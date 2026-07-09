CREATE TABLE "FeedbackReport" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "module" TEXT NOT NULL,
  "moduleLabel" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "tagsJson" TEXT,
  "extraJson" TEXT,
  "attachmentsJson" TEXT,
  "attachmentCount" INTEGER NOT NULL DEFAULT 0,
  "appVersion" TEXT,
  "platform" TEXT,
  "userAgent" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "FeedbackReport_status_createdAt_idx" ON "FeedbackReport"("status", "createdAt");
CREATE INDEX "FeedbackReport_module_createdAt_idx" ON "FeedbackReport"("module", "createdAt");
