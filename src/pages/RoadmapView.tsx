import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCompany } from '@/contexts/CompanyContext';
import TopBar from '@/components/TopBar';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ChevronRight, Search, X, ArrowUpRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface Initiative {
  id: string;
  initiative_id: string;
  title: string;
  cluster_id: string;
  cluster_name: string;
  predicted_impact: string;
  impact_count: number;
  status: string;
  owner_name: string;
  owner_initials: string;
  impact_rationale: string | null;
  raw_feedback_count: number;
}

const STATUS_STYLES: Record<string, string> = {
  Proposal: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  'In Progress': 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  Shipped: 'bg-green-500/15 text-green-400 border-green-500/30',
};

const IMPACT_STYLES: Record<string, string> = {
  High: 'text-red-400',
  Medium: 'text-yellow-400',
  Low: 'text-green-400',
};

export default function RoadmapView() {
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selected, setSelected] = useState<Initiative | null>(null);
  const [clusterFeedback, setClusterFeedback] = useState<any[]>([]);
  const { toast } = useToast();
  const { activeCompany } = useCompany();

  useEffect(() => {
    if (!activeCompany) {
      setInitiatives([]); setLoading(false); return;
    }
    setLoading(true);
    supabase.from('roadmap').select('*').eq('company_id', activeCompany.id).order('initiative_id').then(({ data, error }) => {
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else setInitiatives(data || []);
      setLoading(false);
    });
  }, [activeCompany?.id]);

  const openInitiative = async (init: Initiative) => {
    setSelected(init);
    const { data } = await supabase.from('feedback').select('*').eq('cluster_id', init.cluster_id);
    setClusterFeedback(data || []);
  };

  const filtered = initiatives.filter((i) => {
    const matchStatus = statusFilter === 'All' || i.status === statusFilter;
    const matchSearch = !search || i.title.toLowerCase().includes(search.toLowerCase()) || i.cluster_name.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Roadmap" subtitle={`${initiatives.length} initiatives`} />

      <div className="px-4 py-2 border-b border-border bg-card flex items-center gap-3 flex-wrap shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search initiatives…" className="h-7 pl-8 text-xs w-48 bg-muted border-border" />
        </div>
        <div className="flex items-center gap-1">
          {['All', 'Proposal', 'In Progress', 'Shipped'].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)} className={cn('px-2.5 py-1 rounded text-xs font-medium transition-colors', statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}>{s}</button>
          ))}
        </div>
        {(search || statusFilter !== 'All') && (
          <button onClick={() => { setSearch(''); setStatusFilter('All'); }} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <X className="w-3 h-3" /> Clear
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} results</span>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card border-b border-border z-10">
            <tr>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-20">ID</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Initiative</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-24">Cluster</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-32">Predicted Impact</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-28">Status</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-32">Owner</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-12"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b border-border">
                {Array.from({ length: 7 }).map((_, j) => (
                  <td key={j} className="px-3 py-2"><div className="h-3 bg-muted rounded animate-pulse" /></td>
                ))}
              </tr>
            )) : filtered.map((init) => (
              <tr key={init.id} onClick={() => openInitiative(init)} className="border-b border-border hover:bg-muted/40 cursor-pointer transition-colors">
                <td className="px-3 py-2 mono text-muted-foreground">{init.initiative_id}</td>
                <td className="px-3 py-2 font-medium text-foreground">{init.title}</td>
                <td className="px-3 py-2 mono text-blue-400">{init.cluster_id}</td>
                <td className="px-3 py-2">
                  <span className={cn('font-semibold', IMPACT_STYLES[init.predicted_impact])}>{init.predicted_impact}</span>
                  <span className="text-muted-foreground ml-1">({init.impact_count} req.)</span>
                </td>
                <td className="px-3 py-2">
                  <span className={cn('px-2 py-0.5 rounded border text-[10px] font-medium', STATUS_STYLES[init.status])}>{init.status}</span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[9px] font-medium text-primary shrink-0">{init.owner_initials}</div>
                    <span>{init.owner_name}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No initiatives match your filters</div>
        )}
      </div>

      <Sheet open={!!selected} onOpenChange={() => { setSelected(null); setClusterFeedback([]); }}>
        <SheetContent className="w-[500px] bg-card border-border overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-sm">
                  <span className="mono text-muted-foreground">{selected.initiative_id}</span>
                  <span className={cn('px-2 py-0.5 rounded border text-[10px] font-medium', STATUS_STYLES[selected.status])}>{selected.status}</span>
                </SheetTitle>
                <p className="text-sm font-semibold mt-1">{selected.title}</p>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><div className="text-muted-foreground mb-1">Linked Cluster</div>
                    <div className="mono font-medium text-blue-400">{selected.cluster_id}</div>
                    <div className="text-muted-foreground text-[10px] mt-0.5">{selected.cluster_name}</div>
                  </div>
                  <div><div className="text-muted-foreground mb-1">Predicted Impact</div>
                    <div className={cn('font-semibold', IMPACT_STYLES[selected.predicted_impact])}>{selected.predicted_impact} ({selected.impact_count} requests)</div>
                  </div>
                  <div><div className="text-muted-foreground mb-1">Owner</div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[9px] font-medium text-primary">{selected.owner_initials}</div>
                      <span className="font-medium">{selected.owner_name}</span>
                    </div>
                  </div>
                  <div><div className="text-muted-foreground mb-1">Raw Feedback</div>
                    <div className="font-medium">{selected.raw_feedback_count} items</div>
                  </div>
                </div>
                {selected.impact_rationale && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-2">Impact Rationale</div>
                    <div className="p-3 bg-muted rounded-md text-xs leading-relaxed">{selected.impact_rationale}</div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                    <ArrowUpRight className="w-3 h-3" /> Trace back: Raw Feedback ({clusterFeedback.length})
                  </div>
                  <div className="space-y-2">
                    {clusterFeedback.map((f) => (
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
