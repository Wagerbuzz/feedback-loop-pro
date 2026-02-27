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

// Reddit public JSON API - no API key required
async function collectRedditFeedback(
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
  if (!collectionSources.includes("reddit")) {
    console.log("Reddit collection disabled for this company");
    return { newCount, dupeCount, texts };
  }

  const brandName = brandTerms[0] || company.name;
  const subreddits = (company.reddit_subreddits as string[]) || [];

  // Build search URLs: general search + specific subreddits
  const searchUrls: string[] = [
    `https://www.reddit.com/search.json?q=${encodeURIComponent(brandName)}&sort=relevance&limit=25&t=year`,
  ];
  for (const sub of subreddits.slice(0, 5)) {
    searchUrls.push(
      `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(brandName)}&restrict_sr=1&sort=relevance&limit=15&t=year`
    );
  }

  const seenPostIds = new Set<string>();

  for (const searchUrl of searchUrls) {
    try {
      console.log(`Reddit search: ${searchUrl}`);
      const res = await fetch(searchUrl, {
        headers: { "User-Agent": "FeedbackCollector/1.0" },
      });

      if (!res.ok) {
        console.warn(`Reddit search failed: ${res.status}`);
        continue;
      }

      const data = await res.json();
      const posts = data?.data?.children || [];

      for (const post of posts) {
        const postData = post.data;
        if (!postData || seenPostIds.has(postData.id)) continue;
        seenPostIds.add(postData.id);

        // Fetch comments for this post
        try {
          await new Promise((r) => setTimeout(r, 1200)); // Rate limit: ~60 req/min
          const commentsRes = await fetch(
            `https://www.reddit.com/comments/${postData.id}.json?limit=20&sort=top`,
            { headers: { "User-Agent": "FeedbackCollector/1.0" } }
          );

          if (!commentsRes.ok) continue;

          const commentsData = await commentsRes.json();

          // Collect post title + selftext and top comments
          const contentParts: string[] = [];
          contentParts.push(`Post: ${postData.title}\n${postData.selftext || ""}`);

          const comments = commentsData?.[1]?.data?.children || [];
          for (const comment of comments) {
            const c = comment.data;
            if (c && c.body && c.body.length > 20) {
              contentParts.push(`Comment by u/${c.author}: ${c.body}`);
            }
          }

          const fullContent = contentParts.join("\n\n");
          if (fullContent.length < 100) continue;

          // Check brand mention in content
          const lowerContent = fullContent.toLowerCase();
          const hasBrandMention = brandTerms.some((t) => lowerContent.includes(t.toLowerCase()));
          if (!hasBrandMention) continue;

          // Extract feedback via AI
          const extractRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                {
                  role: "system",
                  content: `You extract individual customer feedback items from Reddit content about ${company.name}. Extract ONLY genuine user opinions, complaints, praise, or feature requests that are DIRECTLY about ${company.name} or its products (${brandTerms.join(", ")}). Do NOT extract opinions about other products. Skip generic or off-topic comments.`,
                },
                {
                  role: "user",
                  content: `Extract feedback items ONLY about ${company.name} from this Reddit thread:\n\n${fullContent.slice(0, 6000)}`,
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

          const permalink = `https://www.reddit.com${postData.permalink}`;

          for (const item of items) {
            if (!item.text || item.text.length < 20 || (item.confidence || 0) < 0.7) continue;

            const feedbackLower = item.text.toLowerCase();
            const mentionsBrand = brandTerms.some((t) => feedbackLower.includes(t.toLowerCase()));
            if (!mentionsBrand && (item.confidence || 0) < 0.9) continue;

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
              source_url: permalink,
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
        } catch (commentErr) {
          console.warn("Reddit comment fetch error:", commentErr);
        }
      }

      await new Promise((r) => setTimeout(r, 1200));
    } catch (searchErr) {
      console.warn("Reddit search error:", searchErr);
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
  const query = `"${brandName}" -is:retweet lang:en`;

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
              content: `Extract customer feedback from tweets about ${company.name}. Only extract tweets that contain genuine opinions, complaints, praise, or feature requests DIRECTLY about ${company.name}. Skip promotional tweets, ads, and bot content.`,
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
        if (!item.text || item.text.length < 20 || (item.confidence || 0) < 0.7) continue;

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

    console.log(`Starting collection for ${company.name} with ${queries.length} queries, sources: ${collectionSources.join(", ")}`);

    // ===== Phase 1: Firecrawl Web Search (increased limits) =====
    if (collectionSources.includes("web")) {
      for (const q of queries.slice(0, 25)) {
        try {
          console.log(`Searching: ${q.query_text}`);
          const searchRes = await fetch("https://api.firecrawl.dev/v1/search", {
            method: "POST",
            headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              query: q.query_text,
              limit: 10,
              scrapeOptions: { formats: ["markdown"] },
            }),
          });

          if (!searchRes.ok) {
            console.warn(`Search failed for "${q.query_text}": ${searchRes.status}`);
            continue;
          }

          const searchData = await searchRes.json();
          const results = searchData?.data || [];

          for (const result of results) {
            const content = result.markdown || "";
            if (content.length < 300) continue;

            const url = result.url || "";
            const urlLower = url.toLowerCase();

            // URL-level relevance filtering
            const isOtherProductPage = urlLower.includes('/products/') &&
              !brandTerms.some((t: string) => urlLower.includes(t.toLowerCase()));
            const isCategoryPage = urlLower.includes('/categories/');
            if (isOtherProductPage || isCategoryPage) {
              console.log(`Skipping irrelevant URL: ${url}`);
              continue;
            }

            // Check brand mention
            const lowerContent = content.toLowerCase();
            const hasBrandMention = brandTerms.some((t: string) => lowerContent.includes(t.toLowerCase()));
            if (!hasBrandMention) continue;

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
                      content: `You extract individual customer feedback items from web content about ${company.name}. Extract ONLY genuine user opinions, complaints, praise, or feature requests that are DIRECTLY about ${company.name} or its products (${brandTerms.join(', ')}). Do NOT extract reviews about other products even if they appear on the same page. Skip marketing copy, author bios, and navigation text. Every extracted item MUST be directly about ${company.name}. If the page is primarily reviewing a different product, return an empty items array.`,
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
                continue;
              }

              const extractData = await extractRes.json();
              const toolCall = extractData.choices?.[0]?.message?.tool_calls?.[0];
              if (!toolCall) continue;

              const { items } = JSON.parse(toolCall.function.arguments);
              if (!items || !Array.isArray(items)) continue;

              // Determine source from URL
              let source = "Web";
              if (urlLower.includes("reddit.com")) source = "Reddit";
              else if (urlLower.includes("g2.com")) source = "G2";
              else if (urlLower.includes("trustradius.com")) source = "TrustRadius";
              else if (urlLower.includes("capterra.com")) source = "Capterra";

              for (const item of items) {
                if (!item.text || item.text.length < 20 || (item.confidence || 0) < 0.7) continue;

                const feedbackLower = item.text.toLowerCase();
                const mentionsBrand = brandTerms.some((t: string) => feedbackLower.includes(t.toLowerCase()));
                if (!mentionsBrand && (item.confidence || 0) < 0.9) {
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
                    totalDuplicates++;
                  } else {
                    console.warn("Insert error:", insertErr.message);
                  }
                } else {
                  totalNew++;
                  allFeedbackTexts.push(item.text);
                }
              }
            } catch (aiErr) {
              console.warn("AI extraction error:", aiErr);
            }
          }

          await new Promise((r) => setTimeout(r, 1000));
        } catch (searchErr) {
          console.warn(`Query error for "${q.query_text}":`, searchErr);
        }
      }
    }

    // ===== Phase 2: Reddit Collection =====
    const redditResult = await collectRedditFeedback(company, brandTerms, supabase, company_id, LOVABLE_API_KEY);
    totalNew += redditResult.newCount;
    totalDuplicates += redditResult.dupeCount;
    allFeedbackTexts.push(...redditResult.texts);

    // ===== Phase 3: Twitter/X Collection =====
    const twitterResult = await collectTwitterFeedback(company, brandTerms, supabase, company_id, LOVABLE_API_KEY);
    totalNew += twitterResult.newCount;
    totalDuplicates += twitterResult.dupeCount;
    allFeedbackTexts.push(...twitterResult.texts);

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
