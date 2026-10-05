import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChartLine, Download, ExternalLink, Plus, Sparkles, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ErrorBox, PageHeader, Spinner } from '@/components/common';
import { fmtTime, fromLocalInput, score, toLocalInput } from '@/lib/utils';
import type { Announcement, ProblemType } from '@/lib/types';
import { ICPC_BALLOON_COLORS } from '@noi/shared';
import { Balloon } from '@/components/Balloon';

interface AdminContest {
  id: string;
  name: string;
  description: string;
  scoringMode: 'IOI' | 'ICPC';
  startsAt: string;
  endsAt: string;
  freezeAt: string | null;
  penaltyMinutes: number;
  countCompileErrors: boolean;
  ioiTaskScoreRule: 'MAX_SUBTASK' | 'BEST_SUBMISSION';
  maxSubmissionsPerTask: number | null;
  languages: string[];
  visible: boolean;
  publicScoreboard: boolean;
  balloonPalette: 'ICPC' | 'CUSTOM';
  _count: { participants: number; submissions: number };
  announcements: Announcement[];
  problems: { id: string; code: string; title: string; type: ProblemType; ordinal: number; timeLimitMs: number; memoryLimitMb: number; scorePrecision: number; balloonColor: string | null; color: string; testCount: number; maxScoreCenti: number | null }[];
}

const TYPE_LABEL = { BATCH: 'Batch', OUTPUT_ONLY: 'Output-only', INTERACTIVE: 'Interactive' } as const;

