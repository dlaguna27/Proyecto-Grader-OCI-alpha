/**
 * End-to-end sandbox self-test. Runs real submissions through isolate and checks verdicts.
 * Usage (inside the worker container): node dist/selftest.js
 */
import { PPM, type JudgeJob, type TestVerdict } from '@noi/shared';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { DirFileSource } from './files.js';
import { judge, makeSlot } from './judge.js';
import { writeIsolateConfig } from './setup.js';

const CPP_AB = `#include <bits/stdc++.h>
int main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}`;
const PY_AB = `a, b = map(int, input().split())\nprint(a + b)`;
const CPP_WA = `#include <cstdio>\nint main(){long long a,b;scanf("%lld %lld",&a,&b);printf("%lld\\n",a-b);}`;
const CPP_TLE = `int main(){volatile unsigned long long x=0;for(;;)x++;}`;
const PY_TLE = `while True:\n    pass`;
const CPP_MLE = `#include <bits/stdc++.h>
int main(){std::vector<char> v(600u<<20);for(size_t i=0;i<v.size();i+=4096)v[i]=1;std::cout<<(int)v[4096];}`;
const CPP_RE = `int main(){volatile int*p=nullptr;*p=1;return 0;}`;
const PY_RE = `raise SystemExit(3)`;
const CPP_CE = `int main(){ this is not c++ }`;
const PY_CE = `def f(:\n  pass`;
const CPP_FORK = `#include <unistd.h>
#include <cstdio>
int main(){int ok=0;for(int i=0;i<100;i++){pid_t p=fork();if(p==0){for(;;);}if(p>0)ok++;}long long a,b;scanf("%lld %lld",&a,&b);printf("%lld\\n",a+b);return ok;}`;
const PY_NET = `import socket\ns=socket.create_connection(("1.1.1.1",80),timeout=2)\nprint(3)`;
const CPP_CPP20 = `#include <bits/stdc++.h>
#include <ranges>
int main(){long long a,b;std::cin>>a>>b;auto v=std::views::iota(0,1);std::cout<<a+b+std::ranges::distance(v)-1<<"\\n";}`;

const CHECKER_PARTIAL = `#include "testlib.h"
int main(int argc,char*argv[]){registerTestlibCmd(argc,argv);
 long long want=ans.readLong(); long long got=ouf.readLong();
 if(got==want) quitf(_ok,"exact");
 if(got==want+1||got==want-1) quitp(0.5,"off by one");
 quitf(_wa,"expected %lld got %lld",want,got);}`;

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
const CPP_GUESS = `#include <bits/stdc++.h>
int main(){int lo=1,hi=1000000000;while(true){int m=lo+(hi-lo)/2;std::cout<<m<<std::endl;std::string r;std::cin>>r;if(r=="=")return 0;if(r=="<")lo=m+1;else hi=m-1;}}`;
const PY_GUESS = `import sys
lo, hi = 1, 10**9
while True:
    m = (lo + hi) // 2
    print(m, flush=True)
    r = sys.stdin.readline().strip()
    if r == "=":
        break
    if r == "<":
        lo = m + 1
    else:
        hi = m - 1`;
const CPP_GUESS_WASTEFUL = `#include <bits/stdc++.h>
int main(){std::string r;for(int i=0;i<5;i++){std::cout<<1<<std::endl;std::cin>>r;if(r=="=")return 0;}
int lo=1,hi=1000000000;while(true){int m=lo+(hi-lo)/2;std::cout<<m<<std::endl;std::cin>>r;if(r=="=")return 0;if(r=="<")lo=m+1;else hi=m-1;}}`;
const CPP_GUESS_WRONG = `#include <bits/stdc++.h>
int main(){std::string r;for(int i=0;i<41;i++){std::cout<<1<<std::endl;std::cin>>r;if(r=="=")return 0;}}`;
const CPP_GUESS_NOFLUSH = `#include <cstdio>
int main(){char r[8];printf("500000000\\n");scanf("%7s",r);return 0;}`;
const CPP_GUESS_QUIT = `int main(){return 0;}`;
const CPP_GUESS_BUSY = `#include <iostream>
int main(){std::cout<<1<<std::endl;volatile unsigned long long x=0;for(;;)x++;}`;
const CPP_GUESS_CRASH = `#include <iostream>
int main(){std::cout<<1<<std::endl;std::string r;std::cin>>r;volatile int*p=nullptr;*p=1;}`;

