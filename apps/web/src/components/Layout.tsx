import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { KeyRound, LogOut, Moon, Sun, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Field } from './ui/label';
import { ErrorBox } from './common';
import { useEffect, useState } from 'react';
import { useLogout, useMe, setServerTime } from '@/lib/auth';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { useLiveUpdates } from '@/lib/events';

function NavItem({ to, children, end }: { to: string; children: React.ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent', isActive ? 'bg-accent text-foreground' : 'text-muted-foreground')
      }
    >
      {children}
    </NavLink>
  );
}

export function Layout() {
  const { data } = useMe();
  const logout = useLogout();
  const user = data?.user;
  const loc = useLocation();
  const params = useParams();
  const contestId = params.cid ?? null;
  const isAdminArea = loc.pathname.startsWith('/admin');
  const [dark, setDark] = useState(document.documentElement.classList.contains('dark'));
  const [pwOpen, setPwOpen] = useState(false);
  useEffect(() => {
    if (data?.serverTime) setServerTime(data.serverTime);
  }, [data?.serverTime]);
  useLiveUpdates(user ? (isAdminArea ? null : contestId) : null);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="container flex h-14 items-center gap-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <Trophy className="h-5 w-5 text-primary" />
            <span className="hidden sm:inline">NOI Contest System</span>
          </Link>
          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            {user?.role === 'ADMIN' && (
              <>
                <NavItem to="/admin" end>Contests</NavItem>
                <NavItem to="/admin/users">Users</NavItem>
                <NavItem to="/admin/submissions">Submissions</NavItem>
                <NavItem to="/admin/queue">Queue</NavItem>
              </>
            )}
            {user?.role === 'CONTESTANT' && contestId && (
              <>
                <NavItem to={`/c/${contestId}`} end>Problems</NavItem>
                <NavItem to={`/c/${contestId}/submissions`}>My submissions</NavItem>
                <NavItem to={`/c/${contestId}/scoreboard`}>Scoreboard</NavItem>
              </>
            )}
          </nav>
          <Button variant="ghost" size="icon" onClick={toggleTheme} title="Toggle theme">
            {dark ? <Sun /> : <Moon />}
          </Button>
          {user && (
            <div className="flex items-center gap-2">
              <div className="hidden text-right text-sm leading-tight md:block">
                <div className="font-medium">{user.displayName}</div>
                <div className="text-xs text-muted-foreground">{user.username}</div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setPwOpen(true)} title="Change password">
                <KeyRound />
              </Button>
              <Button variant="ghost" size="icon" onClick={logout} title="Log out">
                <LogOut />
              </Button>
            </div>
          )}
        </div>
      </header>
      <main className="container py-6">
        <Outlet />
      </main>
      {pwOpen && <PasswordDialog onClose={() => setPwOpen(false)} />}
    </div>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    setError(null);
    if (next !== again) return setError(new Error('The new passwords do not match'));
    try {
      await api.post('/api/auth/password', { current, next });
      toast.success('Password changed');
      onClose();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Repeat new password">
            <Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </Field>
          <ErrorBox error={error} />
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={!current || next.length < 8}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
