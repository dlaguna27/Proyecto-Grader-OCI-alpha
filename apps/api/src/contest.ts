import type { Contest, ContestParticipant } from '@prisma/client';

export interface Window {
  start: Date;
  end: Date;
}

/** A participant's personal window: contest window shifted by their start delay, plus extra time. */
export function participantWindow(contest: Contest, p: Pick<ContestParticipant, 'startDelay' | 'extraTime'> | null): Window {
  const delay = (p?.startDelay ?? 0) * 1000;
  const extra = (p?.extraTime ?? 0) * 1000;
  return {
    start: new Date(contest.startsAt.getTime() + delay),
    end: new Date(contest.endsAt.getTime() + delay + extra),
  };
}

export type Phase = 'BEFORE' | 'RUNNING' | 'AFTER';

export function phaseOf(w: Window, now = new Date()): Phase {
  if (now < w.start) return 'BEFORE';
  if (now >= w.end) return 'AFTER';
  return 'RUNNING';
}
