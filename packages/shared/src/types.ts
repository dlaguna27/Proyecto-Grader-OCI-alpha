export const SCORING_MODES = ['IOI', 'ICPC'] as const;
export type ScoringMode = (typeof SCORING_MODES)[number];

export const PROBLEM_TYPES = ['BATCH', 'OUTPUT_ONLY', 'INTERACTIVE'] as const;
export type ProblemType = (typeof PROBLEM_TYPES)[number];

export const LANGUAGES = ['cpp', 'python'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  cpp: 'C++20 (g++ -O3)',
  python: 'Python 3',
};

export const CHECKER_KINDS = ['TOKENS', 'FLOAT', 'CUSTOM'] as const;
export type CheckerKind = (typeof CHECKER_KINDS)[number];

export const SUBTASK_SCORINGS = ['MIN', 'SUM'] as const;
export type SubtaskScoring = (typeof SUBTASK_SCORINGS)[number];

export const IOI_TASK_SCORE_RULES = ['MAX_SUBTASK', 'BEST_SUBMISSION'] as const;
export type IoiTaskScoreRule = (typeof IOI_TASK_SCORE_RULES)[number];

/** Per-test verdicts reported by the grading worker. */
export const TEST_VERDICTS = ['AC', 'PA', 'WA', 'TLE', 'MLE', 'RE', 'SE', 'SKIPPED'] as const;
export type TestVerdict = (typeof TEST_VERDICTS)[number];

export const TEST_VERDICT_LABELS: Record<TestVerdict, string> = {
  AC: 'Accepted',
  PA: 'Partially correct',
  WA: 'Wrong answer',
  TLE: 'Time limit exceeded',
  MLE: 'Memory limit exceeded',
  RE: 'Runtime error',
  SE: 'System error',
  SKIPPED: 'Skipped',
};

/** Lifecycle of one judgement (one grading attempt of a submission). */
export const JUDGEMENT_STATUSES = ['QUEUED', 'COMPILING', 'RUNNING', 'DONE', 'CE', 'SE'] as const;
export type JudgementStatus = (typeof JUDGEMENT_STATUSES)[number];

/** Overall verdict of a submission shown to contestants. */
export type SubmissionVerdict = TestVerdict | 'CE' | 'PENDING';

export const PPM = 1_000_000;

export interface JudgeTest {
  id: string;
  inputSha: string;
  /** Expected output; optional for interactive problems. */
  answerSha: string | null;
}

export interface JudgeSubtask {
  testIds: string[];
  scoring: SubtaskScoring;
}

export interface JudgeChecker {
  kind: CheckerKind;
  /** Source sha of a custom testlib checker. */
  sourceSha?: string | null;
  /** Absolute/relative tolerance for FLOAT checker. */
  epsilon?: number | null;
}

/** Payload of a job on the `judge` queue. Self-contained: the worker needs no DB access. */
export interface JudgeJob {
  judgementId: string;
  token: string;
  problemType: ProblemType;
  language: Language | null;
  sourceSha: string | null;
  /** Output-only submissions: test id -> uploaded output sha. */
  outputs: Record<string, string> | null;
  timeLimitMs: number;
  memoryLimitMb: number;
  checker: JudgeChecker;
  interactorSha: string | null;
  tests: JudgeTest[];
  /** IOI: used to skip tests that can no longer change the score. */
  subtasks: JudgeSubtask[] | null;
  /** ICPC: stop at the first non-accepted test. */
  stopOnFirstFailure: boolean;
}

export interface TestOutcome {
  testId: string;
  verdict: TestVerdict;
  /** Score fraction of this test in parts-per-million (0..1_000_000). */
  fractionPpm: number;
  timeMs: number | null;
  memoryKb: number | null;
  /** Diagnostic message (checker output etc.). Admin-only. */
  message: string | null;
}

export interface JudgeResult {
  judgementId: string;
  token: string;
  status: 'DONE' | 'CE' | 'SE';
  compileLog: string | null;
  tests: TestOutcome[];
  error: string | null;
  worker: string;
}

export interface JudgeProgress {
  stage: 'COMPILING' | 'RUNNING';
  done: number;
  total: number;
}

export const QUEUE_JUDGE = 'judge';
export const QUEUE_RESULTS = 'judge-results';
