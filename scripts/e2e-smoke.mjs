// End-to-end smoke test against a running stack.
// Usage: node scripts/e2e-smoke.mjs [baseUrl] (env: ADMIN_USER, ADMIN_PASSWORD)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const yazl = require('yazl');

const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const ADMIN_USER = process.env.ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'adminpass';
const tag = Date.now().toString(36);
let failures = 0;

class Client {
  cookie = '';
  async req(method, path, body, isForm = false) {
    const headers = { 'x-noi-csrf': '1' };
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined && !isForm) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${typeof data === 'object' ? data.error : data}`);
    return data;
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b ?? {}); }
  put(p, b) { return this.req('PUT', p, b); }
  patch(p, b) { return this.req('PATCH', p, b); }
  form(p, fd) { return this.req('POST', p, fd, true); }
}

function zipOf(files) {
  return new Promise((resolve, reject) => {
    const z = new yazl.ZipFile();
    for (const [name, content] of Object.entries(files)) z.addBuffer(Buffer.from(content), name);
    z.end();
    const chunks = [];
    z.outputStream.on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);
  });
}

function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${detail}`}`);
  if (!cond) failures++;
}

async function waitFor(client, sid, timeoutMs = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await client.get(`/api/submissions/${sid}`);
    if (['DONE', 'CE', 'SE'].includes(s.status)) return s;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`submission ${sid} not judged in time`);
}

async function submit(client, cid, pid, language, code) {
  const fd = new FormData();
  fd.set('language', language);
  fd.set('code', code);
  return (await client.form(`/api/contests/${cid}/problems/${pid}/submit`, fd)).id;
}

const SUM_AC = '#include <bits/stdc++.h>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}';
const SUM_SMALL = '#include <bits/stdc++.h>\nint main(){int a,b;std::cin>>a>>b;std::cout<<(a+b)<<"\\n";}'; // overflows on big tests
const SUM_PY = 'a,b=map(int,input().split())\nprint(a+b)';
const SUM_TLE = 'int main(){volatile long long x=0;for(;;)x++;}';
const SUM_CE = 'int main(){ return x; }';

const INTERACTOR = `#include "testlib.h"
#include <iostream>
using namespace std;
int main(int argc,char*argv[]){registerInteraction(argc,argv);
 int n=inf.readInt(); int q=0;
 while(true){ int g=ouf.readInt(1,1000000000,"guess"); q++;
   if(q>40) quitf(_wa,"too many queries");
   if(g==n){cout<<"="<<endl;break;}
   cout<<(g<n?"<":">")<<endl; }
 if(q<=30) quitf(_ok,"%d queries",q);
 quitp(0.5,"%d queries",q);}`;
const GUESS_PY = `lo, hi = 1, 10**9
while True:
    m = (lo + hi) // 2
    print(m, flush=True)
    r = input().strip()
    if r == "=":
        break
    if r == "<":
        lo = m + 1
    else:
        hi = m - 1`;

async function main() {
  const admin = new Client();
  await admin.post('/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  const now = Date.now();
  const window = { startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 3 * 3600_000).toISOString() };

  // ---------- IOI contest ----------
  const ioi = await admin.post('/api/admin/contests', { name: `Smoke IOI ${tag}`, scoringMode: 'IOI', ...window });
  check('IOI contest defaults to 50 submissions', ioi.maxSubmissionsPerTask === 50, JSON.stringify(ioi.maxSubmissionsPerTask));
  const sum = await admin.post(`/api/admin/contests/${ioi.id}/problems`, { code: 'sum', title: 'A+B', scorePrecision: 1, timeLimitMs: 1000 });
  const zip = await zipOf({
    'sample1.in': '1 2\n', 'sample1.out': '3\n',
    'tests/1.in': '2 3\n', 'tests/1.out': '5\n',
    'tests/2.in': '10 20\n', 'tests/2.out': '30\n',
    'tests/3.in': '2000000000 2000000000\n', 'tests/3.out': '4000000000\n',
    'tests/10.in': '1500000000 1500000000\n', 'tests/10.ans': '3000000000\n',
  });
  const fd = new FormData();
  fd.set('file', new Blob([zip]), 'tests.zip');
  const up = await admin.form(`/api/admin/problems/${sum.id}/tests`, fd);
  check('test zip upload pairs 5 tests (1 sample)', up.tests === 5 && up.samples === 1, JSON.stringify(up));
  await admin.put(`/api/admin/problems/${sum.id}/subtasks`, {
    subtasks: [
      { name: 'small', points: '37.5', scoring: 'MIN', tests: ['1', '2'] },
      { name: 'big', points: '62.5', scoring: 'MIN', tests: ['3', '10'] },
    ],
  });
  let bad = null;
  try { await admin.put(`/api/admin/problems/${sum.id}/subtasks`, { subtasks: [{ points: '1.25', tests: ['1'] }] }); } catch (e) { bad = e.message; }
  check('subtask points with too many decimals rejected', /not a valid score/.test(bad ?? ''), bad);

  const users = await admin.post('/api/admin/users/import', { csv: `username,password,displayName\nteam_${tag}_1,pass1234,Team One ${tag}\nteam_${tag}_2,,Team Two ${tag}`, contestId: ioi.id });
  check('CSV import created 2 accounts, generated a password', users.created.length === 2 && users.created[1].password.length >= 8, JSON.stringify(users));
  const t1 = new Client();
  await t1.post('/api/auth/login', { username: `team_${tag}_1`, password: 'pass1234' });
  const t2 = new Client();
  await t2.post('/api/auth/login', { username: `team_${tag}_2`, password: users.created[1].password });

  const prob = await t1.get(`/api/contests/${ioi.id}/problems/${sum.id}`);
  check('contestant sees sample and subtasks', prob.samples.length === 1 && prob.subtasks.length === 2 && prob.maxScoreCenti === 10000, JSON.stringify(prob).slice(0, 300));

  const s1 = await waitFor(t1, await submit(t1, ioi.id, sum.id, 'cpp', SUM_SMALL));
  check('IOI partial: int overflow gets 37.5', s1.status === 'DONE' && s1.scoreCenti === 3750, `${s1.status} ${s1.scoreCenti} ${s1.verdict}`);
  check('full feedback: per-test verdicts visible', s1.tests.length === 5 && s1.tests.every((t) => t.verdict) && s1.tests.every((t) => t.message === null), JSON.stringify(s1.tests));
  const s2 = await waitFor(t1, await submit(t1, ioi.id, sum.id, 'python', SUM_PY));
  check('IOI Python AC gets 100', s2.scoreCenti === 10000 && s2.verdict === 'AC', `${s2.scoreCenti} ${s2.verdict}`);
  const s3 = await waitFor(t2, await submit(t2, ioi.id, sum.id, 'cpp', SUM_CE));
  check('compile error reported with log', s3.status === 'CE' && (s3.compileLog ?? '').includes('error'), s3.status);
  const s4 = await waitFor(t2, await submit(t2, ioi.id, sum.id, 'cpp', SUM_TLE));
  check('TLE scores 0', s4.scoreCenti === 0 && s4.verdict === 'TLE', `${s4.scoreCenti} ${s4.verdict}`);

  const board = await admin.get(`/api/contests/${ioi.id}/scoreboard`);
  const r1 = board.rows.find((r) => r.username === `team_${tag}_1`);
  check('IOI scoreboard: team 1 rank 1 with 100', r1?.rank === 1 && r1.totalCenti === 10000, JSON.stringify(r1));
  check('balloon colors: ICPC preset by default', board.problems.every((p) => /^#[0-9a-f]{6}$/.test(p.color)) && board.problems[0].color === '#e53935', JSON.stringify(board.problems.map((p) => p.color)));
  await admin.patch(`/api/admin/contests/${ioi.id}`, { balloonPalette: 'CUSTOM' });
  await admin.patch(`/api/admin/problems/${board.problems[0].id}`, { balloonColor: '#123abc' });
  const board2 = await admin.get(`/api/contests/${ioi.id}/scoreboard`);
  check('balloon colors: custom color applied', board2.problems[0].color === '#123abc', board2.problems[0].color);

  // Changing subtasks rescored existing submissions without rejudging.
  await admin.put(`/api/admin/problems/${sum.id}/subtasks`, {
    subtasks: [{ name: 'all', points: '50', scoring: 'SUM', tests: ['1', '2', '3', '10'] }],
  });
  const s1b = await t1.get(`/api/submissions/${s1.id}`);
  check('subtask edit rescored: SUM 2/4 of 50 = 25', s1b.scoreCenti === 2500, String(s1b.scoreCenti));

  // Submission limit
  await admin.patch(`/api/admin/contests/${ioi.id}`, { maxSubmissionsPerTask: 3 });
  let limitErr = null;
  try { await submit(t1, ioi.id, sum.id, 'python', SUM_PY); await submit(t1, ioi.id, sum.id, 'python', SUM_PY); } catch (e) { limitErr = e.message; }
  check('submission limit enforced (3 per task)', /limit/i.test(limitErr ?? ''), limitErr);

  // ---------- Interactive + output-only problems ----------
  const guess = await admin.post(`/api/admin/contests/${ioi.id}/problems`, { code: 'guess', title: 'Guess', type: 'INTERACTIVE' });
  const gz = new FormData();
  gz.set('file', new Blob([await zipOf({ '1.in': '1\n', '2.in': '777777777\n' })]), 'g.zip');
  await admin.form(`/api/admin/problems/${guess.id}/tests`, gz);
  const ifd = new FormData();
  ifd.set('file', new Blob([INTERACTOR]), 'interactor.cpp');
  await admin.form(`/api/admin/problems/${guess.id}/interactor`, ifd);
  const g1 = await waitFor(t2, await submit(t2, ioi.id, guess.id, 'python', GUESS_PY));
  check('interactive Python AC = 100', g1.scoreCenti === 10000 && g1.verdict === 'AC', `${g1.status} ${g1.verdict} ${g1.scoreCenti} ${g1.error ?? ''}`);

  const oo = await admin.post(`/api/admin/contests/${ioi.id}/problems`, { code: 'oo', title: 'Output only', type: 'OUTPUT_ONLY' });
  const oz = new FormData();
  oz.set('file', new Blob([await zipOf({ 'a.in': '1\n', 'a.out': '2\n', 'b.in': '5\n', 'b.out': '10\n' })]), 'oo.zip');
  await admin.form(`/api/admin/problems/${oo.id}/tests`, oz);
  const inputs = await fetch(`${BASE}/api/contests/${ioi.id}/problems/${oo.id}/inputs.zip`, { headers: { cookie: t2.cookie } });
  check('output-only inputs.zip download', inputs.ok && (await inputs.arrayBuffer()).byteLength > 50);
  const ofd = new FormData();
  ofd.append('files', new Blob(['2\n']), 'a.out');
  ofd.append('files', new Blob(['11\n']), 'b.txt');
  const o1 = await waitFor(t2, (await t2.form(`/api/contests/${ioi.id}/problems/${oo.id}/submit`, ofd)).id);
  check('output-only: one of two correct = 50', o1.scoreCenti === 5000, `${o1.status} ${o1.scoreCenti} ${JSON.stringify(o1.tests.map((t) => t.verdict))}`);

  // ---------- ICPC contest ----------
  const icpc = await admin.post('/api/admin/contests', { name: `Smoke ICPC ${tag}`, scoringMode: 'ICPC', ...window });
  check('ICPC contest is unlimited by default', icpc.maxSubmissionsPerTask === null);
  const pa = await admin.post(`/api/admin/contests/${icpc.id}/problems`, { code: 'A', title: 'A+B' });
  const pz = new FormData();
  pz.set('file', new Blob([zip]), 'tests.zip');
  await admin.form(`/api/admin/problems/${pa.id}/tests`, pz);
  await admin.post(`/api/admin/contests/${icpc.id}/participants`, { allContestants: true });
  const c1 = await waitFor(t1, await submit(t1, icpc.id, pa.id, 'cpp', SUM_SMALL));
  check('ICPC rejected with WA, later tests skipped', c1.verdict === 'WA' && c1.tests.some((t) => t.verdict === 'SKIPPED'), `${c1.verdict} ${JSON.stringify(c1.tests.map((t) => t.verdict))}`);
  const c2 = await waitFor(t1, await submit(t1, icpc.id, pa.id, 'cpp', SUM_CE));
  check('ICPC CE', c2.status === 'CE');
  const c3 = await waitFor(t1, await submit(t1, icpc.id, pa.id, 'cpp', SUM_AC));
  check('ICPC AC', c3.verdict === 'AC', c3.verdict);
  const ib = await admin.get(`/api/contests/${icpc.id}/scoreboard`);
  const ir = ib.rows.find((r) => r.username === `team_${tag}_1`);
  const cell = ir?.icpc?.[pa.id];
  check('ICPC board: solved 1, 1 rejected (CE not counted), penalty = minute + 20', ir?.solved === 1 && cell.rejected === 1 && ir.penalty === cell.solveMinute + 20 && ir.rank === 1, JSON.stringify(ir));

  // Freeze hides later results from the public board but not from the admin board.
  await admin.patch(`/api/admin/contests/${icpc.id}`, { freezeAt: new Date(Date.now() - 1000).toISOString() });
  await waitFor(t2, await submit(t2, icpc.id, pa.id, 'cpp', SUM_AC));
  const pub = await t2.get(`/api/contests/${icpc.id}/scoreboard`);
  const full = await admin.get(`/api/contests/${icpc.id}/scoreboard`);
  const pubCell = pub.rows.find((r) => r.username === `team_${tag}_2`).icpc[pa.id];
  const fullCell = full.rows.find((r) => r.username === `team_${tag}_2`).icpc[pa.id];
  check('freeze: public board shows pending, admin board shows solved', pub.frozen && pubCell.pending && !pubCell.solved && fullCell.solved, JSON.stringify({ pubCell, fullCell }));

  const histPub = await t2.get(`/api/contests/${icpc.id}/history`);
  const histFull = await admin.get(`/api/contests/${icpc.id}/history`);
  const hs = histFull.series.find((x) => x.username === `team_${tag}_1`);
  check(
    'rank history: one point per minute, capped at the freeze for teams',
    hs && hs.ranks.length === histFull.lastMinute + 1 && hs.scores.at(-1) === 1 && histPub.frozen && histPub.lastMinute <= histFull.lastMinute,
    JSON.stringify({ lastMinute: histFull.lastMinute, pub: histPub.lastMinute, hs }),
  );
  const reveal = await admin.get(`/api/admin/contests/${icpc.id}/reveal`);
  const rb = reveal.before.rows.find((r) => r.username === `team_${tag}_2`).icpc[pa.id];
  const ra = reveal.after.rows.find((r) => r.username === `team_${tag}_2`).icpc[pa.id];
  check('reveal: before = frozen (pending), after = solved', rb.pending && !rb.solved && ra.solved && typeof ra.acElapsedMs === 'number', JSON.stringify({ rb, ra }));
  const denied = await t2.get(`/api/admin/contests/${icpc.id}/reveal`).then(() => null, (e) => e.message);
  check('reveal is admin-only', /40[13]/.test(denied ?? ''), denied);

  // Single session per contestant account
  const again = new Client();
  await again.post('/api/auth/login', { username: `team_${tag}_1`, password: 'pass1234' });
  const me = await t1.get('/api/auth/me');
  check('second login logs out the first computer', me.user === null, JSON.stringify(me));

  const csv = await admin.get(`/api/admin/contests/${ioi.id}/results.csv`);
  check('results CSV export', typeof csv === 'string' && csv.includes(`team_${tag}_1`));

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll smoke checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
