import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ContestDetail, SubmissionItem } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ErrorBox, LanguageName, PageHeader, Spinner, StatusBadge } from '@/components/common';
import { fmtTime, score } from '@/lib/utils';

export function SubmissionsTable({ items, ioi, showUser }: { items: SubmissionItem[]; ioi: boolean; showUser?: boolean }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Time</TH>
          {showUser && <TH>Team</TH>}
          <TH>Problem</TH>
          <TH>Language</TH>
          <TH>Result</TH>
          {ioi && <TH className="text-right">Score</TH>}
          <TH className="text-right">Time</TH>
          <TH className="text-right">Memory</TH>
        </TR>
      </THead>
      <TBody>
        {items.map((s) => (
          <TR key={s.id}>
            <TD className="whitespace-nowrap text-muted-foreground">
              <Link className="hover:underline" to={`/s/${s.id}`}>
                {fmtTime(s.submittedAt)}
              </Link>
            </TD>
            {showUser && <TD>{s.user?.displayName}</TD>}
            <TD>
              <span className="font-mono font-semibold">{s.problemCode}</span> {s.problemTitle}
            </TD>
            <TD>
              <LanguageName lang={s.language} />
            </TD>
            <TD>
              <Link to={`/s/${s.id}`}>
                <StatusBadge status={s.status} verdict={s.verdict} done={s.progressDone} total={s.progressTotal} />
              </Link>
            </TD>
            {ioi && <TD className="text-right font-mono">{s.status === 'DONE' || s.status === 'CE' ? score(s.scoreCenti, s.scorePrecision) : ''}</TD>}
            <TD className="text-right font-mono text-muted-foreground">{s.maxTimeMs !== null ? `${s.maxTimeMs} ms` : ''}</TD>
            <TD className="text-right font-mono text-muted-foreground">{s.maxMemoryKb !== null ? `${(s.maxMemoryKb / 1024).toFixed(1)} MB` : ''}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function MySubmissionsPage() {
  const { cid } = useParams();
  const contest = useQuery({ queryKey: ['contest', cid], queryFn: () => api.get<ContestDetail>(`/api/contests/${cid}`) });
  const q = useQuery({ queryKey: ['submissions', cid], queryFn: () => api.get<SubmissionItem[]>(`/api/contests/${cid}/submissions`) });
  if (q.isLoading) return <Spinner />;
  return (
    <div>
      <PageHeader title="My submissions" subtitle={contest.data?.name} />
      <ErrorBox error={q.error} />
      <Card>
        <SubmissionsTable items={q.data ?? []} ioi={contest.data?.scoringMode !== 'ICPC'} />
        {q.data?.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No submissions yet.</p>}
      </Card>
    </div>
  );
}
