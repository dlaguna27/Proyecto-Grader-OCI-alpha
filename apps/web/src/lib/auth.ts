import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api';
import type { Me } from './types';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ user: Me | null; serverTime: string }>('/api/auth/me'),
    staleTime: 60_000,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api.post('/api/auth/logout');
    qc.clear();
    window.location.href = '/login';
  };
}

let clockOffset = 0;
/** Server-synchronized clock so countdowns are correct even if the contestant PC clock is wrong. */
export function setServerTime(iso: string) {
  clockOffset = new Date(iso).getTime() - Date.now();
}
export function serverNow(): number {
  return Date.now() + clockOffset;
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
