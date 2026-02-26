import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function WorkspaceSettings() {
  return (
    <div className="space-y-6 max-w-md">
      <div>
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
