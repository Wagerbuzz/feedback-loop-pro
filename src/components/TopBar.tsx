import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

const ROLE_COLORS: Record<string, string> = {
  pm: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  cs: 'bg-green-500/20 text-green-400 border-green-500/30',
  exec: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};
const ROLE_LABELS: Record<string, string> = {
  pm: 'Product Manager',
  cs: 'Customer Success',
  exec: 'Executive',
};

interface Props {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function TopBar({ title, subtitle, actions }: Props) {
  const { profile, role } = useAuth();

  return (
    <header className="h-12 flex items-center justify-between px-4 border-b border-border bg-card shrink-0">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-sm font-semibold leading-none">{title}</h1>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {actions}
        {role && (
          <span className={cn('text-[10px] px-2 py-0.5 rounded border font-medium', ROLE_COLORS[role])}>
            {ROLE_LABELS[role]}
          </span>
        )}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-xs font-medium text-primary">
              {profile?.avatar_initials || '?'}
            </span>
          </div>
          <span className="text-xs text-muted-foreground hidden sm:block">
            {profile?.full_name || ''}
          </span>
        </div>
      </div>
    </header>
  );
}
