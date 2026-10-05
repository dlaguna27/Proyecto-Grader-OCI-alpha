# Running a real contest with the OCI Contest System

A practical runbook for the organizer. The README covers installation; this covers **what to do, when**.

---

## 1. Weeks before: prepare the problems

For every problem, prepare on your own computer:

| Item | Batch | Output-only | Interactive |
|---|---|---|---|
| Statement (Markdown with `$LaTeX$`, or a PDF) | yes | yes | yes |
| Tests: `NAME.in` + `NAME.out` (or `.ans`) in one zip | yes | yes (contestants download the `.in`) | `.in` (interactor's secret input) + `.out` if your interactor reads it |
| Reference solution (C++ and/or Python) | yes | your answers are the `.out` files | yes |
| Checker | only if many answers are valid or floats | same | **interactor required** (testlib) |
| Subtasks (IOI) and points | yes | yes | yes |

Tips:
- Name samples `sample1.in`, `sample2.in` … — they are shown in the statement automatically and are not scored.
- Name tests so subtasks can be selected by pattern: `1-01.in`, `1-02.in`, `2-01.in` → in the subtask editor type `1-*` and press *Add*.
- Decide limits by running your reference solution **on the contest server** (timing differs between machines). A common rule is 2–3× the reference time.
- If a problem needs fractional points (e.g. `12.5`), set *Score decimals* to 1 or 2 in the problem's Settings before entering subtask points.
- Checkers/interactors use testlib: `quitf(_ok, "...")`, `quitf(_wa, "...")`, `quitp(0.4, "...")` (40 % of the test). The grader compiles them itself.

## 2. Days before: set up the system

1. Install and start (README *Quick start*). For an offline venue, build the images at home with `export-images.ps1` and carry the tar on a USB drive.
2. Log in as `admin` and **change the password** (key icon, top right).
3. **Users → Import CSV** — one line per team (one computer per team; a team may be one person):
   ```csv
   username,password,displayName,members,organization,region
   team01,,Los Algoritmos,"Ana; Luis",Colegio X,San José
   team02,,Byte Force,Carla,Liceo Y,Heredia
   ```
   Leave `password` empty to generate one. After importing, **download the credentials CSV and print the cards** — passwords are shown only once (you can reset them later).
4. **Contests → New contest**: choose **IOI** or **ICPC** — new contests default to IOI, so pick ICPC explicitly (it cannot be changed once there are submissions) — then start and end time.
   - IOI: 50 submissions per task by default; *Task score* = best per subtask across submissions (IOI standard) or best single submission.
   - ICPC: unlimited submissions, penalty 20 min per rejected try, compile errors don't count by default.
   - *Scoreboard freeze*: optional time after which other teams' results are hidden (teams always see their own).
   - Uncheck *Visible* while you prepare so teams don't see it yet.
5. **Participants**: add the teams to the contest. Creating accounts does not register them; only participants can log in to the contest and appear on the scoreboard. Delay/extra-time fields save when you click outside the box.
6. **Problems → Add problem**, for each one:
   - *Settings*: type, time/memory limit, score decimals, output checking.
   - *Statement*: paste Markdown (preview on the right) or upload a PDF; optional attachments zip.
   - *Tests & subtasks*: upload the zip, then build subtasks and **Save subtasks**. Total should be 100 (or whatever you decided).
   - *Checker/Interactor & files*: upload the checker or interactor source.
   - Click **Preview as contestant**.
7. **Test every problem**: create a test account (e.g. `judge1`), register it, and submit the reference solution and a few wrong ones. Check the scores are exactly what you expect. Before the contest, remove the test account from Participants: the scoreboard lists participants only.
8. **Dry run** with a few volunteers on the actual venue computers: login, submit, scoreboard. Check `.\scripts\status.ps1` and **Queue** while they submit.
9. Run `.\scripts\backup.ps1` once to confirm backups work.

## 3. Contest day — morning

- [ ] Server on wired LAN, static IP, power saving disabled, Docker Desktop set to start with Windows.
- [ ] `.\scripts\start.ps1` — note the LAN URL it prints; open it from one contestant PC.
- [ ] Windows Firewall rule for the port (command printed by `start.ps1`).
- [ ] Admin → Queue shows the worker online.
- [ ] Contest *Visible* = on, start/end times correct (server clock is the authority; the countdown in the browser is synced to it).
- [ ] Projector: open `http://SERVER/board/<contest id>` (the *Scoreboard* button) in a browser that is **not** logged in as admin — admins always see the unfrozen board.
- [ ] Hand out credential cards. Contestant PCs need only a browser; block internet at the router if required by your rules.

## 4. During the contest

| Situation | What to do |
|---|---|
| Team can't log in | Users → reset password, give them the new one. |
| Team logged in on another PC | Single session: the newest login wins; the old tab is logged out. |
| Team arrived late / PC broke | Participants → *Personal start delay* or *Extra minutes at the end* for that team only. |
| Clarification for everyone | Announcements → publish; it pops up on every contestant screen. |
| A test or checker was wrong | Fix it (upload a new zip / checker), then Submissions → filter by problem → **Rejudge**. Scores update by themselves. |
| Subtask points were wrong | Edit subtasks → Save. Existing submissions are rescored instantly (no rejudge needed). |
| Red "System error" in Queue | Grader problem, not the team's fault: usually a broken checker/interactor or missing `.out`. Fix, then rejudge those submissions. |
| Queue keeps growing | Raise `JUDGE_SLOTS` in `.env` and rerun `start.ps1`, or add a judge PC (README). |
| Server must restart | `.\scripts\stop.ps1` / `start.ps1` — nothing is lost; queued submissions resume. |

Every 30–60 minutes run `.\scripts\backup.ps1` (safe while running) and copy the folder to a USB drive.

## 5. After the contest

1. Wait until Queue shows 0 waiting / 0 grading.
2. Handle appeals: open a submission (note the badge shows the worst test verdict, so a *Wrong answer* submission can still have partial points — read the score) to see every test's verdict, time, memory and checker message.
3. ICPC with freeze: unfreeze for the award ceremony by clearing the freeze time in contest Settings (the public board then shows final standings).
4. **Results CSV** (contest page) → official results.
5. Final `.\scripts\backup.ps1`, keep it with the contest files.

## 6. What contestants should know (put this on the instruction sheet)

- Open `http://<server IP>` and log in with the card.
- Check the language selector before each submission (pasting C++ with Python selected gives a compile error).
- Languages: **C++20** (`g++ -O3 -std=gnu++20`) and **Python 3**. Read standard input, write standard output; no files, no network.
- Feedback is full: each test's verdict, time and memory, and the points per subtask.
- IOI: 50 submissions per problem; your score on a problem is the best per subtask across all your submissions.
- ICPC: unlimited submissions; each rejected try before acceptance adds 20 minutes; compile errors are free.
- Output-only: download the inputs, run locally, upload one file per test named like the input (`03.out` for `03.in`) or a zip.
- Interactive: **flush after every line** (`cout << endl;` / `print(..., flush=True)`), otherwise you get "Idleness limit exceeded".

Verdicts: AC accepted · WA wrong answer · TLE time limit · MLE memory limit · RE runtime error · CE compile error · PA partial · SK skipped (an earlier test in the subtask failed, so the subtask is already 0).
