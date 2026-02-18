import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import TopBar from '@/components/TopBar';
import { cn } from '@/lib/utils';

interface PortalItem {
  id: string;
  feedback_text: string;
  status: string;
  action_taken: string;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  Received: 'bg-muted text-muted-foreground border-border',
  Clustered: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  'Under Review': 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  'In Progress': 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  Shipped: 'bg-green-500/15 text-green-400 border-green-500/30',
};

const STATUS_ORDER = ['Received', 'Clustered', 'Under Review', 'In Progress', 'Shipped'];

export default function PortalView() {
  const [items, setItems] = useState<PortalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    supabase.from('customer_portal').select('*').order('created_at', { ascending: false }).then(({ data, error }) => {
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else setItems(data || []);
      setLoading(false);
    });
  }, []);

  const getStatusStep = (status: string) => STATUS_ORDER.indexOf(status);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title="Customer Portal"
        subtitle="Track how your feedback influences the product"
      />

      {/* Legend */}
      <div className="px-4 py-2 border-b border-border bg-card flex items-center gap-2 shrink-0">
        <span className="text-xs text-muted-foreground mr-2">Progress stages:</span>
        {STATUS_ORDER.map((s, i) => (
          <div key={s} className="flex items-center gap-1.5">
            <span className={cn('px-2 py-0.5 rounded border text-[10px] font-medium', STATUS_STYLES[s])}>{s}</span>
            {i < STATUS_ORDER.length - 1 && <span className="text-muted-foreground text-xs">→</span>}
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card border-b border-border z-10">
            <tr>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Feedback Submitted</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-36">Status</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium w-32">Progress</th>
              <th className="px-3 py-2 text-left text-muted-foreground font-medium">Action Taken</th>
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="border-b border-border">
                {Array.from({ length: 4 }).map((_, j) => (
                  <td key={j} className="px-3 py-2"><div className="h-3 bg-muted rounded animate-pulse" /></td>
                ))}
              </tr>
            )) : items.map((item) => (
              <tr key={item.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                <td className="px-3 py-2 text-foreground/90 italic max-w-xs">
                  <span className="line-clamp-2">{item.feedback_text}</span>
                </td>
                <td className="px-3 py-2">
                  <span className={cn('px-2 py-0.5 rounded border text-[10px] font-medium', STATUS_STYLES[item.status])}>{item.status}</span>
                </td>
                <td className="px-3 py-2">
                  {/* Progress dots */}
                  <div className="flex items-center gap-1">
                    {STATUS_ORDER.map((s, i) => (
                      <div
                        key={s}
                        className={cn(
                          'w-2 h-2 rounded-full',
                          i <= getStatusStep(item.status) ? 'bg-primary' : 'bg-border'
                        )}
                      />
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 text-muted-foreground max-w-md">
                  <span className="line-clamp-2">{item.action_taken || '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 && (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No portal items yet</div>
        )}
      </div>
    </div>
  );
}
