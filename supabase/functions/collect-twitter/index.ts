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
      .eq("source", "twitter")
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

    let newCount = 0;
    let dupeCount = 0;

    // Get bearer token
    const BEARER_TOKEN = Deno.env.get("TWITTER_BEARER_TOKEN");
    const CONSUMER_KEY = Deno.env.get("TWITTER_CONSUMER_KEY");
    const CONSUMER_SECRET = Deno.env.get("TWITTER_CONSUMER_SECRET");

    let bearerToken = BEARER_TOKEN;

    if (!bearerToken && CONSUMER_KEY && CONSUMER_SECRET) {
      try {
        const credentials = btoa(`${CONSUMER_KEY}:${CONSUMER_SECRET}`);
        const tokenRes = await fetch("https://api.x.com/oauth2/token", {
          method: "POST",
          headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: "grant_type=client_credentials",
        });
        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          bearerToken = tokenData.access_token;
        }
      } catch (authErr) {
        console.warn("Twitter auth error:", authErr);
      }
    }

    if (!bearerToken) {
      console.log("Twitter API keys not configured, skipping");
      await supabase.from("collection_jobs")
        .update({ status: "completed", new_count: 0, dupe_count: 0, completed_at: new Date().toISOString() })
        .eq("run_id", run_id)
        .eq("source", "twitter");

      await checkAndFinalize(supabase, run_id, company_id, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      return new Response(JSON.stringify({ success: true, new_count: 0, dupe_count: 0, skipped: "no_api_keys" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build search query
    const productTerms = (company.product_terms || []).slice(0, 3);
    const industryType = company.industry_type || "";
    const contextTerms = [
      ...productTerms.map((t: string) => t.split(" ").pop()),
      industryType,
    ].filter(Boolean).slice(0, 3);

    let query: string;
    if (contextTerms.length > 0) {
      const orClauses = contextTerms.map((t: string) => `("${brandName}" ${t})`);
      if (company.domain) orClauses.push(`(${company.domain})`);
      query = `(${orClauses.join(" OR ")}) -is:retweet lang:en`;
    } else {
      query = `"${brandName}" -is:retweet lang:en`;
    }

    console.log(`Twitter search query: ${query}`);

    try {
      const searchUrl = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=100&tweet.fields=author_id,created_at,public_metrics,text`;
      const searchRes = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${bearerToken}` },
      });

      if (!searchRes.ok) {
        console.warn("Twitter search failed:", searchRes.status);
      } else {
        const searchData = await searchRes.json();
        const tweets = searchData?.data || [];
        console.log(`Twitter: found ${tweets.length} tweets`);

        const tweetBatchSize = 20;
        for (let i = 0; i < tweets.length; i += tweetBatchSize) {
          const batch = tweets.slice(i, i + tweetBatchSize);
          const tweetTexts = batch.map((t: any, idx: number) => `${idx + 1}. @${t.author_id}: ${t.text}`).join("\n");

          if (!LOVABLE_API_KEY) continue;

          const extractRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                {
                  role: "system",
                  content: `Extract customer feedback from tweets about ${company.name} (${company.domain}), a ${company.industry_type || "software"} product. Only extract tweets about THIS specific product. Skip promotional tweets, ads, and bot content.`,
                },
                { role: "user", content: `Extract feedback from these tweets about ${company.name}:\n\n${tweetTexts}` },
              ],
              tools: [{
                type: "function",
                function: {
                  name: "extract_feedback",
                  description: "Extract feedback from tweets",
                  parameters: {
                    type: "object",
                    properties: {
                      items: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            tweet_index: { type: "number" },
                            text: { type: "string" },
                            sentiment: { type: "string", enum: ["Positive", "Negative", "Neutral"] },
                            confidence: { type: "number" },
                            pain_point_category: { type: "string", enum: ["UX", "Pricing", "Reliability", "Performance", "Documentation", "Features", "Support", "Security", "Integration", "Other"] },
                            intent_type: { type: "string", enum: ["praise", "bug", "feature_request", "churn_risk", "comparison", "general"] },
                          },
                          required: ["tweet_index", "text", "sentiment", "confidence", "pain_point_category", "intent_type"],
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

          if (!extractRes.ok) continue;

          const extractData = await extractRes.json();
          const toolCall = extractData.choices?.[0]?.message?.tool_calls?.[0];
          if (!toolCall) continue;

          const { items } = JSON.parse(toolCall.function.arguments);
          if (!items || !Array.isArray(items)) continue;

          for (const item of items) {
            if (!item.text || item.text.length < 20 || (item.confidence || 0) < 0.8) continue;

            const feedbackLower = item.text.toLowerCase();
            const allValidationTerms = [...brandTerms, ...(company.product_terms || []), company.domain].filter(Boolean);
            const mentionsBrand = allValidationTerms.some((t: string) => feedbackLower.includes(t.toLowerCase()));
            if (!mentionsBrand && (item.confidence || 0) < 0.85) continue;

            const tweetIdx = (item.tweet_index || 1) - 1;
            const tweet = batch[tweetIdx];
            const tweetUrl = tweet ? `https://x.com/i/status/${tweet.id}` : "";
            const contentHash = await hashText(item.text);

            const { error: insertErr } = await supabase.from("feedback").insert({
              feedback_id: crypto.randomUUID(),
              text: item.text.slice(0, 500),
              customer_name: tweet ? `@${tweet.author_id}` : "Anonymous",
              source: "Twitter",
              sentiment: item.sentiment || "Neutral",
              status: "New",
              channel: "Twitter",
              company_id,
              source_url: tweetUrl,
              content_hash: contentHash,
              pain_point_category: item.pain_point_category,
              intent_type: item.intent_type,
              confidence_score: item.confidence || 0.5,
              original_context_excerpt: null,
            });

            if (insertErr) {
              if (insertErr.message?.includes("idx_feedback_content_hash")) dupeCount++;
              else console.warn("Twitter insert error:", insertErr.message);
            } else {
              newCount++;
            }
          }
        }
      }
    } catch (err) {
      console.warn("Twitter collection error:", err);
    }

    // Mark job completed
    await supabase.from("collection_jobs")
      .update({ status: "completed", new_count: newCount, dupe_count: dupeCount, completed_at: new Date().toISOString() })
      .eq("run_id", run_id)
      .eq("source", "twitter");

    console.log(`Twitter collection complete: ${newCount} new, ${dupeCount} dupes`);

    await checkAndFinalize(supabase, run_id, company_id, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    return new Response(JSON.stringify({ success: true, new_count: newCount, dupe_count: dupeCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("collect-twitter error:", error);
    try {
      const body = await req.clone().json().catch(() => null);
      if (body?.run_id) {
        await supabase.from("collection_jobs")
          .update({ status: "failed", error_message: error instanceof Error ? error.message : "Unknown", completed_at: new Date().toISOString() })
          .eq("run_id", body.run_id)
          .eq("source", "twitter");
      }
    } catch (_) {}
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
