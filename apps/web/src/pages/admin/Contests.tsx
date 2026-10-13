import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ErrorBox, PageHeader, Spinner } from '@/components/common';
import { fmtTime, fromLocalInput, toLocalInput } from '@/lib/utils';
import { t } from '@/lib/i18n';

interface AdminContest {
  id: string;
  name: string;
  scoringMode: 'IOI' | 'ICPC';
  startsAt: string;
  endsAt: string;
  visible: boolean;
  _count: { problems: number; participants: number; submissions: number };
}

export function AdminContestsPage() {
  const q = useQuery({ queryKey: ['admin-contests'], queryFn: () => api.get<AdminContest[]>('/api/admin/contests') });
  const [open, setOpen] = useState(false);
  if (q.isLoading) return <Spinner />;
  const now = Date.now();
  return (
    <div>
      <PageHeader
        title={t('Contests')}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> {t('New contest')}
          </Button>
        }
      />
      <ErrorBox error={q.error} />
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>{t('Name')}</TH>
              <TH>{t('Mode')}</TH>
              <TH>{t('Window')}</TH>
              <TH>{t('Status')}</TH>
              <TH className="text-right">{t('Problems')}</TH>
              <TH className="text-right">{t('Teams')}</TH>
              <TH className="text-right">{t('Submissions')}</TH>
            </TR>
          </THead>
          <TBody>
            {q.data?.map((c) => {
              const s = new Date(c.startsAt).getTime();
              const e = new Date(c.endsAt).getTime();
              return (
                <TR key={c.id}>
                  <TD>
                    <Link to={`/admin/contests/${c.id}`} className="font-medium text-primary hover:underline">
                      {c.name}
                    </Link>
                    {!c.visible && <Badge variant="muted" className="ml-2">{t('hidden')}</Badge>}
                  </TD>
                  <TD>
                    <Badge variant={c.scoringMode === 'IOI' ? 'info' : 'warning'}>{c.scoringMode}</Badge>
                  </TD>
                  <TD className="text-xs text-muted-foreground">
                    {fmtTime(c.startsAt)} – {fmtTime(c.endsAt)}
                  </TD>
                  <TD>{now < s ? <Badge variant="muted">{t('Upcoming')}</Badge> : now < e ? <Badge variant="success">{t('In progress')}</Badge> : <Badge variant="secondary">{t('Finished')}</Badge>}</TD>
                  <TD className="text-right">{c._count.problems}</TD>
                  <TD className="text-right">{c._count.participants}</TD>
                  <TD className="text-right">{c._count.submissions}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        {q.data?.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{t('No contests yet. Create one to get started.')}</p>}
      </Card>
      <NewContestDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function NewContestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const nav = useNavigate();
  const start = new Date(Date.now() + 3600_000);
  start.setMinutes(0, 0, 0);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'IOI' | 'ICPC'>('IOI');
  const [startsAt, setStartsAt] = useState(toLocalInput(start));
  const [endsAt, setEndsAt] = useState(toLocalInput(new Date(start.getTime() + 5 * 3600_000)));
  const [error, setError] = useState<unknown>(null);
  const create = async () => {
    try {
      const c = await api.post<{ id: string }>('/api/admin/contests', { name, scoringMode: mode, startsAt: fromLocalInput(startsAt), endsAt: fromLocalInput(endsAt) });
      nav(`/admin/contests/${c.id}`);
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('New contest')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t('Name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="OCI 2026" />
          </Field>
          <Field
            label={t('Scoring mode')}
            hint={mode === 'IOI' ? t('Subtasks with partial scores; 50 submissions per task by default.') : t('Accepted/rejected with time penalty; unlimited submissions.')}
          >
            <NativeSelect value={mode} onChange={(e) => setMode(e.target.value as 'IOI' | 'ICPC')}>
              <option value="IOI">{t('IOI — subtasks and partial scoring')}</option>
              <option value="ICPC">{t('ICPC — binary scoring with penalty')}</option>
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('Starts')}>
              <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </Field>
            <Field label={t('Ends')}>
              <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </Field>
          </div>
          <ErrorBox error={error} />
        </div>
        <DialogFooter>
          <Button onClick={create} disabled={!name}>
            {t('Create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
