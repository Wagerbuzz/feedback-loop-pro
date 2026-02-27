import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCompany } from '@/contexts/CompanyContext';
import TopBar from '@/components/TopBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessageSquare, Mail, Slack, Headphones, Smartphone, Globe, Plus, Search, X, ArrowUp, ArrowDown, ArrowUpDown, Trash2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import AddFeedbackDialog from '@/components/AddFeedbackDialog';

type SortField = 'feedback_id' | 'source' | 'text' | 'customer_name' | 'timestamp' | 'sentiment' | 'status' | 'cluster_id';
type SortDir = 'asc' | 'desc';

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
  source_url: string | null;
  pain_point_category: string | null;
  intent_type: string | null;
  confidence_score: number | null;
}

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  Intercom: <MessageSquare className="w-3.5 h-3.5 text-blue-400" />,
  Email: <Mail className="w-3.5 h-3.5 text-orange-400" />,
  Slack: <Slack className="w-3.5 h-3.5 text-purple-400" />,
  Zendesk: <Headphones className="w-3.5 h-3.5 text-green-400" />,
  'In-App': <Smartphone className="w-3.5 h-3.5 text-cyan-400" />,
  Social: <Globe className="w-3.5 h-3.5 text-pink-400" />,
  Reddit: <Globe className="w-3.5 h-3.5 text-orange-400" />,
  G2: <Globe className="w-3.5 h-3.5 text-red-400" />,
  TrustRadius: <Globe className="w-3.5 h-3.5 text-blue-400" />,
  Web: <Globe className="w-3.5 h-3.5 text-muted-foreground" />,
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

const SOURCES = ['All', 'Intercom', 'Slack', 'Email', 'Zendesk', 'In-App', 'Social', 'Reddit', 'G2', 'TrustRadius', 'Web'];
const STATUSES = ['New', 'Clustered', 'Under Review'];
const SENTIMENTS = ['Positive', 'Negative', 'Neutral'];

