import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Snowflake } from 'lucide-react';
import { api } from '@/lib/api';
import type { Board } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Countdown, ErrorBox, PageHeader, Spinner } from '@/components/common';
import { cn, fmtClock, fmtDuration, score } from '@/lib/utils';
import { useLiveUpdates } from '@/lib/events';
import { ScoreboardTabs } from './RankingHistory';
import { Balloon, ioiCellStyle } from '@/components/Balloon';
import { t } from '@/lib/i18n';

export function ScoreboardPage({ standalone }: { standalone?: boolean }) {
  const { cid } = useParams();
  const q = useQuery({
    queryKey: ['scoreboard', cid],
    queryFn: () => api.get<Board>(`/api/contests/${cid}/scoreboard`),
    refetchInterval: 30_000,
  });
  if (standalone) return <StandaloneBoard q={q} cid={cid!} />;
  return <BoardView q={q} nav={<ScoreboardTabs cid={cid!} active="table" />} />;
}

function StandaloneBoard({ q, cid }: { q: ReturnType<typeof useQuery<Board>>; cid: string }) {
  useLiveUpdates(cid);
  return (
    <div className="container py-6">
      <BoardView q={q} big nav={<ScoreboardTabs cid={cid} standalone active="table" />} />
    </div>
  );
}

function BoardView({ q, big, nav }: { q: ReturnType<typeof useQuery<Board>>; big?: boolean; nav?: React.ReactNode }) {
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const b = q.data;
  const ioi = b.mode === 'IOI';
  const maxPrec = Math.max(0, ...b.problems.map((p) => p.scorePrecision));
  return (
    <div>
      <PageHeader
        title={`${b.contest.name} — ${t('Scoreboard')}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={ioi ? 'info' : 'warning'}>{b.mode}</Badge>
            <Countdown startsAt={b.contest.startsAt} endsAt={b.contest.endsAt} />
            <span>· {t('updated')} {fmtClock(b.generatedAt)}</span>
            {b.frozen && (
              <Badge variant="info" className="gap-1">
                <Snowflake className="h-3 w-3" /> {t('Frozen')}
              </Badge>
            )}
          </span>
        }
        actions={nav}
      />
      <Card>
        <Table className={big ? 'text-base' : ''}>
          <THead>
            <TR>
              <TH className="w-14 text-center">{t('Rank')}</TH>
              <TH>{t('Team')}</TH>
              {b.problems.map((p) => (
                <TH key={p.id} className="text-center" title={p.title}>
                  <div className="flex flex-col items-center gap-0.5 py-1">
                    <Balloon color={p.color} />
                    <span>{p.code}</span>
                  </div>
                </TH>
              ))}
              {ioi ? <TH className="text-right">{t('Total')}</TH> : <><TH className="text-center">{t('Solved')}</TH><TH className="text-right">{t('Penalty')}</TH></>}
            </TR>
          </THead>
          <TBody>
            {b.rows.map((r) => (
              <TR key={r.userId}>
                <TD className="text-center font-semibold">{r.rank}</TD>
                <TD>
                  <div className="font-medium">{r.displayName}</div>
                  {(r.organization || r.members) && <div className="text-xs text-muted-foreground">{[r.organization, r.members].filter(Boolean).join(' · ')}</div>}
                </TD>
                {b.problems.map((p) => {
                  if (ioi) {
                    const c = r.ioi![p.id];
                    return (
                      <TD key={p.id} className="text-center font-mono" style={ioiCellStyle(c.scoreCenti, p.maxScoreCenti, p.color)}>
                        {c.attempts > 0 ? score(c.scoreCenti, p.scorePrecision) : <span className="text-muted-foreground">·</span>}
                        {c.pending > 0 && <span className="ml-1 text-xs text-muted-foreground">?</span>}
                      </TD>
                    );
                  }
                  const c = r.icpc![p.id];
                  return (
                    <TD
                      key={p.id}
                      className={cn(
                        'text-center font-mono text-xs',
                        c.firstSolve ? 'bg-emerald-600 text-white' : c.solved ? 'bg-emerald-500/25' : c.pending ? 'bg-sky-500/20' : c.rejected ? 'bg-red-500/15' : '',
                      )}
                    >
                      {c.solved ? (
                        <>
                          <div className="flex items-center justify-center gap-1 font-semibold">
                            <Balloon color={p.color} className="h-4" />+{c.rejected || ''}
                          </div>
                          <div>{c.solveMinute}</div>
                        </>
                      ) : c.pending ? (
                        <div>
                          ? {c.rejected ? `-${c.rejected}` : ''} +{c.pendingCount}
                        </div>
                      ) : c.rejected ? (
                        <div className="font-semibold">-{c.rejected}</div>
                      ) : (
                        ''
                      )}
                    </TD>
                  );
                })}
                {ioi ? (
                  <TD className="text-right font-mono font-semibold">
                    {score(r.totalCenti ?? 0, maxPrec)}
                    {b.ioiTieBreak === 'TIME' && r.reachedAtMs != null && (
                      <div className="text-xs font-normal text-muted-foreground" title={t('Time the team reached this total')}>{fmtDuration(r.reachedAtMs)}</div>
                    )}
                  </TD>
                ) : (
                  <>
                    <TD className="text-center font-semibold">{r.solved}</TD>
                    <TD className="text-right font-mono">{r.penalty}</TD>
                  </>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
        {b.rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{t('No participants yet.')}</p>}
      </Card>
    </div>
  );
}
