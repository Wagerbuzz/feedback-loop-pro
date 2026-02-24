import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox, GitBranch, Zap, Map, Users, LogOut, LayoutDashboard } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

const NAV_ITEMS = [
  { title: 'Dashboard', icon: LayoutDashboard, url: '/dashboard', keywords: 'home overview stats' },
  { title: 'Inbox', icon: Inbox, url: '/inbox', keywords: 'feedback messages' },
  { title: 'Clusters', icon: GitBranch, url: '/clusters', keywords: 'groups topics' },
  { title: 'Actions', icon: Zap, url: '/actions', keywords: 'tasks todo' },
  { title: 'Roadmap', icon: Map, url: '/roadmap', keywords: 'plan timeline' },
  { title: 'Customer Portal', icon: Users, url: '/portal', keywords: 'customers users' },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { signOut } = useAuth();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const runCommand = (cmd: () => void) => {
    setOpen(false);
    cmd();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          {NAV_ITEMS.map((item) => (
            <CommandItem
              key={item.url}
              value={item.title + ' ' + item.keywords}
              onSelect={() => runCommand(() => navigate(item.url))}
            >
              <item.icon className="mr-2 h-4 w-4" />
              {item.title}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Account">
          <CommandItem
            value="sign out logout"
            onSelect={() => runCommand(() => signOut())}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
