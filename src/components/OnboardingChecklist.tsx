import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Check, X, ArrowRight } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface OnboardingRow {
  id: string;
  profile_completed: boolean;
  source_connected: boolean;
  cluster_reviewed: boolean;
  action_created: boolean;
  dismissed: boolean;
}

const STEPS = [
  { key: 'profile_completed' as const, label: 'Complete your profile', link: '/settings?tab=profile' },
  { key: 'source_connected' as const, label: 'Connect a data source', link: '/settings?tab=integrations' },
  { key: 'cluster_reviewed' as const, label: 'Review a cluster', link: '/clusters' },
  { key: 'action_created' as const, label: 'Create an action', link: '/actions' },
];

export default function OnboardingChecklist() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<OnboardingRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('onboarding_progress')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data: row }) => {
        setData(row);
        setLoading(false);
      });
  }, [user]);

  if (loading || !data || data.dismissed) return null;

  const completed = STEPS.filter((s) => data[s.key]).length;
  const allDone = completed === STEPS.length;
  if (allDone) return null;

  const dismiss = async () => {
    await supabase.from('onboarding_progress').update({ dismissed: true }).eq('id', data.id);
    setData((d) => (d ? { ...d, dismissed: true } : d));
  };

  const pct = Math.round((completed / STEPS.length) * 100);

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Get started with FeedbackFlow</h3>
          <p className="text-xs text-muted-foreground">{completed} of {STEPS.length} completed</p>
        </div>
        <button onClick={dismiss} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      <Progress value={pct} className="h-1.5" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {STEPS.map((step) => {
          const done = data[step.key];
          return (
            <button
              key={step.key}
              onClick={() => navigate(step.link)}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left',
                done
                  ? 'text-muted-foreground line-through'
                  : 'text-foreground hover:bg-muted'
              )}
            >
              {done ? (
                <Check className="w-4 h-4 text-green-400 shrink-0" />
              ) : (
                <ArrowRight className="w-4 h-4 text-primary shrink-0" />
              )}
              {step.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
