import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import TopBar from '@/components/TopBar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Search, X, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Action {
  id: string;
  action_id: string;
  cluster_id: string;
  cluster_name: string;
  suggested_action: string;
  owner_name: string;
  owner_initials: string;
  owner_role: string;
  status: string;
  deadline: string | null;
  ai_suggested: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  Pending: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  'In Progress': 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  Done: 'bg-green-500/15 text-green-400 border-green-500/30',
};

const OWNERS = ['All', 'Alex Rivera', 'Morgan Lee', 'Jordan Kim', 'Taylor Brooks', 'Sam Quinn'];

export default function ActionsView() {
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [ownerFilter, setOwnerFilter] = useState('All');
  const { toast } = useToast();

  const fetchActions = async () => {
    const { data, error } = await supabase.from('actions').select('*').order('action_id');
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else setActions(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchActions(); }, []);

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from('actions').update({ status }).eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setActions((prev) => prev.map((a) => a.id === id ? { ...a, status } : a));
      toast({ title: 'Status updated', description: `Action updated to ${status}` });
    }
  };

  const updateOwner = async (id: string, owner_name: string) => {
    const initials = owner_name.split(' ').map(n => n[0]).join('').toUpperCase();
    const { error } = await supabase.from('actions').update({ owner_name, owner_initials: initials }).eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setActions((prev) => prev.map((a) => a.id === id ? { ...a, owner_name, owner_initials: initials } : a));
      toast({ title: 'Owner updated' });
    }
  };

  const filtered = actions.filter((a) => {
    const matchStatus = statusFilter === 'All' || a.status === statusFilter;
    const matchOwner = ownerFilter === 'All' || a.owner_name === ownerFilter;
    const matchSearch = !search || a.suggested_action.toLowerCase().includes(search.toLowerCase()) || a.cluster_name.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchOwner && matchSearch;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Actions" subtitle={`${actions.length} agentic actions`} />

      <div className="px-4 py-2 border-b border-border bg-card flex items-center gap-3 flex-wrap shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search actions…" className="h-7 pl-8 text-xs w-48 bg-muted border-border" />
        </div>
        <div className="flex items-center gap-1">
          {['All', 'Pending', 'In Progress', 'Done'].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)} className={cn('px-2.5 py-1 rounded text-xs font-medium transition-colors', statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}>{s}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {OWNERS.map((o) => (
            <button key={o} onClick={() => setOwnerFilter(o)} className={cn('px-2.5 py-1 rounded text-xs font-medium transition-colors', ownerFilter === o ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}>{o === 'All' ? 'All Owners' : o.split(' ')[0]}</button>
          ))}
        </div>
        {(search || statusFilter !== 'All' || ownerFilter !== 'All') && (
          <button onClick={() => { setSearch(''); setStatusFilter('All'); setOwnerFilter('All'); }} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <X className="w-3 h-3" /> Clear
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} results</span>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card border-b border-border z-10">
            <tr>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-20">Action ID</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-24">Cluster</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Suggested Action</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-36">Owner</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-32">Status</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-28">Deadline</th>
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="border-b border-border">
                {Array.from({ length: 6 }).map((_, j) => (
                  <td key={j} className="px-3 py-2"><div className="h-3 bg-muted rounded animate-pulse" /></td>
                ))}
              </tr>
            )) : filtered.map((a) => (
              <tr key={a.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                <td className="px-3 py-2 mono text-muted-foreground">{a.action_id}</td>
                <td className="px-3 py-2 mono text-blue-400">{a.cluster_id}</td>
                <td className="px-3 py-2">
                  <div className="flex items-start gap-1.5">
                    {a.ai_suggested && (
                      <span className="flex items-center gap-0.5 mt-0.5 shrink-0 px-1.5 py-0.5 bg-purple-500/15 text-purple-400 border border-purple-500/30 rounded text-[9px] font-medium">
                        <Sparkles className="w-2.5 h-2.5" /> AI
                      </span>
                    )}
                    <span className="text-foreground/90">{a.suggested_action}</span>
                  </div>
                </td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <Select value={a.owner_name} onValueChange={(v) => updateOwner(a.id, v)}>
                    <SelectTrigger className="h-6 text-[11px] bg-transparent border-transparent hover:bg-muted hover:border-border gap-1 px-1.5">
                      <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[9px] font-medium text-primary shrink-0">{a.owner_initials}</div>
                        <SelectValue />
                      </div>
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {OWNERS.filter(o => o !== 'All').map((o) => (
                        <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <Select value={a.status} onValueChange={(v) => updateStatus(a.id, v)}>
                    <SelectTrigger className="h-6 text-[11px] border-transparent bg-transparent hover:bg-muted hover:border-border px-1.5">
                      <span className={cn('px-2 py-0.5 rounded border text-[10px] font-medium', STATUS_STYLES[a.status])}>{a.status}</span>
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {['Pending', 'In Progress', 'Done'].map((s) => (
                        <SelectItem key={s} value={s} className="text-xs">
                          <span className={cn('px-2 py-0.5 rounded border text-[10px] font-medium', STATUS_STYLES[s])}>{s}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {a.deadline ? new Date(a.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No actions match your filters</div>
        )}
      </div>
    </div>
  );
}
