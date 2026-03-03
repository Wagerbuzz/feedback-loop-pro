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
            content: `You are a brand analyst. Given a company's homepage content, extract structured information about the company. Be thorough and specific. Look for named features, modules, and sub-products even if they aren't standalone products.`,
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
                    description: "Specific product names, sub-products, modules, and named features (e.g. 'Atlas', 'Compass', 'Claygent', 'Waterfall Enrichment', 'Chrome Extension')",
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
    // Targeted buckets use site constraints; discovery buckets always use open web
    const targetedBuckets = [
      { intent: "pain", templates: ["{brand} frustrating", "{brand} issues", "{brand} problems"] },
      { intent: "churn", templates: ["{brand} switching from", "{brand} alternative", "left {brand} for"] },
      { intent: "comparison", templates: ["{brand} vs", "{brand} compared to", "{brand} competitor"] },
      { intent: "pricing", templates: ["{brand} pricing", "{brand} expensive", "{brand} cost"] },
      { intent: "feature_experience", templates: ["{brand} {feature} experience", "{brand} review"] },
      { intent: "praise", templates: ["{brand} love", "{brand} great", "{brand} recommend"] },
    ];

    const discoveryBuckets = [
      { intent: "blog_review", templates: ["{brand} review blog", "{brand} honest review", "{brand} deep dive"] },
      { intent: "newsletter", templates: ["{brand} newsletter review", "{brand} substack", "{brand} analysis"] },
      { intent: "community", templates: ["{brand} forum discussion", "{brand} community feedback", "{brand} user experience"] },
      { intent: "video", templates: ["{brand} review youtube", "{brand} walkthrough"] },
      { intent: "case_study", templates: ["{brand} case study", "using {brand} for", "{brand} workflow"] },
    ];

    // Deterministic site constraints for targeted queries only
    // Removed reddit (has dedicated phase), g2/trustradius (handled by direct scraping)
    const siteConstraints = ["site:capterra.com", "site:producthunt.com", "site:news.ycombinator.com", ""];
    const queries: Array<{ query_text: string; intent_bucket: string; domain_target: string }> = [];

    const brandName = profile.brand_terms?.[0] || company_name;
    let queryIndex = 0;

    // Build disambiguator from industry_type for common-name brands
    const disambiguator = profile.industry_type
      ? profile.industry_type.split(/[\s\/,]+/).slice(0, 2).join(" ")
      : "";
    console.log(`Disambiguator: "${disambiguator}" (industry: ${profile.industry_type})`);

    // Add targeted queries (~40%) with deterministic site cycling
    for (const bucket of targetedBuckets) {
      for (const template of bucket.templates) {
        if (queries.length >= 10) break;
        const featureTerm = profile.feature_terms?.[Math.floor(Math.random() * (profile.feature_terms?.length || 1))] || "";
        const queryText = template.replace("{brand}", brandName).replace("{feature}", featureTerm);
        const siteConstraint = siteConstraints[queryIndex % siteConstraints.length];
        queryIndex++;
        const fullQuery = siteConstraint ? `${queryText} ${siteConstraint}` : queryText;
        queries.push({
          query_text: fullQuery,
          intent_bucket: bucket.intent,
          domain_target: siteConstraint.replace("site:", "") || "web",
        });
      }
      if (queries.length >= 10) break;
    }

    // Add discovery queries with disambiguation - always open web, no site constraint
    for (const bucket of discoveryBuckets) {
      for (const template of bucket.templates) {
        if (queries.length >= 22) break;
        const featureTerm = profile.feature_terms?.[Math.floor(Math.random() * (profile.feature_terms?.length || 1))] || "";
        const baseQuery = template.replace("{brand}", brandName).replace("{feature}", featureTerm);
        // Append disambiguator for discovery queries to avoid common-name pollution
        const queryText = disambiguator ? `${baseQuery} ${disambiguator}` : baseQuery;
        queries.push({
          query_text: queryText,
          intent_bucket: bucket.intent,
          domain_target: "web",
        });
      }
      if (queries.length >= 22) break;
    }

    // Add domain-based queries - completely unambiguous regardless of brand name
    const domainBucket = [
      `${domain} review`,
      `${domain} feedback`,
      `${domain} alternative`,
    ];
    for (const queryText of domainBucket) {
      if (queries.length >= 25) break;
      queries.push({
        query_text: queryText,
        intent_bucket: "domain_search",
        domain_target: "web",
      });
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
