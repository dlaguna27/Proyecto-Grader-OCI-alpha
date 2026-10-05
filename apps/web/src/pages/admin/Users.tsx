import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Printer, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ErrorBox, PageHeader, Spinner } from '@/components/common';

interface User {
  id: string;
  username: string;
  role: 'ADMIN' | 'CONTESTANT';
  displayName: string;
  members: string;
  organization: string;
  region: string;
}
type Cred = { username: string; password: string; displayName?: string };

function printCredentials(creds: Cred[]) {
  const w = window.open('', '_blank');
  if (!w) return;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  w.document.write(`<html><head><title>Credentials</title><style>
    body{font-family:system-ui,sans-serif;margin:0}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:0}
    .c{border:1px dashed #999;padding:18px 22px;page-break-inside:avoid}
    .n{font-size:18px;font-weight:600;margin-bottom:8px}.k{color:#555;font-size:12px}
    .v{font-family:ui-monospace,Consolas,monospace;font-size:20px;margin-bottom:6px}
  </style></head><body><div class="grid">${creds
    .map(
      (c) =>
        `<div class="c"><div class="n">${esc(c.displayName ?? c.username)}</div><div class="k">Username</div><div class="v">${esc(c.username)}</div><div class="k">Password</div><div class="v">${esc(c.password)}</div></div>`,
    )
    .join('')}</div><script>window.print()</script></body></html>`);
  w.document.close();
}

