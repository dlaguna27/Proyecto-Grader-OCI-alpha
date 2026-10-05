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

/** Switch between the scoreboard table and the ranking history chart. */
export function ScoreboardTabs({ cid, standalone, active }: { cid: string; standalone?: boolean; active: 'table' | 'history' }) {
  const table = standalone ? `/board/${cid}` : `/c/${cid}/scoreboard`;
  const history = standalone ? `/board/${cid}/history` : `/c/${cid}/history`;
  return (
    <div className="flex gap-1">
      <Button size="sm" variant={active === 'table' ? 'default' : 'outline'} asChild>
        <Link to={table}>Table</Link>
      </Button>
      <Button size="sm" variant={active === 'history' ? 'default' : 'outline'} asChild>
        <Link to={history}>Ranking history</Link>
      </Button>
    </div>
  );
}

export function teamColor(i: number): string {
  return `hsl(${Math.round((i * 137.508) % 360)} 70% 50%)`;
}

const fmtMinute = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

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
        title={`${h.contest.name} — Ranking history`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={h.mode === 'IOI' ? 'info' : 'warning'}>{h.mode}</Badge>
            <Countdown startsAt={h.contest.startsAt} endsAt={h.contest.endsAt} />
            <span>· updated {fmtClock(h.generatedAt)}</span>
            {h.frozen && h.freezeMinute !== null && (
              <Badge variant="info" className="gap-1">
                <Snowflake className="h-3 w-3" /> Frozen — chart stops at {fmtMinute(h.freezeMinute)}
              </Badge>
            )}
          </span>
        }
        actions={<ScoreboardTabs cid={cid} standalone={standalone} active="history" />}
      />
      {h.lastMinute < 0 || h.series.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {h.series.length === 0 ? 'No participants yet.' : 'The chart starts when the contest starts.'}
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <Card className="p-3">
            <RankChart h={h} selected={selected} hovered={hovered} setHovered={setHovered} minute={minute} setMinute={setMinute} onToggle={toggle} />
            <p className="mt-2 px-1 text-xs text-muted-foreground">
              Position at each minute of the contest (1 = first). Hover to see a minute; click a line or a team to highlight it.
            </p>
          </Card>
          <Card className="max-h-[70vh] overflow-y-auto p-2">
            <div className="flex items-center justify-between px-2 py-1 text-xs font-medium text-muted-foreground">
              <span>{minute === null ? (h.lastMinute >= h.durationMinutes ? 'Final' : `Now (${fmtMinute(h.lastMinute)})`) : `At ${fmtMinute(minute)}`}</span>
              {selected.size > 0 && (
                <button className="hover:underline" onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              )}
            </div>
            {legend.map(({ s, i, rank }) => (
              <button
                key={s.userId}
                onClick={() => toggle(s.userId)}
                onMouseEnter={() => setHovered(s.userId)}
                onMouseLeave={() => setHovered(null)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted',
                  selected.has(s.userId) && 'bg-muted font-medium',
                )}
              >
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: teamColor(i) }} />
                <span className="w-7 shrink-0 text-right font-mono text-xs text-muted-foreground">{rank}</span>
                <span className="min-w-0 flex-1 truncate">
                  {s.displayName}
                  {me?.id === s.userId && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                </span>
                <span className="shrink-0 font-mono text-xs">
                  {h.mode === 'IOI' ? score(s.scores[shown], h.scorePrecision) : `${s.scores[shown]} / ${s.penalties?.[shown] ?? 0}`}
                </span>
              </button>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

const W = 1000;
const PAD = { l: 40, r: 12, t: 12, b: 28 };

function RankChart({
  h,
  selected,
  hovered,
  setHovered,
  minute,
  setMinute,
  onToggle,
}: {
  h: RankHistory;
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
  const y = (r: number) => PAD.t + (n <= 1 ? plotH / 2 : ((r - 1) / (n - 1)) * plotH);
  const xStep = [5, 10, 15, 30, 60, 120].find((s) => D / s <= 10) ?? 240;
  const yStep = n <= 12 ? 1 : n <= 30 ? 5 : 10;
  const yTicks = [1, ...Array.from({ length: Math.floor(n / yStep) }, (_, k) => (k + 1) * yStep).filter((r) => r > 1 && r < n), ...(n > 1 ? [n] : [])];
  const emphasis = selected.size > 0 || hovered !== null;
  const isOn = (id: string) => selected.has(id) || hovered === id;
  const lines = h.series.map((s, i) => ({ s, i, pts: s.ranks.map((r, m) => `${x(m).toFixed(1)},${y(r).toFixed(1)}`).join(' ') }));
  const ordered = [...lines.filter((l) => !isOn(l.s.userId)), ...lines.filter((l) => isOn(l.s.userId))];

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const m = Math.round(((px - PAD.l) / plotW) * D);
    setMinute(Math.max(0, Math.min(h.lastMinute, m)));
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" onMouseMove={onMove} onMouseLeave={() => setMinute(null)} role="img" aria-label="Ranking history chart">
      {yTicks.map((r) => (
        <g key={`y${r}`}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(r)} y2={y(r)} className="stroke-border" strokeWidth={1} />
          <text x={PAD.l - 6} y={y(r)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px]">
            {r}
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
            freeze
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
              <circle key={s.userId} cx={x(minute)} cy={y(s.ranks[minute])} r={5} fill={teamColor(i)} className="stroke-background" strokeWidth={2} />
            ))}
        </g>
      )}
    </svg>
  );
}
