import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ---------- Types ----------
interface CompanyRow {
  id: string;
  name: string;
  domain: string;
  brand_terms: string[] | null;
  product_terms: string[] | null;
  feature_terms: string[] | null;
  industry_type: string | null;
  persona_type: string | null;
  search_queries: any[] | null;
  collection_sources: string[] | null;
  reddit_subreddits: string[] | null;
  reddit_min_score: number | null;
  reddit_max_age_days: number | null;
  g2_url: string | null;
  capterra_url: string | null;
  trustradius_url: string | null;
  getapp_url: string | null;
  last_collected_at: string | null;
}

// ---------- Helpers ----------
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

// ---------- Phase 0: Direct Review Site Scraping ----------
async function collectDirectReviews(
  company: CompanyRow,
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

  // Use persisted URLs when available, fall back to slug construction
  const reviewUrls: { url: string; source: string }[] = [];

  if (company.g2_url) {
    reviewUrls.push({ url: company.g2_url, source: "G2" });
    // Also try page 2
    const page2 = company.g2_url.includes("?") ? `${company.g2_url}&page=2` : `${company.g2_url}?page=2`;
    reviewUrls.push({ url: page2, source: "G2" });
  } else {
    reviewUrls.push({ url: `https://www.g2.com/products/${brandSlug}/reviews`, source: "G2" });
    reviewUrls.push({ url: `https://www.g2.com/products/${brandSlug}/reviews?page=2`, source: "G2" });
  }

  if (company.trustradius_url) {
    reviewUrls.push({ url: company.trustradius_url, source: "TrustRadius" });
  } else {
    reviewUrls.push({ url: `https://www.trustradius.com/products/${brandSlug}/reviews`, source: "TrustRadius" });
  }

  if (company.capterra_url) {
    reviewUrls.push({ url: company.capterra_url, source: "Capterra" });
  } else {
    reviewUrls.push({ url: `https://www.capterra.com/reviews/${brandSlug}`, source: "Capterra" });
    reviewUrls.push({ url: `https://www.capterra.com/p/${brandSlug}/reviews`, source: "Capterra" });
  }

  if (company.getapp_url) {
    reviewUrls.push({ url: company.getapp_url, source: "GetApp" });
  }

  console.log(`Direct review scraping: ${reviewUrls.length} URLs for "${brandName}"`);

  // Scrape all review URLs in parallel
  const scrapeResults = await Promise.allSettled(
    reviewUrls.map(async ({ url, source }) => {
      const urlLower = url.toLowerCase();
      if (scrapedUrls.has(urlLower)) return { url, source, content: "", skipped: true };
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

  const scrapedPages: { url: string; source: string; content: string }[] = [];
  for (const result of scrapeResults) {
    if (result.status !== "fulfilled") continue;
    const { url, source, content, skipped } = result.value;
    if (skipped || content.length < 300) continue;
    scrapedPages.push({ url, source, content: content.slice(0, 3000) });
  }

  if (scrapedPages.length === 0) {
    console.log("Direct review scraping: no pages with content");
    return { newCount, dupeCount, texts };
  }

  const combinedContent = scrapedPages
    .map((p, i) => `--- REVIEW PAGE ${i + 1}: ${p.source} (${p.url}) ---\n${p.content}`)
    .join("\n\n");
  const cappedContent = combinedContent.slice(0, 15000);

  console.log(`Direct review batched extraction: ${scrapedPages.length} pages, ${cappedContent.length} chars`);

  try {
    const extractRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `You extract individual customer feedback items from review pages about ${company.name}. Multiple review pages are provided, separated by "--- REVIEW PAGE N ---" delimiters. Extract each individual review as a separate feedback item. Include the reviewer's name if available. For each item, include the source_url of the page it came from. Extract ONLY genuine user reviews - skip editorial content, marketing copy, and navigation text.`,
          },
          {
            role: "user",
            content: `Extract all individual reviews about ${company.name} from these review pages:\n\n${cappedContent}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_feedback",
              description: "Extract structured feedback items from review pages",
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
                        source_url: { type: "string", description: "URL of the review page this item came from" },
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
                      required: ["author", "text", "sentiment", "confidence", "source_url", "pain_point_category", "intent_type"],
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
      console.warn(`Direct review batched extraction failed: ${extractRes.status}`);
      return { newCount, dupeCount, texts };
    }

    const extractData = await extractRes.json();
    const toolCall = extractData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) return { newCount, dupeCount, texts };

    const { items } = JSON.parse(toolCall.function.arguments);
    if (!items || !Array.isArray(items)) return { newCount, dupeCount, texts };

    console.log(`Direct review AI returned ${items.length} raw items`);

    for (const item of items) {
      if (!item.text || item.text.length < 15) {
        console.log(`Direct review: skipped item (too short: ${item.text?.length || 0} chars)`);
        continue;
      }
      if ((item.confidence || 0) < 0.5) {
        console.log(`Direct review: skipped low-confidence item (${item.confidence}): "${item.text?.slice(0, 50)}..."`);
        continue;
      }

      const contentHash = await hashText(item.text);
      const itemUrl = item.source_url || scrapedPages[0]?.url || "";
      const source = getSourceFromUrl(itemUrl);

      const feedbackRow = {
        feedback_id: crypto.randomUUID(),
        text: item.text.slice(0, 500),
        customer_name: item.author || "Anonymous",
        source,
        sentiment: item.sentiment || "Neutral",
        status: "New",
        channel: source,
        company_id: companyId,
        source_url: itemUrl,
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
    console.warn("Direct review batched AI extraction error:", aiErr);
  }

  console.log(`Direct review scraping: ${newCount} new, ${dupeCount} dupes`);
  return { newCount, dupeCount, texts };
}

// ---------- Phase 2: Reddit Collection via Native JSON API ----------
async function collectRedditFeedback(
  company: CompanyRow,
  brandTerms: string[],
  supabaseClient: any,
  companyId: string,
  lovableApiKey: string
): Promise<{ newCount: number; dupeCount: number; texts: string[] }> {
  let newCount = 0;
  let dupeCount = 0;
  const texts: string[] = [];

  const collectionSources = company.collection_sources || ["web", "reddit"];
  if (!collectionSources.includes("reddit")) {
    console.log("Reddit collection disabled for this company");
    return { newCount, dupeCount, texts };
  }

  const brandName = brandTerms[0] || company.name;
  const minScore = company.reddit_min_score ?? 5;
  const maxAgeDays = company.reddit_max_age_days ?? 90;
  const cutoffTimestamp = Math.floor(Date.now() / 1000) - maxAgeDays * 86400;

  let subreddits = (company.reddit_subreddits as string[]) || [];

  // Fallback subreddits based on industry_type
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
      label: `cross-reddit search: "${brandName}"`,
    },
  ];
  for (const sub of subreddits.slice(0, 4)) {
    redditEndpoints.push({
      url: `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(brandName)}&restrict_sr=1&sort=top&limit=25`,
      label: `r/${sub}: "${brandName}"`,
    });
  }

  // Collect all qualifying posts across all endpoints
  const allPosts: { title: string; selftext: string; author: string; score: number; url: string; permalink: string }[] = [];
  const seenPostIds = new Set<string>();

  for (const endpoint of redditEndpoints) {
    try {
      console.log(`Reddit JSON API: ${endpoint.label}`);
      const res = await fetch(endpoint.url, {
        headers: { "User-Agent": "FeedbackCollector/1.0" },
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
        if (!post) continue;

        // Deduplicate across endpoints
        if (seenPostIds.has(post.id)) continue;
        seenPostIds.add(post.id);

        // Filter by score
        if ((post.score || 0) < minScore) continue;

        // Filter by age
        if (post.created_utc && post.created_utc < cutoffTimestamp) continue;

        const selftext = post.selftext || "";
        const title = post.title || "";
        if (selftext.length < 30 && title.length < 30) continue;

        allPosts.push({
          title,
          selftext: selftext.slice(0, 1500),
          author: post.author || "Anonymous",
          score: post.score || 0,
          url: post.url || "",
          permalink: post.permalink ? `https://www.reddit.com${post.permalink}` : "",
        });
      }
    } catch (err) {
      console.warn(`Reddit endpoint error for ${endpoint.label}:`, err);
    }
  }

  console.log(`Reddit: ${allPosts.length} qualifying posts (score >= ${minScore}, age <= ${maxAgeDays}d)`);

  if (allPosts.length === 0) return { newCount, dupeCount, texts };

  // Batch posts into AI extraction (up to 15 posts per batch)
  const batchSize = 15;
  for (let i = 0; i < allPosts.length; i += batchSize) {
    const batch = allPosts.slice(i, i + batchSize);
    const combinedContent = batch
      .map((p, idx) => `--- POST ${idx + 1} (score: ${p.score}, by u/${p.author}) ---\nTitle: ${p.title}\n${p.selftext}\nURL: ${p.permalink}`)
      .join("\n\n");

    try {
      const extractRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            {
              role: "system",
              content: `You extract individual customer feedback items from Reddit posts about ${company.name}. Extract ONLY genuine user opinions, complaints, praise, or feature requests that are DIRECTLY about ${company.name} or its products (${brandTerms.join(", ")}). Do NOT extract opinions about other products. Skip generic or off-topic comments. If a post title clearly indicates discussion about ${company.name}, you can extract feedback from the body.`,
            },
            {
              role: "user",
              content: `Extract feedback items ONLY about ${company.name} from these Reddit posts:\n\n${combinedContent.slice(0, 12000)}`,
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
                          post_index: { type: "number", description: "1-based index of the post" },
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
                        required: ["post_index", "author", "text", "sentiment", "confidence", "pain_point_category", "intent_type"],
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
        console.warn(`Reddit AI extraction failed: ${extractRes.status}`);
        continue;
      }

      const extractData = await extractRes.json();
      const toolCall = extractData.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) continue;

      const { items } = JSON.parse(toolCall.function.arguments);
      if (!items || !Array.isArray(items)) continue;

      console.log(`Reddit AI returned ${items.length} raw items for batch ${Math.floor(i / batchSize) + 1}`);

      for (const item of items) {
        if (!item.text || item.text.length < 15 || (item.confidence || 0) < 0.6) continue;

        const feedbackLower = item.text.toLowerCase();
        const mentionsBrand = brandTerms.some((t) => feedbackLower.includes(t.toLowerCase()));
        if (!mentionsBrand && (item.confidence || 0) < 0.75) continue;

        const postIdx = (item.post_index || 1) - 1;
        const post = batch[postIdx];
        const postUrl = post?.permalink || "";

        const contentHash = await hashText(item.text);

        const feedbackRow = {
          feedback_id: crypto.randomUUID(),
          text: item.text.slice(0, 500),
          customer_name: item.author || post?.author || "Anonymous",
          source: "Reddit",
          sentiment: item.sentiment || "Neutral",
          status: "New",
          channel: "Reddit",
          company_id: companyId,
          source_url: postUrl,
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

  console.log(`Reddit collection: ${newCount} new, ${dupeCount} dupes`);
  return { newCount, dupeCount, texts };
}

// ---------- Phase 3: Twitter/X API v2 ----------
async function collectTwitterFeedback(
  company: CompanyRow,
  brandTerms: string[],
  supabaseClient: any,
  companyId: string,
  lovableApiKey: string
): Promise<{ newCount: number; dupeCount: number; texts: string[] }> {
  let newCount = 0;
  let dupeCount = 0;
  const texts: string[] = [];

  const collectionSources = company.collection_sources || ["web", "reddit"];
  if (!collectionSources.includes("twitter")) {
    console.log("Twitter collection disabled for this company");
    return { newCount, dupeCount, texts };
  }

  const BEARER_TOKEN = Deno.env.get("TWITTER_BEARER_TOKEN");
  const CONSUMER_KEY = Deno.env.get("TWITTER_CONSUMER_KEY");
  const CONSUMER_SECRET = Deno.env.get("TWITTER_CONSUMER_SECRET");

  let bearerToken = BEARER_TOKEN;

  if (!bearerToken && CONSUMER_KEY && CONSUMER_SECRET) {
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
      return { newCount, dupeCount, texts };
    }

    const searchData = await searchRes.json();
    const tweets = searchData?.data || [];
    console.log(`Twitter: found ${tweets.length} tweets`);

    const tweetBatchSize = 20;
    for (let i = 0; i < tweets.length; i += tweetBatchSize) {
      const batch = tweets.slice(i, i + tweetBatchSize);
      const tweetTexts = batch.map((t: any, idx: number) => `${idx + 1}. @${t.author_id}: ${t.text}`).join("\n");

      const extractRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `Extract customer feedback from tweets about ${company.name} (${company.domain}), a ${company.industry_type || "software"} product. Only extract tweets about THIS specific product, not other products that share the same name. Skip promotional tweets, ads, and bot content.`,
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

        const feedbackLower = item.text.toLowerCase();
        const allValidationTerms = [...brandTerms, ...(company.product_terms || []), company.domain].filter(Boolean);
        const mentionsBrand = allValidationTerms.some((t: string) => feedbackLower.includes(t.toLowerCase()));
        if (!mentionsBrand && (item.confidence || 0) < 0.85) continue;

        const tweetIdx = (item.tweet_index || 1) - 1;
        const tweet = batch[tweetIdx];
        const tweetUrl = tweet ? `https://x.com/i/status/${tweet.id}` : "";

        const contentHash = await hashText(item.text);

        const feedbackRow = {
          feedback_id: crypto.randomUUID(),
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

// ---------- Main handler ----------
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!FIRECRAWL_API_KEY) return errResp("FIRECRAWL_API_KEY not configured");
  if (!LOVABLE_API_KEY) return errResp("LOVABLE_API_KEY not configured");

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Save company_id early so catch block can use it
  let savedCompanyId: string | null = null;
  let runId: string | null = null;

  try {
    const { company_id } = await req.json();
    if (!company_id) return errResp("company_id required", 400);
    savedCompanyId = company_id;

    // Load company
    const { data: company, error: compErr } = await supabase
      .from("companies")
      .select("*")
      .eq("id", company_id)
      .single();
    if (compErr || !company) return errResp("Company not found", 404);

    // Clean up any stuck runs for this company (older than 3 minutes)
    await supabase.from("collection_runs")
      .update({ status: "failed", error_message: "Timed out", completed_at: new Date().toISOString() })
      .eq("company_id", company_id)
      .eq("status", "running")
      .lt("started_at", new Date(Date.now() - 180000).toISOString());

    // Create collection run
    const { data: run } = await supabase
      .from("collection_runs")
      .insert({ company_id, status: "running" })
      .select("id")
      .single();
    runId = run?.id || null;

    let totalNew = 0;
    let totalDuplicates = 0;
    const allFeedbackTexts: string[] = [];

    const queries = (company.search_queries as any[]) || [];
    const brandTerms = (company.brand_terms as string[]) || [company.name];
    const collectionSources = (company.collection_sources as string[]) || ["web", "reddit"];

    // Time budget: 70s hard wall leaves ~50s margin before Deno 120s timeout
    const startTime = Date.now();
    const HARD_WALL_MS = 70000;
    const hasMultipleSources = collectionSources.length > 1;
    const webQueryLimit = hasMultipleSources ? 15 : 20;
    const webBudgetMs = hasMultipleSources ? 30000 : 40000;

    console.log(`Starting collection for ${company.name} with ${queries.length} queries (limit: ${webQueryLimit}), sources: ${collectionSources.join(", ")}`);

    // URL deduplication across all phases
    const scrapedUrls = new Set<string>();

    // ===== Phase 0: Direct Review Site Scraping (15s cap) =====
    if (collectionSources.includes("web")) {
      console.log("Starting direct review scraping phase (15s cap)...");
      const PHASE0_BUDGET_MS = 15000;
      const typedCompany = company as unknown as CompanyRow;
      const directPromise = collectDirectReviews(typedCompany, brandTerms, supabase, company_id, LOVABLE_API_KEY, FIRECRAWL_API_KEY, scrapedUrls);
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

          const relevantResults: { url: string; content: string; relevanceSignals: string[] }[] = [];

          for (const result of results) {
            const content = result.markdown || "";
            if (content.length < 300) continue;

            const url = result.url || "";
            const urlLower = url.toLowerCase();

            if (scrapedUrls.has(urlLower)) {
              console.log(`Skipping duplicate URL: ${url}`);
              continue;
            }
            scrapedUrls.add(urlLower);

            const isOtherProductPage = urlLower.includes('/products/') &&
              !brandTerms.some((t: string) => urlLower.includes(t.toLowerCase()));
            const isCategoryPage = urlLower.includes('/categories/');
            if (isOtherProductPage || isCategoryPage) {
              console.log(`Skipping irrelevant URL: ${url}`);
              continue;
            }

            const lowerContent = content.toLowerCase();
            const hasBrandMention = brandTerms.some((t: string) => lowerContent.includes(t.toLowerCase()));
            const prodTerms = (company.product_terms as string[]) || [];
            const hasProductMention = prodTerms.some((t: string) => lowerContent.includes(t.toLowerCase()));
            const hasDomainMention = company.domain ? lowerContent.includes(company.domain.toLowerCase()) : false;
            const urlMentionsBrand = brandTerms.some((t: string) => urlLower.includes(t.toLowerCase()));

            const isRelevant = hasBrandMention || hasProductMention || hasDomainMention || urlMentionsBrand;
            if (!isRelevant) {
              console.log(`Skipping page with no relevance signals: ${url}`);
              continue;
            }

            const relevanceSignals: string[] = [];
            if (hasBrandMention) relevanceSignals.push("brand name in content");
            if (hasProductMention) relevanceSignals.push("product term in content");
            if (hasDomainMention) relevanceSignals.push("domain in content");
            if (urlMentionsBrand) relevanceSignals.push("brand name in URL");

            const affiliateKeywords = ["affiliate", "sponsored post", "paid partnership", "commission"];
            if (affiliateKeywords.some((k) => lowerContent.includes(k))) continue;

            relevantResults.push({ url, content: content.slice(0, 2000), relevanceSignals });
          }

          if (relevantResults.length === 0) {
            return { queryNew, queryDupes, queryTexts };
          }

          const combinedContent = relevantResults
            .map((r, i) => `--- SOURCE ${i + 1}: ${r.url} (relevance: ${r.relevanceSignals.join(", ")}) ---\n${r.content}`)
            .join("\n\n");
          const cappedContent = combinedContent.slice(0, 12000);

          console.log(`Batched extraction for "${q.query_text}": ${relevantResults.length} results, ${cappedContent.length} chars`);

          try {
            const extractRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash-lite",
                messages: [
                  {
                    role: "system",
                    content: `You extract individual customer feedback items from web content about ${company.name}. Multiple pages are provided, separated by "--- SOURCE N ---" delimiters. Extract ONLY genuine user opinions, complaints, praise, or feature requests that are DIRECTLY about ${company.name} or its products (${brandTerms.join(', ')}). For each item, include the source_url of the page it came from. Do NOT extract reviews about other products. Skip marketing copy, author bios, and navigation text. If a page is primarily reviewing a different product, skip it entirely.`,
                  },
                  {
                    role: "user",
                    content: `Extract feedback items ONLY about ${company.name} from these pages:\n\n${cappedContent}`,
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
                                source_url: { type: "string", description: "URL of the page this item came from" },
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
                              required: ["author", "text", "sentiment", "confidence", "source_url", "pain_point_category", "intent_type"],
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

            console.log(`Web AI returned ${items.length} raw items for "${q.query_text}"`);

            for (const item of items) {
              if (!item.text || item.text.length < 15 || (item.confidence || 0) < 0.6) continue;

              const feedbackLower = item.text.toLowerCase();
              const mentionsBrand = brandTerms.some((t: string) => feedbackLower.includes(t.toLowerCase()));
              if (!mentionsBrand && (item.confidence || 0) < 0.75) {
                console.log(`Skipping feedback not mentioning brand (conf=${item.confidence}): "${item.text.slice(0, 60)}..."`);
                continue;
              }

              const itemUrl = item.source_url || relevantResults[0]?.url || "";
              const source = getSourceFromUrl(itemUrl);

              const contentHash = await hashText(item.text);

              const feedbackRow = {
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
        } catch (searchErr) {
          console.warn(`Query error for "${q.query_text}":`, searchErr);
        }

        return { queryNew, queryDupes, queryTexts };
      };

      // Process queries in parallel batches of 5
      const queriesToProcess = queries.slice(0, webQueryLimit);
      const batchSize = 5;
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

    // ===== Phase 2: Reddit Collection (native JSON API) =====
    console.log(`Starting Reddit collection phase... (elapsed: ${Date.now() - startTime}ms)`);
    if (Date.now() - startTime < HARD_WALL_MS) {
      const typedCompany = company as unknown as CompanyRow;
      const redditResult = await collectRedditFeedback(typedCompany, brandTerms, supabase, company_id, LOVABLE_API_KEY);
      totalNew += redditResult.newCount;
      totalDuplicates += redditResult.dupeCount;
      allFeedbackTexts.push(...redditResult.texts);
    } else {
      console.log("Skipping Reddit phase - past hard wall");
    }

    // ===== Phase 3: Twitter/X Collection =====
    console.log(`Starting Twitter collection phase... (elapsed: ${Date.now() - startTime}ms)`);
    const hasBearerToken = !!Deno.env.get("TWITTER_BEARER_TOKEN");
    const hasConsumerKeys = !!Deno.env.get("TWITTER_CONSUMER_KEY") && !!Deno.env.get("TWITTER_CONSUMER_SECRET");
    console.log(`Twitter auth: bearer=${hasBearerToken}, consumer_keys=${hasConsumerKeys}`);
    if (Date.now() - startTime < HARD_WALL_MS) {
      const typedCompany = company as unknown as CompanyRow;
      const twitterResult = await collectTwitterFeedback(typedCompany, brandTerms, supabase, company_id, LOVABLE_API_KEY);
      totalNew += twitterResult.newCount;
      totalDuplicates += twitterResult.dupeCount;
      allFeedbackTexts.push(...twitterResult.texts);
    } else {
      console.log("Skipping Twitter phase - past hard wall");
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
    // Mark the run as failed using saved company_id (no req.clone needed)
    if (savedCompanyId) {
      try {
        const updateFilter: any = { status: "running" };
        if (runId) {
          await supabase.from("collection_runs")
            .update({ status: "failed", error_message: error instanceof Error ? error.message : "Unknown error", completed_at: new Date().toISOString() })
            .eq("id", runId);
        } else {
          await supabase.from("collection_runs")
            .update({ status: "failed", error_message: error instanceof Error ? error.message : "Unknown error", completed_at: new Date().toISOString() })
            .eq("company_id", savedCompanyId)
            .eq("status", "running");
        }
      } catch (_) { /* best effort */ }
    }
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
