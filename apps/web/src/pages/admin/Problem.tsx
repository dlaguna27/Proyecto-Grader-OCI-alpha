import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { precisionStep } from '@noi/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ErrorBox, PageHeader, Spinner } from '@/components/common';
import { cn, fmtTime, score } from '@/lib/utils';
import { InlineMarkdown, Markdown } from '../Problem';
import type { ProblemType } from '@/lib/types';

interface AdminProblem {
  id: string;
  contestId: string;
  code: string;
  title: string;
  type: ProblemType;
  ordinal: number;
  timeLimitMs: number;
  memoryLimitMb: number;
  scorePrecision: number;
  checkerKind: 'TOKENS' | 'FLOAT' | 'CUSTOM';
  checkerEpsilon: number | null;
  checkerSha: string | null;
  interactorSha: string | null;
  statementSha: string | null;
  statementType: string | null;
  statementMd: string;
  attachmentSha: string | null;
  activeTestSetId: string | null;
  contest: { id: string; name: string; scoringMode: 'IOI' | 'ICPC' };
  testSets: { id: string; createdAt: string; note: string; _count: { tests: number; judgements: number } }[];
  activeTestSet: {
    id: string;
    createdAt: string;
    note: string;
    tests: { id: string; name: string; isSample: boolean; inputSize: number; hasAnswer: boolean }[];
    subtasks: { id: string; ordinal: number; name: string; scoring: 'MIN' | 'SUM'; pointsCenti: number; points: string; tests: string[] }[];
  } | null;
}

