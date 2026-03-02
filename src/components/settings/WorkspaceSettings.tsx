import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export default function WorkspaceSettings() {
  const { profile, user } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [initials, setInitials] = useState(profile?.avatar_initials || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName, avatar_initials: initials.toUpperCase() })
      .eq('user_id', user.id);
    setSaving(false);
    if (error) {
      toast.error('Failed to update profile');
    } else {
      toast.success('Profile updated');
    }
  };

  return (
    <div className="space-y-6 max-w-md">
      {/* Profile section */}
      <div>
        <h2 className="text-lg font-semibold">Profile</h2>
        <p className="text-sm text-muted-foreground">Manage your personal information.</p>
      </div>

      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
          <span className="text-lg font-semibold text-primary">{initials || '?'}</span>
        </div>
        <div className="text-sm text-muted-foreground">
          Your avatar is generated from your initials.
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="initials">Initials</Label>
          <Input
            id="initials"
            value={initials}
            onChange={(e) => setInitials(e.target.value.slice(0, 2))}
            maxLength={2}
            className="w-24"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Email</Label>
        <p className="text-sm text-muted-foreground">{user?.email ?? '—'}</p>
      </div>

      <Button onClick={handleSave} disabled={saving} size="sm">
        {saving ? 'Saving…' : 'Save changes'}
      </Button>

      {/* Workspace section */}
      <div className="border-t border-border pt-6">
        <h2 className="text-lg font-semibold">Workspace</h2>
        <p className="text-sm text-muted-foreground">Your team workspace settings.</p>
      </div>

      <div className="space-y-1.5">
        <Label>Workspace name</Label>
        <Input defaultValue="My Workspace" disabled />
        <p className="text-xs text-muted-foreground">Workspace settings will be configurable in a future update.</p>
      </div>

      <div className="space-y-1.5">
        <Label>Team members</Label>
        <p className="text-sm text-muted-foreground">Team management coming soon.</p>
      </div>
    </div>
  );
}
