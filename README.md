# NOI Contest Management System

A self-hosted contest system for the National Olympiad in Informatics.

- **Contestant UI:** problems (Markdown + LaTeX or PDF), samples, C++20 / Python 3 submissions, output-only uploads, full per-test and per-subtask feedback, live scoreboard, announcements.
- **Admin panel:** contests (IOI or ICPC), problems, test-case zip upload, subtask editor with decimal points, custom checkers and interactors (testlib), accounts (CSV import, printable credential cards), participants (start delay / extra time), queue monitor, rejudge, results CSV.
- **Grading:** isolate sandboxes (the IOI/CMS sandbox) inside Docker, cgroup v2 memory/CPU/process limits, no network. Batch, output-only and interactive tasks.
- **Scoring:** IOI subtasks (MIN / SUM, max-per-subtask across submissions, 0–2 decimal places, 50 submissions per task by default) and ICPC (accepted / rejected, penalty minutes, freeze, first-solve).

The design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

- Windows 10/11 with **Docker Desktop** (WSL2 backend), or any Linux server with Docker Engine + Compose v2.
- 4+ CPU cores and 8 GB RAM recommended for ~100 teams. Grading throughput scales with cores.
- Internet is needed only to **build** images. Onsite servers can run fully offline (see below).

## Quick start (Windows, PowerShell)

```powershell
git clone <this repo> noi-cms; cd noi-cms
Set-ExecutionPolicy -Scope Process Bypass   # allow the scripts in this window
.\scripts\setup.ps1                          # creates .env with random passwords, prints the admin password
.\scripts\start.ps1                          # builds and starts everything, prints the LAN URLs
```

Open `http://localhost`, log in as `admin` with the password printed by `setup.ps1` (stored in `.env`).

Linux/macOS: `cp .env.example .env`, edit the passwords, then `docker compose up -d --build --wait`.

## Running a contest

1. **Users** → *Import CSV* (`username,password,displayName,members,organization,region`). One account per team or individual — one computer each. Empty passwords are generated; print the credential cards.
2. **Contests** → *New contest*, choose **IOI** or **ICPC**. IOI defaults to 50 submissions per task; ICPC is unlimited. Set the freeze time if you want one.
3. **Participants** → *Add all teams*. Late arrival? Give that team a start delay or extra time.
4. **Problems** → *Add problem* (Batch, Output-only or Interactive), then:
   - *Tests*: upload a zip with `NAME.in` + `NAME.out` (or `.ans`). Names containing `sample`/`example` are shown to contestants.
   - *Subtasks* (IOI): assign tests and points. Choose *Score decimals* in Settings (0, 1 or 2) to allow points like `12.5`. Saving rescores old submissions immediately.
   - *Checker*: exact tokens, float tolerance, or a testlib checker. *Interactor* for interactive tasks.
   - *Preview as contestant* to check the statement, then submit a reference solution.
5. During the contest watch **Queue**. A red *system error* means a broken checker/interactor or test — fix it and use *Rejudge*.
6. After the contest: **Results CSV**, and `.\scripts\backup.ps1`.

The projector scoreboard is `http://SERVER/board/<contest id>` (the *Scoreboard* button). It needs no login when the contest's scoreboard is public; after the freeze it shows the frozen standings.

### Problem formats

| Type | Contestant submits | Judged by |
|---|---|---|
| Batch | C++ or Python source | stdin/stdout, compared by tokens / float tolerance / testlib checker |
| Output-only | one file per test (`NAME.out`) or a zip | same checkers as batch; missing files score 0 |
| Interactive | C++ or Python source | a testlib interactor in a separate sandbox, connected only by pipes |

