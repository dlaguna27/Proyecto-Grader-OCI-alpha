import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/** Subscribes to server-sent events and refreshes the matching queries. */
export function useLiveUpdates(contestId: string | null | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    const es = new EventSource(`/api/events${contestId ? `?contestId=${encodeURIComponent(contestId)}` : ''}`);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounce = (fn: () => void) => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, 400);
    };
    es.addEventListener('submission', (e) => {
      const data = JSON.parse((e as MessageEvent).data || 'null') as { id?: string } | null;
      if (data?.id) qc.invalidateQueries({ queryKey: ['submission', data.id] });
      debounce(() => {
        qc.invalidateQueries({ queryKey: ['submissions'] });
        qc.invalidateQueries({ queryKey: ['contest'] });
        qc.invalidateQueries({ queryKey: ['admin-queue'] });
      });
    });
    es.addEventListener('scoreboard', () => debounce(() => qc.invalidateQueries({ queryKey: ['scoreboard'] })));
    es.addEventListener('announcement', (e) => {
      const a = JSON.parse((e as MessageEvent).data || 'null') as { title: string; body: string } | null;
      if (a) toast.info(a.title, { description: a.body, duration: 30_000 });
      qc.invalidateQueries({ queryKey: ['contest'] });
    });
    return () => {
      es.close();
      if (timer) clearTimeout(timer);
    };
  }, [contestId, qc]);
}
