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

// Direct review site scraping - construct known review URLs and scrape them directly
async function collectDirectReviews(
  company: any,
  brandTerms: string[],
  supabaseClient: any,
  companyId: string,
  lovableApiKey: string,
  firecrawlApiKey: string,
  scrapedUrls: Set<string>
): Promise<{ newCount: number; dupeCount: number; texts: string[] }> {
  let newCount = 0;
  let dupeCount = 0;
  const texts: string[] = [];

  const brandName = brandTerms[0] || company.name;
  const brandSlug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  // Construct known review page URLs
  const reviewUrls = [
    { url: `https://www.g2.com/products/${brandSlug}/reviews`, source: "G2" },
    { url: `https://www.g2.com/products/${brandSlug}/reviews?page=2`, source: "G2" },
    { url: `https://www.trustradius.com/products/${brandSlug}/reviews`, source: "TrustRadius" },
    { url: `https://www.capterra.com/reviews/${brandSlug}`, source: "Capterra" },
    { url: `https://www.capterra.com/p/${brandSlug}/reviews`, source: "Capterra" },
  ];

  console.log(`Direct review scraping: ${reviewUrls.length} URLs for "${brandName}" (slug: ${brandSlug})`);

  // Scrape all review URLs in parallel (they're independent)
  const scrapeResults = await Promise.allSettled(
    reviewUrls.map(async ({ url, source }) => {
      const urlLower = url.toLowerCase();
      if (scrapedUrls.has(urlLower)) {
        console.log(`Direct scrape: skipping duplicate URL: ${url}`);
        return { url, source, content: "", skipped: true };
      }
      scrapedUrls.add(urlLower);

      try {
        console.log(`Direct scrape: ${url}`);
        const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: { Authorization: `Bearer ${firecrawlApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
        });

        if (!scrapeRes.ok) {
          console.warn(`Direct scrape failed (${scrapeRes.status}): ${url}`);
          return { url, source, content: "", skipped: false };
        }

        const scrapeData = await scrapeRes.json();
        const content = scrapeData?.data?.markdown || scrapeData?.markdown || "";
        return { url, source, content, skipped: false };
      } catch (err) {
        console.warn(`Direct scrape error for ${url}:`, err);
        return { url, source, content: "", skipped: false };
      }
    })
  );

  // Process scraped content through AI extraction
  for (const result of scrapeResults) {
    if (result.status !== "fulfilled") continue;
    const { url, source, content, skipped } = result.value;
    if (skipped || content.length < 300) continue;

    try {
      const extractRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `You extract individual customer feedback items from ${source} review pages about ${company.name}. This is a direct review page for ${company.name}, so all reviews on this page should be about this product. Extract each individual review as a separate feedback item. Include the reviewer's name if available. Extract ONLY genuine user reviews - skip editorial content, marketing copy, and navigation text.`,
            },
            {
              role: "user",
              content: `Extract all individual reviews about ${company.name} from this ${source} page:\n\nURL: ${url}\n\n${content.slice(0, 8000)}`,
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_feedback",
                description: "Extract structured feedback items from review page",
                parameters: {
                  type: "object",
                  properties: {
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          author: { type: "string", description: "Reviewer name or anonymous" },
                          text: { type: "string", description: "The review text (50-300 chars)" },
                          sentiment: { type: "string", enum: ["Positive", "Negative", "Neutral"] },
                          confidence: { type: "number", description: "Confidence 0-1" },
                          pain_point_category: {
                            type: "string",
                            enum: ["UX", "Pricing", "Reliability", "Performance", "Documentation", "Features", "Support", "Security", "Integration", "Other"],
                          },
                          intent_type: {
                            type: "string",
                            enum: ["praise", "bug", "feature_request", "churn_risk", "comparison", "general"],
                          },
                          context_excerpt: { type: "string", description: "Surrounding context (100 chars)" },
                        },
                        required: ["author", "text", "sentiment", "confidence", "pain_point_category", "intent_type"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["items"],
                  additionalProperties: false,
                },
              },
            },
          ],
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

      for (const item of items) {
        if (!item.text || item.text.length < 20 || (item.confidence || 0) < 0.6) continue;

        const contentHash = await hashText(item.text);

        const feedbackRow = {
          feedback_id: `DIR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          text: item.text.slice(0, 500),
          customer_name: item.author || "Anonymous",
          source,
          sentiment: item.sentiment || "Neutral",
          status: "New",
          channel: source,
          company_id: companyId,
          source_url: url,
          content_hash: contentHash,
          pain_point_category: item.pain_point_category,
          intent_type: item.intent_type,
          confidence_score: item.confidence || 0.5,
          original_context_excerpt: item.context_excerpt?.slice(0, 200) || null,
        };

        const { error: insertErr } = await supabaseClient.from("feedback").insert(feedbackRow);

        if (insertErr) {
          if (insertErr.message?.includes("idx_feedback_content_hash")) dupeCount++;
          else console.warn("Direct review insert error:", insertErr.message);
        } else {
          newCount++;
          texts.push(item.text);
        }
      }
    } catch (aiErr) {
      console.warn("Direct review AI extraction error:", aiErr);
    }
  }

  console.log(`Direct review scraping: ${newCount} new, ${dupeCount} dupes`);
  return { newCount, dupeCount, texts };
}

// Reddit collection via Firecrawl search (direct Reddit API is blocked with 403)
async function collectRedditFeedback(
  company: any,
  brandTerms: string[],
  supabaseClient: any,
  companyId: string,
  lovableApiKey: string,
  firecrawlApiKey: string
): Promise<{ newCount: number; dupeCount: number; texts: string[] }> {
  let newCount = 0;
  let dupeCount = 0;
  const texts: string[] = [];

  const collectionSources = (company.collection_sources as string[]) || ["web", "reddit"];
  if (!collectionSources.includes("reddit")) {
    console.log("Reddit collection disabled for this company");
    return { newCount, dupeCount, texts };
  }

  const brandName = brandTerms[0] || company.name;
  let subreddits = (company.reddit_subreddits as string[]) || [];

  // Fallback subreddits based on industry_type if none configured
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
      (k) => company.industry_type.toLowerCase().includes(k.toLowerCase())
    );
    if (industryKey) {
      subreddits = INDUSTRY_SUBREDDITS[industryKey];
      console.log(`Using fallback subreddits for ${company.industry_type}: ${subreddits.join(", ")}`);
    }
  }

  // Build Firecrawl search queries targeting Reddit
  const redditQueries: string[] = [
    `${brandName} site:reddit.com`,
  ];
  for (const sub of subreddits.slice(0, 4)) {
    redditQueries.push(`${brandName} site:reddit.com/r/${sub}`);
  }

  for (const query of redditQueries) {
    try {
      console.log(`Reddit via Firecrawl: ${query}`);
      const searchRes = await fetch("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${firecrawlApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          limit: 5,
          scrapeOptions: { formats: ["markdown"] },
        }),
      });

      if (!searchRes.ok) {
        console.warn(`Reddit Firecrawl search failed: ${searchRes.status} for "${query}"`);
        continue;
      }

      const searchData = await searchRes.json();
      const results = searchData?.data || [];
      console.log(`Reddit Firecrawl: ${results.length} results for "${query}"`);

      for (const result of results) {
        const content = result.markdown || "";
        if (content.length < 200) continue;

        const url = result.url || "";

        // Extract feedback via AI
        try {
          const extractRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                {
                  role: "system",
                  content: `You extract individual customer feedback items from Reddit content about ${company.name}. Extract ONLY genuine user opinions, complaints, praise, or feature requests that are DIRECTLY about ${company.name} or its products (${brandTerms.join(", ")}). Do NOT extract opinions about other products. Skip generic or off-topic comments. If the page URL or title clearly indicates this is a discussion about ${company.name}, you can extract feedback even if the text doesn't explicitly repeat the brand name.`,
                },
                {
                  role: "user",
                  content: `Extract feedback items ONLY about ${company.name} from this Reddit page:\n\nURL: ${url}\n\n${content.slice(0, 6000)}`,
                },
              ],
              tools: [
                {
                  type: "function",
                  function: {
                    name: "extract_feedback",
                    description: "Extract structured feedback items from Reddit content",
                    parameters: {
                      type: "object",
                      properties: {
                        items: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              author: { type: "string" },
                              text: { type: "string", description: "The feedback text (50-300 chars)" },
                              sentiment: { type: "string", enum: ["Positive", "Negative", "Neutral"] },
                              confidence: { type: "number", description: "Confidence 0-1" },
                              pain_point_category: {
                                type: "string",
                                enum: ["UX", "Pricing", "Reliability", "Performance", "Documentation", "Features", "Support", "Security", "Integration", "Other"],
                              },
                              intent_type: {
                                type: "string",
                                enum: ["praise", "bug", "feature_request", "churn_risk", "comparison", "general"],
                              },
                              context_excerpt: { type: "string" },
                            },
                            required: ["author", "text", "sentiment", "confidence", "pain_point_category", "intent_type"],
                            additionalProperties: false,
                          },
                        },
                      },
                      required: ["items"],
                      additionalProperties: false,
                    },
                  },
                },
              ],
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

          for (const item of items) {
            if (!item.text || item.text.length < 20 || (item.confidence || 0) < 0.7) continue;

            const feedbackLower = item.text.toLowerCase();
            const mentionsBrand = brandTerms.some((t) => feedbackLower.includes(t.toLowerCase()));
            if (!mentionsBrand && (item.confidence || 0) < 0.8) continue;

            const contentHash = await hashText(item.text);

            const feedbackRow = {
              feedback_id: `RED-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              text: item.text.slice(0, 500),
              customer_name: item.author || "Anonymous",
              source: "Reddit",
              sentiment: item.sentiment || "Neutral",
              status: "New",
              channel: "Reddit",
              company_id: companyId,
              source_url: url,
              content_hash: contentHash,
              pain_point_category: item.pain_point_category,
              intent_type: item.intent_type,
              confidence_score: item.confidence || 0.5,
              original_context_excerpt: item.context_excerpt?.slice(0, 200) || null,
            };

            const { error: insertErr } = await supabaseClient.from("feedback").insert(feedbackRow);

            if (insertErr) {
              if (insertErr.message?.includes("idx_feedback_content_hash")) dupeCount++;
              else console.warn("Reddit insert error:", insertErr.message);
            } else {
              newCount++;
              texts.push(item.text);
            }
          }
        } catch (aiErr) {
          console.warn("Reddit AI extraction error:", aiErr);
        }
      }
    } catch (searchErr) {
      console.warn("Reddit Firecrawl search error:", searchErr);
    }
  }

  console.log(`Reddit collection: ${newCount} new, ${dupeCount} dupes`);
  return { newCount, dupeCount, texts };
}

// Twitter/X API v2 collection
async function collectTwitterFeedback(
  company: any,
  brandTerms: string[],
  supabaseClient: any,
  companyId: string,
  lovableApiKey: string
): Promise<{ newCount: number; dupeCount: number; texts: string[] }> {
  let newCount = 0;
  let dupeCount = 0;
  const texts: string[] = [];

  const collectionSources = (company.collection_sources as string[]) || ["web", "reddit"];
  if (!collectionSources.includes("twitter")) {
    console.log("Twitter collection disabled for this company");
    return { newCount, dupeCount, texts };
  }

  const BEARER_TOKEN = Deno.env.get("TWITTER_BEARER_TOKEN");
  const CONSUMER_KEY = Deno.env.get("TWITTER_CONSUMER_KEY");
  const CONSUMER_SECRET = Deno.env.get("TWITTER_CONSUMER_SECRET");

  let bearerToken = BEARER_TOKEN;

  if (!bearerToken && CONSUMER_KEY && CONSUMER_SECRET) {
    // Fall back to OAuth 2.0 client credentials flow
    try {
      const credentials = btoa(`${CONSUMER_KEY}:${CONSUMER_SECRET}`);
      const tokenRes = await fetch("https://api.x.com/oauth2/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });

      if (!tokenRes.ok) {
        console.warn("Twitter OAuth token exchange failed:", tokenRes.status);
        return { newCount, dupeCount, texts };
      }

      const tokenData = await tokenRes.json();
      bearerToken = tokenData.access_token;
    } catch (authErr) {
      console.warn("Twitter auth error:", authErr);
      return { newCount, dupeCount, texts };
    }
  } else if (!bearerToken) {
    console.log("Twitter API keys not configured, skipping Twitter collection");
    return { newCount, dupeCount, texts };
  }

  const brandName = brandTerms[0] || company.name;

  // Build disambiguated Twitter search query using product terms and industry
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
    // Search recent tweets
    const searchUrl = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=100&tweet.fields=author_id,created_at,public_metrics,text`;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });

    if (!searchRes.ok) {
      console.warn("Twitter search failed:", searchRes.status);
      return { newCount, dupeCount, texts };
    }

    const searchData = await searchRes.json();
    const tweets = searchData?.data || [];

    console.log(`Twitter: found ${tweets.length} tweets`);

    // Process tweets in batches through AI extraction
    const batchSize = 20;
    for (let i = 0; i < tweets.length; i += batchSize) {
      const batch = tweets.slice(i, i + batchSize);
      const tweetTexts = batch.map((t: any, idx: number) => `${idx + 1}. @${t.author_id}: ${t.text}`).join("\n");

      const extractRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `Extract customer feedback from tweets about ${company.name} (${company.domain}), a ${company.industry_type || "software"} product. Only extract tweets about THIS specific product, not other products that share the same name. Skip tweets about unrelated products, promotional tweets, ads, and bot content.`,
            },
            { role: "user", content: `Extract feedback from these tweets about ${company.name}:\n\n${tweetTexts}` },
          ],
          tools: [
            {
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
                          tweet_index: { type: "number", description: "1-based index of the tweet" },
                          text: { type: "string" },
                          sentiment: { type: "string", enum: ["Positive", "Negative", "Neutral"] },
                          confidence: { type: "number" },
                          pain_point_category: {
                            type: "string",
                            enum: ["UX", "Pricing", "Reliability", "Performance", "Documentation", "Features", "Support", "Security", "Integration", "Other"],
                          },
                          intent_type: {
                            type: "string",
                            enum: ["praise", "bug", "feature_request", "churn_risk", "comparison", "general"],
                          },
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
            },
          ],
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

      for (const item of items) {
        if (!item.text || item.text.length < 20 || (item.confidence || 0) < 0.8) continue;

        // Post-extraction brand validation: check feedback mentions brand-relevant terms
        const feedbackLower = item.text.toLowerCase();
        const allValidationTerms = [...brandTerms, ...(company.product_terms || []), company.domain].filter(Boolean);
        const mentionsBrand = allValidationTerms.some((t: string) => feedbackLower.includes(t.toLowerCase()));
        if (!mentionsBrand && (item.confidence || 0) < 0.85) continue;

        const tweetIdx = (item.tweet_index || 1) - 1;
        const tweet = batch[tweetIdx];
        const tweetUrl = tweet ? `https://x.com/i/status/${tweet.id}` : "";

        const contentHash = await hashText(item.text);

        const feedbackRow = {
          feedback_id: `TW-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          text: item.text.slice(0, 500),
          customer_name: tweet ? `@${tweet.author_id}` : "Anonymous",
          source: "Twitter",
          sentiment: item.sentiment || "Neutral",
          status: "New",
          channel: "Twitter",
          company_id: companyId,
          source_url: tweetUrl,
          content_hash: contentHash,
          pain_point_category: item.pain_point_category,
          intent_type: item.intent_type,
          confidence_score: item.confidence || 0.5,
          original_context_excerpt: null,
        };

        const { error: insertErr } = await supabaseClient.from("feedback").insert(feedbackRow);

        if (insertErr) {
          if (insertErr.message?.includes("idx_feedback_content_hash")) dupeCount++;
          else console.warn("Twitter insert error:", insertErr.message);
        } else {
          newCount++;
          texts.push(item.text);
        }
      }
    }
  } catch (err) {
    console.warn("Twitter collection error:", err);
  }

  console.log(`Twitter collection: ${newCount} new, ${dupeCount} dupes`);
  return { newCount, dupeCount, texts };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!FIRECRAWL_API_KEY) return errResp("FIRECRAWL_API_KEY not configured");
  if (!LOVABLE_API_KEY) return errResp("LOVABLE_API_KEY not configured");

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { company_id } = await req.json();
    if (!company_id) return errResp("company_id required", 400);

    // Load company
    const { data: company, error: compErr } = await supabase
      .from("companies")
      .select("*")
      .eq("id", company_id)
      .single();
    if (compErr || !company) return errResp("Company not found", 404);

    // Create collection run
    const { data: run } = await supabase
      .from("collection_runs")
      .insert({ company_id, status: "running" })
      .select("id")
      .single();
    const runId = run?.id;

    let totalNew = 0;
    let totalDuplicates = 0;
    const allFeedbackTexts: string[] = [];

    const queries = (company.search_queries as any[]) || [];
    const brandTerms = (company.brand_terms as string[]) || [company.name];
    const collectionSources = (company.collection_sources as string[]) || ["web", "reddit"];

    // Time budget management
    const startTime = Date.now();
    const TIME_BUDGET_MS = 55000; // 55s total (leave 5s margin)
    const hasMultipleSources = collectionSources.length > 1;
    const webQueryLimit = hasMultipleSources ? 20 : 25;
    const webBudgetMs = hasMultipleSources ? 40000 : 50000;

    console.log(`Starting collection for ${company.name} with ${queries.length} queries (limit: ${webQueryLimit}), sources: ${collectionSources.join(", ")}`);

    // URL deduplication across all phases
    const scrapedUrls = new Set<string>();

    // ===== Phase 0: Direct Review Site Scraping (15s cap) =====
    if (collectionSources.includes("web")) {
      console.log("Starting direct review scraping phase (15s cap)...");
      const PHASE0_BUDGET_MS = 15000;
      const directPromise = collectDirectReviews(company, brandTerms, supabase, company_id, LOVABLE_API_KEY, FIRECRAWL_API_KEY, scrapedUrls);
      const timeoutPromise = new Promise<{ newCount: number; dupeCount: number; texts: string[] }>((resolve) =>
        setTimeout(() => {
          console.log("Phase 0 timed out at 15s, moving on");
          resolve({ newCount: 0, dupeCount: 0, texts: [] });
        }, PHASE0_BUDGET_MS)
      );
      const directResult = await Promise.race([directPromise, timeoutPromise]);
      totalNew += directResult.newCount;
      totalDuplicates += directResult.dupeCount;
      allFeedbackTexts.push(...directResult.texts);
      console.log(`Direct review phase complete (elapsed: ${Date.now() - startTime}ms)`);
    }

    // Reset timer so web phase gets its own independent budget
    const webPhaseStart = Date.now();

    // ===== Phase 1: Firecrawl Web Search (Parallel Batched) =====
    if (collectionSources.includes("web")) {
      console.log("Starting web collection phase...");

      const processQuery = async (q: any) => {
        let queryNew = 0;
        let queryDupes = 0;
        const queryTexts: string[] = [];

        try {
          console.log(`Searching: ${q.query_text}`);
          const searchRes = await fetch("https://api.firecrawl.dev/v1/search", {
            method: "POST",
            headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              query: q.query_text,
              limit: 5,
              scrapeOptions: { formats: ["markdown"] },
            }),
          });

          if (!searchRes.ok) {
            console.warn(`Search failed for "${q.query_text}": ${searchRes.status}`);
            return { queryNew, queryDupes, queryTexts };
          }

          const searchData = await searchRes.json();
          const results = searchData?.data || [];

          for (const result of results) {
            const content = result.markdown || "";
            if (content.length < 300) continue;

            const url = result.url || "";
            const urlLower = url.toLowerCase();

            // URL deduplication
            if (scrapedUrls.has(urlLower)) {
              console.log(`Skipping duplicate URL: ${url}`);
              continue;
            }
            scrapedUrls.add(urlLower);

            // URL-level relevance filtering
            const isOtherProductPage = urlLower.includes('/products/') &&
              !brandTerms.some((t: string) => urlLower.includes(t.toLowerCase()));
            const isCategoryPage = urlLower.includes('/categories/');
            if (isOtherProductPage || isCategoryPage) {
              console.log(`Skipping irrelevant URL: ${url}`);
              continue;
            }

            // Soft relevance check: brand terms, product terms, domain, or URL match
            const lowerContent = content.toLowerCase();
            const hasBrandMention = brandTerms.some((t: string) => lowerContent.includes(t.toLowerCase()));
            const productTerms = (company.product_terms as string[]) || [];
            const hasProductMention = productTerms.some((t: string) => lowerContent.includes(t.toLowerCase()));
            const hasDomainMention = company.domain ? lowerContent.includes(company.domain.toLowerCase()) : false;
            const urlMentionsBrand = brandTerms.some((t: string) => urlLower.includes(t.toLowerCase()));

            const isRelevant = hasBrandMention || hasProductMention || hasDomainMention || urlMentionsBrand;
            if (!isRelevant) {
              console.log(`Skipping page with no relevance signals: ${url}`);
              continue;
            }

            // Build relevance context for AI prompt
            const relevanceSignals: string[] = [];
            if (hasBrandMention) relevanceSignals.push("brand name in content");
            if (hasProductMention) relevanceSignals.push("product term in content");
            if (hasDomainMention) relevanceSignals.push("domain in content");
            if (urlMentionsBrand) relevanceSignals.push("brand name in URL");

            // Filter affiliate content
            const affiliateKeywords = ["affiliate", "sponsored post", "paid partnership", "commission"];
            if (affiliateKeywords.some((k) => lowerContent.includes(k))) continue;

            // Extract feedback via AI
            try {
              const extractRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                method: "POST",
                headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: "google/gemini-2.5-flash",
                  messages: [
                    {
                      role: "system",
                      content: `You extract individual customer feedback items from web content about ${company.name}. This page was found via a web search for feedback about ${company.name}. Even if it's a blog post, newsletter, or community discussion that discusses the product indirectly, extract any user opinions or experiences mentioned. Relevance signals found: ${relevanceSignals.join(", ")}. Extract ONLY genuine user opinions, complaints, praise, or feature requests that are DIRECTLY about ${company.name} or its products (${brandTerms.join(', ')}). Do NOT extract reviews about other products even if they appear on the same page. Skip marketing copy, author bios, and navigation text. Every extracted item MUST be directly about ${company.name}. If the page is primarily reviewing a different product, return an empty items array.`,
                    },
                    {
                      role: "user",
                      content: `Extract feedback items ONLY about ${company.name} from this page. Ignore any reviews or opinions about other products:\n\nURL: ${url}\n\nContent:\n${content.slice(0, 6000)}`,
                    },
                  ],
                  tools: [
                    {
                      type: "function",
                      function: {
                        name: "extract_feedback",
                        description: "Extract structured feedback items from web content",
                        parameters: {
                          type: "object",
                          properties: {
                            items: {
                              type: "array",
                              items: {
                                type: "object",
                                properties: {
                                  author: { type: "string", description: "Author name or anonymous" },
                                  text: { type: "string", description: "The feedback text (50-300 chars)" },
                                  sentiment: { type: "string", enum: ["Positive", "Negative", "Neutral"] },
                                  confidence: { type: "number", description: "Confidence 0-1 that this feedback is genuinely about " + company.name },
                                  pain_point_category: {
                                    type: "string",
                                    enum: ["UX", "Pricing", "Reliability", "Performance", "Documentation", "Features", "Support", "Security", "Integration", "Other"],
                                  },
                                  intent_type: {
                                    type: "string",
                                    enum: ["praise", "bug", "feature_request", "churn_risk", "comparison", "general"],
                                  },
                                  context_excerpt: { type: "string", description: "Surrounding context (100 chars)" },
                                },
                                required: ["author", "text", "sentiment", "confidence", "pain_point_category", "intent_type"],
                                additionalProperties: false,
                              },
                            },
                          },
                          required: ["items"],
                          additionalProperties: false,
                        },
                      },
                    },
                  ],
                  tool_choice: { type: "function", function: { name: "extract_feedback" } },
                }),
              });

              if (!extractRes.ok) {
                if (extractRes.status === 429) {
                  console.warn("Rate limited, waiting 5s...");
                  await new Promise((r) => setTimeout(r, 5000));
                }
                return { queryNew, queryDupes, queryTexts };
              }

              const extractData = await extractRes.json();
              const toolCall = extractData.choices?.[0]?.message?.tool_calls?.[0];
              if (!toolCall) return { queryNew, queryDupes, queryTexts };

              const { items } = JSON.parse(toolCall.function.arguments);
              if (!items || !Array.isArray(items)) return { queryNew, queryDupes, queryTexts };

              // Determine source from URL
              let source = "Web";
              if (urlLower.includes("reddit.com")) source = "Reddit";
              else if (urlLower.includes("g2.com")) source = "G2";
              else if (urlLower.includes("trustradius.com")) source = "TrustRadius";
              else if (urlLower.includes("capterra.com")) source = "Capterra";
              else if (urlLower.includes("producthunt.com")) source = "ProductHunt";
              else if (urlLower.includes("news.ycombinator.com")) source = "HackerNews";

              for (const item of items) {
                if (!item.text || item.text.length < 20 || (item.confidence || 0) < 0.7) continue;

                const feedbackLower = item.text.toLowerCase();
                const mentionsBrand = brandTerms.some((t: string) => feedbackLower.includes(t.toLowerCase()));
                if (!mentionsBrand && (item.confidence || 0) < 0.8) {
                  console.log(`Skipping feedback not mentioning brand: "${item.text.slice(0, 60)}..."`);
                  continue;
                }
                const contentHash = await hashText(item.text);

                const feedbackRow = {
                  feedback_id: `WEB-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  text: item.text.slice(0, 500),
                  customer_name: item.author || "Anonymous",
                  source,
                  sentiment: item.sentiment || "Neutral",
                  status: "New",
                  channel: source,
                  company_id,
                  source_url: url,
                  content_hash: contentHash,
                  pain_point_category: item.pain_point_category,
                  intent_type: item.intent_type,
                  confidence_score: item.confidence || 0.5,
                  original_context_excerpt: item.context_excerpt?.slice(0, 200) || null,
                };

                const { error: insertErr } = await supabase.from("feedback").insert(feedbackRow);

                if (insertErr) {
                  if (insertErr.message?.includes("idx_feedback_content_hash")) {
                    queryDupes++;
                  } else {
                    console.warn("Insert error:", insertErr.message);
                  }
                } else {
                  queryNew++;
                  queryTexts.push(item.text);
                }
              }
            } catch (aiErr) {
              console.warn("AI extraction error:", aiErr);
            }
          }
        } catch (searchErr) {
          console.warn(`Query error for "${q.query_text}":`, searchErr);
        }

        return { queryNew, queryDupes, queryTexts };
      };

      // Process queries in parallel batches of 3
      const queriesToProcess = queries.slice(0, webQueryLimit);
      const batchSize = 3;
      for (let i = 0; i < queriesToProcess.length; i += batchSize) {
        const elapsed = Date.now() - webPhaseStart;
        if (elapsed > webBudgetMs) {
          console.log(`Web phase time budget exceeded (${elapsed}ms / ${webBudgetMs}ms), moving to next phase`);
          break;
        }

        const batch = queriesToProcess.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} queries`);
        const results = await Promise.allSettled(batch.map(q => processQuery(q)));

        for (const result of results) {
          if (result.status === "fulfilled") {
            totalNew += result.value.queryNew;
            totalDuplicates += result.value.queryDupes;
            allFeedbackTexts.push(...result.value.queryTexts);
          }
        }
      }
    }

    // ===== Phase 2: Reddit Collection =====
    console.log(`Starting Reddit collection phase... (elapsed: ${Date.now() - startTime}ms)`);
    if (Date.now() - startTime < TIME_BUDGET_MS) {
      const redditResult = await collectRedditFeedback(company, brandTerms, supabase, company_id, LOVABLE_API_KEY, FIRECRAWL_API_KEY);
      totalNew += redditResult.newCount;
      totalDuplicates += redditResult.dupeCount;
      allFeedbackTexts.push(...redditResult.texts);
    } else {
      console.log("Skipping Reddit phase - time budget exhausted");
    }

    // ===== Phase 3: Twitter/X Collection =====
    console.log(`Starting Twitter collection phase... (elapsed: ${Date.now() - startTime}ms)`);
    const hasBearerToken = !!Deno.env.get("TWITTER_BEARER_TOKEN");
    const hasConsumerKeys = !!Deno.env.get("TWITTER_CONSUMER_KEY") && !!Deno.env.get("TWITTER_CONSUMER_SECRET");
    console.log(`Twitter auth: bearer=${hasBearerToken}, consumer_keys=${hasConsumerKeys}`);
    if (Date.now() - startTime < TIME_BUDGET_MS) {
      const twitterResult = await collectTwitterFeedback(company, brandTerms, supabase, company_id, LOVABLE_API_KEY);
      totalNew += twitterResult.newCount;
      totalDuplicates += twitterResult.dupeCount;
      allFeedbackTexts.push(...twitterResult.texts);
    } else {
      console.log("Skipping Twitter phase - time budget exhausted");
    }

    // ===== Clustering phase =====
    let clustersUpdated = 0;
    if (allFeedbackTexts.length > 3) {
      try {
        console.log(`Clustering ${allFeedbackTexts.length} feedback items...`);
        const clusterRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content: `You are a feedback analyst. Group the following feedback items into 3-8 thematic clusters. Each cluster should represent a distinct pain point or topic.`,
              },
              {
                role: "user",
                content: `Group these ${allFeedbackTexts.length} feedback items into clusters:\n\n${allFeedbackTexts.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
              },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "create_clusters",
                  description: "Group feedback into thematic clusters",
                  parameters: {
                    type: "object",
                    properties: {
                      clusters: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            title: { type: "string" },
                            description: { type: "string" },
                            primary_pain_point: { type: "string" },
                            category: { type: "string", enum: ["Feature Request", "Bug", "UX Improvement"] },
                            sentiment: { type: "string", enum: ["Positive", "Negative", "Neutral"] },
                            priority: { type: "string", enum: ["High", "Medium", "Low"] },
                            feedback_indices: { type: "array", items: { type: "number" }, description: "1-based indices of feedback items in this cluster" },
                            tags: { type: "array", items: { type: "string" } },
                          },
                          required: ["title", "description", "primary_pain_point", "category", "sentiment", "priority", "feedback_indices", "tags"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["clusters"],
                    additionalProperties: false,
                  },
                },
              },
            ],
            tool_choice: { type: "function", function: { name: "create_clusters" } },
          }),
        });

        if (clusterRes.ok) {
          const clusterData = await clusterRes.json();
          const toolCall = clusterData.choices?.[0]?.message?.tool_calls?.[0];
          if (toolCall) {
            const { clusters: aiClusters } = JSON.parse(toolCall.function.arguments);
            for (let i = 0; i < (aiClusters?.length || 0); i++) {
              const c = aiClusters[i];
              const clusterId = `CL-${company.name.toUpperCase().slice(0, 3)}-${String(i + 1).padStart(3, "0")}`;

              const { error: clErr } = await supabase.from("clusters").upsert(
                {
                  cluster_id: clusterId,
                  name: c.title,
                  category: c.category || "Feature Request",
                  sentiment: c.sentiment || "Neutral",
                  priority: c.priority || "Medium",
                  tags: c.tags || [],
                  feedback_count: c.feedback_indices?.length || 0,
                  company_id,
                  description: c.description,
                  primary_pain_point: c.primary_pain_point,
                  severity_score: c.priority === "High" ? 0.8 : c.priority === "Medium" ? 0.5 : 0.2,
                  first_seen_at: new Date().toISOString(),
                  last_seen_at: new Date().toISOString(),
                  sentiment_mix: { [c.sentiment || "Neutral"]: c.feedback_indices?.length || 0 },
                },
                { onConflict: "cluster_id" }
              );

              if (!clErr) clustersUpdated++;
            }
          }
        }
      } catch (clusterErr) {
        console.warn("Clustering error:", clusterErr);
      }
    }

    // Update collection run
    if (runId) {
      await supabase.from("collection_runs").update({
        status: "completed",
        new_feedback_count: totalNew,
        duplicates_skipped: totalDuplicates,
        clusters_updated: clustersUpdated,
        completed_at: new Date().toISOString(),
      }).eq("id", runId);
    }

    // Update company last_collected_at
    await supabase.from("companies").update({ last_collected_at: new Date().toISOString() }).eq("id", company_id);

    const summary = { new_feedback_count: totalNew, duplicates_skipped: totalDuplicates, clusters_updated: clustersUpdated };
    console.log("Collection complete:", summary);

    return new Response(JSON.stringify({ success: true, data: summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("collect-feedback error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function errResp(msg: string, status = 500) {
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