Checkers and interactors use [testlib](https://github.com/MikeMirzayanov/testlib): `quitf(_ok, …)`, `quitf(_wa, …)`, or `quitp(0.4, …)` for 40 % of the test's value. Compilation: `g++ -O3 -std=gnu++20 -pipe -static -DONLINE_JUDGE`; Python runs as `python3`.

## Onsite (offline LAN)

On a machine with internet:

```powershell
.\scripts\export-images.ps1        # builds and writes noi-cms-images.tar (~1.5 GB)
```

Copy the repository folder and the tar to the contest server (USB), then on the server:

```powershell
.\scripts\import-images.ps1
.\scripts\setup.ps1
.\scripts\start.ps1 -NoBuild
```

Contestants browse to `http://<server LAN IP>`. If they cannot connect, allow the port in Windows Firewall (the command is printed by `start.ps1`). Give the server a static IP. Contestant PCs need only a browser.

### More grading capacity

- Same machine: set `JUDGE_SLOTS` (parallel tests per worker) in `.env` to about *cores − 2*, then `.\scripts\start.ps1`.
- Extra judge PCs: on the main server, publish Redis and the API **only to the judges' network** (create `docker-compose.override.yml` with `ports: ["6379:6379"]` for `redis` and `["3000:3000"]` for `api`, and restrict them with a firewall rule to the judge PCs' IPs). On each judge PC import the images and run `.\scripts\add-judge-machine.ps1 -Server <ip> -WorkerToken … -RedisPassword …`. Never expose these ports to contestant machines.

For fair timing, keep all judge machines identical and don't run other heavy programs on them.

## Offsite (cloud: DigitalOcean, AWS, …)

1. Create an Ubuntu VM (4+ vCPU, dedicated CPU recommended for stable timing), install Docker, open ports 80 and 443.
2. Point a DNS record (e.g. `contest.example.org`) at the VM.
3. `cp .env.example .env`, set strong passwords, `SITE_ADDRESS=contest.example.org`, `ACME_EMAIL=you@example.org`.
4. `docker compose -f docker-compose.yml -f docker-compose.cloud.yml up -d --build --wait`

Caddy gets a Let's Encrypt certificate automatically and session cookies become `Secure`. From Windows you can do the same with `.\scripts\setup.ps1 -Cloud -Domain contest.example.org` and `.\scripts\start.ps1 -Cloud`.

## Operations

| Task | Command |
|---|---|
| Status / queue size | `.\scripts\status.ps1` |
| Logs | `.\scripts\logs.ps1 [api|worker|web|postgres]` |
| Backup (safe during a contest) | `.\scripts\backup.ps1` → `backups\<time>\` |
| Restore | `.\scripts\restore.ps1 backups\<time>` |
| Stop (data is kept) | `.\scripts\stop.ps1` |
| Scale workers | `.\scripts\scale-workers.ps1 3` |
| Smoke test a running system | `node scripts/e2e-smoke.mjs http://localhost` (needs `SUBMIT_PER_MINUTE` ≥ 30) |

All data lives in Docker volumes (`noi-cms_pgdata`, `noi-cms_filedata`). `docker compose down -v` deletes it.

### Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `WORKER_TOKEN` | — | Internal secrets (random, letters/digits) |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | `admin` | First admin account (created on first start only) |
| `HTTP_PORT` | `80` | LAN port |
| `SITE_ADDRESS` | `:80` | Domain for HTTPS in cloud mode |
| `JUDGE_SLOTS` | `2` | Tests graded in parallel per worker container |
| `WORKER_REPLICAS` | `1` | Worker containers |
| `SINGLE_SESSION` | `1` | A new login logs out the team's other session |
| `SUBMIT_PER_MINUTE` | `6` | Anti-flood limit per team |

## Security notes

- Contestant code and checkers/interactors run in separate isolate sandboxes: no network, private filesystem, CPU/memory/process/file-size limits. The worker container is privileged so isolate can manage cgroups; it publishes no ports.
- Workers have no database access. They fetch files with a token and report raw per-test results; the API recomputes every score.
- `/internal/*` is never routed through the web proxy. Passwords are hashed with Argon2; all state-changing requests require a CSRF header.
- Change the admin password after the first login (key icon, top right), and keep `.env` private.

## Development

```bash
npm ci
npm run build && npm test                    # shared scoring + worker unit tests
docker build -f docker/worker/Dockerfile -t noi-cms-worker .
docker run --rm --privileged noi-cms-worker node apps/worker/dist/selftest.js   # 27 real-sandbox cases
```

`apps/api` (Fastify + Prisma), `apps/worker` (isolate runner), `apps/web` (Vite + React + Tailwind + shadcn/ui), `packages/shared` (types and exact scoring).
