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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let savedRunId: string | null = null;
  let savedCompanyId: string | null = null;

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
      .eq("source", "reddit")
      .eq("status", "pending");

    // Load company
    const { data: company, error: compErr } = await supabase
      .from("companies")
      .select("*")
      .eq("id", company_id)
      .single();
    if (compErr || !company) throw new Error("Company not found");

    const brandTerms = (company.brand_terms as string[]) || [company.name];
    const brandName = brandTerms[0] || company.name;
    const minScore = company.reddit_min_score ?? 5;
    const maxAgeDays = company.reddit_max_age_days ?? 90;
    const cutoffTimestamp = Math.floor(Date.now() / 1000) - maxAgeDays * 86400;

    let subreddits = (company.reddit_subreddits as string[]) || [];

    // Fallback subreddits based on industry
    if (subreddits.length === 0 && company.industry_type) {
      const INDUSTRY_SUBREDDITS: Record<string, string[]> = {
        "SEO": ["SEO", "bigseo", "digital_marketing"],
        "SaaS": ["SaaS", "startups", "software"],
        "Database": ["databases", "dataengineering", "devops"],
        "Analytics": ["analytics", "datascience", "BusinessIntelligence"],
        "Marketing": ["marketing", "digital_marketing", "content_marketing"],
        "E-commerce": ["ecommerce", "shopify", "smallbusiness"],
        "Security": ["netsec", "cybersecurity", "infosec"],
        "DevOps": ["devops", "sysadmin", "kubernetes"],
        "AI": ["artificial", "MachineLearning", "ChatGPT"],
        "CRM": ["sales", "CRM", "smallbusiness"],
        "Project Management": ["projectmanagement", "agile", "scrum"],
        "HR": ["humanresources", "recruiting", "jobs"],
      };
      const industryKey = Object.keys(INDUSTRY_SUBREDDITS).find(
        (k) => (company.industry_type || "").toLowerCase().includes(k.toLowerCase())
      );
      if (industryKey) {
        subreddits = INDUSTRY_SUBREDDITS[industryKey];
        console.log(`Using fallback subreddits for ${company.industry_type}: ${subreddits.join(", ")}`);
      }
    }

    // Build Reddit JSON API queries
    const redditEndpoints: { url: string; label: string }[] = [
      {
        url: `https://www.reddit.com/search.json?q=${encodeURIComponent(brandName)}&type=link&sort=new&limit=25`,
        label: `cross-reddit: "${brandName}"`,
      },
    ];
    for (const sub of subreddits.slice(0, 4)) {
      redditEndpoints.push({
        url: `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(brandName)}&restrict_sr=1&sort=top&limit=25`,
        label: `r/${sub}: "${brandName}"`,
      });
    }

    const allPosts: { title: string; selftext: string; author: string; score: number; permalink: string }[] = [];
    const seenPostIds = new Set<string>();

    let newCount = 0;
    let dupeCount = 0;

    for (const endpoint of redditEndpoints) {
      try {
        console.log(`Reddit JSON API: ${endpoint.label}`);
        const res = await fetch(endpoint.url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; FeedbackCollector/1.0; +https://feedbackflow.app)",
            "Accept": "application/json",
          },
        });

        if (!res.ok) {
          console.warn(`Reddit API failed (${res.status}) for ${endpoint.label}`);
          if (res.status === 429) await new Promise((r) => setTimeout(r, 3000));
          continue;
        }

        const data = await res.json();
        const children = data?.data?.children || [];
        console.log(`Reddit: ${children.length} results from ${endpoint.label}`);

        for (const child of children) {
          const post = child.data;
          if (!post || seenPostIds.has(post.id)) continue;
          seenPostIds.add(post.id);

          if ((post.score || 0) < minScore) continue;
          if (post.created_utc && post.created_utc < cutoffTimestamp) continue;

          const selftext = post.selftext || "";
          const title = post.title || "";
          if (selftext.length < 30 && title.length < 30) continue;

          allPosts.push({
            title,
            selftext: selftext.slice(0, 1500),
            author: post.author || "Anonymous",
            score: post.score || 0,
            permalink: post.permalink ? `https://www.reddit.com${post.permalink}` : "",
          });
        }
      } catch (err) {
        console.warn(`Reddit endpoint error:`, err);
      }
    }

    console.log(`Reddit: ${allPosts.length} qualifying posts (score >= ${minScore}, age <= ${maxAgeDays}d)`);

    if (allPosts.length > 0) {
      const batchSize = 15;
      for (let i = 0; i < allPosts.length; i += batchSize) {
        const batch = allPosts.slice(i, i + batchSize);
        const combinedContent = batch
          .map((p, idx) => `--- POST ${idx + 1} (score: ${p.score}, by u/${p.author}) ---\nTitle: ${p.title}\n${p.selftext}\nURL: ${p.permalink}`)
          .join("\n\n");

        try {
          const extractRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-lite",
              messages: [
                {
                  role: "system",
                  content: `You extract customer feedback from Reddit posts about ${company.name}. Extract ONLY genuine user opinions DIRECTLY about ${company.name} or its products (${brandTerms.join(", ")}). Skip off-topic comments.`,
                },
                {
                  role: "user",
                  content: `Extract feedback about ${company.name} from these Reddit posts:\n\n${combinedContent.slice(0, 12000)}`,
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
                            post_index: { type: "number" },
                            author: { type: "string" },
                            text: { type: "string" },
                            sentiment: { type: "string", enum: ["Positive", "Negative", "Neutral"] },
                            confidence: { type: "number" },
                            pain_point_category: { type: "string", enum: ["UX", "Pricing", "Reliability", "Performance", "Documentation", "Features", "Support", "Security", "Integration", "Other"] },
                            intent_type: { type: "string", enum: ["praise", "bug", "feature_request", "churn_risk", "comparison", "general"] },
                            context_excerpt: { type: "string" },
                          },
                          required: ["post_index", "author", "text", "sentiment", "confidence", "pain_point_category", "intent_type"],
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

          if (!extractRes.ok) {
            if (extractRes.status === 429) await new Promise((r) => setTimeout(r, 5000));
            continue;
          }

          const extractData = await extractRes.json();
          const toolCall = extractData.choices?.[0]?.message?.tool_calls?.[0];
          if (!toolCall) continue;

          const { items } = JSON.parse(toolCall.function.arguments);
          if (!items || !Array.isArray(items)) continue;

          console.log(`Reddit AI returned ${items.length} items for batch ${Math.floor(i / batchSize) + 1}`);

          for (const item of items) {
            if (!item.text || item.text.length < 15 || (item.confidence || 0) < 0.6) continue;

            const feedbackLower = item.text.toLowerCase();
            const mentionsBrand = brandTerms.some((t) => feedbackLower.includes(t.toLowerCase()));
            if (!mentionsBrand && (item.confidence || 0) < 0.75) continue;

            const postIdx = (item.post_index || 1) - 1;
            const post = batch[postIdx];
            const contentHash = await hashText(item.text);

            const { error: insertErr } = await supabase.from("feedback").insert({
              feedback_id: crypto.randomUUID(),
              text: item.text.slice(0, 500),
              customer_name: item.author || post?.author || "Anonymous",
              source: "Reddit",
              sentiment: item.sentiment || "Neutral",
              status: "New",
              channel: "Reddit",
              company_id,
              source_url: post?.permalink || "",
              content_hash: contentHash,
              pain_point_category: item.pain_point_category,
              intent_type: item.intent_type,
              confidence_score: item.confidence || 0.5,
              original_context_excerpt: item.context_excerpt?.slice(0, 200) || null,
            });

            if (insertErr) {
              if (insertErr.message?.includes("idx_feedback_content_hash")) dupeCount++;
              else console.warn("Reddit insert error:", insertErr.message);
            } else {
              newCount++;
            }
          }
        } catch (aiErr) {
          console.warn("Reddit AI extraction error:", aiErr);
        }
      }
    }

    // Mark job completed
    await supabase.from("collection_jobs")
      .update({ status: "completed", new_count: newCount, dupe_count: dupeCount, completed_at: new Date().toISOString() })
      .eq("run_id", run_id)
      .eq("source", "reddit");

    console.log(`Reddit collection complete: ${newCount} new, ${dupeCount} dupes`);

    await checkAndFinalize(supabase, run_id, company_id, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    return new Response(JSON.stringify({ success: true, new_count: newCount, dupe_count: dupeCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("collect-reddit error:", error);
    if (savedRunId) {
      await supabase.from("collection_jobs")
        .update({ status: "failed", error_message: error instanceof Error ? error.message : "Unknown", completed_at: new Date().toISOString() })
        .eq("run_id", savedRunId)
        .eq("source", "reddit").catch(() => {});

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
  const { data: jobs } = await supabase.from("collection_jobs").select("source, status").eq("run_id", runId);
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
