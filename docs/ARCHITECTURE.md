# NOI Contest Management System — Architecture Design

Status: **Approved** · Scope: v1 for the National Olympiad in Informatics

---

## 1. Goals and non-negotiables

| # | Requirement | How the design meets it |
|---|---|---|
| 1 | Administered from Windows, everything in Docker Compose | Single `docker compose up` on Docker Desktop (WSL2 backend). No host-side Linux tooling. |
| 2 | Onsite (offline LAN) and offsite (cloud) | Same images and compose file; two thin override files (`compose.onsite.yml`, `compose.cloud.yml`). No runtime internet dependency (no CDNs, fonts bundled, images exportable with `docker save`). |
| 3 | Languages: C++ (`g++ -O3`), Python 3 | Toolchains baked into the worker image, pinned versions. |
| 4 | Task types: Batch, Output-Only, Interactive | One grading pipeline with pluggable "run" and "evaluate" stages (§5). |
| 5 | Scoring: IOI (subtasks, partial) or ICPC (binary + penalty), chosen per contest | Scoring is a pure, deterministic function computed by the API from stored per-test results (§6, §7). |
| 6 | Web GUI for contestants and admins | Vite + React + Tailwind + shadcn/ui SPA; admin and contestant areas in the same app, role-gated. |

---

## 2. Technology choices

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Vite + React + TypeScript + Tailwind + shadcn/ui**, TanStack Query | Pure static SPA served by the reverse proxy: trivially works offline, no SSR server to operate. |
| API | **Node.js + TypeScript (Fastify)**, Zod validation, **Prisma** ORM | One language across frontend, API and worker; shared types for verdicts/scoring. |
| Queue | **BullMQ on Redis** | Mature, at-least-once delivery, stalled-job recovery, priorities, built-in dashboard data for the admin "grading queue" page. |
| Database | **PostgreSQL 16** | Source of truth for users, contests, problems, submissions, results. |
| Grading worker | Node.js (TypeScript) orchestrator + **`isolate`** sandbox (the sandbox used by IOI/CMS) | Battle-tested in real olympiads; per-run CPU/wall/memory/process limits, separate network/PID/mount namespaces. |
| Reverse proxy | **Caddy** | Serves SPA + proxies API; automatic HTTPS in cloud mode, plain HTTP or internal CA on LAN. |
| Real-time | Server-Sent Events from API (submission status, scoreboard, queue) | Simpler than WebSockets, works through proxies. |

---

## 3. Deployment topology

```
                        ┌──────────────────────────── docker compose ─────────────────────────────┐
 Contestant / Admin     │                                                                         │
 browser  ──HTTP(S)──▶  │  caddy ──▶ web (static SPA)                                              │
                        │    │                                                                    │
                        │    └──▶ api (Fastify) ──▶ postgres                                       │
                        │           │   ▲                                                         │
                        │           ▼   │ results                                                 │
                        │          redis (BullMQ)                                                 │
                        │           │   ▲                                                         │
                        │           ▼   │                                                         │
                        │   worker × N (privileged, isolate)  ── fetches test data by SHA-256 ──▶ api │
                        └─────────────────────────────────────────────────────────────────────────┘
 Networks:  `public` (caddy)   `backend` (caddy, api, postgres, redis)   `judge` (api, redis, worker)
```

Key isolation decisions:

- **Workers never get database credentials.** They only talk to Redis (jobs in, results out) and to an internal, token-authenticated API endpoint that serves test data / checker binaries by content hash. A sandbox escape on a worker therefore does not directly expose the DB.
- **Postgres and Redis are never published to the host** in cloud mode.
- **Named Docker volumes**, not Windows bind mounts, for Postgres data and the content-addressed file store (bind mounts from NTFS are slow and break Linux permissions).

### 3.1 Onsite (offline LAN)

