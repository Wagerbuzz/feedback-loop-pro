import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import TopBar from '@/components/TopBar';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface Cluster {
  id: string;
  cluster_id: string;
  name: string;
  category: string;
  feedback_count: number;
  sentiment: string;
  priority: string;
  tags: string[];
  linked_actions_count: number;
}

const CATEGORY_STYLES: Record<string, string> = {
  'Feature Request': 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  'Bug': 'bg-red-500/15 text-red-400 border-red-500/30',
  'UX Improvement': 'bg-purple-500/15 text-purple-400 border-purple-500/30',
};

const PRIORITY_STYLES: Record<string, string> = {
  High: 'bg-red-500/15 text-red-400 border-red-500/30',
  Medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  Low: 'bg-green-500/15 text-green-400 border-green-500/30',
};

const SENTIMENT_STYLES: Record<string, string> = {
  Positive: 'text-green-400',
  Negative: 'text-red-400',
  Neutral: 'text-muted-foreground',
};

export default function ClustersView() {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [selected, setSelected] = useState<Cluster | null>(null);
  const [feedbackForCluster, setFeedbackForCluster] = useState<any[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    supabase.from('clusters').select('*').order('cluster_id').then(({ data, error }) => {
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else setClusters(data || []);
      setLoading(false);
    });
  }, []);

  const openCluster = async (c: Cluster) => {
    setSelected(c);
    const { data } = await supabase.from('feedback').select('*').eq('cluster_id', c.cluster_id);
    setFeedbackForCluster(data || []);
  };

  const filtered = clusters.filter((c) => {
    const matchCat = catFilter === 'All' || c.category === catFilter;
    const matchPriority = priorityFilter === 'All' || c.priority === priorityFilter;
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.tags.some(t => t.toLowerCase().includes(search.toLowerCase()));
    return matchCat && matchPriority && matchSearch;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Clusters" subtitle={`${clusters.length} AI-grouped clusters`} />

      {/* Filters */}
      <div className="px-4 py-2 border-b border-border bg-card flex items-center gap-3 flex-wrap shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clusters…" className="h-7 pl-8 text-xs w-48 bg-muted border-border" />
        </div>
        <div className="flex items-center gap-1">
          {['All', 'Feature Request', 'Bug', 'UX Improvement'].map((s) => (
            <button key={s} onClick={() => setCatFilter(s)} className={cn('px-2.5 py-1 rounded text-xs font-medium transition-colors', catFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}>{s}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {['All', 'High', 'Medium', 'Low'].map((s) => (
            <button key={s} onClick={() => setPriorityFilter(s)} className={cn('px-2.5 py-1 rounded text-xs font-medium transition-colors', priorityFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}>{s}</button>
          ))}
        </div>
        {(search || catFilter !== 'All' || priorityFilter !== 'All') && (
          <button onClick={() => { setSearch(''); setCatFilter('All'); setPriorityFilter('All'); }} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <X className="w-3 h-3" /> Clear
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} results</span>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card border-b border-border z-10">
            <tr>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-20">Cluster ID</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Name</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-36">Category</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-20">Count</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-24">Sentiment</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-24">Priority</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Tags</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} className="border-b border-border">
                {Array.from({ length: 8 }).map((_, j) => (
                  <td key={j} className="px-3 py-2"><div className="h-3 bg-muted rounded animate-pulse" /></td>
                ))}
              </tr>
            )) : filtered.map((c) => (
              <tr key={c.id} onClick={() => openCluster(c)} className="border-b border-border hover:bg-muted/40 cursor-pointer transition-colors">
                <td className="px-3 py-2 mono text-muted-foreground">{c.cluster_id}</td>
                <td className="px-3 py-2 font-medium text-foreground">{c.name}</td>
                <td className="px-3 py-2">
                  <span className={cn('px-2 py-0.5 rounded border text-[10px] font-medium', CATEGORY_STYLES[c.category])}>{c.category}</span>
                </td>
                <td className="px-3 py-2 text-center">
                  <span className="font-medium">{c.feedback_count}</span>
                  <span className="text-muted-foreground ml-1">items</span>
                </td>
                <td className={cn('px-3 py-2 font-medium', SENTIMENT_STYLES[c.sentiment])}>{c.sentiment}</td>
                <td className="px-3 py-2">
                  <span className={cn('px-2 py-0.5 rounded border text-[10px] font-medium', PRIORITY_STYLES[c.priority])}>{c.priority}</span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1 flex-wrap">
                    {c.tags.map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 bg-muted rounded text-[10px] text-muted-foreground">{tag}</span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 text-center text-muted-foreground">{c.linked_actions_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No clusters match your filters</div>
        )}
      </div>

      <Sheet open={!!selected} onOpenChange={() => { setSelected(null); setFeedbackForCluster([]); }}>
        <SheetContent className="w-[480px] bg-card border-border overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-sm">
                  <span className="mono text-muted-foreground">{selected.cluster_id}</span>
                  <span className={cn('px-2 py-0.5 rounded border text-[10px] font-medium', PRIORITY_STYLES[selected.priority])}>{selected.priority}</span>
                </SheetTitle>
                <p className="text-sm font-semibold">{selected.name}</p>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><div className="text-muted-foreground mb-1">Category</div>
                    <span className={cn('px-2 py-0.5 rounded border text-[10px] font-medium', CATEGORY_STYLES[selected.category])}>{selected.category}</span>
                  </div>
                  <div><div className="text-muted-foreground mb-1">Sentiment</div>
                    <span className={cn('font-medium', SENTIMENT_STYLES[selected.sentiment])}>{selected.sentiment}</span>
                  </div>
                  <div><div className="text-muted-foreground mb-1">Feedback Items</div>
                    <span className="font-medium">{selected.feedback_count}</span>
                  </div>
                  <div><div className="text-muted-foreground mb-1">Linked Actions</div>
                    <span className="font-medium">{selected.linked_actions_count}</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-2">Tags</div>
                  <div className="flex gap-1.5 flex-wrap">
                    {selected.tags.map((t) => <span key={t} className="px-2 py-0.5 bg-muted rounded text-xs">{t}</span>)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-2">Raw Feedback ({feedbackForCluster.length})</div>
                  <div className="space-y-2">
                    {feedbackForCluster.map((f) => (
                      <div key={f.id} className="p-2.5 bg-muted rounded-md text-xs">
                        <div className="text-foreground/90 line-clamp-2">"{f.text}"</div>
                        <div className="mt-1 text-muted-foreground">{f.customer_name} · {f.source} · {new Date(f.timestamp).toLocaleDateString()}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
