import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { company_id } = await req.json();
    if (!company_id) {
      return new Response(JSON.stringify({ error: "company_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: company, error: compErr } = await supabase
      .from("companies")
      .select("id, name, domain, g2_url, capterra_url, trustradius_url, getapp_url")
      .eq("id", company_id)
      .single();
    if (compErr || !company) {
      return new Response(JSON.stringify({ error: "Company not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const brandName = company.name;
    console.log(`Looking up review URLs for "${brandName}" (${company.domain})`);

    const platforms = [
      { key: "g2_url", current: company.g2_url, query: `"${brandName}" site:g2.com/products`, match: /g2\.com\/products\/[^\s"')]+/i },
      { key: "capterra_url", current: company.capterra_url, query: `"${brandName}" site:capterra.com`, match: /capterra\.com\/(?:p\/\d+\/[^\s"')]+|reviews\/[^\s"')]+)/i },
      { key: "trustradius_url", current: company.trustradius_url, query: `"${brandName}" site:trustradius.com/products`, match: /trustradius\.com\/products\/[^\s"')]+/i },
      { key: "getapp_url", current: company.getapp_url, query: `"${brandName}" site:getapp.com`, match: /getapp\.com\/(?:software|reviews)\/[^\s"')]+/i },
    ];

    const updates: Record<string, string> = {};

    // Search in parallel for all platforms that don't already have a URL
    const results = await Promise.allSettled(
      platforms
        .filter((p) => !p.current)
        .map(async (platform) => {
          try {
            console.log(`Searching: ${platform.query}`);
            const res = await fetch("https://api.firecrawl.dev/v1/search", {
              method: "POST",
              headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ query: platform.query, limit: 3 }),
            });

            if (!res.ok) {
              console.warn(`Search failed for ${platform.key}: ${res.status}`);
              return { key: platform.key, url: null };
            }

            const data = await res.json();
            const searchResults = data?.data || [];

            // Find the first URL matching the platform pattern
            for (const result of searchResults) {
              const url = result.url || "";
              if (platform.match.test(url)) {
                // Clean URL - ensure it ends at the reviews path
                let cleanUrl = url.split("?")[0].split("#")[0];
                // Ensure trailing /reviews for G2 and TrustRadius
                if (platform.key === "g2_url" && !cleanUrl.includes("/reviews")) {
                  cleanUrl = cleanUrl.replace(/\/$/, "") + "/reviews";
                }
                console.log(`Found ${platform.key}: ${cleanUrl}`);
                return { key: platform.key, url: cleanUrl };
              }
            }

            console.log(`No matching URL found for ${platform.key}`);
            return { key: platform.key, url: null };
          } catch (err) {
            console.warn(`Error searching for ${platform.key}:`, err);
            return { key: platform.key, url: null };
          }
        })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.url) {
        updates[result.value.key] = result.value.url;
      }
    }

    // Update company with found URLs
    if (Object.keys(updates).length > 0) {
      updates.review_urls_verified_at = new Date().toISOString();
      const { error: updateErr } = await supabase
        .from("companies")
        .update(updates)
        .eq("id", company_id);
      if (updateErr) console.warn("Failed to update company URLs:", updateErr.message);
    }

    const foundCount = Object.keys(updates).filter((k) => k !== "review_urls_verified_at").length;
    console.log(`Found ${foundCount} review URLs for "${brandName}"`);

    return new Response(
      JSON.stringify({ success: true, found: foundCount, urls: updates }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("lookup-review-urls error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
