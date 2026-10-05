import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { SubmissionItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { ErrorBox, PageHeader, Spinner } from '@/components/common';
import { SubmissionsTable } from '../MySubmissions';

interface ContestLite {
  id: string;
  name: string;
  scoringMode: 'IOI' | 'ICPC';
}
interface ContestFull extends ContestLite {
  problems: { id: string; code: string; title: string }[];
}

export function AdminSubmissionsPage() {
  const [params, setParams] = useSearchParams();
  const contestId = params.get('contestId') ?? '';
  const problemId = params.get('problemId') ?? '';
  const status = params.get('status') ?? '';
  const [page, setPage] = useState(0);
  const contests = useQuery({ queryKey: ['admin-contests'], queryFn: () => api.get<ContestLite[]>('/api/admin/contests') });
  const contest = useQuery({ queryKey: ['admin-contest', contestId], queryFn: () => api.get<ContestFull>(`/api/admin/contests/${contestId}`), enabled: !!contestId });
  const qs = new URLSearchParams({ ...(contestId && { contestId }), ...(problemId && { problemId }), ...(status && { status }), take: '100', skip: String(page * 100) });
  const q = useQuery({
    queryKey: ['submissions', 'admin', qs.toString()],
    queryFn: () => api.get<{ total: number; items: SubmissionItem[] }>(`/api/admin/submissions?${qs}`),
    refetchInterval: 5000,
  });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k === 'contestId') n.delete('problemId');
    setParams(n);
    setPage(0);
  };
  const rejudgeAll = async () => {
    if (!contestId) return;
    const scope = problemId ? 'this problem' : 'the whole contest';
    if (!confirm(`Rejudge all${status ? ` ${status}` : ''} submissions of ${scope}?`)) return;
    const r = await api.post<{ count: number }>('/api/admin/rejudge', { contestId, problemId: problemId || undefined, onlyStatus: status ? [status] : undefined });
    toast.success(`Queued ${r.count} rejudge(s)`);
  };
  const ioi = (contests.data?.find((c) => c.id === contestId)?.scoringMode ?? 'IOI') === 'IOI';
  return (
    <div>
      <PageHeader
        title="Submissions"
        subtitle={q.data ? `${q.data.total} total` : undefined}
        actions={
          contestId && (
            <Button variant="outline" onClick={rejudgeAll}>
              <RotateCcw /> Rejudge filtered
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <NativeSelect className="w-60" value={contestId} onChange={(e) => set('contestId', e.target.value)}>
          <option value="">All contests</option>
          {contests.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect className="w-48" value={problemId} onChange={(e) => set('problemId', e.target.value)} disabled={!contestId}>
          <option value="">All problems</option>
          {contest.data?.problems.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.title}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect className="w-44" value={status} onChange={(e) => set('status', e.target.value)}>
          <option value="">Any result</option>
          {['QUEUED', 'RUNNING', 'AC', 'PA', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'SE'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NativeSelect>
      </div>
      <ErrorBox error={q.error} />
      {q.isLoading ? (
        <Spinner />
      ) : (
        <Card>
          <SubmissionsTable items={q.data?.items ?? []} ioi={ioi} showUser />
        </Card>
      )}
      {q.data && q.data.total > 100 && (
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="px-2 py-1 text-sm">Page {page + 1} of {Math.ceil(q.data.total / 100)}</span>
          <Button variant="outline" size="sm" disabled={(page + 1) * 100 >= q.data.total} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
