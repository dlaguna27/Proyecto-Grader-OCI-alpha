import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ChevronsRight, Maximize, X } from 'lucide-react';
import { buildRevealSteps, type RevealOrder, type RevealTeam } from '@noi/shared';
import { api } from '@/lib/api';
import type { IcpcCell, IoiCell, RevealData } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorBox, Spinner } from '@/components/common';
import { cn, score } from '@/lib/utils';
import { Balloon, ioiCellStyle } from '@/components/Balloon';
import { t } from '@/lib/i18n';

type Cell = IoiCell | IcpcCell;
type Start = 'FROZEN' | 'ZERO';

export function AdminRevealPage() {
  const { cid } = useParams();
  const q = useQuery({
    queryKey: ['admin-reveal', cid],
    queryFn: () => api.get<RevealData>(`/api/admin/contests/${cid}/reveal`),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const [start, setStart] = useState<Start | null>(null);
  if (q.isLoading) return <Spinner className="mt-24" />;
  if (q.error || !q.data) return <div className="container py-6"><ErrorBox error={q.error} /></div>;
  if (!start) return <RevealSetup d={q.data} onStart={setStart} onReload={() => q.refetch()} />;
  return <Revealer d={q.data} start={start} onExit={() => setStart(null)} />;
}

function hiddenCount(d: RevealData): number {
  let n = 0;
  for (const r of d.before.rows) {
    for (const p of d.before.problems) {
      const c = d.before.mode === 'IOI' ? r.ioi?.[p.id] : r.icpc?.[p.id];
      if (c && (typeof c.pending === 'number' ? c.pending > 0 : c.pending)) n++;
    }
  }
  return n;
}

function RevealSetup({ d, onStart, onReload }: { d: RevealData; onStart: (s: Start) => void; onReload: () => void }) {
  const hidden = hiddenCount(d);
  const hasFreeze = d.contest.freezeAt !== null;
  return (
    <div className="container max-w-2xl py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{d.contest.name} — {t('Score revealer')}</h1>
      <p className="mt-2 text-muted-foreground">
        {t('Reveals the final ranking from last place to first, one step per key press. Best shown full-screen on a projector. Only admins can open this page.')}
      </p>
      <div className="mt-6 grid gap-4">
        <Card className="p-5">
          <h2 className="font-semibold">{t('From the frozen scoreboard')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasFreeze
              ? t('Starts from what teams saw at the freeze. {n} hidden result(s) will be revealed, always working on the lowest team on the board (like the ICPC resolver).', { n: hidden })
              : t('This contest has no scoreboard freeze, so there is nothing hidden: each step just confirms the next team from the bottom.')}
          </p>
          <Button className="mt-4" onClick={() => onStart('FROZEN')}>{t('Start')}</Button>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">{t('From zero (all results hidden)')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('Every team starts at 0. Teams are revealed in order of final position, last place first; each step reveals one problem of the current team, and the winner is revealed last.')}
          </p>
          <Button className="mt-4" onClick={() => onStart('ZERO')}>{t('Start')}</Button>
        </Card>
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        {t('Keys')}: <b>{t('Space')}</b> / <b>→</b> {t('next')} · <b>←</b> {t('back')} · <b>End</b> {t('show final')} · <b>F</b> {t('full-screen')} · <b>Esc</b> {t('leave full-screen')}. {t('Results are loaded when this page opens:')}{' '}
        <button className="underline" onClick={onReload}>{t('reload them')}</button> {t('if judging changed since.')}
      </p>
      <Button variant="outline" className="mt-4" asChild>
        <Link to={`/admin/contests/${d.contest.id}`}>{t('Back to contest')}</Link>
      </Button>
    </div>
  );
}

function zeroCell(c: Cell, ioi: boolean): Cell {
  if (ioi) {
    const x = c as IoiCell;
    return { scoreCenti: 0, attempts: 0, pending: x.attempts };
  }
  const x = c as IcpcCell;
  const attempts = x.rejected + (x.solved ? 1 : 0) + x.pendingCount;
  return { solved: false, rejected: 0, penaltyMinutes: 0, solveMinute: null, acElapsedMs: null, pending: attempts > 0, pendingCount: attempts, firstSolve: false };
}

const ROW_H = 60;

function Revealer({ d, start, onExit }: { d: RevealData; start: Start; onExit: () => void }) {
  const ioi = d.after.mode === 'IOI';
  const problems = d.after.problems;
  const maxPrec = Math.max(0, ...problems.map((p) => p.scorePrecision));
  const info = useMemo(() => new Map(d.after.rows.map((r) => [r.userId, r])), [d]);
  const steps = useMemo(() => {
    const before = new Map(d.before.rows.map((r) => [r.userId, r]));
    const teams: RevealTeam<Cell>[] = d.after.rows.map((r) => {
      const after = (ioi ? r.ioi : r.icpc) as Record<string, Cell>;
      const b = before.get(r.userId);
      const frozen = ((ioi ? b?.ioi : b?.icpc) ?? after) as Record<string, Cell>;
      return {
        userId: r.userId,
        displayName: r.displayName,
        after,
        before: start === 'ZERO' ? Object.fromEntries(Object.entries(after).map(([pid, c]) => [pid, zeroCell(c, ioi)])) : frozen,
      };
    });
    const order: RevealOrder = start === 'ZERO' ? 'FINAL_RANK' : 'CURRENT_RANK';
    return buildRevealSteps<Cell>(d.after.mode, problems.map((p) => p.id), teams, order);
  }, [d, ioi, problems, start]);

  const [i, setI] = useState(0);
  const step = steps[i];
  const last = steps.length - 1;
  const next = useCallback(() => setI((v) => Math.min(last, v + 1)), [last]);
  const prev = useCallback(() => setI((v) => Math.max(0, v - 1)), []);
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ([' ', 'Enter', 'ArrowRight', 'ArrowDown', 'PageDown'].includes(e.key)) next();
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) prev();
      else if (e.key === 'End') setI(last);
      else if (e.key === 'Home') setI(0);
      else if (e.key === 'f' || e.key === 'F') fullscreen();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, last]);

  const pos = useMemo(() => new Map(step.order.map((r, k) => [r.userId, { k, rank: r.rank }])), [step]);
  const finalized = useMemo(() => new Set(step.finalized), [step]);
  const boardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const p = step.focus && pos.get(step.focus.userId);
    if (!p || !boardRef.current) return;
    const top = boardRef.current.getBoundingClientRect().top + window.scrollY + p.k * ROW_H;
    window.scrollTo({ top: Math.max(0, top - window.innerHeight / 2), behavior: 'smooth' });
  }, [step, pos]);

  const cols = `4rem minmax(12rem,1fr) repeat(${problems.length}, 5.5rem) ${ioi ? '7rem' : '5rem 6rem'}`;
  const focusTeam = step.focus ? info.get(step.focus.userId) : null;

  return (
    <div className="min-h-screen bg-background pb-[50vh]">
      <div className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center gap-3 px-6 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xl font-semibold">{d.contest.name}</div>
            <div className="truncate text-sm text-muted-foreground">
              {i === 0 ? t('Press Space to start') : i === last ? t('Final ranking') : focusTeam ? `${focusTeam.displayName}${step.focus?.problemId ? ` — ${problems.find((p) => p.id === step.focus!.problemId)?.code}` : ` — ${t('final position')}`}` : ''}
              <span className="ml-2 text-xs">({i}/{last})</span>
            </div>
          </div>
          <Button variant="outline" size="icon" onClick={prev} disabled={i === 0} title={`${t('Back')} (←)`}><ChevronLeft /></Button>
          <Button size="icon" onClick={next} disabled={i === last} title={`${t('Next')} (${t('Space')})`}><ChevronRight /></Button>
          <Button variant="outline" size="icon" onClick={() => setI(last)} title={`${t('Show final')} (End)`}><ChevronsRight /></Button>
          <Button variant="ghost" size="icon" onClick={fullscreen} title={`${t('Full-screen')} (F)`}><Maximize /></Button>
          <Button variant="ghost" size="icon" onClick={onExit} title={t('Back to setup')}><X /></Button>
        </div>
        <div className="grid items-center gap-2 px-6 pb-2 text-sm font-medium text-muted-foreground" style={{ gridTemplateColumns: cols }}>
          <div className="text-center">{t('Rank')}</div>
          <div>{t('Team')}</div>
          {problems.map((p) => (
            <div key={p.id} className="flex flex-col items-center" title={p.title}>
              <Balloon color={p.color} className="h-6" />
              {p.code}
            </div>
          ))}
          {ioi ? <div className="text-right">{t('Total')}</div> : <><div className="text-center">{t('Solved')}</div><div className="text-right">{t('Penalty')}</div></>}
        </div>
      </div>
      <div ref={boardRef} className="relative mx-6 mt-2" style={{ height: step.order.length * ROW_H }}>
        {d.after.rows.map((r) => {
          const p = pos.get(r.userId)!;
          const cells = step.cells[r.userId];
          const isFocus = step.focus?.userId === r.userId;
          const done = finalized.has(r.userId);
          const showRank = start === 'FROZEN' || done;
          let total = 0;
          let solved = 0;
          let penalty = 0;
          for (const c of Object.values(cells)) {
            if (ioi) total += (c as IoiCell).scoreCenti;
            else if ((c as IcpcCell).solved) {
              solved++;
              penalty += (c as IcpcCell).penaltyMinutes;
            }
          }
          return (
            <div
              key={r.userId}
              className={cn(
                'absolute inset-x-0 grid items-center gap-2 rounded-lg border px-0 text-lg transition-[transform,background-color] duration-700 ease-in-out',
                isFocus ? 'z-10 border-primary bg-primary/10 shadow-lg' : done ? 'bg-card' : 'bg-muted/40',
              )}
              style={{ gridTemplateColumns: cols, height: ROW_H - 6, transform: `translateY(${p.k * ROW_H}px)` }}
            >
              <div className={cn('text-center font-mono text-2xl font-bold', !showRank && 'text-muted-foreground/40', done && p.rank <= 3 && 'text-amber-500')}>
                {showRank ? p.rank : '–'}
              </div>
              <div className="min-w-0">
                <div className="truncate font-semibold">{r.displayName}</div>
                {r.organization && <div className="truncate text-xs text-muted-foreground">{r.organization}</div>}
              </div>
              {problems.map((pr) => {
                const c = cells[pr.id];
                const flash = isFocus && step.focus?.problemId === pr.id;
                return (
                  <div
                    key={pr.id + (flash ? `:${i}` : '')}
                    className={cn('flex h-10 items-center justify-center rounded-md font-mono', cellClass(c, ioi), flash && 'animate-in zoom-in-50 ring-4 ring-amber-400 duration-500')}
                    style={ioi ? cellStyle(c as IoiCell, pr.maxScoreCenti, pr.color) : undefined}
                  >
                    {renderCell(c, ioi, pr.scorePrecision, pr.color)}
                  </div>
                );
              })}
              {ioi ? (
                <div className="pr-4 text-right font-mono text-2xl font-bold">{score(total, maxPrec)}</div>
              ) : (
                <>
                  <div className="text-center font-mono text-2xl font-bold">{solved}</div>
                  <div className="pr-4 text-right font-mono">{penalty}</div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function cellClass(c: Cell, ioi: boolean): string {
  if (ioi) {
    const x = c as IoiCell;
    return x.pending > 0 && x.scoreCenti === 0 ? 'bg-sky-500/20' : '';
  }
  const x = c as IcpcCell;
  return x.solved ? 'bg-emerald-500/25' : x.pending ? 'bg-sky-500/20' : x.rejected ? 'bg-red-500/15' : '';
}

function cellStyle(c: IoiCell, max: number | null, color: string) {
  return c.pending > 0 && c.scoreCenti === 0 ? undefined : ioiCellStyle(c.scoreCenti, max, color);
}

function renderCell(c: Cell, ioi: boolean, precision: number, color: string) {
  if (ioi) {
    const x = c as IoiCell;
    if (x.attempts === 0 && x.pending === 0) return <span className="text-muted-foreground">·</span>;
    return (
      <>
        {x.attempts > 0 ? score(x.scoreCenti, precision) : ''}
        {x.pending > 0 && <span className="ml-1 text-sm text-muted-foreground">?</span>}
      </>
    );
  }
  const x = c as IcpcCell;
  if (x.solved) return <span className="flex items-center gap-1 text-base font-semibold"><Balloon color={color} />+{x.rejected || ''} <span className="text-xs font-normal">{x.solveMinute}</span></span>;
  if (x.pending) return <span className="text-base">?{x.rejected ? ` -${x.rejected}` : ''}</span>;
  if (x.rejected) return <span className="text-base font-semibold">-{x.rejected}</span>;
  return '';
}
