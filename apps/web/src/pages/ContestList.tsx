import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ContestSummary } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Countdown, ErrorBox, PageHeader, Spinner } from '@/components/common';
import { fmtTime } from '@/lib/utils';
import { t } from '@/lib/i18n';

export function ContestListPage() {
  const q = useQuery({ queryKey: ['contests'], queryFn: () => api.get<ContestSummary[]>('/api/contests') });
  if (q.isLoading) return <Spinner />;
  return (
    <div>
      <PageHeader title={t('Contests')} />
      <ErrorBox error={q.error} />
      {q.data?.length === 0 && <p className="text-muted-foreground">{t('You are not registered for any contest yet.')}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {q.data?.map((c) => (
          <Link key={c.id} to={`/c/${c.id}`}>
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{c.name}</CardTitle>
                  <Badge variant={c.scoringMode === 'IOI' ? 'info' : 'warning'}>{c.scoringMode}</Badge>
                </div>
                <CardDescription>
                  {fmtTime(c.startsAt)} – {fmtTime(c.endsAt)}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm">
                <Countdown startsAt={c.startsAt} endsAt={c.endsAt} />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
