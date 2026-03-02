import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, Briefcase, Plug, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import TopBar from '@/components/TopBar';
import CompanySetup from '@/components/settings/CompanySetup';
import WorkspaceSettings from '@/components/settings/WorkspaceSettings';
import IntegrationsSettings from '@/components/settings/IntegrationsSettings';
import NotificationSettings from '@/components/settings/NotificationSettings';

const TABS = [
  { id: 'companies', label: 'Companies', icon: Building2 },
  { id: 'workspace', label: 'Workspace', icon: Briefcase },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'notifications', label: 'Notifications', icon: Bell },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function SettingsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as TabId) || 'companies';
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  useEffect(() => {
    const tab = searchParams.get('tab') as TabId;
    if (tab && TABS.some((t) => t.id === tab)) setActiveTab(tab);
  }, [searchParams]);

  const selectTab = (id: TabId) => {
    setActiveTab(id);
    setSearchParams({ tab: id });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Settings" subtitle="Manage your account and integrations" />

      <div className="flex flex-1 overflow-hidden">
        {/* Left nav */}
        <nav className="w-48 shrink-0 border-r border-border p-3 space-y-0.5 overflow-y-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              className={cn(
                'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors',
                activeTab === tab.id
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <tab.icon className="w-4 h-4 shrink-0" />
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {activeTab === 'companies' && <CompanySetup />}
          {activeTab === 'workspace' && <WorkspaceSettings />}
          {activeTab === 'integrations' && <IntegrationsSettings />}
          {activeTab === 'notifications' && <NotificationSettings />}
        </div>
      </div>
    </div>
  );
}
