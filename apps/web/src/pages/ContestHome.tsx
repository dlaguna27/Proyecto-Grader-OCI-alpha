import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import { api } from '@/lib/api';
import type { ContestDetail, IcpcCell, IoiCell } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Countdown, ErrorBox, PageHeader, Spinner } from '@/components/common';
import { fmtTime, score } from '@/lib/utils';
import { useNow } from '@/lib/auth';

const TYPE_LABEL = { BATCH: 'Batch', OUTPUT_ONLY: 'Output-only', INTERACTIVE: 'Interactive' } as const;

export function ContestHomePage() {
  const { cid } = useParams();
  const q = useQuery({ queryKey: ['contest', cid], queryFn: () => api.get<ContestDetail>(`/api/contests/${cid}`), refetchInterval: 30_000 });
  const now = useNow(5000);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const c = q.data;
  const ioi = c.scoringMode === 'IOI';
  const notStarted = now < new Date(c.startsAt).getTime();
  let total = 0;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        <PageHeader
          title={c.name}
          subtitle={
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant={ioi ? 'info' : 'warning'}>{c.scoringMode}</Badge>
              {fmtTime(c.startsAt)} – {fmtTime(c.endsAt)}
            </span>
          }
          actions={
            <div className="rounded-lg border bg-card px-4 py-2 text-lg font-semibold">
              <Countdown startsAt={c.startsAt} endsAt={c.endsAt} />
            </div>
          }
        />
        {c.description && <p className="mb-6 whitespace-pre-wrap text-sm text-muted-foreground">{c.description}</p>}
        {notStarted ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">Problems will appear when the contest starts.</CardContent>
          </Card>
        ) : (
          <Card>
            <Table>
              <THead>
                <TR>
                  <TH className="w-16">#</TH>
                  <TH>Problem</TH>
                  <TH>Type</TH>
                  <TH className="text-right">{ioi ? 'Score' : 'Result'}</TH>
                  <TH className="text-right">Submissions</TH>
                </TR>
              </THead>
              <TBody>
                {c.problems.map((p) => {
                  const my = p.my as (IoiCell & Omit<IcpcCell, 'pending'> & { pending: number | boolean }) | null;
                  if (ioi && my) total += my.scoreCenti;
                  return (
                    <TR key={p.id}>
                      <TD className="font-mono font-semibold">{p.code}</TD>
                      <TD>
                        <Link className="font-medium text-primary hover:underline" to={`/c/${cid}/p/${p.id}`}>
                          {p.title}
                        </Link>
                      </TD>
                      <TD className="text-muted-foreground">{TYPE_LABEL[p.type]}</TD>
                      <TD className="text-right font-mono">
                        {ioi ? (
                          <span>
                            {score(my?.scoreCenti ?? 0, p.scorePrecision)}
                            <span className="text-muted-foreground"> / {score(p.maxScoreCenti, p.scorePrecision)}</span>
                          </span>
                        ) : my?.solved ? (
                          <Badge variant="success">Solved</Badge>
                        ) : my?.pending ? (
                          <Badge variant="muted">Pending</Badge>
                        ) : my && my.rejected > 0 ? (
                          <Badge variant="danger">-{my.rejected}</Badge>
                        ) : (
                          ''
                        )}
                      </TD>
                      <TD className="text-right text-muted-foreground">
                        {p.submissions}
                        {c.maxSubmissionsPerTask ? ` / ${c.maxSubmissionsPerTask}` : ''}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            {ioi && c.problems.length > 0 && (
              <div className="flex justify-end border-t px-3 py-2 text-sm">
                Total: <span className="ml-2 font-mono font-semibold">{score(total, Math.max(0, ...c.problems.map((p) => p.scorePrecision)))}</span>
              </div>
            )}
          </Card>
        )}
      </div>
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="h-4 w-4" /> Announcements
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {c.announcements.length === 0 && <p className="text-sm text-muted-foreground">No announcements.</p>}
            {c.announcements.map((a) => (
              <div key={a.id} className="rounded-md border p-3">
                <div className="text-sm font-semibold">{a.title}</div>
                <div className="text-xs text-muted-foreground">{fmtTime(a.createdAt)}</div>
                {a.body && <p className="mt-1 whitespace-pre-wrap text-sm">{a.body}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-5 text-sm text-muted-foreground">
            <div>Languages: C++20 (g++ -O3), Python 3</div>
            {c.maxSubmissionsPerTask && <div>Up to {c.maxSubmissionsPerTask} submissions per task</div>}
            {!ioi && <div>Penalty: {c.penaltyMinutes} min per rejected attempt</div>}
            {c.freezeAt && <div>Scoreboard freezes at {fmtTime(c.freezeAt)}</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
