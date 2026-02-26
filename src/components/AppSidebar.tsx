import { useLocation, useNavigate } from 'react-router-dom';
import { Inbox, GitBranch, Zap, Map, Users, ChevronLeft, ChevronRight, LayoutDashboard, Settings } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { title: 'Dashboard', icon: LayoutDashboard, url: '/dashboard' },
  { title: 'Inbox', icon: Inbox, url: '/inbox' },
  { title: 'Clusters', icon: GitBranch, url: '/clusters' },
  { title: 'Actions', icon: Zap, url: '/actions' },
  { title: 'Roadmap', icon: Map, url: '/roadmap' },
  { title: 'Customer Portal', icon: Users, url: '/portal' },
];


interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

export default function AppSidebar({ collapsed, onToggle }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();

  return (
    <aside
      className={cn(
        'flex flex-col h-screen bg-sidebar border-r border-sidebar-border transition-all duration-200 shrink-0',
        collapsed ? 'w-14' : 'w-52'
      )}
    >
      {/* Header */}
      <div className="flex items-center h-12 px-3 border-b border-sidebar-border shrink-0">
        {!collapsed && (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center shrink-0">
              <Zap className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold tracking-tight truncate">FeedbackFlow</span>
          </div>
        )}
        {collapsed && (
          <div className="w-6 h-6 rounded bg-primary flex items-center justify-center mx-auto">
            <Zap className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
        )}
        {!collapsed && (
          <button
            onClick={onToggle}
            className="ml-auto p-1 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname === item.url || (item.url !== '/' && location.pathname.startsWith(item.url));
          return (
            <button
              key={item.url}
              onClick={() => navigate(item.url)}
              className={cn(
                'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
              title={collapsed ? item.title : undefined}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.title}</span>}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-2 shrink-0 space-y-1">
        <button
          onClick={() => navigate('/settings')}
          className={cn(
            'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors',
            location.pathname.startsWith('/settings')
              ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
              : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
          )}
          title={collapsed ? 'Settings' : undefined}
        >
          <Settings className="w-4 h-4 shrink-0" />
          {!collapsed && <span>Settings</span>}
        </button>

        {collapsed ? (
          <button
            onClick={onToggle}
            className="w-full flex justify-center p-1.5 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <div className="flex items-center gap-2 px-1 py-1">
            <button
              onClick={() => navigate('/settings?tab=profile')}
              className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 hover:ring-1 hover:ring-primary/40 transition-shadow"
            >
              <span className="text-xs font-medium text-primary">
                {profile?.avatar_initials || '?'}
              </span>
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{profile?.full_name || 'User'}</div>
            </div>
            <button
              onClick={signOut}
              className="text-[10px] text-muted-foreground hover:text-foreground shrink-0"
            >
              Out
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
