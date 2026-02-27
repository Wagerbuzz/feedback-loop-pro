import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { company_name, domain } = await req.json();
    if (!company_name || !domain) {
      return new Response(JSON.stringify({ error: "company_name and domain required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY not configured");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Step 1: Scrape homepage
    console.log(`Scraping ${domain}...`);
    const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: `https://${domain}`, formats: ["markdown"], onlyMainContent: true }),
    });
    const scrapeData = await scrapeRes.json();
    const markdown = scrapeData?.data?.markdown || scrapeData?.markdown || "";

    if (!markdown || markdown.length < 100) {
      console.warn("Homepage content too short, using company name only");
    }

    // Step 2: Extract brand profile via AI
    console.log("Extracting brand profile via AI...");
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are a brand analyst. Given a company's homepage content, extract structured information about the company. Be thorough and specific.`,
          },
          {
            role: "user",
            content: `Analyze this company: "${company_name}" (${domain})\n\nHomepage content:\n${markdown.slice(0, 8000)}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_brand_profile",
              description: "Extract structured brand profile from company homepage",
              parameters: {
                type: "object",
                properties: {
                  brand_terms: {
                    type: "array",
                    items: { type: "string" },
                    description: "Key brand names, trademarks, and variations (e.g. 'MongoDB', 'Mongo', 'Atlas')",
                  },
                  product_terms: {
                    type: "array",
                    items: { type: "string" },
                    description: "Specific product names (e.g. 'Atlas', 'Compass', 'Realm')",
                  },
                  feature_terms: {
                    type: "array",
                    items: { type: "string" },
                    description: "Key feature keywords (e.g. 'aggregation pipeline', 'sharding', 'replication')",
                  },
                  industry_type: {
                    type: "string",
                    description: "Industry category (e.g. 'Database', 'Cloud Infrastructure', 'SaaS')",
                  },
                  persona_type: {
                    type: "string",
                    description: "Primary user persona (e.g. 'developer', 'data engineer', 'enterprise admin')",
                  },
                  reddit_subreddits: {
                    type: "array",
                    items: { type: "string" },
                    description: "Relevant subreddit names (without r/) where users discuss this product (e.g. 'mongodb', 'database', 'devops')",
                  },
                },
                required: ["brand_terms", "product_terms", "feature_terms", "industry_type", "persona_type", "reddit_subreddits"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_brand_profile" } },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("AI error:", aiRes.status, errText);
      throw new Error(`AI extraction failed: ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");

    const profile = JSON.parse(toolCall.function.arguments);

    // Step 3: Generate search queries
    const intentBuckets = [
      { intent: "pain", templates: ["{brand} frustrating", "{brand} issues", "{brand} problems"] },
      { intent: "churn", templates: ["{brand} switching from", "{brand} alternative", "left {brand} for"] },
      { intent: "comparison", templates: ["{brand} vs", "{brand} compared to", "{brand} competitor"] },
      { intent: "pricing", templates: ["{brand} pricing", "{brand} expensive", "{brand} cost"] },
      { intent: "feature_experience", templates: ["{brand} {feature} experience", "{brand} review"] },
      { intent: "praise", templates: ["{brand} love", "{brand} great", "{brand} recommend"] },
    ];

    const domainConstraints = ["site:reddit.com", "site:g2.com", "site:trustradius.com", ""];
    const queries: Array<{ query_text: string; intent_bucket: string; domain_target: string }> = [];

    const brandName = profile.brand_terms?.[0] || company_name;

    for (const bucket of intentBuckets) {
      for (const template of bucket.templates) {
        if (queries.length >= 20) break;
        const featureTerm = profile.feature_terms?.[Math.floor(Math.random() * (profile.feature_terms?.length || 1))] || "";
        const queryText = template.replace("{brand}", brandName).replace("{feature}", featureTerm);
        const domainConstraint = domainConstraints[Math.floor(Math.random() * domainConstraints.length)];
        const fullQuery = domainConstraint ? `${queryText} ${domainConstraint}` : queryText;
        queries.push({
          query_text: fullQuery,
          intent_bucket: bucket.intent,
          domain_target: domainConstraint.replace("site:", "") || "web",
        });
      }
      if (queries.length >= 20) break;
    }

    const result = {
      brand_terms: profile.brand_terms,
      product_terms: profile.product_terms,
      feature_terms: profile.feature_terms,
      industry_type: profile.industry_type,
      persona_type: profile.persona_type,
      reddit_subreddits: profile.reddit_subreddits || [],
      search_queries: queries,
    };

    console.log(`Brand profile extracted: ${profile.brand_terms?.length} brand terms, ${queries.length} queries`);

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("brand-profile error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