- Server is a Windows machine running Docker Desktop; contestants reach it by LAN IP/hostname on port 80/443.
- Images are built (or pulled) once while online, then exported: `docker save … > noi-cms-images.tar` and loaded on the contest server with `docker load`. A PowerShell helper script will wrap this.
- `.wslconfig` guidance: dedicate CPU cores and RAM to the WSL2 VM; worker count = dedicated cores − 1.
- Optional: additional worker machines on the LAN run only the `worker` service, pointed at the main server's Redis/API.

### 3.2 Offsite (cloud: DigitalOcean / AWS)

- One Linux VM with Docker (same compose file + `compose.cloud.yml`), Caddy obtains a Let's Encrypt cert for the configured domain.
- Horizontal scaling: run extra worker-only VMs; they need just `REDIS_URL`, `API_INTERNAL_URL`, `WORKER_TOKEN`.
- Backups: scheduled `pg_dump` container to a volume (and optionally to S3/Spaces).

### 3.3 Windows-specific gotchas handled up front

- `.gitattributes` forces `eol=lf` for all scripts/Dockerfiles (CRLF shell scripts break containers).
- Uploaded test data and contestant outputs are normalized/compared with whitespace-insensitive checking by default, so CRLF from Windows-edited files does not cause false WA.
- Requires Docker Desktop with **WSL2 backend** (Hyper-V backend not supported for the privileged worker).

---

## 4. Sandbox and resource limits

Every untrusted program — contestant compilation, contestant execution, **and admin-supplied checkers/interactors** — runs inside its own `isolate` box.

| Limit | Contestant run | Compilation | Checker / Interactor |
|---|---|---|---|
| CPU time | problem TL | 10 s | 10 s (configurable) |
| Wall time | 2 × TL + 1 s | 20 s | contestant wall + 2 s |
| Memory (cgroup) | problem ML | 1 GiB | 1 GiB |
| Processes | 1 (C++), 1 (Python) | 32 | 1 |
| File size written | 64 MiB | 64 MiB | 64 MiB |
| Network | none (own netns) | none | none |
| Filesystem | box dir rw; `/usr`, `/lib` ro | same | same + test files ro |

Verdict mapping from isolate's `meta` file: `status=TO` → TLE, `cg-oom-killed` or `max-rss > ML` → MLE, `status=SG|RE` → RE (signal/exit code recorded), `status=XX` → **System Error** (never blamed on the contestant; auto-retried, then flagged to admins).

Compile commands (pinned in the worker image):

- C++: `g++ -O3 -std=gnu++20 -pipe -static -DONLINE_JUDGE -o sol sol.cpp -lm`
- Python 3: `python3 -m py_compile sol.py` (syntax errors → Compilation Error); run with `python3 sol.py`.

**cgroup v2 on Docker Desktop.** Docker Desktop's WSL2 VM uses cgroup v2. The worker entrypoint will run privileged with a private cgroup namespace, move itself into a child cgroup, enable `memory`, `pids`, `cpuset` controllers and point isolate (v2.x) at that subtree. This is the highest technical risk and is the **first thing built and validated in Phase 1**. Fallback if it misbehaves on a given host: isolate's non-cgroup mode (RLIMIT-based memory/process limits), which is sufficient for single-process C++/Python solutions.

**Timing fairness.** Each worker slot is pinned to a dedicated CPU core (cpuset), one judging job per core, and the contestant's **CPU time** (not wall time) is what's compared against TL.

---

## 5. Grading pipeline

### 5.1 Submission lifecycle

```
 contestant ──POST /submissions──▶ API
   API: validate (contest running, language allowed, size ≤ 64 KiB, rate limit)
        store source + create Submission + Judgement(attempt=1, status=QUEUED)   ← one DB transaction
        enqueue BullMQ job {judgementId, token}  (jobId = judgementId → deduplicated)
 worker: pull job → fetch problem bundle by SHA (cached locally) →
        COMPILING → RUNNING (per test) → returns raw per-test results
 API (result consumer): verify token + judgement still active →
        persist TestResults → compute scores (§6/§7) → status=DONE → push SSE update
```

