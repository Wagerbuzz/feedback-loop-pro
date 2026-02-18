import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import TopBar from '@/components/TopBar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { MessageSquare, Mail, Slack, Headphones, Smartphone, Globe, Plus, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import AddFeedbackDialog from '@/components/AddFeedbackDialog';

interface Feedback {
  id: string;
  feedback_id: string;
  source: string;
  text: string;
  customer_name: string;
  timestamp: string;
  sentiment: string;
  status: string;
  cluster_id: string | null;
  channel: string | null;
}

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  Intercom: <MessageSquare className="w-3.5 h-3.5 text-blue-400" />,
  Email: <Mail className="w-3.5 h-3.5 text-orange-400" />,
  Slack: <Slack className="w-3.5 h-3.5 text-purple-400" />,
  Zendesk: <Headphones className="w-3.5 h-3.5 text-green-400" />,
  'In-App': <Smartphone className="w-3.5 h-3.5 text-cyan-400" />,
  Social: <Globe className="w-3.5 h-3.5 text-pink-400" />,
};

const SENTIMENT_STYLES: Record<string, string> = {
  Positive: 'bg-green-500/15 text-green-400 border-green-500/30',
  Negative: 'bg-red-500/15 text-red-400 border-red-500/30',
  Neutral: 'bg-muted text-muted-foreground border-border',
};

const STATUS_STYLES: Record<string, string> = {
  New: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  Clustered: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  'Under Review': 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
};

const SOURCES = ['All', 'Intercom', 'Slack', 'Email', 'Zendesk', 'In-App', 'Social'];

export default function InboxView() {
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [sentimentFilter, setSentimentFilter] = useState('All');
  const [selected, setSelected] = useState<Feedback | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const { toast } = useToast();

  const fetchFeedback = async () => {
    const { data, error } = await supabase
      .from('feedback')
      .select('*')
      .order('timestamp', { ascending: false });
    if (error) {
      toast({ title: 'Error loading feedback', description: error.message, variant: 'destructive' });
    } else {
      setFeedback(data || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchFeedback(); }, []);

  const filtered = feedback.filter((f) => {
    const matchSource = sourceFilter === 'All' || f.source === sourceFilter;
    const matchSentiment = sentimentFilter === 'All' || f.sentiment === sentimentFilter;
    const matchSearch = !search || f.text.toLowerCase().includes(search.toLowerCase()) || f.customer_name.toLowerCase().includes(search.toLowerCase());
    return matchSource && matchSentiment && matchSearch;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title="Feedback Inbox"
        subtitle={`${feedback.length} items`}
        actions={
          <Button size="sm" className="h-7 text-xs gap-1.5" onClick={() => setShowAdd(true)}>
            <Plus className="w-3.5 h-3.5" /> Add Feedback
          </Button>
        }
      />

      {/* Filters */}
      <div className="px-4 py-2 border-b border-border bg-card flex items-center gap-3 flex-wrap shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search feedback…"
            className="h-7 pl-8 text-xs w-48 bg-muted border-border"
          />
        </div>
        <div className="flex items-center gap-1">
          {SOURCES.map((s) => (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={cn(
                'px-2.5 py-1 rounded text-xs font-medium transition-colors',
                sourceFilter === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-2">
          {['All', 'Positive', 'Negative', 'Neutral'].map((s) => (
            <button
              key={s}
              onClick={() => setSentimentFilter(s)}
              className={cn(
                'px-2.5 py-1 rounded text-xs font-medium transition-colors',
                sentimentFilter === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              )}
            >
              {s}
            </button>
          ))}
        </div>
        {(search || sourceFilter !== 'All' || sentimentFilter !== 'All') && (
          <button
            onClick={() => { setSearch(''); setSourceFilter('All'); setSentimentFilter('All'); }}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} results</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card border-b border-border z-10">
            <tr>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-20">ID</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-24">Source</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Feedback</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-32">Customer</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-32">Timestamp</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-24">Sentiment</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-28">Status</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-20">Cluster</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="px-3 py-2">
                      <div className="h-3 bg-muted rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.map((f) => (
              <tr
                key={f.id}
                onClick={() => setSelected(f)}
                className="border-b border-border hover:bg-muted/40 cursor-pointer transition-colors"
              >
                <td className="px-3 py-2 mono text-muted-foreground">{f.feedback_id}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    {SOURCE_ICONS[f.source] || <Globe className="w-3.5 h-3.5" />}
                    <span>{f.source}</span>
                  </div>
                </td>
                <td className="px-3 py-2 max-w-xs">
                  <span className="line-clamp-1 text-foreground/90">{f.text}</span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{f.customer_name}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {new Date(f.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-3 py-2">
                  <span className={cn('px-2 py-0.5 rounded border text-[10px] font-medium', SENTIMENT_STYLES[f.sentiment])}>
                    {f.sentiment}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={cn('px-2 py-0.5 rounded border text-[10px] font-medium', STATUS_STYLES[f.status])}>
                    {f.status}
                  </span>
                </td>
                <td className="px-3 py-2 mono text-muted-foreground">{f.cluster_id || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            No feedback matches your filters
          </div>
        )}
      </div>

      {/* Side panel */}
      <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
        <SheetContent className="w-96 bg-card border-border">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-sm">
                  <span className="mono text-muted-foreground">{selected.feedback_id}</span>
                  <span className={cn('px-2 py-0.5 rounded border text-[10px] font-medium', SENTIMENT_STYLES[selected.sentiment])}>
                    {selected.sentiment}
                  </span>
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="p-3 bg-muted rounded-md">
                  <p className="text-sm leading-relaxed">"{selected.text}"</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-muted-foreground mb-1">Customer</div>
                    <div className="font-medium">{selected.customer_name}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1">Source</div>
                    <div className="flex items-center gap-1.5 font-medium">
                      {SOURCE_ICONS[selected.source]}
                      {selected.source}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1">Channel</div>
                    <div className="font-medium">{selected.channel || '—'}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1">Status</div>
                    <span className={cn('px-2 py-0.5 rounded border text-[10px] font-medium', STATUS_STYLES[selected.status])}>
                      {selected.status}
                    </span>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1">Timestamp</div>
                    <div className="font-medium">
                      {new Date(selected.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1">Linked Cluster</div>
                    <div className="font-medium mono">{selected.cluster_id || '—'}</div>
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <AddFeedbackDialog open={showAdd} onClose={() => setShowAdd(false)} onAdded={fetchFeedback} />
    </div>
  );
}