export default function InboxView() {
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [sentimentFilter, setSentimentFilter] = useState('All');
  const [selected, setSelected] = useState<Feedback | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const { toast } = useToast();
  const { activeCompany } = useCompany();

  const fetchFeedback = async () => {
    if (!activeCompany) {
      setFeedback([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('feedback')
      .select('*')
      .eq('company_id', activeCompany.id)
      .order('timestamp', { ascending: false });
    if (error) {
      toast({ title: 'Error loading feedback', description: error.message, variant: 'destructive' });
    } else {
      setFeedback(data || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchFeedback(); }, [activeCompany?.id]);

  const filtered = useMemo(() => {
    const list = feedback.filter((f) => {
      const matchSource = sourceFilter === 'All' || f.source === sourceFilter;
      const matchSentiment = sentimentFilter === 'All' || f.sentiment === sentimentFilter;
      const matchSearch = !search || f.text.toLowerCase().includes(search.toLowerCase()) || f.customer_name.toLowerCase().includes(search.toLowerCase());
      return matchSource && matchSentiment && matchSearch;
    });
    list.sort((a, b) => {
      const aVal = a[sortField] ?? '';
      const bVal = b[sortField] ?? '';
      const cmp = typeof aVal === 'number' && typeof bVal === 'number'
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [feedback, sourceFilter, sentimentFilter, search, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((f) => selectedIds.has(f.id));
  const someFilteredSelected = filtered.some((f) => selectedIds.has(f.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((f) => f.id)));
    }
  };

  const handleRowCheckbox = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedIds);

    if (e.shiftKey && lastClickedId) {
      const lastIdx = filtered.findIndex((f) => f.id === lastClickedId);
      const curIdx = filtered.findIndex((f) => f.id === id);
      if (lastIdx !== -1 && curIdx !== -1) {
        const [start, end] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
        for (let i = start; i <= end; i++) {
          next.add(filtered[i].id);
        }
      }
    } else {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    }

    setSelectedIds(next);
    setLastClickedId(id);
  };

  const bulkUpdate = async (field: 'status' | 'sentiment', value: string) => {
    setBulkUpdating(true);
    const ids = [...selectedIds];
    const { error } = await supabase
      .from('feedback')
      .update({ [field]: value })
      .in('id', ids);

    if (error) {
      toast({ title: 'Bulk update failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Updated ${ids.length} items`, description: `${field} → ${value}` });
      setSelectedIds(new Set());
      await fetchFeedback();
    }
    setBulkUpdating(false);
  };

  const bulkDelete = async () => {
    setBulkUpdating(true);
    const ids = [...selectedIds];

    // Collect affected cluster_ids before deleting
    const affectedClusterIds = feedback
      .filter(f => ids.includes(f.id) && f.cluster_id)
      .map(f => f.cluster_id!);

    const { error } = await supabase
      .from('feedback')
      .delete()
      .in('id', ids);

    if (error) {
      toast({ title: 'Bulk delete failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Deleted ${ids.length} items` });
      setSelectedIds(new Set());

      // Clean up orphaned clusters
      if (affectedClusterIds.length > 0 && activeCompany) {
        const uniqueClusterIds = [...new Set(affectedClusterIds)];
        for (const clusterId of uniqueClusterIds) {
          const { count } = await supabase
            .from('feedback')
            .select('*', { count: 'exact', head: true })
            .eq('company_id', activeCompany.id)
            .eq('cluster_id', clusterId);

          if (count === 0) {
            await supabase.from('clusters').delete().eq('cluster_id', clusterId).eq('company_id', activeCompany.id);
          } else {
            await supabase.from('clusters').update({ feedback_count: count }).eq('cluster_id', clusterId).eq('company_id', activeCompany.id);
          }
        }
      }

      await fetchFeedback();
    }
    setBulkUpdating(false);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      <TopBar
        title="Feedback"
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
              <th className="px-3 py-2 w-10">
                <Checkbox
                  checked={allFilteredSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                  className={cn(!allFilteredSelected && someFilteredSelected && 'data-[state=unchecked]:bg-primary/30')}
                />
              </th>
              {([
                ['feedback_id', 'ID', 'w-20'],
                ['source', 'Source', 'w-24'],
                ['text', 'Feedback', ''],
                ['customer_name', 'Customer', 'w-32'],
                ['timestamp', 'Timestamp', 'w-32'],
                ['sentiment', 'Sentiment', 'w-24'],
                ['status', 'Status', 'w-28'],
                ['cluster_id', 'Cluster', 'w-20'],
              ] as [SortField, string, string][]).map(([field, label, width]) => (
                <th
                  key={field}
                  onClick={() => toggleSort(field)}
                  className={cn(
                    'px-3 py-2 text-left text-muted-foreground font-medium cursor-pointer select-none hover:text-foreground transition-colors',
                    width
                  )}
                >
                  <span className="flex items-center gap-1">
                    {label}
                    <SortIcon field={field} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {Array.from({ length: 9 }).map((_, j) => (
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
                className={cn(
                  'border-b border-border hover:bg-muted/40 cursor-pointer transition-colors',
                  selectedIds.has(f.id) && 'bg-primary/5'
                )}
              >
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selectedIds.has(f.id)}
                    onClick={(e) => handleRowCheckbox(f.id, e)}
                    onCheckedChange={() => {}}
                    aria-label={`Select ${f.feedback_id}`}
                  />
                </td>
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

      {/* Floating bulk action bar */}
      <div
        className={cn(
          'absolute bottom-6 left-1/2 -translate-x-1/2 z-30 transition-all duration-200',
          selectedIds.size > 0
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-4 pointer-events-none'
        )}
      >
        <div className="flex items-center gap-3 bg-card border border-border rounded-lg shadow-lg px-4 py-2.5">
          <span className="text-xs font-medium text-foreground whitespace-nowrap">
            {selectedIds.size} selected
          </span>
          <div className="w-px h-5 bg-border" />
          <Select onValueChange={(v) => bulkUpdate('status', v)} disabled={bulkUpdating}>
            <SelectTrigger className="h-7 text-xs w-32 bg-muted border-border">
              <SelectValue placeholder="Set Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select onValueChange={(v) => bulkUpdate('sentiment', v)} disabled={bulkUpdating}>
            <SelectTrigger className="h-7 text-xs w-32 bg-muted border-border">
              <SelectValue placeholder="Set Sentiment" />
            </SelectTrigger>
            <SelectContent>
              {SENTIMENTS.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="w-px h-5 bg-border" />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive" className="h-7 text-xs gap-1" disabled={bulkUpdating}>
                <Trash2 className="w-3 h-3" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {selectedIds.size} feedback items?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. The selected feedback items will be permanently removed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={bulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <div className="w-px h-5 bg-border" />
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Deselect
          </button>
        </div>
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
                {/* Pain point & intent badges */}
                {(selected.pain_point_category || selected.intent_type) && (
                  <div className="flex gap-1.5 flex-wrap">
                    {selected.pain_point_category && (
                      <span className="px-2 py-0.5 rounded border border-border bg-muted text-[10px] font-medium text-muted-foreground">
                        {selected.pain_point_category}
                      </span>
                    )}
                    {selected.intent_type && (
                      <span className="px-2 py-0.5 rounded border border-border bg-muted text-[10px] font-medium text-muted-foreground">
                        {selected.intent_type.replace('_', ' ')}
                      </span>
                    )}
                    {selected.confidence_score != null && (
                      <span className="px-2 py-0.5 rounded border border-border bg-muted text-[10px] font-medium text-muted-foreground">
                        {Math.round(selected.confidence_score * 100)}% confidence
                      </span>
                    )}
                  </div>
                )}
                {/* Source URL */}
                {selected.source_url && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Source</div>
                    <a
                      href={selected.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline break-all"
                    >
                      {selected.source_url}
                    </a>
                  </div>
                )}
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
