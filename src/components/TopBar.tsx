import { useAuth } from '@/contexts/AuthContext';

interface Props {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function TopBar({ title, subtitle, actions }: Props) {
  const { profile } = useAuth();

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
