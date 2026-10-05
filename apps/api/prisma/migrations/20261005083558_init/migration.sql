-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'CONTESTANT');

-- CreateEnum
CREATE TYPE "ScoringMode" AS ENUM ('IOI', 'ICPC');

-- CreateEnum
CREATE TYPE "IoiTaskScoreRule" AS ENUM ('MAX_SUBTASK', 'BEST_SUBMISSION');

-- CreateEnum
CREATE TYPE "ProblemType" AS ENUM ('BATCH', 'OUTPUT_ONLY', 'INTERACTIVE');

-- CreateEnum
CREATE TYPE "CheckerKind" AS ENUM ('TOKENS', 'FLOAT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SubtaskScoring" AS ENUM ('MIN', 'SUM');

-- CreateEnum
CREATE TYPE "JudgementStatus" AS ENUM ('QUEUED', 'COMPILING', 'RUNNING', 'DONE', 'CE', 'SE');

-- CreateEnum
CREATE TYPE "TestVerdict" AS ENUM ('AC', 'PA', 'WA', 'TLE', 'MLE', 'RE', 'SE', 'SKIPPED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CONTESTANT',
    "displayName" TEXT NOT NULL,
    "members" TEXT NOT NULL DEFAULT '',
    "organization" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "scoringMode" "ScoringMode" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "freezeAt" TIMESTAMP(3),
    "penaltyMinutes" INTEGER NOT NULL DEFAULT 20,
    "countCompileErrors" BOOLEAN NOT NULL DEFAULT false,
    "ioiTaskScoreRule" "IoiTaskScoreRule" NOT NULL DEFAULT 'MAX_SUBTASK',
    "maxSubmissionsPerTask" INTEGER,
    "languages" TEXT[] DEFAULT ARRAY['cpp', 'python']::TEXT[],
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "publicScoreboard" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestParticipant" (
    "contestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDelay" INTEGER NOT NULL DEFAULT 0,
    "extraTime" INTEGER NOT NULL DEFAULT 0,
    "hidden" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ContestParticipant_pkey" PRIMARY KEY ("contestId","userId")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ProblemType" NOT NULL DEFAULT 'BATCH',
    "timeLimitMs" INTEGER NOT NULL DEFAULT 1000,
    "memoryLimitMb" INTEGER NOT NULL DEFAULT 256,
    "scorePrecision" INTEGER NOT NULL DEFAULT 0,
    "checkerKind" "CheckerKind" NOT NULL DEFAULT 'TOKENS',
    "checkerEpsilon" DOUBLE PRECISION,
    "checkerSha" TEXT,
    "interactorSha" TEXT,
    "statementSha" TEXT,
    "statementType" TEXT,
    "statementMd" TEXT NOT NULL DEFAULT '',
    "attachmentSha" TEXT,
    "activeTestSetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestSet" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "TestSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Test" (
    "id" TEXT NOT NULL,
    "testSetId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "inputSha" TEXT NOT NULL,
    "answerSha" TEXT,
    "inputSize" INTEGER NOT NULL DEFAULT 0,
    "isSample" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subtask" (
    "id" TEXT NOT NULL,
    "testSetId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "pointsCenti" INTEGER NOT NULL,
    "scoring" "SubtaskScoring" NOT NULL DEFAULT 'MIN',

    CONSTRAINT "Subtask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubtaskTest" (
    "subtaskId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,

    CONSTRAINT "SubtaskTest_pkey" PRIMARY KEY ("subtaskId","testId")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "language" TEXT,
    "sourceSha" TEXT,
    "outputs" JSONB,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Judgement" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "testSetId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "status" "JudgementStatus" NOT NULL DEFAULT 'QUEUED',
    "compileLog" TEXT,
    "error" TEXT,
    "subtaskScores" JSONB,
    "scoreCenti" INTEGER,
    "verdict" TEXT,
    "maxTimeMs" INTEGER,
    "maxMemoryKb" INTEGER,
    "worker" TEXT,
    "progressDone" INTEGER NOT NULL DEFAULT 0,
    "progressTotal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Judgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestResult" (
    "judgementId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "verdict" "TestVerdict" NOT NULL,
    "fractionPpm" INTEGER NOT NULL,
    "timeMs" INTEGER,
    "memoryKb" INTEGER,
    "message" TEXT,

    CONSTRAINT "TestResult_pkey" PRIMARY KEY ("judgementId","testId")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "sha" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "File_pkey" PRIMARY KEY ("sha")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "ContestParticipant_userId_idx" ON "ContestParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Problem_activeTestSetId_key" ON "Problem"("activeTestSetId");

-- CreateIndex
CREATE UNIQUE INDEX "Problem_contestId_code_key" ON "Problem"("contestId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Test_testSetId_name_key" ON "Test"("testSetId", "name");

-- CreateIndex
CREATE INDEX "Submission_contestId_userId_problemId_idx" ON "Submission"("contestId", "userId", "problemId");

-- CreateIndex
CREATE INDEX "Submission_contestId_submittedAt_idx" ON "Submission"("contestId", "submittedAt");

-- CreateIndex
CREATE INDEX "Judgement_submissionId_active_idx" ON "Judgement"("submissionId", "active");

-- CreateIndex
CREATE INDEX "Judgement_status_idx" ON "Judgement"("status");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipant" ADD CONSTRAINT "ContestParticipant_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipant" ADD CONSTRAINT "ContestParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_activeTestSetId_fkey" FOREIGN KEY ("activeTestSetId") REFERENCES "TestSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSet" ADD CONSTRAINT "TestSet_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_testSetId_fkey" FOREIGN KEY ("testSetId") REFERENCES "TestSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subtask" ADD CONSTRAINT "Subtask_testSetId_fkey" FOREIGN KEY ("testSetId") REFERENCES "TestSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubtaskTest" ADD CONSTRAINT "SubtaskTest_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "Subtask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubtaskTest" ADD CONSTRAINT "SubtaskTest_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Judgement" ADD CONSTRAINT "Judgement_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Judgement" ADD CONSTRAINT "Judgement_testSetId_fkey" FOREIGN KEY ("testSetId") REFERENCES "TestSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_judgementId_fkey" FOREIGN KEY ("judgementId") REFERENCES "Judgement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