interface Case {
  name: string;
  job: Partial<JudgeJob>;
  expect: { status: 'DONE' | 'CE' | 'SE'; verdicts?: TestVerdict[]; fractions?: number[] };
}

async function main() {
  await writeIsolateConfig();
  const root = path.join(config.cacheDir, 'selftest');
  await fs.rm(root, { recursive: true, force: true });
  const files = new DirFileSource(path.join(root, 'files'));
  const put = (s: string) => files.put(s);

  const abTests = [
    { id: 't1', inputSha: await put('1 2\n'), answerSha: await put('3\n') },
    { id: 't2', inputSha: await put('1000000000000 5\n'), answerSha: await put('1000000000005\r\n') },
  ];
  const guessTests = [
    { id: 'g1', inputSha: await put('1\n'), answerSha: null },
    { id: 'g2', inputSha: await put('777777777\n'), answerSha: null },
  ];
  const checker = await put(CHECKER_PARTIAL);
  const interactor = await put(INTERACTOR);

  const batch = async (language: 'cpp' | 'python', src: string): Promise<Partial<JudgeJob>> => ({
    problemType: 'BATCH', language, sourceSha: await put(src), tests: abTests,
  });
  const inter = async (language: 'cpp' | 'python', src: string): Promise<Partial<JudgeJob>> => ({
    problemType: 'INTERACTIVE', language, sourceSha: await put(src), tests: guessTests, interactorSha: interactor,
  });

  const cases: Case[] = [
    { name: 'batch C++ AC', job: await batch('cpp', CPP_AB), expect: { status: 'DONE', verdicts: ['AC', 'AC'] } },
    { name: 'batch C++20 features AC', job: await batch('cpp', CPP_CPP20), expect: { status: 'DONE', verdicts: ['AC', 'AC'] } },
    { name: 'batch Python AC', job: await batch('python', PY_AB), expect: { status: 'DONE', verdicts: ['AC', 'AC'] } },
    { name: 'batch C++ WA', job: await batch('cpp', CPP_WA), expect: { status: 'DONE', verdicts: ['WA', 'WA'] } },
    { name: 'batch C++ TLE', job: await batch('cpp', CPP_TLE), expect: { status: 'DONE', verdicts: ['TLE', 'TLE'] } },
    { name: 'batch Python TLE', job: await batch('python', PY_TLE), expect: { status: 'DONE', verdicts: ['TLE', 'TLE'] } },
    { name: 'batch C++ MLE', job: await batch('cpp', CPP_MLE), expect: { status: 'DONE', verdicts: ['MLE', 'MLE'] } },
    { name: 'batch C++ RE (segfault)', job: await batch('cpp', CPP_RE), expect: { status: 'DONE', verdicts: ['RE', 'RE'] } },
    { name: 'batch Python RE', job: await batch('python', PY_RE), expect: { status: 'DONE', verdicts: ['RE', 'RE'] } },
    { name: 'C++ compile error', job: await batch('cpp', CPP_CE), expect: { status: 'CE' } },
    { name: 'Python syntax error', job: await batch('python', PY_CE), expect: { status: 'CE' } },
    { name: 'fork bomb is contained', job: await batch('cpp', CPP_FORK), expect: { status: 'DONE', verdicts: ['AC', 'AC'] } },
    { name: 'network is blocked', job: await batch('python', PY_NET), expect: { status: 'DONE', verdicts: ['RE', 'RE'] } },
    {
      name: 'ICPC stops at first failure',
      job: { ...(await batch('cpp', CPP_WA)), stopOnFirstFailure: true },
      expect: { status: 'DONE', verdicts: ['WA', 'SKIPPED'] },
    },
    {
      name: 'IOI skips tests of a failed MIN subtask',
      job: {
        ...(await batch('cpp', CPP_WA)),
        tests: [...abTests, { id: 't3', inputSha: await put('2 2\n'), answerSha: await put('4\n') }],
        subtasks: [
          { testIds: ['t1', 't2'], scoring: 'MIN' },
          { testIds: ['t3'], scoring: 'MIN' },
        ],
      },
      expect: { status: 'DONE', verdicts: ['WA', 'SKIPPED', 'WA'] },
    },
    {
      name: 'custom checker with partial score',
      job: {
        problemType: 'BATCH', language: 'cpp',
        sourceSha: await put(`#include <cstdio>\nint main(){long long a,b;scanf("%lld %lld",&a,&b);printf("%lld\\n",a+b+(a==1));}`),
        tests: abTests, checker: { kind: 'CUSTOM', sourceSha: checker },
      },
      expect: { status: 'DONE', verdicts: ['PA', 'AC'], fractions: [PPM / 2, PPM] },
    },
    {
      name: 'float checker',
      job: {
        problemType: 'BATCH', language: 'python', sourceSha: await put('print(1/3)'),
        tests: [{ id: 'f1', inputSha: await put(''), answerSha: await put('0.333333\n') }],
        checker: { kind: 'FLOAT', epsilon: 1e-6 },
      },
      expect: { status: 'DONE', verdicts: ['AC'] },
    },
    {
      name: 'output-only: correct, wrong and missing files',
      job: {
        problemType: 'OUTPUT_ONLY', language: null, sourceSha: null,
        tests: [...abTests, { id: 't3', inputSha: await put('2 2\n'), answerSha: await put('4\n') }],
        outputs: { t1: await put('3'), t2: await put('7\n') },
      },
      expect: { status: 'DONE', verdicts: ['AC', 'WA', 'WA'] },
    },
    { name: 'interactive C++ AC', job: await inter('cpp', CPP_GUESS), expect: { status: 'DONE', verdicts: ['AC', 'AC'] } },
    { name: 'interactive Python AC', job: await inter('python', PY_GUESS), expect: { status: 'DONE', verdicts: ['AC', 'AC'] } },
    {
      name: 'interactive partial points',
      job: await inter('cpp', CPP_GUESS_WASTEFUL),
      expect: { status: 'DONE', verdicts: ['AC', 'PA'], fractions: [PPM, PPM / 2] },
    },
    { name: 'interactive WA (too many queries)', job: await inter('cpp', CPP_GUESS_WRONG), expect: { status: 'DONE', verdicts: ['AC', 'WA'] } },
    { name: 'interactive missing flush -> idleness TLE', job: await inter('cpp', CPP_GUESS_NOFLUSH), expect: { status: 'DONE', verdicts: ['TLE', 'TLE'] } },
    { name: 'interactive solution exits early -> WA', job: await inter('cpp', CPP_GUESS_QUIT), expect: { status: 'DONE', verdicts: ['WA', 'WA'] } },
    { name: 'interactive CPU TLE', job: await inter('cpp', CPP_GUESS_BUSY), expect: { status: 'DONE', verdicts: ['TLE', 'TLE'] } },
    { name: 'interactive crash -> RE', job: await inter('cpp', CPP_GUESS_CRASH), expect: { status: 'DONE', verdicts: ['RE', 'RE'] } },
    {
      name: 'broken interactor -> system error',
      job: { ...(await inter('cpp', CPP_GUESS)), interactorSha: await put(`int main(){return 3;}`) },
      expect: { status: 'SE' },
    },
  ];

  const slot = makeSlot(90);
  let failed = 0;
  for (const c of cases) {
    const job: JudgeJob = {
      judgementId: c.name, token: 'selftest', problemType: 'BATCH', language: 'cpp', sourceSha: null, outputs: null,
      timeLimitMs: 1000, memoryLimitMb: 256, checker: { kind: 'TOKENS' }, interactorSha: null, tests: [],
      subtasks: null, stopOnFirstFailure: false, ...c.job,
    };
    const t0 = Date.now();
    const r = await judge(job, slot, files);
    const verdicts = r.tests.map((t) => t.verdict);
    let ok = r.status === c.expect.status;
    if (c.expect.verdicts) ok &&= JSON.stringify(verdicts) === JSON.stringify(c.expect.verdicts);
    if (c.expect.fractions) ok &&= JSON.stringify(r.tests.map((t) => t.fractionPpm)) === JSON.stringify(c.expect.fractions);
    if (!ok) failed++;
    const detail = r.tests.map((t) => `${t.verdict}(${t.timeMs ?? '-'}ms,${t.memoryKb ?? '-'}KB)`).join(' ');
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(48)} ${r.status} ${detail} [${Date.now() - t0} ms]`);
    if (!ok) console.log(`      expected ${JSON.stringify(c.expect)}; error=${r.error}; log=${r.compileLog?.slice(0, 300)}; msgs=${JSON.stringify(r.tests.map((t) => t.message))}`);
  }
  await fs.rm(root, { recursive: true, force: true });
  console.log(failed ? `\n${failed} of ${cases.length} self-test cases FAILED` : `\nAll ${cases.length} self-test cases passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
