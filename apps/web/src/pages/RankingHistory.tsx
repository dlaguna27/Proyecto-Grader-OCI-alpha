import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Snowflake } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useLiveUpdates } from '@/lib/events';
import type { RankHistory } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Countdown, ErrorBox, PageHeader, Spinner } from '@/components/common';
import { cn, fmtClock, score } from '@/lib/utils';
import { t } from '@/lib/i18n';

/** Switch between the scoreboard table and the ranking history chart. */
export function ScoreboardTabs({ cid, standalone, active }: { cid: string; standalone?: boolean; active: 'table' | 'history' }) {
  const table = standalone ? `/board/${cid}` : `/c/${cid}/scoreboard`;
  const history = standalone ? `/board/${cid}/history` : `/c/${cid}/history`;
  return (
    <div className="flex gap-1">
      <Button size="sm" variant={active === 'table' ? 'default' : 'outline'} asChild>
        <Link to={table}>{t('Table')}</Link>
      </Button>
      <Button size="sm" variant={active === 'history' ? 'default' : 'outline'} asChild>
        <Link to={history}>{t('Ranking history')}</Link>
      </Button>
    </div>
  );
}

export function teamColor(i: number): string {
  return `hsl(${Math.round((i * 137.508) % 360)} 70% 50%)`;
}

const fmtMinute = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

type ChartView = 'rank' | 'points';
const VIEW_KEY = 'oci.history.view';
const hiddenKey = (cid: string) => `oci.history.hidden.${cid}`;

