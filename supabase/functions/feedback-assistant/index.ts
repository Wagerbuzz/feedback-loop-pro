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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { messages } = await req.json();

    // Fetch recent feedback data for context
    const [feedbackRes, clustersRes, actionsRes] = await Promise.all([
      supabase.from("feedback").select("*").order("timestamp", { ascending: false }).limit(100),
      supabase.from("clusters").select("*").order("feedback_count", { ascending: false }).limit(50),
      supabase.from("actions").select("*").order("created_at", { ascending: false }).limit(50),
    ]);

    const feedback = feedbackRes.data || [];
    const clusters = clustersRes.data || [];
    const actions = actionsRes.data || [];

    // Build summary stats
    const totalFeedback = feedback.length;
    const sentimentCounts = feedback.reduce((acc: Record<string, number>, f: any) => {
      acc[f.sentiment] = (acc[f.sentiment] || 0) + 1;
      return acc;
    }, {});
    const sourceCounts = feedback.reduce((acc: Record<string, number>, f: any) => {
      acc[f.source] = (acc[f.source] || 0) + 1;
      return acc;
    }, {});

    const systemPrompt = `You are the FeedbackFlow AI Assistant — an expert at analyzing customer feedback data. You help product managers, CS teams, and executives understand trends, sentiments, and actionable insights from their feedback pipeline.

You have access to the following live data:

## Summary Stats
- Total feedback items: ${totalFeedback}
- Sentiment breakdown: ${JSON.stringify(sentimentCounts)}
- Source breakdown: ${JSON.stringify(sourceCounts)}

## Recent Feedback (last ${feedback.length} items)
${feedback.slice(0, 50).map((f: any) => `- [${f.feedback_id}] "${f.text}" — ${f.customer_name} via ${f.source} (${f.sentiment}, ${f.status}, cluster: ${f.cluster_id || "unassigned"})`).join("\n")}

## Active Clusters (${clusters.length} total)
${clusters.map((c: any) => `- ${c.cluster_id}: "${c.name}" — ${c.feedback_count} feedback, ${c.linked_actions_count} actions, priority: ${c.priority}, sentiment: ${c.sentiment}, tags: [${c.tags.join(", ")}]`).join("\n")}

## Actions (${actions.length} total)
${actions.map((a: any) => `- ${a.action_id}: "${a.suggested_action}" — owner: ${a.owner_name}, status: ${a.status}, cluster: ${a.cluster_id}${a.ai_suggested ? " [AI suggested]" : ""}`).join("\n")}

Guidelines:
- Answer questions about feedback trends, sentiment patterns, top complaints, cluster insights, action status
- Quote specific feedback when relevant
- Provide data-driven recommendations
- Be concise but thorough — use bullet points and markdown formatting
- If asked about something not in the data, say so honestly`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings → Workspace → Usage." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("feedback-assistant error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
