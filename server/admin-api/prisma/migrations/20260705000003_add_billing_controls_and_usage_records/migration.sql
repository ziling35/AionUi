ALTER TABLE "ModelConfig" ADD COLUMN "billingMode" TEXT NOT NULL DEFAULT 'per_token';
ALTER TABLE "ModelConfig" ADD COLUMN "inputTokenPrice" REAL NOT NULL DEFAULT 1.0;
ALTER TABLE "ModelConfig" ADD COLUMN "outputTokenPrice" REAL NOT NULL DEFAULT 1.0;
ALTER TABLE "ModelConfig" ADD COLUMN "fixedCost" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ModelConfig" ADD COLUMN "minCost" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ModelConfig" ADD COLUMN "reserveCost" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "modelId" TEXT NOT NULL,
    "providerId" TEXT,
    "endpoint" TEXT NOT NULL,
    "billingMode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "reservedPoints" INTEGER NOT NULL DEFAULT 0,
    "chargedPoints" INTEGER NOT NULL DEFAULT 0,
    "refundedPoints" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "UsageRecord_userId_createdAt_idx" ON "UsageRecord"("userId", "createdAt");
CREATE INDEX "UsageRecord_modelId_createdAt_idx" ON "UsageRecord"("modelId", "createdAt");
CREATE INDEX "UsageRecord_status_createdAt_idx" ON "UsageRecord"("status", "createdAt");
