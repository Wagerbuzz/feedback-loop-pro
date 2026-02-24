import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import TopBar from '@/components/TopBar';
import { Inbox, GitBranch, Zap, TrendingUp } from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { format, subDays, parseISO } from 'date-fns';

interface FeedbackRow {
  id: string;
  sentiment: string;
  timestamp: string;
  source: string;
}

interface ClusterRow {
  id: string;
  priority: string;
}

interface ActionRow {
  id: string;
  status: string;
}

const SENTIMENT_COLORS: Record<string, string> = {
  Positive: 'hsl(142, 71%, 45%)',
  Negative: 'hsl(0, 72%, 51%)',
  Neutral: 'hsl(215, 16%, 55%)',
};

export default function DashboardView() {
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [clusters, setClusters] = useState<ClusterRow[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [fb, cl, ac] = await Promise.all([
        supabase.from('feedback').select('id, sentiment, timestamp, source'),
        supabase.from('clusters').select('id, priority'),
        supabase.from('actions').select('id, status'),
      ]);
      setFeedback(fb.data ?? []);
      setClusters(cl.data ?? []);
      setActions(ac.data ?? []);
      setLoading(false);
    };
    load();
  }, []);

  // Sentiment breakdown for pie chart
  const sentimentData = useMemo(() => {
    const counts: Record<string, number> = { Positive: 0, Negative: 0, Neutral: 0 };
    feedback.forEach((f) => { counts[f.sentiment] = (counts[f.sentiment] || 0) + 1; });
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }));
  }, [feedback]);

  // Feedback volume over last 14 days
  const volumeData = useMemo(() => {
    const days = 14;
    const buckets: Record<string, number> = {};
    for (let i = days - 1; i >= 0; i--) {
      buckets[format(subDays(new Date(), i), 'MMM d')] = 0;
    }
    feedback.forEach((f) => {
      const key = format(parseISO(f.timestamp), 'MMM d');
      if (key in buckets) buckets[key]++;
    });
    return Object.entries(buckets).map(([date, count]) => ({ date, count }));
  }, [feedback]);

  const pendingActions = actions.filter((a) => a.status === 'Pending').length;

  const statCards = [
    { label: 'Total Feedback', value: feedback.length, icon: Inbox, accent: 'text-primary' },
    { label: 'Active Clusters', value: clusters.length, icon: GitBranch, accent: 'text-purple-400' },
    { label: 'Pending Actions', value: pendingActions, icon: Zap, accent: 'text-amber-400' },
    { label: 'Positive Rate', value: feedback.length ? `${Math.round((feedback.filter((f) => f.sentiment === 'Positive').length / feedback.length) * 100)}%` : '—', icon: TrendingUp, accent: 'text-green-400' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Dashboard" subtitle="Overview of your feedback pipeline" />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((card) => (
            <div
              key={card.label}
              className="bg-card border border-border rounded-lg p-4 flex items-center gap-4"
            >
              <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                <card.icon className={`w-4.5 h-4.5 ${card.accent}`} />
              </div>
              <div>
                <div className="text-xl font-bold tracking-tight">
                  {loading ? <div className="h-5 w-12 bg-muted rounded animate-pulse" /> : card.value}
                </div>
                <div className="text-xs text-muted-foreground">{card.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Volume line chart */}
          <div className="lg:col-span-2 bg-card border border-border rounded-lg p-4">
            <h2 className="text-sm font-semibold mb-4">Feedback Volume (14 days)</h2>
            {loading ? (
              <div className="h-56 bg-muted/30 rounded animate-pulse" />
            ) : (
              <ResponsiveContainer width="100%" height={224}>
                <LineChart data={volumeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 18%)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: 'hsl(215, 16%, 55%)', fontSize: 11 }}
                    axisLine={{ stroke: 'hsl(220, 13%, 18%)' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: 'hsl(215, 16%, 55%)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(220, 13%, 11%)',
                      border: '1px solid hsl(220, 13%, 18%)',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="hsl(217, 91%, 60%)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: 'hsl(217, 91%, 60%)' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Sentiment pie chart */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h2 className="text-sm font-semibold mb-4">Sentiment Breakdown</h2>
            {loading ? (
              <div className="h-56 bg-muted/30 rounded animate-pulse" />
            ) : (
              <ResponsiveContainer width="100%" height={224}>
                <PieChart>
                  <Pie
                    data={sentimentData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {sentimentData.map((entry) => (
                      <Cell key={entry.name} fill={SENTIMENT_COLORS[entry.name] || '#888'} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(220, 13%, 11%)',
                      border: '1px solid hsl(220, 13%, 18%)',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
            {/* Legend */}
            <div className="flex justify-center gap-4 mt-2">
              {sentimentData.map((entry) => (
                <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: SENTIMENT_COLORS[entry.name] }}
                  />
                  <span className="text-muted-foreground">{entry.name}</span>
                  <span className="font-medium">{entry.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
