import { EventEmitter } from 'node:events';

/**
 * In-process event bus feeding Server-Sent Events. The API runs as a single replica
 * (workers scale independently), so no cross-process fan-out is needed.
 */
export interface BusEvent {
  type: 'submission' | 'scoreboard' | 'announcement' | 'queue';
  contestId: string | null;
  /** If set, only this user (and admins) receive the event. */
  userId?: string;
  data: unknown;
}

export const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publish(e: BusEvent): void {
  bus.emit('event', e);
}