- **Workers only report raw facts** (verdict, time, memory, checker fraction, message per test). **All score arithmetic happens in the API**, in one place, from persisted data. Rejudge = new Judgement row, old one kept for audit; the active judgement pointer flips atomically on completion.
- **At-least-once safety:** a job may be delivered twice (worker crash → BullMQ stalled-job requeue). The API accepts results only for the active `(judgementId, token)` pair and writes them in a single transaction with an `ON CONFLICT DO NOTHING` guard, so duplicates are harmless.
- **Problem bundles are versioned and content-addressed.** Uploading a new test zip creates a new problem version; a judgement records which version it used, making every result reproducible.

### 5.2 Batch

For each test: run `sol` in a fresh box with `input` as stdin, capture stdout → run checker in a separate box with `(input, contestant_output, expected_output)`.

Checkers:
- Default: token-by-token comparison, whitespace/line-ending insensitive.
- Optional: floating-point tolerance (abs/rel ε).
- Custom: **testlib-compatible** checker (`checker <input> <output> <answer>`), compiled once per problem version. Exit 0 = AC, 1 = WA, 2 = PE→WA, 3 = checker failure → System Error, 7 = partial, score parsed from the `points <x>` message on stderr (x ∈ [0,1]).

### 5.3 Output-Only

- Contestants download a zip of inputs from the task page.
- Submission = one upload per test (or a zip named `output_XX.txt`). No compilation/execution; only the checker runs (sandboxed).
- Missing file for a test → that test scores 0 ("No output"). In IOI mode the latest file per test can optionally be combined across submissions (CMS-style), configurable per task.

### 5.4 Interactive — detailed workflow

The contestant program and the admin-supplied **interactor** run **concurrently in two separate isolate boxes**, connected only by two anonymous pipes created by the worker.

```
              pipe A (contestant → interactor)
   ┌─────────────────┐  stdout ───────────────────▶ stdin  ┌──────────────────────┐
   │ contestant box  │                                      │ interactor box       │
   │  ./sol          │  stdin  ◀─────────────────── stdout  │  ./interactor        │
   └─────────────────┘   pipe B (interactor → contestant)   │   input.txt   (ro)   │
                                                            │   answer.txt  (ro)   │
                                                            │   → result.txt (rw)  │
                                                            └──────────────────────┘
```

**Interactor protocol (testlib-compatible):** `interactor input.txt result.txt answer.txt`; reads the secret test from `input.txt`, talks to the contestant over stdin/stdout, and reports via exit code (0 AC, 1 WA, 2 PE, 3 FAIL, 7 partial, score parsed from the `points <x>` message). Problem setters can therefore reuse standard testlib interactors unchanged.

**Step-by-step per test case:**

1. **Prepare** two fresh boxes (`isolate --init --cg`). Copy `sol` into box C; copy `interactor`, `input.txt`, `answer.txt` into box I. Box C never sees the input/answer files.
2. **Create pipes** `A = pipe()` and `B = pipe()` in the worker process.
3. **Spawn both** `isolate --run` processes nearly simultaneously:
   - C: `stdin = B.read`, `stdout = A.write`, stderr → file (size-capped, discarded for verdict).
   - I: `stdin = A.read`, `stdout = B.write`.
   isolate passes inherited stdin/stdout fds straight through to the sandboxed program, so no FIFOs on a shared filesystem are needed and the two boxes share nothing else.
4. **Close all four pipe ends in the worker immediately after spawning.** This is critical: if the worker kept a write end open, a reader would never see EOF and a dead peer would hang the other side until wall timeout.
5. **Limits:** C gets the problem CPU TL / ML; wall limit `2·TL + 1s` catches the "both sides blocked reading" deadlock (e.g. contestant forgot to `fflush`). I gets its own generous CPU limit; its CPU time is **never** charged to the contestant. A hard supervisor timeout (`max(wallC, wallI) + 2s`) kills both process groups regardless.
6. **Wait for both** to exit, parse both meta files.
7. **Resolve the verdict** with a fixed precedence table (evaluated top-down, first match wins):

