import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

  try {
    const { run_id, company_id } = await req.json();
    if (!run_id || !company_id) {
      return new Response(JSON.stringify({ error: "run_id and company_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load company name
    const { data: company } = await supabase
      .from("companies")
      .select("name")
      .eq("id", company_id)
      .single();

    // Get total counts from all jobs in this run
    const { data: jobs } = await supabase
      .from("collection_jobs")
      .select("new_count, dupe_count")
      .eq("run_id", run_id);

    const totalNew = (jobs || []).reduce((sum: number, j: any) => sum + (j.new_count || 0), 0);
    const totalDupes = (jobs || []).reduce((sum: number, j: any) => sum + (j.dupe_count || 0), 0);

    // Get recently collected feedback texts for this company (from this run's timeframe)
    const { data: runData } = await supabase
      .from("collection_runs")
      .select("started_at")
      .eq("id", run_id)
      .single();

    const startedAt = runData?.started_at || new Date(Date.now() - 300000).toISOString();

    const { data: recentFeedback } = await supabase
      .from("feedback")
      .select("text")
      .eq("company_id", company_id)
      .gte("created_at", startedAt)
      .limit(100);

    const feedbackTexts = (recentFeedback || []).map((f: any) => f.text).filter(Boolean);

    let clustersUpdated = 0;

    if (feedbackTexts.length > 3) {
      console.log(`Clustering ${feedbackTexts.length} feedback items for ${company?.name || company_id}...`);

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
              content: `Group these ${feedbackTexts.length} feedback items into clusters:\n\n${feedbackTexts.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}`,
            },
          ],
          tools: [{
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
                        feedback_indices: { type: "array", items: { type: "number" } },
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
          }],
          tool_choice: { type: "function", function: { name: "create_clusters" } },
        }),
      });

      if (clusterRes.ok) {
        const clusterData = await clusterRes.json();
        const toolCall = clusterData.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall) {
          const { clusters: aiClusters } = JSON.parse(toolCall.function.arguments);
          const companyPrefix = (company?.name || "X").toUpperCase().slice(0, 3);

          for (let i = 0; i < (aiClusters?.length || 0); i++) {
            const c = aiClusters[i];
            const clusterId = `CL-${companyPrefix}-${String(i + 1).padStart(3, "0")}`;

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
    } else {
      console.log(`Only ${feedbackTexts.length} feedback items, skipping clustering`);
    }

    // Finalize the collection run
    await supabase.from("collection_runs").update({
      status: "completed",
      new_feedback_count: totalNew,
      duplicates_skipped: totalDupes,
      clusters_updated: clustersUpdated,
      completed_at: new Date().toISOString(),
    }).eq("id", run_id);

    // Update company last_collected_at
    await supabase.from("companies")
      .update({ last_collected_at: new Date().toISOString() })
      .eq("id", company_id);

    console.log(`Clustering complete: ${clustersUpdated} clusters. Run finalized: ${totalNew} new, ${totalDupes} dupes`);

    return new Response(JSON.stringify({ success: true, clusters_updated: clustersUpdated, total_new: totalNew, total_dupes: totalDupes }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("collect-cluster error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
