import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { company_id } = await req.json();
    if (!company_id) {
      return new Response(JSON.stringify({ error: "company_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load company to determine which sources are enabled
    const { data: company, error: compErr } = await supabase
      .from("companies")
      .select("id, name, collection_sources")
      .eq("id", company_id)
      .single();
    if (compErr || !company) {
      return new Response(JSON.stringify({ error: "Company not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Clean up any stuck runs (older than 3 minutes)
    await supabase.from("collection_runs")
      .update({ status: "failed", error_message: "Timed out", completed_at: new Date().toISOString() })
      .eq("company_id", company_id)
      .eq("status", "running")
      .lt("started_at", new Date(Date.now() - 180000).toISOString());

    // Create collection run
    const { data: run, error: runErr } = await supabase
      .from("collection_runs")
      .insert({ company_id, status: "running" })
      .select("id")
      .single();
    if (runErr || !run) {
      return new Response(JSON.stringify({ error: "Failed to create run" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const runId = run.id;

    // Determine which sources to enable
    const sources = (company.collection_sources as string[]) || ["web", "reddit"];
    const jobSources: string[] = [];

    // review_sites and web are both under the "web" collection source
    if (sources.includes("web")) {
      jobSources.push("review_sites", "web");
    }
    if (sources.includes("reddit")) {
      jobSources.push("reddit");
    }
    if (sources.includes("twitter")) {
      jobSources.push("twitter");
    }

    // Create jobs for each source
    const jobRows = jobSources.map((source) => ({
      run_id: runId,
      company_id,
      source,
      status: "pending",
      attempt: 0,
      new_count: 0,
      dupe_count: 0,
    }));

    const { error: jobsErr } = await supabase.from("collection_jobs").insert(jobRows);
    if (jobsErr) {
      console.error("Failed to create jobs:", jobsErr.message);
      await supabase.from("collection_runs").update({
        status: "failed", error_message: "Failed to create jobs", completed_at: new Date().toISOString()
      }).eq("id", runId);
      return new Response(JSON.stringify({ error: "Failed to create jobs" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Orchestrator: created run ${runId} with ${jobSources.length} jobs: ${jobSources.join(", ")}`);

    // Fire-and-forget: invoke each source function
    const functionMap: Record<string, string> = {
      review_sites: "collect-reviews",
      web: "collect-web",
      reddit: "collect-reddit",
      twitter: "collect-twitter",
    };

    const invokePromises = jobSources.map(async (source) => {
      const funcName = functionMap[source];
      if (!funcName) return;

      try {
        const funcUrl = `${SUPABASE_URL}/functions/v1/${funcName}`;
        console.log(`Invoking ${funcName} for run ${runId}...`);
        
        // Fire-and-forget: don't await the response
        fetch(funcUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ run_id: runId, company_id }),
        }).catch((err) => console.warn(`Failed to invoke ${funcName}:`, err));
      } catch (err) {
        console.warn(`Error invoking ${source}:`, err);
      }
    });

    // Wait briefly for invocations to be sent (not for them to complete)
    await Promise.allSettled(invokePromises);

    return new Response(
      JSON.stringify({
        success: true,
        data: { run_id: runId, jobs: jobSources, company_name: company.name },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Orchestrator error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