| # | Condition | Verdict |
|---|---|---|
| 1 | Interactor sandbox error / exit 3 (FAIL) / interactor TLE or MLE | **System Error** (admin alerted, contestant not penalized; job retried once) |
| 2 | Contestant exceeded CPU TL | TLE |
| 3 | Contestant exceeded ML | MLE |
| 4 | Contestant killed by signal other than SIGPIPE, or nonzero exit | RE |
| 5 | Contestant hit wall limit while interactor was still running | TLE ("Idleness limit") |
| 6 | Interactor exit 1 / 2 | WA |
| 7 | Interactor exit 7 | Partial (fraction from the `points <x>` message, clamped to [0,1]) |
| 8 | Interactor exit 0 | AC |

   Notes: a contestant dying from **SIGPIPE** means the interactor closed its end first — that's the interactor's call, so we fall through to rows 6–8 (typically WA). If the interactor reports WA *and* the contestant also crashed, the contestant-side error (rows 2–4) wins, matching CMS/Codeforces conventions.
8. **Destroy** both boxes (`isolate --cleanup`) whether or not anything failed (`try/finally`).

Security properties: the contestant never has filesystem access to test data or answers; the interactor is also untrusted code (it's admin-written, but a buggy interactor must not be able to crash a worker or read other tests); pipes carry bytes only — no shared memory, no shared directory, no network.

### 5.5 Short-circuit and ordering

- Tests run in admin-defined order.
- **ICPC:** stop at the first non-AC test (the verdict is that test's verdict) — saves judge time.
- **IOI:** per subtask, once a test fails in a `min`-scored subtask, remaining tests *of that subtask only* are marked "Skipped" — unless a test also belongs to another subtask that still needs it.

---

## 6. IOI scoring

### 6.1 Model

- A problem version has `tests[]` and `subtasks[]`. Each subtask: `points` (up to the problem's `score_precision` decimals, see §6.5), `scoring` ∈ {`min` (all-or-nothing group, the IOI default), `sum` (proportional)}, and a list of test ids. A test may belong to multiple subtasks (e.g. the samples, or tests shared with a larger subtask).
- Admin UI enforces: every test belongs to ≥ 1 subtask, subtask points sum to the problem's max (e.g. 100), test ids exist.
- Submission limit: **50 submissions per task per contestant** in IOI mode (contest setting `max_submissions_per_task`, default 50 for IOI, unlimited for ICPC). Compilation errors count toward the limit; System Errors do not.

### 6.2 Arithmetic (exact, deterministic)

- Each test result stores a **fraction as an integer in parts-per-million** (`0 … 1_000_000`). AC = 1 000 000, WA/TLE/RE/MLE = 0, partial = `round(x · 10^6)` after clamping x to [0,1].
- Subtask score (in **hundredths of a point**, integer):
  - `min`: `points·100 · min(fractions) / 10^6`
  - `sum`: `points·100 · Σ fractions / (n · 10^6)`
  - floored once, at the subtask level, with integer division. No floating-point anywhere.
- Submission score = Σ subtask scores.
- Displayed as `score / 100` with two decimals.

### 6.3 Task score per contestant

Configurable per contest (default = current IOI rule):

- **Max per subtask across submissions** (IOI 2017+): task score = Σ over subtasks of the best score that subtask achieved in *any* of the contestant's submissions.
- **Best single submission**: task score = max over submissions of the submission score.

Total = Σ task scores. Ranking: total desc; ties share a rank. Compile errors and System Errors never count.

### 6.4 Feedback

Full feedback: during the contest contestants see, for each submission, every subtask's score and every test's verdict, time and memory (not the test data itself).

### 6.5 Decimal scoring (per problem)

Each problem has `score_precision` ∈ {0, 1, 2} — the number of decimal places used for its scores.

- `0` (integer scoring): subtask points must be integers; partial scores are floored to integers.
- `1` / `2` (decimal scoring): subtask points may have that many decimals (e.g. `12.5`, `33.33`); partial scores are floored to that precision.
- Internally every score is still an integer in **hundredths** (§6.2); the subtask score is floored to a multiple of `10^(2 − score_precision)` hundredths. Contest totals are displayed with the maximum precision of any problem in the contest.

### 6.6 Safety properties

- Pure function `scoreIOI(problemVersion, testResults) → {subtaskScores, total}` with property-based tests (monotonicity, `0 ≤ score ≤ max`, idempotence, order-independence of test results).
- Scores are **derived data**: stored for fast reads, but always recomputable from `TestResult` rows. Admin "Recompute" button rebuilds a contest's scores from scratch; a nightly/at-end consistency check compares stored vs recomputed.
- Changing subtask points after submissions exist triggers a recompute (no rejudge needed); changing tests requires a rejudge (new problem version).

---

## 7. ICPC scoring

### 7.1 Per submission

Binary: **Accepted** iff every test is AC (partial-capable checkers are treated as AC only at fraction = 1). Otherwise the verdict of the first failing test (WA/TLE/MLE/RE). Subtasks are ignored in ICPC mode.

### 7.2 Per contestant/team per problem

Process the contestant's judged submissions for that problem **ordered by submission time** (server-side `submitted_at`, millisecond precision, tie-broken by id):

- `solved` = exists an AC.
- `rejected_before_ac` = number of submissions before the first AC with verdict ∈ {WA, TLE, MLE, RE}. **Compilation Error and System Error do not count** (standard ICPC rule; configurable for CE).
- `penalty = floor((first_ac_time − contest_start) / 60 s) + penalty_per_reject (default 20) × rejected_before_ac`.
- Submissions after the first AC are ignored for scoring.

Totals: `solved_count = Σ solved`, `penalty_total = Σ penalty over solved problems`.

Ranking: `solved_count` desc → `penalty_total` asc → time of last accepted submission asc → shared rank.

### 7.3 Correctness under asynchronous judging

- **Pending submissions:** a later AC may be judged before an earlier WA. Because the computation re-derives the problem state from the full ordered list each time, the result is identical regardless of judging order. While any earlier submission is pending, the scoreboard cell shows "pending" and the penalty is provisional.
- **Rejudges** simply flip the active judgement and recompute the affected (contestant, problem) cell.
- **Time base:** contest start/end and per-contestant time offsets (for delayed starts) are stored in the DB; all times come from the API server clock, never from the client.
- **First-to-solve** is derived from the same data (earliest `first_ac_time` per problem).

### 7.4 Scoreboard freeze

Optional freeze time (e.g. last 60 minutes). After freeze, public scoreboard shows attempts as "pending" for other teams; admins always see the live board; an "Unfreeze" action (with optional ICPC-style reveal) publishes final results.

---

## 8. Data model (core tables)

```
users(id, username, password_hash, role[ADMIN|CONTESTANT], display_name, members, school, region)
       -- one account per team (a team may have a single member) = one computer
contests(id, name, scoring_mode[IOI|ICPC], starts_at, ends_at, freeze_at?,
         penalty_minutes, ioi_task_score_rule, max_submissions_per_task?, languages[], visible)
contest_participants(contest_id, user_id, time_offset_s, extra_time_s)
problems(id, contest_id, code, title, type[BATCH|OUTPUT_ONLY|INTERACTIVE], max_score_centi,
         score_precision[0|1|2], active_version_id)
problem_versions(id, problem_id, time_limit_ms, memory_limit_mb, checker_kind, checker_file_sha?,
                 interactor_file_sha?, statement_file_sha, created_at)
tests(id, version_id, ordinal, input_sha, answer_sha)
subtasks(id, version_id, ordinal, points_centi, scoring[min|sum])
subtask_tests(subtask_id, test_id)
submissions(id, contest_id, problem_id, user_id, language, source_sha | output_files, submitted_at)
judgements(id, submission_id, version_id, attempt, token, status, compile_log, active, started_at, finished_at)
test_results(judgement_id, test_id, verdict, fraction_ppm, time_ms, memory_kb, message)
subtask_results(judgement_id, subtask_id, score_centi)
files(sha256, size, storage_path)      -- content-addressed blob store on a volume
```

- `scoring_mode` is **locked once the contest has submissions** (prevents silently reinterpreting results).
- All score columns are integers (centi-points, ppm).

---

## 9. Admin panel (v1 scope)

- Contests: create/edit (IOI/ICPC toggle, times, freeze, penalty, languages), participant import from CSV, per-contestant extra time.
- Problems: statement (PDF/Markdown), type, TL/ML, checker/interactor upload, **test zip upload** (auto-pairs `*.in`/`*.out`, preview & reorder), **subtask editor** (drag tests into groups, points, scoring kind, validation that points sum to max), sample-solution test run before publishing.
- Grading queue monitor: live waiting/active/failed counts per worker, per-job progress, retry/cancel, System Error inbox.
- Submissions browser with filters, source view, per-test details; rejudge by submission/problem/contest.
- Scoreboards (live + public/frozen), CSV/JSON export of final results.
- Audit log of admin actions.

Contestant UI: task list & statements, submit (editor upload or paste), submission history with per-test/subtask feedback (feedback level configurable per contest), scoreboard, contest countdown, announcements.

---

## 10. Security summary

- Untrusted code only ever runs in isolate boxes inside the worker container; the worker container holds no DB credentials.
- Auth: Argon2id password hashes, HTTP-only secure session cookies, CSRF protection, role-based authorization on every admin route, login rate limiting.
- Uploads: size limits (source 64 KiB, test zip configurable, default 512 MiB), zip-slip and zip-bomb protection on extraction.
- Contestants can only see their own submissions and, per contest config, limited feedback (e.g. hide test data).
- Secrets via `.env` (never committed); `.env.example` documents them.

---

## 11. Repository layout

```
noi-cms/
  apps/web/           Vite + React + Tailwind + shadcn/ui
  apps/api/           Fastify + Prisma + BullMQ producer/consumer
  apps/worker/        Grading worker (isolate orchestration)
  packages/shared/    Types, verdicts, pure scoring functions (+ tests)
  docker/             Dockerfiles, Caddyfile, worker entrypoint (cgroup setup)
  compose.yml  compose.onsite.yml  compose.cloud.yml
  scripts/*.ps1       Windows helpers: start, stop, backup, export/import images for offline
  docs/
```

---

## 12. Delivery plan

1. **Phase 1 – Judge core (highest risk first):** worker image with isolate + g++ + Python, cgroup v2 setup on Docker Desktop, Batch + Interactive + Output-Only runners, verdict resolution, tests with known-good/bad solutions (AC, WA, TLE, MLE, RE, deadlock, SIGPIPE, malicious fork/network attempts).
2. **Phase 2 – API + DB + queue:** schema, auth, submissions, result consumer, IOI/ICPC scoring with unit/property tests, SSE.
3. **Phase 3 – Frontend:** contestant UI, admin panel (contests, problems, zip upload, subtask editor, queue monitor, scoreboards).
4. **Phase 4 – Ops:** compose overrides for onsite/cloud, PowerShell scripts, offline image bundle, backups, README for Windows admins; end-to-end run with a sample IOI and a sample ICPC contest.

---

## 13. Decisions (confirmed)

1. **Accounts:** one account per team or individual (one computer each); a team may have one member. Same model in IOI and ICPC modes.
2. **Feedback:** full feedback (per subtask and per test) in IOI mode.
3. **Submission limits:** 50 per task per contestant in IOI mode; unlimited in ICPC mode (configurable per contest).
4. **C++:** `g++ -O3 -std=gnu++20`.
5. **Decimal scoring:** per-problem `score_precision` (0–2 decimals), §6.5.
