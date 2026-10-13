import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';
import { api } from '@/lib/api';
import type { Me } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { ErrorBox } from '@/components/common';
import { lang, setLang, t } from '@/lib/i18n';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api.post<Me>('/api/auth/login', { username, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
      nav(me.role === 'ADMIN' ? '/admin' : '/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 p-4 dark:from-slate-950 dark:to-slate-900">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 rounded-full bg-primary/10 p-3">
            <Trophy className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="text-xl">{t('National Olympiad in Informatics')}</CardTitle>
          <CardDescription>{t('Sign in with the account given to your team')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <Field label={t('Username')}>
              <Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
            <Field label={t('Password')}>
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <ErrorBox error={error} />
            <Button className="w-full" disabled={busy || !username || !password}>
              {busy ? t('Signing in…') : t('Sign in')}
            </Button>
          </form>
          <button type="button" className="mt-4 w-full text-center text-xs text-muted-foreground hover:underline" onClick={() => setLang(lang === 'es' ? 'en' : 'es')}>
            {lang === 'es' ? 'English' : 'Español'}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
