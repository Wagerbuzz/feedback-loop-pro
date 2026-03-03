import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function hashText(text: string): Promise<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const data = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getSourceFromUrl(url: string): string {
  const u = (url || "").toLowerCase();
  if (u.includes("g2.com")) return "G2";
  if (u.includes("trustradius.com")) return "TrustRadius";
  if (u.includes("capterra.com")) return "Capterra";
  if (u.includes("getapp.com")) return "GetApp";
  if (u.includes("reddit.com")) return "Reddit";
  if (u.includes("producthunt.com")) return "ProductHunt";
  if (u.includes("news.ycombinator.com")) return "HackerNews";
  return "Web";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!FIRECRAWL_API_KEY || !LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "Missing API keys" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Save these early so the finally block can use them
  let savedRunId: string | null = null;
  let savedCompanyId: string | null = null;
  let newCount = 0;
  let dupeCount = 0;
  let completed = false;

  try {
    const { run_id, company_id } = await req.json();
    savedRunId = run_id;
    savedCompanyId = company_id;

    if (!run_id || !company_id) {
      return new Response(JSON.stringify({ error: "run_id and company_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark job as running
    await supabase.from("collection_jobs")
      .update({ status: "running", started_at: new Date().toISOString(), attempt: 1 })
      .eq("run_id", run_id)
      .eq("source", "web")
      .eq("status", "pending");

    // Load company
    const { data: company, error: compErr } = await supabase
      .from("companies")
      .select("*")
      .eq("id", company_id)
      .single();
    if (compErr || !company) throw new Error("Company not found");

    const queries = (company.search_queries as any[]) || [];
    const brandTerms = (company.brand_terms as string[]) || [company.name];
    const scrapedUrls = new Set<string>();

    // 80s budget for web phase (leave 10s for cleanup before 120s Deno timeout)
    const startTime = Date.now();
    const BUDGET_MS = 80000;
    const webQueryLimit = 15;

    const processQuery = async (q: any) => {
      let queryNew = 0;
      let queryDupes = 0;

      try {
        if (Date.now() - startTime > BUDGET_MS) return { queryNew, queryDupes };

        console.log(`Searching: ${q.query_text}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const searchRes = await fetch("https://api.firecrawl.dev/v1/search", {
          method: "POST",
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: q.query_text, limit: 5, scrapeOptions: { formats: ["markdown"] } }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!searchRes.ok) {
          console.warn(`Search failed for "${q.query_text}": ${searchRes.status}`);
          return { queryNew, queryDupes };
        }

        const searchData = await searchRes.json();
        const results = searchData?.data || [];

        const relevantResults: { url: string; content: string }[] = [];

        for (const result of results) {
          const content = result.markdown || "";
          if (content.length < 300) continue;

          const url = result.url || "";
          const urlLower = url.toLowerCase();

          if (scrapedUrls.has(urlLower)) continue;
          scrapedUrls.add(urlLower);

          const isOtherProductPage = urlLower.includes('/products/') &&
            !brandTerms.some((t: string) => urlLower.includes(t.toLowerCase()));
          const isCategoryPage = urlLower.includes('/categories/');
          if (isOtherProductPage || isCategoryPage) continue;

          const lowerContent = content.toLowerCase();
          const hasBrandMention = brandTerms.some((t: string) => lowerContent.includes(t.toLowerCase()));
          const prodTerms = (company.product_terms as string[]) || [];
          const hasProductMention = prodTerms.some((t: string) => lowerContent.includes(t.toLowerCase()));
          const hasDomainMention = company.domain ? lowerContent.includes(company.domain.toLowerCase()) : false;
          const urlMentionsBrand = brandTerms.some((t: string) => urlLower.includes(t.toLowerCase()));

          if (!hasBrandMention && !hasProductMention && !hasDomainMention && !urlMentionsBrand) continue;

          const affiliateKeywords = ["affiliate", "sponsored post", "paid partnership", "commission"];
          if (affiliateKeywords.some((k) => lowerContent.includes(k))) continue;

          relevantResults.push({ url, content: content.slice(0, 2000) });
        }

        if (relevantResults.length === 0) return { queryNew, queryDupes };

        const combinedContent = relevantResults
          .map((r, i) => `--- SOURCE ${i + 1}: ${r.url} ---\n${r.content}`)
          .join("\n\n");
        const cappedContent = combinedContent.slice(0, 12000);

        console.log(`Batched extraction for "${q.query_text}": ${relevantResults.length} results, ${cappedContent.length} chars`);

        const aiController = new AbortController();
        const aiTimeout = setTimeout(() => aiController.abort(), 25000);
        const extractRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          signal: aiController.signal,
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            messages: [
              {
                role: "system",
                content: `You extract individual customer feedback items from web content about ${company.name}. Extract ONLY genuine user opinions about ${company.name} or its products (${brandTerms.join(', ')}). Skip marketing copy, author bios, and navigation text.`,
              },
              {
                role: "user",
                content: `Extract feedback items ONLY about ${company.name} from these pages:\n\n${cappedContent}`,
              },
            ],
            tools: [{
              type: "function",
              function: {
                name: "extract_feedback",
                description: "Extract structured feedback items",
                parameters: {
                  type: "object",
                  properties: {
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          author: { type: "string" },
                          text: { type: "string" },
                          sentiment: { type: "string", enum: ["Positive", "Negative", "Neutral"] },
                          confidence: { type: "number" },
                          source_url: { type: "string" },
                          pain_point_category: { type: "string", enum: ["UX", "Pricing", "Reliability", "Performance", "Documentation", "Features", "Support", "Security", "Integration", "Other"] },
                          intent_type: { type: "string", enum: ["praise", "bug", "feature_request", "churn_risk", "comparison", "general"] },
                          context_excerpt: { type: "string" },
                        },
                        required: ["author", "text", "sentiment", "confidence", "source_url", "pain_point_category", "intent_type"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["items"],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "extract_feedback" } },
          }),
        });
        clearTimeout(aiTimeout);

        if (!extractRes.ok) {
          if (extractRes.status === 429) await new Promise((r) => setTimeout(r, 5000));
          return { queryNew, queryDupes };
        }

        const extractData = await extractRes.json();
        const toolCall = extractData.choices?.[0]?.message?.tool_calls?.[0];
        if (!toolCall) return { queryNew, queryDupes };

        const { items } = JSON.parse(toolCall.function.arguments);
        if (!items || !Array.isArray(items)) return { queryNew, queryDupes };

        console.log(`Web AI returned ${items.length} items for "${q.query_text}"`);

        for (const item of items) {
          if (!item.text || item.text.length < 15 || (item.confidence || 0) < 0.6) continue;

          const feedbackLower = item.text.toLowerCase();
          const mentionsBrand = brandTerms.some((t: string) => feedbackLower.includes(t.toLowerCase()));
          if (!mentionsBrand && (item.confidence || 0) < 0.75) continue;

          const itemUrl = item.source_url || relevantResults[0]?.url || "";
          const source = getSourceFromUrl(itemUrl);
          const contentHash = await hashText(item.text);

          const { error: insertErr } = await supabase.from("feedback").insert({
            feedback_id: crypto.randomUUID(),
            text: item.text.slice(0, 500),
            customer_name: item.author || "Anonymous",
            source,
            sentiment: item.sentiment || "Neutral",
            status: "New",
            channel: source,
            company_id,
            source_url: itemUrl,
            content_hash: contentHash,
            pain_point_category: item.pain_point_category,
            intent_type: item.intent_type,
            confidence_score: item.confidence || 0.5,
            original_context_excerpt: item.context_excerpt?.slice(0, 200) || null,
          });

          if (insertErr) {
            if (insertErr.message?.includes("idx_feedback_content_hash")) queryDupes++;
            else console.warn("Insert error:", insertErr.message);
          } else {
            queryNew++;
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          console.warn(`Query timeout for "${q.query_text}"`);
        } else {
          console.warn(`Query error for "${q.query_text}":`, err);
        }
      }

      return { queryNew, queryDupes };
    };

    // Process queries in parallel batches of 5
    const queriesToProcess = queries.slice(0, webQueryLimit);
    const batchSize = 5;
    for (let i = 0; i < queriesToProcess.length; i += batchSize) {
      if (Date.now() - startTime > BUDGET_MS) {
        console.log(`Web phase time budget exceeded (${Date.now() - startTime}ms)`);
        break;
      }

      const batch = queriesToProcess.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} queries`);
      const results = await Promise.allSettled(batch.map(q => processQuery(q)));

      for (const result of results) {
        if (result.status === "fulfilled") {
          newCount += result.value.queryNew;
          dupeCount += result.value.queryDupes;
        }
      }
    }

    // Mark job completed
    await supabase.from("collection_jobs")
      .update({ status: "completed", new_count: newCount, dupe_count: dupeCount, completed_at: new Date().toISOString() })
      .eq("run_id", run_id)
      .eq("source", "web");

    completed = true;
    console.log(`Web collection complete: ${newCount} new, ${dupeCount} dupes`);

    // Check if all jobs done
    await checkAndFinalize(supabase, run_id, company_id, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    return new Response(JSON.stringify({ success: true, new_count: newCount, dupe_count: dupeCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("collect-web error:", error);
    if (savedRunId) {
      await supabase.from("collection_jobs")
        .update({ status: "failed", error_message: error instanceof Error ? error.message : "Unknown", completed_at: new Date().toISOString() })
        .eq("run_id", savedRunId)
        .eq("source", "web").catch(() => {});

      if (savedCompanyId) {
        await checkAndFinalize(supabase, savedRunId, savedCompanyId, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).catch(() => {});
      }
    }
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function checkAndFinalize(supabase: any, runId: string, companyId: string, supabaseUrl: string, serviceKey: string) {
  const { data: jobs } = await supabase
    .from("collection_jobs")
    .select("source, status")
    .eq("run_id", runId);
  if (!jobs) return;
  const nonClusterJobs = jobs.filter((j: any) => j.source !== "cluster");
  const allDone = nonClusterJobs.every((j: any) => j.status === "completed" || j.status === "failed");
  if (allDone) {
    console.log("All source jobs done, triggering clustering...");
    fetch(`${supabaseUrl}/functions/v1/collect-cluster`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId, company_id: companyId }),
    }).catch((err) => console.warn("Failed to trigger clustering:", err));
  }
}
