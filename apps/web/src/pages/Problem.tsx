import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Copy, Download, FileText, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { ProblemDetail, SubmissionItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { NativeSelect, Textarea } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ErrorBox, LanguageName, PageHeader, Spinner, StatusBadge } from '@/components/common';
import { fmtClock, score } from '@/lib/utils';

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-statement">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** Single-line Markdown + LaTeX (e.g. subtask descriptions like `$N \le 10^5$`). */
export function InlineMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={{ p: ({ children }) => <>{children}</> }}>
      {children}
    </ReactMarkdown>
  );
}

function SampleBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted-foreground">
        {title}
        <button
          className="rounded p-1 hover:bg-accent"
          title="Copy"
          onClick={() => {
            navigator.clipboard?.writeText(text);
            toast.success('Copied');
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-[13px]">{text}</pre>
    </div>
  );
}

export function ProblemPage() {
  const { cid, pid } = useParams();
  const q = useQuery({ queryKey: ['problem', pid], queryFn: () => api.get<ProblemDetail>(`/api/contests/${cid}/problems/${pid}`) });
  const subs = useQuery({
    queryKey: ['submissions', cid, pid],
    queryFn: () => api.get<SubmissionItem[]>(`/api/contests/${cid}/submissions?problemId=${pid}`),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const p = q.data;
  const base = `/api/contests/${cid}/problems/${pid}`;
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <div className="min-w-0">
        <PageHeader
          title={
            <span>
              <span className="font-mono text-muted-foreground">{p.code}</span> {p.title}
            </span>
          }
          subtitle={
            <span className="flex flex-wrap gap-2">
              {p.type !== 'OUTPUT_ONLY' && <Badge variant="outline">Time {p.timeLimitMs / 1000}s</Badge>}
              {p.type !== 'OUTPUT_ONLY' && <Badge variant="outline">Memory {p.memoryLimitMb} MB</Badge>}
              {p.type === 'INTERACTIVE' && <Badge variant="info">Interactive</Badge>}
              {p.type === 'OUTPUT_ONLY' && <Badge variant="info">Output-only</Badge>}
              {p.maxScoreCenti !== null && p.scoringMode === 'IOI' && <Badge variant="outline">{score(p.maxScoreCenti, p.scorePrecision)} points</Badge>}
            </span>
          }
          actions={
            <>
              {p.hasStatementFile && (
                <Button variant="outline" size="sm" asChild>
                  <a href={`${base}/statement`} target="_blank" rel="noreferrer">
                    <FileText /> Statement PDF
                  </a>
                </Button>
              )}
              {p.hasAttachments && (
                <Button variant="outline" size="sm" asChild>
                  <a href={`${base}/attachments`}>
                    <Download /> Attachments
                  </a>
                </Button>
              )}
            </>
          }
        />
        <Card>
          <CardContent className="pt-5">
            {p.statementMd ? (
              <Markdown>{p.statementMd}</Markdown>
            ) : p.hasStatementFile && p.statementType === 'application/pdf' ? (
              <iframe title="statement" src={`${base}/statement`} className="h-[80vh] w-full rounded-md border" />
            ) : (
              <p className="text-muted-foreground">No statement text.</p>
            )}
            {p.samples.length > 0 && (
              <div className="mt-6 space-y-4">
                <h3 className="text-lg font-semibold">Examples</h3>
                {p.samples.map((s) => (
                  <div key={s.name} className="flex flex-col gap-3 md:flex-row">
                    <SampleBlock title={`Input (${s.name})`} text={s.input} />
                    {s.output !== null && <SampleBlock title="Output" text={s.output} />}
                  </div>
                ))}
              </div>
            )}
            {p.subtasks.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 text-lg font-semibold">Subtasks</h3>
                <Table>
                  <THead>
                    <TR>
                      <TH>#</TH>
                      <TH>Description</TH>
                      <TH className="text-right">Points</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {p.subtasks.map((s) => (
                      <TR key={s.id}>
                        <TD>{s.ordinal}</TD>
                        <TD><InlineMarkdown>{s.name}</InlineMarkdown></TD>
                        <TD className="text-right font-mono">{score(s.pointsCenti, p.scorePrecision)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="space-y-6">
        <SubmitCard p={p} />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Your submissions</CardTitle>
          </CardHeader>
          <Table>
            <TBody>
              {(subs.data ?? []).slice(0, 15).map((s) => (
                <TR key={s.id}>
                  <TD className="text-xs text-muted-foreground">
                    <Link className="hover:underline" to={`/s/${s.id}`}>
                      {fmtClock(s.submittedAt)}
                    </Link>
                  </TD>
                  <TD className="text-xs">
                    <LanguageName lang={s.language} />
                  </TD>
                  <TD>
                    <Link to={`/s/${s.id}`}>
                      <StatusBadge status={s.status} verdict={s.verdict} done={s.progressDone} total={s.progressTotal} />
                    </Link>
                  </TD>
                  {p.scoringMode === 'IOI' && <TD className="text-right font-mono">{s.status === 'DONE' || s.status === 'CE' ? score(s.scoreCenti, p.scorePrecision) : ''}</TD>}
                </TR>
              ))}
              {subs.data?.length === 0 && (
                <TR>
                  <TD className="text-sm text-muted-foreground">No submissions yet.</TD>
                </TR>
              )}
            </TBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}

function SubmitCard({ p }: { p: ProblemDetail }) {
  const { cid, pid } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [lang, setLang] = useState(localStorage.getItem('lang') ?? p.languages[0] ?? 'cpp');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const outRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'paste' | 'file'>('paste');
  const base = `/api/contests/${cid}/problems/${pid}`;
  const remaining = p.submissionLimit === null ? null : p.submissionLimit - p.submissionsUsed;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      if (p.type === 'OUTPUT_ONLY') {
        const files = outRef.current?.files;
        if (!files?.length) throw new Error('Choose your output files (or one zip)');
        for (const f of Array.from(files)) fd.append('files', f, f.name);
      } else {
        fd.set('language', lang);
        localStorage.setItem('lang', lang);
        const f = fileRef.current?.files?.[0];
        if (mode === 'file') {
          if (!f) throw new Error('Choose a source file');
          fd.set('source', f, f.name);
        } else {
          if (!code.trim()) throw new Error('Paste your source code');
          fd.set('code', code);
        }
      }
      const r = await api.post<{ id: string }>(`${base}/submit`, fd);
      toast.success('Submitted');
      qc.invalidateQueries({ queryKey: ['submissions'] });
      qc.invalidateQueries({ queryKey: ['problem', pid] });
      nav(`/s/${r.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          Submit
          {remaining !== null && (
            <span className={remaining <= 5 ? 'text-sm text-destructive' : 'text-sm font-normal text-muted-foreground'}>
              {remaining} of {p.submissionLimit} left
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {p.type === 'OUTPUT_ONLY' ? (
          <>
            <Button variant="outline" className="w-full" asChild>
              <a href={`${base}/inputs.zip`}>
                <Download /> Download all inputs (.zip)
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">
              Upload one file per test named like <code className="font-mono">{p.outputOnlyTests[0] ?? 'NAME'}.out</code>, or a single zip with all of them. Tests
              without a file score 0.
            </p>
            <input ref={outRef} type="file" multiple className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5" />
          </>
        ) : (
          <>
            <div className="flex gap-2">
              <NativeSelect value={lang} onChange={(e) => setLang(e.target.value)} className="w-40">
                {p.languages.map((l) => (
                  <option key={l} value={l}>
                    {l === 'cpp' ? 'C++20 (g++)' : 'Python 3'}
                  </option>
                ))}
              </NativeSelect>
              <Tabs value={mode} onValueChange={(v) => setMode(v as 'paste' | 'file')}>
                <TabsList>
                  <TabsTrigger value="paste">Paste</TabsTrigger>
                  <TabsTrigger value="file">File</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {mode === 'paste' ? (
              <Textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                spellCheck={false}
                placeholder={lang === 'cpp' ? '#include <bits/stdc++.h>\nint main() { ... }' : 'print(...)'}
                className="h-72 font-mono text-[13px]"
                onKeyDown={(e) => {
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    const t = e.currentTarget;
                    const s = t.selectionStart;
                    setCode(code.slice(0, s) + '    ' + code.slice(t.selectionEnd));
                    requestAnimationFrame(() => (t.selectionStart = t.selectionEnd = s + 4));
                  }
                }}
              />
            ) : (
              <input
                ref={fileRef}
                type="file"
                accept=".cpp,.cc,.cxx,.py,.txt"
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5"
              />
            )}
            {p.type === 'INTERACTIVE' && <p className="text-xs text-muted-foreground">Remember to flush your output after every line (endl / flush=True).</p>}
          </>
        )}
        <ErrorBox error={error} />
        <Button className="w-full" onClick={send} disabled={busy || remaining === 0}>
          <Upload /> {busy ? 'Submitting…' : 'Submit'}
        </Button>
      </CardContent>
    </Card>
  );
}
