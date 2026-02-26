import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface Prefs {
  email_digest: boolean;
  anomaly_alerts: boolean;
  weekly_summary: boolean;
}

export default function NotificationSettings() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Prefs>({ email_digest: true, anomaly_alerts: true, weekly_summary: false });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('notification_preferences')
      .select('email_digest, anomaly_alerts, weekly_summary')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setPrefs(data);
        setLoaded(true);
      });
  }, [user]);

  const toggle = async (key: keyof Prefs) => {
    if (!user) return;
    const newVal = !prefs[key];
    setPrefs((p) => ({ ...p, [key]: newVal }));

    const { error } = await supabase
      .from('notification_preferences')
      .upsert({ user_id: user.id, [key]: newVal }, { onConflict: 'user_id' });

    if (error) {
      setPrefs((p) => ({ ...p, [key]: !newVal }));
      toast.error('Failed to update preference');
    }
  };

  const items = [
    { key: 'email_digest' as const, label: 'Email digest', desc: 'Daily summary of new feedback and activity.' },
    { key: 'anomaly_alerts' as const, label: 'Anomaly alerts', desc: 'Get notified when feedback volume or negative sentiment spikes.' },
    { key: 'weekly_summary' as const, label: 'Weekly summary', desc: 'A weekly overview of trends, clusters, and actions.' },
  ];

  return (
    <div className="space-y-6 max-w-md">
      <div>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">Choose what updates you receive.</p>
      </div>

      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm">{item.label}</Label>
              <p className="text-xs text-muted-foreground">{item.desc}</p>
            </div>
            <Switch checked={prefs[item.key]} onCheckedChange={() => toggle(item.key)} disabled={!loaded} />
          </div>
        ))}
      </div>
    </div>
  );
}
