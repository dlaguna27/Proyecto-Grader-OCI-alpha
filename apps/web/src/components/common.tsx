import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { TEST_VERDICT_LABELS, type TestVerdict } from '@noi/shared';
import { Badge } from './ui/badge';
import { cn, fmtDuration } from '@/lib/utils';
import { useNow } from '@/lib/auth';
import type { JStatus } from '@/lib/types';
import { t } from '@/lib/i18n';

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={cn('flex justify-center py-8 text-muted-foreground', className)}>
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error instanceof Error ? error.message : String(error)}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const VERDICT_STYLE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'secondary'> = {
  AC: 'success',
  PA: 'warning',
  WA: 'danger',
  TLE: 'info',
  MLE: 'info',
  RE: 'danger',
  CE: 'secondary',
  SE: 'danger',
  SKIPPED: 'muted',
};

export const VERDICT_LABEL: Record<string, string> = { ...TEST_VERDICT_LABELS, CE: 'Compilation error' } as Record<TestVerdict | 'CE', string>;

export function VerdictBadge({ verdict, short }: { verdict: string | null; short?: boolean }) {
  if (!verdict) return <Badge variant="muted">–</Badge>;
  return (
    <Badge variant={VERDICT_STYLE[verdict] ?? 'secondary'} title={t(VERDICT_LABEL[verdict] ?? verdict)}>
      {short ? verdict : t(VERDICT_LABEL[verdict] ?? verdict)}
    </Badge>
  );
}

export function StatusBadge({ status, verdict, done, total }: { status: JStatus; verdict: string | null; done?: number; total?: number }) {
  if (status === 'QUEUED') return <Badge variant="muted">{t('Queued')}</Badge>;
  if (status === 'COMPILING')
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> {t('Compiling')}
      </Badge>
    );
  if (status === 'RUNNING')
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> {t('Running')} {total ? `${done}/${total}` : ''}
      </Badge>
    );
  if (status === 'CE') return <VerdictBadge verdict="CE" />;
  if (status === 'SE') return <VerdictBadge verdict="SE" />;
  return <VerdictBadge verdict={verdict} />;
}

export function Countdown({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  const now = useNow();
  const s = new Date(startsAt).getTime();
  const e = new Date(endsAt).getTime();
  if (now < s) return <span className="font-mono">{t('Starts in {d}', { d: fmtDuration(s - now) })}</span>;
  if (now < e) return <span className="font-mono">{t('{d} left', { d: fmtDuration(e - now) })}</span>;
  return <span>{t('Contest over')}</span>;
}

export function LanguageName({ lang }: { lang: string | null }) {
  if (!lang) return <span className="text-muted-foreground">{t('output')}</span>;
  return <>{lang === 'cpp' ? 'C++20' : lang === 'python' ? 'Python 3' : lang}</>;
}