export function AdminUsersPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-users'], queryFn: () => api.get<User[]>('/api/admin/users') });
  const [edit, setEdit] = useState<Partial<User> & { password?: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [creds, setCreds] = useState<Cred[] | null>(null);
  const [filter, setFilter] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-users'] });

  const reset = async (u: User) => {
    if (!confirm(`Generate a new password for ${u.username}? They will be logged out.`)) return;
    const r = await api.post<Cred>(`/api/admin/users/${u.id}/reset-password`);
    setCreds([{ ...r, displayName: u.displayName }]);
  };
  const remove = async (u: User) => {
    if (!confirm(`Delete ${u.username} and all their submissions?`)) return;
    await api.del(`/api/admin/users/${u.id}`);
    toast.success('Deleted');
    refresh();
  };
  if (q.isLoading) return <Spinner />;
  const users = (q.data ?? []).filter((u) => !filter || `${u.username} ${u.displayName} ${u.organization} ${u.region}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="One account per team (or individual) — one computer each."
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload /> Import CSV
            </Button>
            <Button onClick={() => setEdit({ role: 'CONTESTANT' })}>
              <Plus /> New account
            </Button>
          </>
        }
      />
      <Input placeholder="Search…" className="mb-4 max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <ErrorBox error={q.error} />
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>Username</TH>
              <TH>Name</TH>
              <TH>Members</TH>
              <TH>Organization</TH>
              <TH>Region</TH>
              <TH>Role</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {users.map((u) => (
              <TR key={u.id}>
                <TD className="font-mono">{u.username}</TD>
                <TD>
                  <button className="text-primary hover:underline" onClick={() => setEdit(u)}>
                    {u.displayName}
                  </button>
                </TD>
                <TD className="text-xs text-muted-foreground">{u.members}</TD>
                <TD>{u.organization}</TD>
                <TD>{u.region}</TD>
                <TD>{u.role === 'ADMIN' ? <Badge>Admin</Badge> : <Badge variant="muted">Team</Badge>}</TD>
                <TD className="whitespace-nowrap text-right">
                  <Button variant="ghost" size="icon" title="Reset password" onClick={() => reset(u)}>
                    <KeyRound />
                  </Button>
                  <Button variant="ghost" size="icon" title="Delete" onClick={() => remove(u)}>
                    <Trash2 />
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      {edit && <UserDialog user={edit} onClose={() => setEdit(null)} onSaved={(c) => { refresh(); setEdit(null); if (c) setCreds([c]); }} />}
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onDone={(c) => { refresh(); setCreds(c); }} />
      <Dialog open={!!creds} onOpenChange={(v) => !v && setCreds(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Credentials</DialogTitle>
            <DialogDescription>Passwords are shown only now. Print them or save them somewhere safe.</DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overflow-auto rounded-md border">
            <Table>
              <TBody>
                {creds?.map((c) => (
                  <TR key={c.username}>
                    <TD>{c.displayName}</TD>
                    <TD className="font-mono">{c.username}</TD>
                    <TD className="font-mono">{c.password}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              const csv = 'username,password,displayName\n' + creds!.map((c) => `${c.username},${c.password},"${(c.displayName ?? '').replace(/"/g, '""')}"`).join('\n');
              const a = document.createElement('a');
              a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
              a.download = 'credentials.csv';
              a.click();
            }}>Download CSV</Button>
            <Button onClick={() => printCredentials(creds!)}>
              <Printer /> Print cards
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UserDialog({ user, onClose, onSaved }: { user: Partial<User>; onClose: () => void; onSaved: (c?: Cred) => void }) {
  const [u, setU] = useState({ password: '', ...user });
  const [error, setError] = useState<unknown>(null);
  const set = (k: string, v: string) => setU({ ...u, [k]: v });
  const save = async () => {
    try {
      const body = { username: u.username, displayName: u.displayName, members: u.members, organization: u.organization, region: u.region, role: u.role, ...(u.password ? { password: u.password } : {}) };
      if (user.id) {
        await api.patch(`/api/admin/users/${user.id}`, body);
        onSaved();
      } else {
        const r = await api.post<Cred>('/api/admin/users', body);
        onSaved({ ...r, displayName: u.displayName || u.username });
      }
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user.id ? 'Edit account' : 'New account'}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Username">
            <Input value={u.username ?? ''} onChange={(e) => set('username', e.target.value)} />
          </Field>
          <Field label="Password" hint={user.id ? 'Leave empty to keep' : 'Leave empty to generate'}>
            <Input value={u.password} onChange={(e) => set('password', e.target.value)} />
          </Field>
          <Field label="Team / display name" className="col-span-2">
            <Input value={u.displayName ?? ''} onChange={(e) => set('displayName', e.target.value)} />
          </Field>
          <Field label="Members" className="col-span-2" hint="Free text, e.g. names of the team members">
            <Input value={u.members ?? ''} onChange={(e) => set('members', e.target.value)} />
          </Field>
          <Field label="Organization / school">
            <Input value={u.organization ?? ''} onChange={(e) => set('organization', e.target.value)} />
          </Field>
          <Field label="Region">
            <Input value={u.region ?? ''} onChange={(e) => set('region', e.target.value)} />
          </Field>
          <Field label="Role">
            <NativeSelect value={u.role} onChange={(e) => set('role', e.target.value)}>
              <option value="CONTESTANT">Contestant / team</option>
              <option value="ADMIN">Administrator</option>
            </NativeSelect>
          </Field>
        </div>
        <ErrorBox error={error} />
        <DialogFooter>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: (c: Cred[]) => void }) {
  const [csv, setCsv] = useState('');
  const [contestId, setContestId] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const contests = useQuery({ queryKey: ['admin-contests'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/admin/contests'), enabled: open });
  const run = async () => {
    try {
      const r = await api.post<{ created: Cred[]; errors: string[] }>('/api/admin/users/import', { csv, contestId: contestId || undefined });
      setErrors(r.errors);
      toast.success(`Created ${r.created.length} account(s)`);
      if (r.created.length) onDone(r.created);
      if (!r.errors.length) onOpenChange(false);
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import accounts from CSV</DialogTitle>
          <DialogDescription>
            Columns: <code className="font-mono">username,password,displayName,members,organization,region</code>. Header row optional; empty passwords are generated.
          </DialogDescription>
        </DialogHeader>
        <input
          type="file"
          accept=".csv,text/csv"
          className="text-sm"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setCsv(await f.text());
          }}
        />
        <Textarea className="h-48 font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'username,password,displayName,members,organization,region\nteam01,,Los Algoritmos,"Ana; Luis",Colegio X,Norte'} />
        <Field label="Also register them in contest (optional)">
          <NativeSelect value={contestId} onChange={(e) => setContestId(e.target.value)}>
            <option value="">— none —</option>
            {contests.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {errors.length > 0 && <ErrorBox error={errors.join('\n')} />}
        <ErrorBox error={error} />
        <DialogFooter>
          <Button onClick={run} disabled={!csv.trim()}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
