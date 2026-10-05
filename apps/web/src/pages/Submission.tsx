import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useMe } from '@/lib/auth';
import type { SubmissionDetail } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ErrorBox, LanguageName, PageHeader, Spinner, StatusBadge, VerdictBadge } from '@/components/common';
import { cn, fmtTime, score } from '@/lib/utils';

type Test = SubmissionDetail['tests'][number];

function TestRows({ tests, admin }: { tests: Test[]; admin: boolean }) {
  return (
    <>
      {tests.map((t) => (
        <TR key={t.id}>
          <TD className="font-mono text-xs">
            {t.name}
            {t.isSample && <Badge variant="muted" className="ml-2">sample</Badge>}
          </TD>
          <TD>
            <VerdictBadge verdict={t.verdict} />
          </TD>
          <TD className="text-right font-mono text-xs">{t.verdict === 'PA' && t.fractionPpm !== null ? `${(t.fractionPpm / 10000).toFixed(2)}%` : ''}</TD>
          <TD className="text-right font-mono text-xs text-muted-foreground">{t.timeMs !== null ? `${t.timeMs} ms` : ''}</TD>
          <TD className="text-right font-mono text-xs text-muted-foreground">{t.memoryKb !== null ? `${(t.memoryKb / 1024).toFixed(1)} MB` : ''}</TD>
          {admin && <TD className="max-w-xs truncate text-xs text-muted-foreground" title={t.message ?? ''}>{t.message}</TD>}
        </TR>
      ))}
    </>
  );
}

export function SubmissionPage() {
  const { sid } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const admin = me.data?.user?.role === 'ADMIN';
  const q = useQuery({
    queryKey: ['submission', sid],
    queryFn: () => api.get<SubmissionDetail>(`/api/submissions/${sid}`),
    refetchInterval: (query) => (query.state.data && ['DONE', 'CE', 'SE'].includes(query.state.data.status) ? false : 2000),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const s = q.data;
  const ioi = s.scoringMode === 'IOI';
  const byId = new Map(s.tests.map((t) => [t.id, t]));
  const inSubtask = new Set(s.subtasks.flatMap((st) => st.testIds));
  const loose = s.tests.filter((t) => !inSubtask.has(t.id));
  const head = (
    <THead>
      <TR>
        <TH>Test</TH>
        <TH>Verdict</TH>
        <TH className="text-right">Partial</TH>
        <TH className="text-right">Time</TH>
        <TH className="text-right">Memory</TH>
        {admin && <TH>Checker message</TH>}
      </TR>
    </THead>
  );
  const rejudge = async () => {
    await api.post(`/api/admin/submissions/${s.id}/rejudge`);
    toast.success('Rejudge queued');
    qc.invalidateQueries({ queryKey: ['submission', sid] });
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span>
            Submission <span className="font-mono text-muted-foreground">{s.id.slice(-8)}</span>
          </span>
        }
        subtitle={
          <span>
            <Link className="hover:underline" to={admin ? `/admin/contests/${s.contestId}` : `/c/${s.contestId}/p/${s.problemId}`}>
              <span className="font-mono font-semibold">{s.problemCode}</span> {s.problemTitle}
            </Link>{' '}
            · {s.user.displayName} · <LanguageName lang={s.language} /> · {fmtTime(s.submittedAt)}
          </span>
        }
        actions={
          admin && (
            <Button variant="outline" size="sm" onClick={rejudge}>
              <RotateCcw /> Rejudge
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-4">
        <div className="text-lg">
          <StatusBadge status={s.status} verdict={s.verdict} done={s.progressDone} total={s.progressTotal} />
        </div>
        {ioi && (s.status === 'DONE' || s.status === 'CE') && (
          <div className="text-2xl font-semibold">
            {score(s.scoreCenti, s.scorePrecision)}
            <span className="text-base font-normal text-muted-foreground"> / {score(s.subtasks.reduce((a, x) => a + x.pointsCenti, 0), s.scorePrecision)}</span>
          </div>
        )}
      </div>
      {s.status === 'SE' && (
        <ErrorBox error={admin ? `System error: ${s.error ?? 'unknown'}` : 'A system error occurred while grading. The judges have been notified; this submission does not count against you.'} />
      )}
      {s.compileLog && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{s.status === 'CE' ? 'Compilation error' : 'Compiler output'}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{s.compileLog}</pre>
          </CardContent>
        </Card>
      )}
      {s.status !== 'CE' && s.tests.length > 0 && (
        <div className="space-y-4">
          {ioi &&
            s.subtasks.map((st) => {
              const full = st.scoreCenti === st.pointsCenti;
              return (
                <Card key={st.id}>
                  <div className={cn('flex items-center justify-between border-b px-4 py-3', full ? 'bg-emerald-500/10' : st.scoreCenti ? 'bg-amber-500/10' : 'bg-red-500/5')}>
                    <div className="font-medium">
                      Subtask {st.ordinal}
                      {st.name && <span className="text-muted-foreground"> · {st.name}</span>}
                      <span className="ml-2 text-xs text-muted-foreground">({st.scoring === 'MIN' ? 'all tests must pass' : 'points per test'})</span>
                    </div>
                    <div className="font-mono font-semibold">
                      {score(st.scoreCenti, s.scorePrecision)} / {score(st.pointsCenti, s.scorePrecision)}
                    </div>
                  </div>
                  <Table>
                    {head}
                    <TBody>
                      <TestRows tests={st.testIds.map((id) => byId.get(id)!).filter(Boolean)} admin={admin} />
                    </TBody>
                  </Table>
                </Card>
              );
            })}
          {(loose.length > 0 || !ioi) && (
            <Card>
              <div className="border-b px-4 py-3 font-medium">{ioi ? 'Other tests (not scored)' : 'Tests'}</div>
              <Table>
                {head}
                <TBody>
                  <TestRows tests={ioi ? loose : s.tests} admin={admin} />
                </TBody>
              </Table>
            </Card>
          )}
        </div>
      )}
      {s.source !== null && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Source code</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[600px] overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{s.source}</pre>
          </CardContent>
        </Card>
      )}
      {s.outputs && (
        <Card>
          <CardContent className="pt-5 text-sm">Uploaded outputs for: {s.outputs.join(', ')}</CardContent>
        </Card>
      )}
    </div>
  );
}
