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
import { InlineMarkdown } from './Problem';
import { cn, fmtTime, score } from '@/lib/utils';
import { t } from '@/lib/i18n';

type Test = SubmissionDetail['tests'][number];

function TestRows({ tests, admin }: { tests: Test[]; admin: boolean }) {
  return (
    <>
      {tests.map((x) => (
        <TR key={x.id}>
          <TD className="font-mono text-xs">
            {x.name}
            {x.isSample && <Badge variant="muted" className="ml-2">{t('sample')}</Badge>}
          </TD>
          <TD>
            <VerdictBadge verdict={x.verdict} />
          </TD>
          <TD className="text-right font-mono text-xs">{x.verdict === 'PA' && x.fractionPpm !== null ? `${(x.fractionPpm / 10000).toFixed(2)}%` : ''}</TD>
          <TD className="text-right font-mono text-xs text-muted-foreground">{x.timeMs !== null ? `${x.timeMs} ms` : ''}</TD>
          <TD className="text-right font-mono text-xs text-muted-foreground">{x.memoryKb !== null ? `${(x.memoryKb / 1024).toFixed(1)} MB` : ''}</TD>
          {admin && <TD className="max-w-xs truncate text-xs text-muted-foreground" title={x.message ?? ''}>{x.message}</TD>}
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
        <TH>{t('Test')}</TH>
        <TH>{t('Verdict')}</TH>
        <TH className="text-right">{t('Partial')}</TH>
        <TH className="text-right">{t('Time')}</TH>
        <TH className="text-right">{t('Memory')}</TH>
        {admin && <TH>{t('Checker message')}</TH>}
      </TR>
    </THead>
  );
  const rejudge = async () => {
    await api.post(`/api/admin/submissions/${s.id}/rejudge`);
    toast.success(t('Rejudge queued'));
    qc.invalidateQueries({ queryKey: ['submission', sid] });
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span>
            {t('Submission')} <span className="font-mono text-muted-foreground">{s.id.slice(-8)}</span>
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
              <RotateCcw /> {t('Rejudge')}
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
        <ErrorBox error={admin ? `${t('System error')}: ${s.error ?? t('unknown')}` : t('A system error occurred while grading. The judges have been notified; this submission does not count against you.')} />
      )}
      {s.compileLog && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{s.status === 'CE' ? t('Compilation error') : t('Compiler output')}</CardTitle>
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
                      {t('Subtask')} {st.ordinal}
                      {st.name && <span className="text-muted-foreground"> · <InlineMarkdown>{st.name}</InlineMarkdown></span>}
                      <span className="ml-2 text-xs text-muted-foreground">({st.scoring === 'MIN' ? t('all tests must pass') : t('points per test')})</span>
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
              <div className="border-b px-4 py-3 font-medium">{ioi ? t('Other tests (not scored)') : t('Tests')}</div>
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
            <CardTitle className="text-base">{t('Source code')}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[600px] overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{s.source}</pre>
          </CardContent>
        </Card>
      )}
      {s.outputs && (
        <Card>
          <CardContent className="pt-5 text-sm">{t('Uploaded outputs for')}: {s.outputs.join(', ')}</CardContent>
        </Card>
      )}
    </div>
  );
}