export function AdminContestPage() {
  const { cid } = useParams();
  const q = useQuery({ queryKey: ['admin-contest', cid], queryFn: () => api.get<AdminContest>(`/api/admin/contests/${cid}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const c = q.data;
  return (
    <div>
      <PageHeader
        title={c.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={c.scoringMode === 'IOI' ? 'info' : 'warning'}>{c.scoringMode}</Badge>
            {fmtTime(c.startsAt)} – {fmtTime(c.endsAt)} · {c._count.participants} teams · {c._count.submissions} submissions
          </span>
        }
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/board/${c.id}`} target="_blank">
                <ExternalLink /> Scoreboard
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/board/${c.id}/history`} target="_blank">
                <ChartLine /> Ranking history
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/contests/${c.id}/reveal`} target="_blank">
                <Sparkles /> Score revealer
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/submissions?contestId=${c.id}`}>Submissions</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/admin/contests/${c.id}/results.csv`}>
                <Download /> Results CSV
              </a>
            </Button>
          </>
        }
      />
      <Tabs defaultValue="problems">
        <TabsList>
          <TabsTrigger value="problems">Problems</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="participants">Participants</TabsTrigger>
          <TabsTrigger value="announcements">Announcements</TabsTrigger>
        </TabsList>
        <TabsContent value="problems">
          <ProblemsTab c={c} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab c={c} />
        </TabsContent>
        <TabsContent value="participants">
          <ParticipantsTab cid={c.id} />
        </TabsContent>
        <TabsContent value="announcements">
          <AnnouncementsTab c={c} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProblemsTab({ c }: { c: AdminContest }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ProblemType>('BATCH');
  const [error, setError] = useState<unknown>(null);
  const create = async () => {
    try {
      const p = await api.post<{ id: string }>(`/api/admin/contests/${c.id}/problems`, { code, title, type });
      nav(`/admin/problems/${p.id}`);
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Problems</CardTitle>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus /> Add problem
        </Button>
      </CardHeader>
      <Table>
        <THead>
          <TR>
            <TH>Code</TH>
            <TH>Title</TH>
            <TH>Type</TH>
            <TH>Limits</TH>
            <TH className="text-right">Tests</TH>
            {c.scoringMode === 'IOI' && <TH className="text-right">Points</TH>}
          </TR>
        </THead>
        <TBody>
          {c.problems.map((p) => (
            <TR key={p.id}>
              <TD className="font-mono font-semibold">
                <span className="flex items-center gap-2">
                  <Balloon color={p.color} />
                  {p.code}
                </span>
              </TD>
              <TD>
                <Link className="text-primary hover:underline" to={`/admin/problems/${p.id}`}>
                  {p.title}
                </Link>
              </TD>
              <TD>{TYPE_LABEL[p.type]}</TD>
              <TD className="text-xs text-muted-foreground">{p.type === 'OUTPUT_ONLY' ? '—' : `${p.timeLimitMs} ms · ${p.memoryLimitMb} MB`}</TD>
              <TD className="text-right">{p.testCount || <Badge variant="danger">none</Badge>}</TD>
              {c.scoringMode === 'IOI' && <TD className="text-right font-mono">{score(p.maxScoreCenti, p.scorePrecision)}</TD>}
            </TR>
          ))}
        </TBody>
      </Table>
      {c.problems.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No problems yet.</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add problem</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Code">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="A" />
            </Field>
            <Field label="Title" className="col-span-2">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Type" className="col-span-3">
              <NativeSelect value={type} onChange={(e) => setType(e.target.value as ProblemType)}>
                <option value="BATCH">Batch (stdin → stdout)</option>
                <option value="OUTPUT_ONLY">Output-only (contestants upload answers)</option>
                <option value="INTERACTIVE">Interactive (talks to an interactor)</option>
              </NativeSelect>
            </Field>
          </div>
          <ErrorBox error={error} />
          <DialogFooter>
            <Button onClick={create} disabled={!code || !title}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function SettingsTab({ c }: { c: AdminContest }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [f, setF] = useState(c);
  const [limitOn, setLimitOn] = useState(c.maxSubmissionsPerTask !== null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => setF(c), [c]);
  const set = <K extends keyof AdminContest>(k: K, v: AdminContest[K]) => setF({ ...f, [k]: v });
  const save = async () => {
    setError(null);
    try {
      await api.patch(`/api/admin/contests/${c.id}`, {
        name: f.name,
        description: f.description,
        scoringMode: f.scoringMode,
        startsAt: f.startsAt,
        endsAt: f.endsAt,
        freezeAt: f.freezeAt,
        penaltyMinutes: f.penaltyMinutes,
        countCompileErrors: f.countCompileErrors,
        ioiTaskScoreRule: f.ioiTaskScoreRule,
        maxSubmissionsPerTask: limitOn ? f.maxSubmissionsPerTask ?? 50 : null,
        languages: f.languages,
        visible: f.visible,
        publicScoreboard: f.publicScoreboard,
        balloonPalette: f.balloonPalette,
      });
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['admin-contest', c.id] });
    } catch (e) {
      setError(e);
    }
  };
  const remove = async () => {
    if (prompt(`Type the contest name to delete it with ALL problems and submissions:\n${c.name}`) !== c.name) return;
    await api.del(`/api/admin/contests/${c.id}`);
    nav('/admin');
  };
  const toggleLang = (l: string) => set('languages', f.languages.includes(l) ? f.languages.filter((x) => x !== l) : [...f.languages, l]);
  return (
    <Card>
      <CardContent className="grid gap-4 pt-5 md:grid-cols-2">
        <Field label="Name">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Scoring mode" hint={c._count.submissions > 0 ? 'Locked: submissions exist' : undefined}>
          <NativeSelect value={f.scoringMode} disabled={c._count.submissions > 0} onChange={(e) => set('scoringMode', e.target.value as 'IOI' | 'ICPC')}>
            <option value="IOI">IOI — subtasks and partial scoring</option>
            <option value="ICPC">ICPC — binary scoring with penalty</option>
          </NativeSelect>
        </Field>
        <Field label="Description" className="md:col-span-2">
          <Textarea value={f.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="Starts">
          <Input type="datetime-local" value={toLocalInput(f.startsAt)} onChange={(e) => set('startsAt', fromLocalInput(e.target.value) ?? f.startsAt)} />
        </Field>
        <Field label="Ends">
          <Input type="datetime-local" value={toLocalInput(f.endsAt)} onChange={(e) => set('endsAt', fromLocalInput(e.target.value) ?? f.endsAt)} />
        </Field>
        <Field label="Scoreboard freeze (optional)" hint="After this time the public scoreboard stops updating; teams still see their own results.">
          <Input type="datetime-local" value={toLocalInput(f.freezeAt)} onChange={(e) => set('freezeAt', fromLocalInput(e.target.value))} />
        </Field>
        {f.scoringMode === 'IOI' ? (
          <Field label="Task score" hint="Max per subtask: best result of each subtask across all submissions (IOI 2017+).">
            <NativeSelect value={f.ioiTaskScoreRule} onChange={(e) => set('ioiTaskScoreRule', e.target.value as AdminContest['ioiTaskScoreRule'])}>
              <option value="MAX_SUBTASK">Max per subtask across submissions</option>
              <option value="BEST_SUBMISSION">Best single submission</option>
            </NativeSelect>
          </Field>
        ) : (
          <Field label="Penalty per rejected attempt (minutes)">
            <Input type="number" min={0} value={f.penaltyMinutes} onChange={(e) => set('penaltyMinutes', Number(e.target.value))} />
          </Field>
        )}
        <Field
          label="Balloon colors"
          hint={
            f.balloonPalette === 'ICPC'
              ? `Assigned by problem order: ${ICPC_BALLOON_COLORS.slice(0, 6).map((x) => x.name).join(', ')}, …`
              : "Pick each problem's color in its Settings; problems without one use the preset color."
          }
        >
          <NativeSelect value={f.balloonPalette} onChange={(e) => set('balloonPalette', e.target.value as AdminContest['balloonPalette'])}>
            <option value="ICPC">ICPC preset (white, black, red, dark red, …)</option>
            <option value="CUSTOM">Custom color per problem</option>
          </NativeSelect>
        </Field>
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={limitOn} onCheckedChange={setLimitOn} /> Limit submissions per task
          </label>
          {limitOn && <Input type="number" min={1} className="w-32" value={f.maxSubmissionsPerTask ?? 50} onChange={(e) => set('maxSubmissionsPerTask', Number(e.target.value))} />}
        </div>
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={f.countCompileErrors} onCheckedChange={(v) => set('countCompileErrors', v)} />
            {f.scoringMode === 'ICPC' ? 'Compilation errors count as rejected attempts' : 'Compilation errors count toward the submission limit'}
          </label>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={f.visible} onCheckedChange={(v) => set('visible', v)} /> Visible to participants
          </label>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={f.publicScoreboard} onCheckedChange={(v) => set('publicScoreboard', v)} /> Scoreboard visible to teams and without login
          </label>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">Languages</div>
          {['cpp', 'python'].map((l) => (
            <label key={l} className="flex items-center gap-3 text-sm">
              <Switch checked={f.languages.includes(l)} onCheckedChange={() => toggleLang(l)} /> {l === 'cpp' ? 'C++20 (g++ -O3 -std=gnu++20)' : 'Python 3'}
            </label>
          ))}
        </div>
        <div className="md:col-span-2">
          <ErrorBox error={error} />
        </div>
        <div className="flex justify-between md:col-span-2">
          <Button variant="destructive" onClick={remove}>
            <Trash2 /> Delete contest
          </Button>
          <Button onClick={save}>Save settings</Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface Participant {
  userId: string;
  startDelay: number;
  extraTime: number;
  hidden: boolean;
  user: { id: string; username: string; displayName: string; organization: string; region: string; role: string };
}

function ParticipantsTab({ cid }: { cid: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-participants', cid], queryFn: () => api.get<Participant[]>(`/api/admin/contests/${cid}/participants`) });
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => api.get<{ id: string; username: string; displayName: string; role: string }[]>('/api/admin/users') });
  const [pick, setPick] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-participants', cid] });
  const add = async (body: object) => {
    const r = await api.post<{ added: number }>(`/api/admin/contests/${cid}/participants`, body);
    toast.success(`Added ${r.added}`);
    refresh();
  };
  const patch = async (uid: string, body: object) => {
    await api.patch(`/api/admin/contests/${cid}/participants/${uid}`, body);
    refresh();
  };
  const remove = async (p: Participant) => {
    if (!confirm(`Remove ${p.user.username} from this contest?`)) return;
    await api.del(`/api/admin/contests/${cid}/participants/${p.userId}`);
    refresh();
  };
  if (q.isLoading) return <Spinner />;
  const inContest = new Set(q.data?.map((p) => p.userId));
  const candidates = (users.data ?? []).filter((u) => u.role === 'CONTESTANT' && !inContest.has(u.id));
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Participants ({q.data?.length})</CardTitle>
        <div className="flex gap-2">
          <NativeSelect className="w-56" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose a team…</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username} — {u.displayName}
              </option>
            ))}
          </NativeSelect>
          <Button size="sm" variant="outline" disabled={!pick} onClick={() => add({ userIds: [pick] }).then(() => setPick(''))}>
            <UserPlus /> Add
          </Button>
          <Button size="sm" onClick={() => add({ allContestants: true })}>
            Add all teams
          </Button>
        </div>
      </CardHeader>
      <Table>
        <THead>
          <TR>
            <TH>Username</TH>
            <TH>Team</TH>
            <TH>Organization</TH>
            <TH title="Personal start delay, for late arrivals">Start delay (min)</TH>
            <TH title="Extra minutes at the end">Extra time (min)</TH>
            <TH>Hidden</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {q.data?.map((p) => (
            <TR key={p.userId}>
              <TD className="font-mono">{p.user.username}</TD>
              <TD>{p.user.displayName}</TD>
              <TD className="text-muted-foreground">{p.user.organization}</TD>
              <TD>
                <Input type="number" min={0} className="h-8 w-20" defaultValue={p.startDelay / 60} onBlur={(e) => Number(e.target.value) * 60 !== p.startDelay && patch(p.userId, { startDelay: Math.round(Number(e.target.value) * 60) })} />
              </TD>
              <TD>
                <Input type="number" min={0} className="h-8 w-20" defaultValue={p.extraTime / 60} onBlur={(e) => Number(e.target.value) * 60 !== p.extraTime && patch(p.userId, { extraTime: Math.round(Number(e.target.value) * 60) })} />
              </TD>
              <TD>
                <Switch checked={p.hidden} onCheckedChange={(v) => patch(p.userId, { hidden: v })} />
              </TD>
              <TD className="text-right">
                <Button variant="ghost" size="icon" onClick={() => remove(p)}>
                  <Trash2 />
                </Button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

function AnnouncementsTab({ c }: { c: AdminContest }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const post = async () => {
    await api.post(`/api/admin/contests/${c.id}/announcements`, { title, body });
    setTitle('');
    setBody('');
    toast.success('Announcement sent to all teams');
    qc.invalidateQueries({ queryKey: ['admin-contest', c.id] });
  };
  const remove = async (id: string) => {
    await api.del(`/api/admin/contests/${c.id}/announcements/${id}`);
    qc.invalidateQueries({ queryKey: ['admin-contest', c.id] });
  };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New announcement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Message">
            <Textarea className="h-32" value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <Button onClick={post} disabled={!title}>
            Publish
          </Button>
        </CardContent>
      </Card>
      <div className="space-y-3">
        {c.announcements.map((a) => (
          <Card key={a.id}>
            <CardContent className="flex items-start justify-between gap-3 pt-5">
              <div>
                <div className="font-semibold">{a.title}</div>
                <div className="text-xs text-muted-foreground">{fmtTime(a.createdAt)}</div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{a.body}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => remove(a.id)}>
                <Trash2 />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
