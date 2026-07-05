-- AlterTable
ALTER TABLE "User" ADD COLUMN "cloudHistoryEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CloudConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "localConversationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT,
    "extraJson" TEXT,
    "localCreatedAt" DATETIME,
    "localUpdatedAt" DATETIME,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CloudConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CloudMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cloudConversationId" TEXT NOT NULL,
    "localMessageId" TEXT NOT NULL,
    "msgId" TEXT,
    "type" TEXT NOT NULL,
    "position" TEXT,
    "status" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "contentJson" TEXT NOT NULL,
    "localCreatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CloudMessage_cloudConversationId_fkey" FOREIGN KEY ("cloudConversationId") REFERENCES "CloudConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CloudConversation_userId_localConversationId_key" ON "CloudConversation" ("userId", "localConversationId");

-- CreateIndex
CREATE INDEX "CloudConversation_userId_syncedAt_idx" ON "CloudConversation" ("userId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CloudMessage_cloudConversationId_localMessageId_key" ON "CloudMessage" ("cloudConversationId", "localMessageId");

-- CreateIndex
CREATE INDEX "CloudMessage_cloudConversationId_localCreatedAt_idx" ON "CloudMessage" ("cloudConversationId", "localCreatedAt");
