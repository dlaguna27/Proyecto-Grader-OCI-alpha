export type Role = 'ADMIN' | 'CONTESTANT';
export type Mode = 'IOI' | 'ICPC';
export type ProblemType = 'BATCH' | 'OUTPUT_ONLY' | 'INTERACTIVE';
export type Phase = 'BEFORE' | 'RUNNING' | 'AFTER';

export interface Me {
  id: string;
  username: string;
  role: Role;
  displayName: string;
}

export interface ContestSummary {
  id: string;
  name: string;
  description: string;
  scoringMode: Mode;
  startsAt: string;
  endsAt: string;
  freezeAt: string | null;
  phase: Phase;
  penaltyMinutes: number;
  maxSubmissionsPerTask: number | null;
  languages: string[];
  publicScoreboard: boolean;
}

export interface IoiCell {
  scoreCenti: number;
  attempts: number;
  pending: number;
}

export interface IcpcCell {
  solved: boolean;
  rejected: number;
  penaltyMinutes: number;
  solveMinute: number | null;
  pending: boolean;
  pendingCount: number;
  firstSolve: boolean;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

export interface ContestDetail extends ContestSummary {
  serverTime: string;
  problems: {
    id: string;
    code: string;
    title: string;
    type: ProblemType;
    scorePrecision: number;
    maxScoreCenti: number | null;
    submissions: number;
    my: IoiCell | IcpcCell | null;
  }[];
  announcements: Announcement[];
}

export interface ProblemDetail {
  id: string;
  code: string;
  title: string;
  type: ProblemType;
  timeLimitMs: number;
  memoryLimitMb: number;
  scorePrecision: number;
  statementMd: string;
  hasStatementFile: boolean;
  statementType: string | null;
  hasAttachments: boolean;
  scoringMode: Mode;
  languages: string[];
  subtasks: { id: string; ordinal: number; name: string; pointsCenti: number; scoring: string; testCount: number }[];
  maxScoreCenti: number | null;
  outputOnlyTests: string[];
  samples: { name: string; input: string; output: string | null }[];
  submissionsUsed: number;
  submissionLimit: number | null;
}

export type JStatus = 'QUEUED' | 'COMPILING' | 'RUNNING' | 'DONE' | 'CE' | 'SE';

export interface SubmissionItem {
  id: string;
  problemId: string;
  problemCode: string;
  problemTitle: string;
  scorePrecision: number;
  language: string | null;
  submittedAt: string;
  status: JStatus;
  verdict: string | null;
  scoreCenti: number | null;
  maxTimeMs: number | null;
  maxMemoryKb: number | null;
  progressDone: number;
  progressTotal: number;
  user?: { username: string; displayName: string };
}

export interface SubmissionDetail {
  id: string;
  contestId: string;
  contestName: string;
  scoringMode: Mode;
  problemId: string;
  problemCode: string;
  problemTitle: string;
  problemType: ProblemType;
  scorePrecision: number;
  user: { username: string; displayName: string };
  language: string | null;
  submittedAt: string;
  source: string | null;
  outputs: string[] | null;
  status: JStatus;
  verdict: string | null;
  scoreCenti: number | null;
  compileLog: string | null;
  error: string | null;
  worker: string | null;
  progressDone: number;
  progressTotal: number;
  tests: { id: string; name: string; isSample: boolean; verdict: string | null; fractionPpm: number | null; timeMs: number | null; memoryKb: number | null; message: string | null }[];
  subtasks: { id: string; ordinal: number; name: string; scoring: string; pointsCenti: number; scoreCenti: number | null; testIds: string[] }[];
}

export interface Board {
  contest: { id: string; name: string; scoringMode: Mode; startsAt: string; endsAt: string };
  mode: Mode;
  frozen: boolean;
  freezeAt: string | null;
  generatedAt: string;
  problems: { id: string; code: string; title: string; scorePrecision: number; maxScoreCenti: number | null }[];
  rows: {
    rank: number;
    userId: string;
    username: string;
    displayName: string;
    members: string;
    organization: string;
    region: string;
    totalCenti?: number;
    ioi?: Record<string, IoiCell>;
    solved?: number;
    penalty?: number;
    icpc?: Record<string, IcpcCell>;
  }[];
}
