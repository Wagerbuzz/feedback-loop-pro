import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface CompanyRow {
  id: string;
  name: string;
  domain: string;
  brand_terms: string[] | null;
  product_terms: string[] | null;
  feature_terms: string[] | null;
  industry_type: string | null;
  g2_url: string | null;
  capterra_url: string | null;
  trustradius_url: string | null;
  getapp_url: string | null;
}

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

  try {
    const { run_id, company_id } = await req.json();
    if (!run_id || !company_id) {
      return new Response(JSON.stringify({ error: "run_id and company_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark job as running
    await supabase.from("collection_jobs")
      .update({ status: "running", started_at: new Date().toISOString(), attempt: 1 })
      .eq("run_id", run_id)
      .eq("source", "review_sites")
      .eq("status", "pending");

    // Load company
    const { data: company, error: compErr } = await supabase
      .from("companies")
      .select("*")
      .eq("id", company_id)
      .single();
    if (compErr || !company) throw new Error("Company not found");

    const typedCompany = company as unknown as CompanyRow;
    const brandTerms = (company.brand_terms as string[]) || [company.name];
    const brandName = brandTerms[0] || company.name;
    const brandSlug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    // Build review URLs using persisted URLs or slug fallback
    const reviewUrls: { url: string; source: string }[] = [];

    if (typedCompany.g2_url) {
      reviewUrls.push({ url: typedCompany.g2_url, source: "G2" });
      const page2 = typedCompany.g2_url.includes("?") ? `${typedCompany.g2_url}&page=2` : `${typedCompany.g2_url}?page=2`;
      reviewUrls.push({ url: page2, source: "G2" });
    } else {
      reviewUrls.push({ url: `https://www.g2.com/products/${brandSlug}/reviews`, source: "G2" });
    }

    if (typedCompany.trustradius_url) {
      reviewUrls.push({ url: typedCompany.trustradius_url, source: "TrustRadius" });
    } else {
      reviewUrls.push({ url: `https://www.trustradius.com/products/${brandSlug}/reviews`, source: "TrustRadius" });
    }

    if (typedCompany.capterra_url) {
      reviewUrls.push({ url: typedCompany.capterra_url, source: "Capterra" });
    } else {
      reviewUrls.push({ url: `https://www.capterra.com/reviews/${brandSlug}`, source: "Capterra" });
      reviewUrls.push({ url: `https://www.capterra.com/p/${brandSlug}/reviews`, source: "Capterra" });
    }

    if (typedCompany.getapp_url) {
      reviewUrls.push({ url: typedCompany.getapp_url, source: "GetApp" });
    }

    console.log(`Direct review scraping: ${reviewUrls.length} URLs for "${brandName}"`);

    let newCount = 0;
    let dupeCount = 0;

    // Scrape all review URLs in parallel
    const scrapeResults = await Promise.allSettled(
      reviewUrls.map(async ({ url, source }) => {
        try {
          console.log(`Scraping: ${url}`);
          const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
            method: "POST",
            headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
          });
          if (!scrapeRes.ok) {
            console.warn(`Scrape failed (${scrapeRes.status}): ${url}`);
            return { url, source, content: "" };
          }
          const scrapeData = await scrapeRes.json();
          return { url, source, content: scrapeData?.data?.markdown || scrapeData?.markdown || "" };
        } catch (err) {
          console.warn(`Scrape error for ${url}:`, err);
          return { url, source, content: "" };
        }
      })
    );

    const scrapedPages: { url: string; source: string; content: string }[] = [];
    for (const result of scrapeResults) {
      if (result.status !== "fulfilled") continue;
      const { url, source, content } = result.value;
      if (content.length < 300) continue;
      scrapedPages.push({ url, source, content: content.slice(0, 3000) });
    }

    if (scrapedPages.length > 0) {
      const combinedContent = scrapedPages
        .map((p, i) => `--- REVIEW PAGE ${i + 1}: ${p.source} (${p.url}) ---\n${p.content}`)
        .join("\n\n");
      const cappedContent = combinedContent.slice(0, 15000);

      console.log(`Batched extraction: ${scrapedPages.length} pages, ${cappedContent.length} chars`);

      const extractRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            {
              role: "system",
              content: `You extract individual customer feedback items from review pages about ${company.name}. Extract ONLY genuine user reviews - skip editorial content, marketing copy, and navigation text.`,
            },
            {
              role: "user",
              content: `Extract all individual reviews about ${company.name} from these review pages:\n\n${cappedContent}`,
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
                        text: { type: "string", description: "The review text (50-300 chars)" },
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

      if (extractRes.ok) {
        const extractData = await extractRes.json();
        const toolCall = extractData.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall) {
          const { items } = JSON.parse(toolCall.function.arguments);
          if (items && Array.isArray(items)) {
            console.log(`AI returned ${items.length} items`);
            for (const item of items) {
              if (!item.text || item.text.length < 15 || (item.confidence || 0) < 0.5) continue;

              const contentHash = await hashText(item.text);
              const itemUrl = item.source_url || scrapedPages[0]?.url || "";
              const source = getSourceFromUrl(itemUrl);

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
                if (insertErr.message?.includes("idx_feedback_content_hash")) dupeCount++;
                else console.warn("Insert error:", insertErr.message);
              } else {
                newCount++;
              }
            }
          }
        }
      }
    }

    // Mark job completed
    await supabase.from("collection_jobs")
      .update({ status: "completed", new_count: newCount, dupe_count: dupeCount, completed_at: new Date().toISOString() })
      .eq("run_id", run_id)
      .eq("source", "review_sites");

    console.log(`Review scraping complete: ${newCount} new, ${dupeCount} dupes`);

    // Check if all jobs are done and trigger clustering
    await checkAndFinalize(supabase, run_id, company_id, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    return new Response(JSON.stringify({ success: true, new_count: newCount, dupe_count: dupeCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("collect-reviews error:", error);
    // Try to mark job as failed
    try {
      const body = await req.clone().json().catch(() => null);
      if (body?.run_id) {
        await supabase.from("collection_jobs")
          .update({ status: "failed", error_message: error instanceof Error ? error.message : "Unknown", completed_at: new Date().toISOString() })
          .eq("run_id", body.run_id)
          .eq("source", "review_sites");
      }
    } catch (_) {}
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