export function AdminProblemPage() {
  const { pid } = useParams();
  const q = useQuery({ queryKey: ['admin-problem', pid], queryFn: () => api.get<AdminProblem>(`/api/admin/problems/${pid}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const p = q.data;
  const ioi = p.contest.scoringMode === 'IOI';
  const warnings: string[] = [];
  if (!p.activeTestSet) warnings.push('No tests uploaded yet.');
  if (p.type === 'INTERACTIVE' && !p.interactorSha) warnings.push('Interactive problem needs an interactor.');
  if (p.checkerKind === 'CUSTOM' && !p.checkerSha) warnings.push('Custom checker selected but not uploaded.');
  return (
    <div>
      <PageHeader
        title={
          <span>
            <span className="font-mono text-muted-foreground">{p.code}</span> {p.title}
          </span>
        }
        subtitle={
          <Link className="hover:underline" to={`/admin/contests/${p.contestId}`}>
            ← {p.contest.name}
          </Link>
        }
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to={`/c/${p.contestId}/p/${p.id}`}>Preview as contestant</Link>
          </Button>
        }
      />
      {warnings.length > 0 && <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">{warnings.join(' ')}</div>}
      <Tabs defaultValue="tests">
        <TabsList>
          <TabsTrigger value="tests">Tests{ioi ? ' & subtasks' : ''}</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="statement">Statement</TabsTrigger>
          <TabsTrigger value="files">{p.type === 'INTERACTIVE' ? 'Interactor' : 'Checker'} & files</TabsTrigger>
        </TabsList>
        <TabsContent value="tests" className="space-y-6">
          <TestsCard p={p} />
          {ioi && p.activeTestSet && <SubtasksEditor p={p} />}
          {!ioi && p.activeTestSet && (
            <Card>
              <CardContent className="pt-5 text-sm text-muted-foreground">
                ICPC mode: a submission is Accepted only if it passes every test. Judging stops at the first failed test.
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="settings">
          <SettingsCard p={p} />
        </TabsContent>
        <TabsContent value="statement">
          <StatementCard p={p} />
        </TabsContent>
        <TabsContent value="files">
          <FilesCard p={p} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function useRefresh(pid: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['admin-problem', pid] });
    qc.invalidateQueries({ queryKey: ['admin-contest'] });
  };
}

async function upload(url: string, file: File) {
  const fd = new FormData();
  fd.set('file', file, file.name);
  return api.post<Record<string, unknown>>(url, fd);
}

function TestsCard({ p }: { p: AdminProblem }) {
  const refresh = useRefresh(p.id);
  const ref = useRef<HTMLInputElement>(null);
  const [rejudge, setRejudge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tests: number; samples: number; warnings: string[]; rejudged: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const go = async () => {
    const f = ref.current?.files?.[0];
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const r = (await upload(`/api/admin/problems/${p.id}/tests${rejudge ? '?rejudge=1' : ''}`, f)) as unknown as typeof result;
      setResult(r);
      toast.success(`Uploaded ${r!.tests} tests`);
      refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };
  const activate = async (tsid: string) => {
    await api.post(`/api/admin/problems/${p.id}/test-sets/${tsid}/activate`);
    toast.success('Test set activated. Rejudge to apply it to existing submissions.');
    refresh();
  };
  const ts = p.activeTestSet;
  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload tests (.zip)</CardTitle>
          <CardDescription>
            Pairs <code className="font-mono">NAME.in</code> with <code className="font-mono">NAME.out</code> / <code className="font-mono">.ans</code>. Folders are allowed. Names containing
            “sample” or “example” become public examples.{p.type === 'INTERACTIVE' && ' For interactive problems, answer files are optional (passed to the interactor).'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input ref={ref} type="file" accept=".zip" className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5" />
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={rejudge} onCheckedChange={setRejudge} /> Rejudge existing submissions
          </label>
          <Button onClick={go} disabled={busy} className="w-full">
            <Upload /> {busy ? 'Uploading…' : 'Upload'}
          </Button>
          <ErrorBox error={error} />
          {result && (
            <div className="rounded-md bg-muted p-3 text-sm">
              {result.tests} tests ({result.samples} samples){result.rejudged ? `, ${result.rejudged} rejudges queued` : ''}.
              {result.warnings.map((w) => (
                <div key={w} className="text-amber-700 dark:text-amber-400">
                  {w}
                </div>
              ))}
            </div>
          )}
          {p.testSets.length > 1 && (
            <div className="pt-2">
              <div className="mb-1 text-sm font-medium">Test set history</div>
              {p.testSets.map((t) => (
                <div key={t.id} className="flex items-center justify-between border-t py-1.5 text-xs">
                  <span>
                    {fmtTime(t.createdAt)} · {t._count.tests} tests · {t.note}
                  </span>
                  {t.id === p.activeTestSetId ? (
                    <Badge variant="success">active</Badge>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => activate(t.id)}>
                      Activate
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active tests {ts && <span className="font-normal text-muted-foreground">({ts.tests.length})</span>}</CardTitle>
        </CardHeader>
        {ts ? (
          <div className="max-h-[420px] overflow-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH className="text-right">Input size</TH>
                  <TH>Files</TH>
                </TR>
              </THead>
              <TBody>
                {ts.tests.map((t) => (
                  <TR key={t.id}>
                    <TD className="font-mono text-xs">
                      {t.name} {t.isSample && <Badge variant="info" className="ml-1">sample</Badge>}
                    </TD>
                    <TD className="text-right text-xs text-muted-foreground">{t.inputSize < 1024 ? `${t.inputSize} B` : `${(t.inputSize / 1024).toFixed(1)} KB`}</TD>
                    <TD className="space-x-2 text-xs">
                      <a className="text-primary hover:underline" href={`/api/admin/tests/${t.id}/in`}>
                        in
                      </a>
                      {t.hasAnswer && (
                        <a className="text-primary hover:underline" href={`/api/admin/tests/${t.id}/out`}>
                          answer
                        </a>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ) : (
          <CardContent className="text-sm text-muted-foreground">Upload a zip to create the first test set.</CardContent>
        )}
      </Card>
    </div>
  );
}

interface DraftSubtask {
  key: number;
  name: string;
  points: string;
  scoring: 'MIN' | 'SUM';
  tests: Set<string>;
}

function SubtasksEditor({ p }: { p: AdminProblem }) {
  const refresh = useRefresh(p.id);
  const ts = p.activeTestSet!;
  const mk = () =>
    ts.subtasks.map((s, i) => ({ key: i, name: s.name, points: s.points, scoring: s.scoring, tests: new Set(s.tests) }) as DraftSubtask);
  const [subs, setSubs] = useState<DraftSubtask[]>(mk);
  const [pattern, setPattern] = useState<Record<number, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setSubs(mk());
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ts.id, JSON.stringify(ts.subtasks)]);
  const update = (i: number, patch: Partial<DraftSubtask>) => {
    setSubs(subs.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    setDirty(true);
  };
  const toggle = (i: number, name: string) => {
    const t = new Set(subs[i].tests);
    if (t.has(name)) t.delete(name);
    else t.add(name);
    update(i, { tests: t });
  };
  const applyPattern = (i: number) => {
    const raw = pattern[i]?.trim();
    if (!raw) return;
    let re: RegExp;
    try {
      re = new RegExp(raw.includes('*') ? '^' + raw.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$' : raw);
    } catch {
      toast.error('Invalid pattern');
      return;
    }
    const t = new Set(subs[i].tests);
    for (const x of ts.tests) if (re.test(x.name)) t.add(x.name);
    update(i, { tests: t });
  };
  const move = (i: number, d: number) => {
    const n = [...subs];
    const [x] = n.splice(i, 1);
    n.splice(i + d, 0, x);
    setSubs(n);
    setDirty(true);
  };
  const step = precisionStep(p.scorePrecision) / 100;
  const total = subs.reduce((a, s) => a + (Number(s.points) || 0), 0);
  const save = async () => {
    setError(null);
    try {
      const r = await api.put<{ rescored: number }>(`/api/admin/problems/${p.id}/subtasks`, {
        subtasks: subs.map((s) => ({ name: s.name, points: s.points, scoring: s.scoring, tests: ts.tests.filter((t) => s.tests.has(t.name)).map((t) => t.name) })),
      });
      toast.success(`Subtasks saved; ${r.rescored} submission(s) rescored`);
      setDirty(false);
      refresh();
    } catch (e) {
      setError(e);
    }
  };
  const unassigned = ts.tests.filter((t) => !t.isSample && !subs.some((s) => s.tests.has(t.name)));
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">Subtasks</CardTitle>
          <CardDescription>
            Points use {p.scorePrecision === 0 ? 'whole numbers' : `up to ${p.scorePrecision} decimal place${p.scorePrecision > 1 ? 's' : ''} (step ${step})`} — change in Settings.
            “All tests” (MIN) gives points only if every test passes; “Per test” (SUM) splits the points across tests. Saving rescores existing submissions without rejudging.
          </CardDescription>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Total</div>
          <div className="font-mono text-xl font-semibold">{total.toFixed(p.scorePrecision)}</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {subs.map((s, i) => (
          <div key={s.key} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-8 pb-2 text-center font-semibold">{i + 1}</div>
              <Field label="Description (Markdown, LaTeX with $…$)" className="min-w-[160px] flex-1">
                <Input value={s.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="e.g. $N \le 1000$" />
              </Field>
              <Field label="Points" className="w-28">
                <Input value={s.points} inputMode="decimal" onChange={(e) => update(i, { points: e.target.value })} />
              </Field>
              <Field label="Scoring" className="w-40">
                <NativeSelect value={s.scoring} onChange={(e) => update(i, { scoring: e.target.value as 'MIN' | 'SUM' })}>
                  <option value="MIN">All tests (MIN)</option>
                  <option value="SUM">Per test (SUM)</option>
                </NativeSelect>
              </Field>
              <Field label="Add by pattern" className="w-44">
                <Input placeholder="e.g. 2-* or ^big" value={pattern[i] ?? ''} onChange={(e) => setPattern({ ...pattern, [i]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && applyPattern(i)} />
              </Field>
              <Button variant="outline" size="sm" className="mb-0.5" onClick={() => applyPattern(i)}>
                Add
              </Button>
              <Button variant="ghost" size="sm" className="mb-0.5" onClick={() => update(i, { tests: new Set() })}>
                Clear
              </Button>
              <div className="mb-0.5 ml-auto flex">
                <Button variant="ghost" size="icon" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp />
                </Button>
                <Button variant="ghost" size="icon" disabled={i === subs.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => { setSubs(subs.filter((_, j) => j !== i)); setDirty(true); }}>
                  <Trash2 />
                </Button>
              </div>
            </div>
            {s.name.includes('$') && (
              <div className="mt-2 pl-10 text-sm text-muted-foreground">
                Preview: <InlineMarkdown>{s.name}</InlineMarkdown>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-1">
              {ts.tests.map((t) => (
                <button
                  key={t.id}
                  onClick={() => toggle(i, t.name)}
                  className={cn(
                    'rounded border px-2 py-0.5 font-mono text-xs transition-colors',
                    s.tests.has(t.name) ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{s.tests.size} test(s)</div>
          </div>
        ))}
        {unassigned.length > 0 && <div className="text-sm text-amber-700 dark:text-amber-400">Not in any subtask: {unassigned.map((t) => t.name).join(', ')}</div>}
        <ErrorBox error={error} />
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => { setSubs([...subs, { key: Date.now(), name: '', points: '0', scoring: 'MIN', tests: new Set() }]); setDirty(true); }}>
            <Plus /> Add subtask
          </Button>
          <Button onClick={save} disabled={!dirty}>
            Save subtasks
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsCard({ p }: { p: AdminProblem }) {
  const refresh = useRefresh(p.id);
  const nav = useNavigate();
  const [f, setF] = useState(p);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => setF(p), [p]);
  const set = <K extends keyof AdminProblem>(k: K, v: AdminProblem[K]) => setF({ ...f, [k]: v });
  const save = async () => {
    setError(null);
    try {
      await api.patch(`/api/admin/problems/${p.id}`, {
        code: f.code,
        title: f.title,
        ordinal: f.ordinal,
        timeLimitMs: f.timeLimitMs,
        memoryLimitMb: f.memoryLimitMb,
        scorePrecision: f.scorePrecision,
        checkerKind: f.checkerKind,
        checkerEpsilon: f.checkerKind === 'FLOAT' ? f.checkerEpsilon ?? 1e-6 : f.checkerEpsilon,
      });
      toast.success('Saved');
      refresh();
    } catch (e) {
      setError(e);
    }
  };
  const remove = async () => {
    if (!confirm(`Delete problem ${p.code} and all its submissions?`)) return;
    await api.del(`/api/admin/problems/${p.id}`);
    nav(`/admin/contests/${p.contestId}`);
  };
  return (
    <Card>
      <CardContent className="grid gap-4 pt-5 md:grid-cols-3">
        <Field label="Code">
          <Input value={f.code} onChange={(e) => set('code', e.target.value)} />
        </Field>
        <Field label="Title" className="md:col-span-2">
          <Input value={f.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Type" hint="Fixed after creation">
          <Input value={{ BATCH: 'Batch', OUTPUT_ONLY: 'Output-only', INTERACTIVE: 'Interactive' }[p.type]} disabled />
        </Field>
        {p.type !== 'OUTPUT_ONLY' && (
          <>
            <Field label="Time limit (ms)" hint="CPU time per test; wall limit is about 3× plus 1 s">
              <Input type="number" min={100} step={100} value={f.timeLimitMs} onChange={(e) => set('timeLimitMs', Number(e.target.value))} />
            </Field>
            <Field label="Memory limit (MB)">
              <Input type="number" min={16} value={f.memoryLimitMb} onChange={(e) => set('memoryLimitMb', Number(e.target.value))} />
            </Field>
          </>
        )}
        <Field label="Score decimals" hint="0 = whole points. 1 or 2 allow decimal subtask points and partial scores (e.g. 12.5).">
          <NativeSelect value={f.scorePrecision} onChange={(e) => set('scorePrecision', Number(e.target.value))}>
            <option value={0}>0 — integer scores</option>
            <option value={1}>1 decimal (12.5)</option>
            <option value={2}>2 decimals (12.25)</option>
          </NativeSelect>
        </Field>
        <Field label="Display order">
          <Input type="number" value={f.ordinal} onChange={(e) => set('ordinal', Number(e.target.value))} />
        </Field>
        {p.type !== 'INTERACTIVE' && (
          <>
            <Field label="Output checking">
              <NativeSelect value={f.checkerKind} onChange={(e) => set('checkerKind', e.target.value as AdminProblem['checkerKind'])}>
                <option value="TOKENS">Exact tokens (ignores whitespace)</option>
                <option value="FLOAT">Tokens with float tolerance</option>
                <option value="CUSTOM" disabled={!p.checkerSha}>
                  Custom checker (testlib){!p.checkerSha ? ' — upload first' : ''}
                </option>
              </NativeSelect>
            </Field>
            {f.checkerKind === 'FLOAT' && (
              <Field label="Tolerance (absolute or relative)">
                <Input type="number" step="any" value={f.checkerEpsilon ?? 1e-6} onChange={(e) => set('checkerEpsilon', Number(e.target.value))} />
              </Field>
            )}
          </>
        )}
        <div className="md:col-span-3">
          <ErrorBox error={error} />
        </div>
        <div className="flex justify-between md:col-span-3">
          <Button variant="destructive" onClick={remove}>
            <Trash2 /> Delete problem
          </Button>
          <Button onClick={save}>Save settings</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatementCard({ p }: { p: AdminProblem }) {
  const refresh = useRefresh(p.id);
  const [md, setMd] = useState(p.statementMd);
  const save = async () => {
    await api.patch(`/api/admin/problems/${p.id}`, { statementMd: md });
    toast.success('Statement saved');
    refresh();
  };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Markdown statement</CardTitle>
          <CardDescription>Supports GitHub Markdown and LaTeX math ($x^2$, $$\sum$$). Leave empty to show the uploaded PDF instead.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea className="h-[520px] font-mono text-xs" value={md} onChange={(e) => setMd(e.target.value)} />
          <Button onClick={save}>Save statement</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview</CardTitle>
        </CardHeader>
        <CardContent>{md ? <Markdown>{md}</Markdown> : <p className="text-sm text-muted-foreground">Empty</p>}</CardContent>
      </Card>
    </div>
  );
}

function FileSlot({ p, kind, title, description, accept, present }: { p: AdminProblem; kind: string; title: string; description: string; accept: string; present: boolean }) {
  const refresh = useRefresh(p.id);
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const f = ref.current?.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      await upload(`/api/admin/problems/${p.id}/${kind}`, f);
      toast.success(`${title} uploaded`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };
  const remove = async () => {
    await api.del(`/api/admin/problems/${p.id}/files/${kind}`);
    refresh();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          {title} {present ? <Badge variant="success">uploaded</Badge> : <Badge variant="muted">none</Badge>}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input ref={ref} type="file" accept={accept} className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5" />
        <div className="flex gap-2">
          <Button size="sm" onClick={go} disabled={busy}>
            <Upload /> Upload
          </Button>
          {present && (
            <>
              <Button size="sm" variant="outline" asChild>
                <a href={`/api/admin/problems/${p.id}/files/${kind}`} target="_blank" rel="noreferrer">
                  <Download /> View
                </a>
              </Button>
              <Button size="sm" variant="ghost" onClick={remove}>
                <Trash2 /> Remove
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FilesCard({ p }: { p: AdminProblem }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {p.type === 'INTERACTIVE' ? (
        <FileSlot
          p={p}
          kind="interactor"
          title="Interactor"
          accept=".cpp,.cc"
          present={!!p.interactorSha}
          description="testlib C++ interactor: registerInteraction(argc, argv); read the test with inf, talk to the solution with ouf/cout, finish with quitf(_ok|_wa, …) or quitp(fraction, …) for partial points."
        />
      ) : (
        <FileSlot
          p={p}
          kind="checker"
          title="Custom checker"
          accept=".cpp,.cc"
          present={!!p.checkerSha}
          description="testlib C++ checker: registerTestlibCmd(argc, argv); inf = input, ouf = contestant output, ans = answer. Use quitf(_ok|_wa, …) or quitp(fraction, …). Uploading switches the problem to the custom checker."
        />
      )}
      <FileSlot p={p} kind="statement" title="Statement PDF" accept=".pdf" present={!!p.statementSha} description="Shown to contestants as a download and inline if there is no Markdown statement." />
      <FileSlot p={p} kind="attachments" title="Attachments (.zip)" accept=".zip" present={!!p.attachmentSha} description="Extra files for contestants: graders, headers, sample files." />
    </div>
  );
}
