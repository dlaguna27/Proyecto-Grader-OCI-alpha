import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Cpu } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ErrorBox, PageHeader, Spinner } from '@/components/common';
import { fmtTime } from '@/lib/utils';

interface Q {
  counts: Record<string, number>;
  workers: { name: string; addr: string; age: number; idle: number }[];
  active: { judgementId: string; submissionId?: string; username?: string; problem?: string; status?: string; progressDone?: number; progressTotal?: number; worker: string | null; startedAt: number | null }[];
  waiting: { judgementId: string; submissionId?: string; username?: string; problem?: string; createdAt?: string }[];
  failedJobs: { id: string; reason: string; at: number }[];
  recentErrors: { judgementId: string; submissionId: string; username: string; problem: string; error: string | null; at: string }[];
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`text-3xl font-semibold ${tone ?? ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

export function AdminQueuePage() {
  const q = useQuery({ queryKey: ['admin-queue'], queryFn: () => api.get<Q>('/api/admin/queue'), refetchInterval: 2000 });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const d = q.data;
  const workerNames = [...new Set(d.workers.map((w) => w.name))];
  return (
    <div className="space-y-6">
      <PageHeader title="Grading queue" subtitle="Refreshes every 2 seconds" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Waiting" value={d.counts.waiting ?? 0} tone={(d.counts.waiting ?? 0) > 20 ? 'text-amber-600' : ''} />
        <Stat label="Grading now" value={d.counts.active ?? 0} />
        <Stat label="Workers online" value={workerNames.length} tone={workerNames.length === 0 ? 'text-destructive' : 'text-emerald-600'} />
        <Stat label="Completed (recent)" value={d.counts.completed ?? 0} />
        <Stat label="System errors" value={d.recentErrors.length} tone={d.recentErrors.length ? 'text-destructive' : ''} />
      </div>
      {workerNames.length === 0 && <ErrorBox error="No grading workers are connected. Submissions will wait in the queue until a worker starts." />}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Workers</CardTitle>
          </CardHeader>
          <Table>
            <TBody>
              {workerNames.map((n) => {
                const conns = d.workers.filter((w) => w.name === n);
                const busy = d.active.filter((a) => a.worker === n).length;
                return (
                  <TR key={n}>
                    <TD className="flex items-center gap-2 font-mono">
                      <Cpu className="h-4 w-4 text-muted-foreground" /> {n}
                    </TD>
                    <TD className="text-xs text-muted-foreground">{conns[0]?.addr}</TD>
                    <TD className="text-right">{busy ? <Badge variant="success">busy {busy}</Badge> : <Badge variant="muted">idle</Badge>}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Grading now</CardTitle>
          </CardHeader>
          <Table>
            <TBody>
              {d.active.map((a) => (
                <TR key={a.judgementId}>
                  <TD>
                    <Link className="text-primary hover:underline" to={`/s/${a.submissionId}`}>
                      {a.username} · {a.problem}
                    </Link>
                  </TD>
                  <TD className="text-xs">{a.status} {a.progressTotal ? `${a.progressDone}/${a.progressTotal}` : ''}</TD>
                  <TD className="text-right font-mono text-xs text-muted-foreground">{a.worker}</TD>
                </TR>
              ))}
              {d.active.length === 0 && (
                <TR>
                  <TD className="text-sm text-muted-foreground">Nothing is being graded.</TD>
                </TR>
              )}
            </TBody>
          </Table>
        </Card>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Waiting ({d.waiting.length})</CardTitle>
        </CardHeader>
        <Table>
          <TBody>
            {d.waiting.slice(0, 50).map((w) => (
              <TR key={w.judgementId}>
                <TD>
                  <Link className="hover:underline" to={`/s/${w.submissionId}`}>
                    {w.username} · {w.problem}
                  </Link>
                </TD>
                <TD className="text-right text-xs text-muted-foreground">{w.createdAt ? fmtTime(w.createdAt) : ''}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      {d.recentErrors.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-destructive">System errors (need attention — fix the cause, then rejudge)</CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <TR>
                <TH>Submission</TH>
                <TH>Error</TH>
                <TH>When</TH>
              </TR>
            </THead>
            <TBody>
              {d.recentErrors.map((e) => (
                <TR key={e.judgementId}>
                  <TD>
                    <Link className="text-primary hover:underline" to={`/s/${e.submissionId}`}>
                      {e.username} · {e.problem}
                    </Link>
                  </TD>
                  <TD className="max-w-xl truncate font-mono text-xs" title={e.error ?? ''}>
                    {e.error}
                  </TD>
                  <TD className="text-xs text-muted-foreground">{e.at ? fmtTime(e.at) : ''}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
