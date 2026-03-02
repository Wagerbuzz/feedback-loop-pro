import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { MessageSquare, Headphones, Hash, FileUp, Code } from 'lucide-react';

const PROVIDERS = [
  { id: 'zendesk', name: 'Zendesk', description: 'Import support tickets', icon: Headphones },
  { id: 'intercom', name: 'Intercom', description: 'Chat conversations', icon: MessageSquare },
  { id: 'slack', name: 'Slack', description: 'Team messages & threads', icon: Hash },
  { id: 'csv', name: 'CSV Upload', description: 'Manual data import', icon: FileUp },
  { id: 'api', name: 'REST API', description: 'Programmatic access', icon: Code },
];

interface Integration {
  id: string;
  provider: string;
  status: string;
}

export default function IntegrationsSettings() {
  const { user } = useAuth();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('integrations')
      .select('id, provider, status')
      .eq('user_id', user.id)
      .then(({ data }) => {
        setIntegrations(data ?? []);
        setLoading(false);
      });
  }, [user]);

  const getStatus = (providerId: string) => {
    return integrations.find((i) => i.provider === providerId)?.status ?? 'disconnected';
  };

  const handleToggle = async (providerId: string, providerName: string) => {
    if (!user) return;
    const existing = integrations.find((i) => i.provider === providerId);
    if (existing && existing.status === 'connected') {
      const { error } = await supabase
        .from('integrations')
        .update({ status: 'disconnected', connected_at: null })
        .eq('id', existing.id);
      if (!error) {
        setIntegrations((prev) =>
          prev.map((i) => (i.id === existing.id ? { ...i, status: 'disconnected' } : i))
        );
        toast.success(`${providerName} disconnected`);
      }
    } else if (existing) {
      const { error } = await supabase
        .from('integrations')
        .update({ status: 'connected', connected_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (!error) {
        setIntegrations((prev) =>
          prev.map((i) => (i.id === existing.id ? { ...i, status: 'connected' } : i))
        );
        toast.success(`${providerName} connected`);
      }
    } else {
      const { data, error } = await supabase
        .from('integrations')
        .insert({ user_id: user.id, provider: providerId, display_name: providerName, status: 'connected', connected_at: new Date().toISOString() })
        .select('id, provider, status')
        .single();
      if (!error && data) {
        setIntegrations((prev) => [...prev, data]);
        toast.success(`${providerName} connected`);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Integrations</h2>
        <p className="text-sm text-muted-foreground">Connect your feedback sources to start importing data.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {PROVIDERS.map((p) => {
          const status = getStatus(p.id);
          const connected = status === 'connected';
          return (
            <div
              key={p.id}
              className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between">
                <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center">
                  <p.icon className="w-4.5 h-4.5 text-muted-foreground" />
                </div>
                <Badge variant={connected ? 'default' : 'secondary'} className="text-[10px]">
                  {connected ? 'Connected' : 'Disconnected'}
                </Badge>
              </div>
              <div>
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.description}</div>
              </div>
              <Button
                size="sm"
                variant={connected ? 'outline' : 'default'}
                onClick={() => handleToggle(p.id, p.name)}
                disabled={loading}
                className="mt-auto"
              >
                {connected ? 'Disconnect' : 'Connect'}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