function loadHidden(cid: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(hiddenKey(cid)) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function RankingHistoryPage({ standalone }: { standalone?: boolean }) {
  const { cid } = useParams();
  const q = useQuery({
    queryKey: ['scoreboard', cid, 'history'],
    queryFn: () => api.get<RankHistory>(`/api/contests/${cid}/history`),
    refetchInterval: 60_000,
  });
  const body = q.isLoading ? <Spinner /> : q.error || !q.data ? <ErrorBox error={q.error} /> : <HistoryView h={q.data} cid={cid!} standalone={standalone} />;
  if (!standalone) return body;
  return <StandaloneHistory cid={cid!}>{body}</StandaloneHistory>;
}

function StandaloneHistory({ cid, children }: { cid: string; children: React.ReactNode }) {
  useLiveUpdates(cid);
  return <div className="container py-6">{children}</div>;
}

function HistoryView({ h, cid, standalone }: { h: RankHistory; cid: string; standalone?: boolean }) {
  const me = useMe().data?.user;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const [minute, setMinute] = useState<number | null>(null);
  const [view, setViewState] = useState<ChartView>(() => (localStorage.getItem(VIEW_KEY) === 'points' ? 'points' : 'rank'));
  const [hidden, setHiddenState] = useState<Set<string>>(() => loadHidden(cid));
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !me) return;
    seeded.current = true;
    if (h.series.some((s) => s.userId === me.id)) setSelected(new Set([me.id]));
  }, [me, h.series]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setView = (v: ChartView) => {
    setViewState(v);
    localStorage.setItem(VIEW_KEY, v);
  };
  const setHidden = (next: Set<string>) => {
    setHiddenState(next);
    localStorage.setItem(hiddenKey(cid), JSON.stringify([...next]));
  };
  const toggleShown = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
  };
  const visibleCount = h.series.filter((s) => !hidden.has(s.userId)).length;

  const shown = minute ?? h.lastMinute;
  const legend = useMemo(
    () =>
      h.series
        .map((s, i) => ({ s, i, rank: s.ranks[shown] ?? 1 }))
        .sort((a, b) => a.rank - b.rank || a.s.displayName.localeCompare(b.s.displayName)),
    [h.series, shown],
  );

  return (
    <div>
      <PageHeader
        title={`${h.contest.name} — ${t('Ranking history')}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={h.mode === 'IOI' ? 'info' : 'warning'}>{h.mode}</Badge>
            <Countdown startsAt={h.contest.startsAt} endsAt={h.contest.endsAt} />
            <span>· {t('updated')} {fmtClock(h.generatedAt)}</span>
            {h.frozen && h.freezeMinute !== null && (
              <Badge variant="info" className="gap-1">
                <Snowflake className="h-3 w-3" /> {t('Frozen — chart stops at {m}', { m: fmtMinute(h.freezeMinute) })}
              </Badge>
            )}
          </span>
        }
        actions={<ScoreboardTabs cid={cid} standalone={standalone} active="history" />}
      />
      {h.lastMinute < 0 || h.series.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {h.series.length === 0 ? t('No participants yet.') : t('The chart starts when the contest starts.')}
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <Card className="p-3">
            <div className="mb-2 flex gap-1">
              <Button size="sm" variant={view === 'rank' ? 'default' : 'outline'} onClick={() => setView('rank')}>
                {t('Position')}
              </Button>
              <Button size="sm" variant={view === 'points' ? 'default' : 'outline'} onClick={() => setView('points')}>
                {h.mode === 'IOI' ? t('Points') : t('Problems solved')}
              </Button>
            </div>
            {visibleCount === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">{t('No teams selected. Tick teams in the list to show them.')}</div>
            ) : (
              <HistoryChart
                h={h}
                view={view}
                hidden={hidden}
                selected={selected}
                hovered={hovered}
                setHovered={setHovered}
                minute={minute}
                setMinute={setMinute}
                onToggle={toggle}
              />
            )}
            <p className="mt-2 px-1 text-xs text-muted-foreground">
              {view === 'rank'
                ? t('Position at each minute of the contest (1 = first). Hover to see a minute; click a line or a team to highlight it.')
                : h.mode === 'IOI'
                  ? t('Total points at each minute of the contest. Hover to see a minute; click a line or a team to highlight it.')
                  : t('Problems solved at each minute of the contest. Hover to see a minute; click a line or a team to highlight it.')}{' '}
              {t('Use the checkboxes to choose which teams are shown.')}
            </p>
          </Card>
          <Card className="max-h-[70vh] overflow-y-auto p-2">
            <div className="flex items-center justify-between px-2 py-1 text-xs font-medium text-muted-foreground">
              <span>{minute === null ? (h.lastMinute >= h.durationMinutes ? t('Final') : t('Now ({m})', { m: fmtMinute(h.lastMinute) })) : t('At {m}', { m: fmtMinute(minute) })}</span>
              <span className="flex gap-2">
                {selected.size > 0 && (
                  <button className="hover:underline" onClick={() => setSelected(new Set())}>
                    {t('Clear')}
                  </button>
                )}
                <button className="hover:underline disabled:opacity-40 disabled:no-underline" disabled={hidden.size === 0} onClick={() => setHidden(new Set())}>
                  {t('All')}
                </button>
                <button
                  className="hover:underline disabled:opacity-40 disabled:no-underline"
                  disabled={visibleCount === 0}
                  onClick={() => setHidden(new Set(h.series.map((x) => x.userId)))}
                >
                  {t('None')}
                </button>
              </span>
            </div>
            {legend.map(({ s, i, rank }) => (
              <div
                key={s.userId}
                role="button"
                tabIndex={0}
                onClick={() => toggle(s.userId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') toggle(s.userId);
                }}
                onMouseEnter={() => setHovered(s.userId)}
                onMouseLeave={() => setHovered(null)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted',
                  selected.has(s.userId) && 'bg-muted font-medium',
                  hidden.has(s.userId) && 'text-muted-foreground opacity-60',
                )}
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 shrink-0 cursor-pointer"
                  style={{ accentColor: teamColor(i) }}
                  checked={!hidden.has(s.userId)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleShown(s.userId)}
                  aria-label={t('Show {name} on the chart', { name: s.displayName })}
                  title={t('Show on the chart')}
                />
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: teamColor(i) }} />
                <span className="w-7 shrink-0 text-right font-mono text-xs text-muted-foreground">{rank}</span>
                <span className="min-w-0 flex-1 truncate">
                  {s.displayName}
                  {me?.id === s.userId && <span className="ml-1 text-xs text-muted-foreground">({t('you')})</span>}
                </span>
                <span className="shrink-0 font-mono text-xs">
                  {h.mode === 'IOI' ? score(s.scores[shown], h.scorePrecision) : `${s.scores[shown]} / ${s.penalties?.[shown] ?? 0}`}
                </span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

const W = 1000;
const PAD = { l: 40, r: 12, t: 12, b: 28 };

function niceStep(max: number, target = 6): number {
  const raw = Math.max(max, 1) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 5, 10].find((f) => f * mag >= raw) ?? 10) * mag;
}

function HistoryChart({
  h,
  view,
  hidden,
  selected,
  hovered,
  setHovered,
  minute,
  setMinute,
  onToggle,
}: {
  h: RankHistory;
  view: ChartView;
  hidden: Set<string>;
  selected: Set<string>;
  hovered: string | null;
  setHovered: (id: string | null) => void;
  minute: number | null;
  setMinute: (m: number | null) => void;
  onToggle: (id: string) => void;
}) {
  const n = h.series.length;
  const H = Math.min(760, Math.max(340, n * 13 + PAD.t + PAD.b));
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const D = Math.max(1, h.durationMinutes);
  const x = (m: number) => PAD.l + (m / D) * plotW;
  const xStep = [5, 10, 15, 30, 60, 120].find((s) => D / s <= 10) ?? 240;
  const visible = h.series.map((s, i) => ({ s, i })).filter(({ s }) => !hidden.has(s.userId));
  const values = (s: RankHistory['series'][number]) => (view === 'rank' ? s.ranks : s.scores);

  let y: (v: number) => number;
  let yTicks: number[];
  let yLabel: (v: number) => string;
  if (view === 'rank') {
    y = (r) => PAD.t + (n <= 1 ? plotH / 2 : ((r - 1) / (n - 1)) * plotH);
    const yStep = n <= 12 ? 1 : n <= 30 ? 5 : 10;
    yTicks = [1, ...Array.from({ length: Math.floor(n / yStep) }, (_, k) => (k + 1) * yStep).filter((r) => r > 1 && r < n), ...(n > 1 ? [n] : [])];
    yLabel = (r) => String(r);
  } else {
    const unit = h.mode === 'IOI' ? 100 : 1;
    const maxUnits = Math.max(1, ...visible.flatMap(({ s }) => s.scores)) / unit;
    const step = h.mode === 'IOI' ? niceStep(maxUnits) : Math.max(1, Math.round(niceStep(maxUnits)));
    const top = Math.ceil(maxUnits / step) * step * unit;
    y = (v) => PAD.t + plotH - (v / top) * plotH;
    yTicks = Array.from({ length: Math.round(top / (step * unit)) + 1 }, (_, k) => Math.round(k * step * unit));
    yLabel = (v) => (h.mode === 'IOI' ? score(v, h.scorePrecision) : String(v));
  }

  const emphasis = selected.size > 0 || hovered !== null;
  const isOn = (id: string) => selected.has(id) || hovered === id;
  const lines = visible.map(({ s, i }) => ({ s, i, pts: values(s).map((v, m) => `${x(m).toFixed(1)},${y(v).toFixed(1)}`).join(' ') }));
  const ordered = [...lines.filter((l) => !isOn(l.s.userId)), ...lines.filter((l) => isOn(l.s.userId))];

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const m = Math.round(((px - PAD.l) / plotW) * D);
    setMinute(Math.max(0, Math.min(h.lastMinute, m)));
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" onMouseMove={onMove} onMouseLeave={() => setMinute(null)} role="img" aria-label={view === 'rank' ? t('Ranking history') : t('Points history')}>
      {yTicks.map((r) => (
        <g key={`y${r}`}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(r)} y2={y(r)} className="stroke-border" strokeWidth={1} />
          <text x={PAD.l - 6} y={y(r)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px]">
            {yLabel(r)}
          </text>
        </g>
      ))}
      {Array.from({ length: Math.floor(D / xStep) + 1 }, (_, k) => k * xStep).map((m) => (
        <text key={`x${m}`} x={x(m)} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
          {fmtMinute(m)}
        </text>
      ))}
      {h.freezeMinute !== null && h.freezeMinute <= D && (
        <g>
          <line x1={x(h.freezeMinute)} x2={x(h.freezeMinute)} y1={PAD.t} y2={PAD.t + plotH} className="stroke-sky-500" strokeDasharray="4 4" strokeWidth={1.5} />
          <text x={x(h.freezeMinute) + 4} y={PAD.t + 10} className="fill-sky-600 text-[11px] dark:fill-sky-400">
            {t('freeze')}
          </text>
        </g>
      )}
      {ordered.map(({ s, i, pts }) => {
        const on = isOn(s.userId);
        return (
          <polyline
            key={s.userId}
            points={pts}
            fill="none"
            stroke={teamColor(i)}
            strokeWidth={on ? 3.5 : emphasis ? 1.5 : 2}
            strokeOpacity={on ? 1 : emphasis ? 0.15 : 0.75}
            strokeLinejoin="round"
            className="cursor-pointer"
            pointerEvents="stroke"
            onMouseEnter={() => setHovered(s.userId)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onToggle(s.userId)}
          >
            <title>{s.displayName}</title>
          </polyline>
        );
      })}
      {minute !== null && (
        <g pointerEvents="none">
          <line x1={x(minute)} x2={x(minute)} y1={PAD.t} y2={PAD.t + plotH} className="stroke-foreground/40" strokeWidth={1} />
          {lines
            .filter((l) => isOn(l.s.userId))
            .map(({ s, i }) => (
              <circle key={s.userId} cx={x(minute)} cy={y(values(s)[minute])} r={5} fill={teamColor(i)} className="stroke-background" strokeWidth={2} />
            ))}
        </g>
      )}
    </svg>
  );
}
