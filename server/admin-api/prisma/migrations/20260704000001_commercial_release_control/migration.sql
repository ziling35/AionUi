-- Align the deployable SQLite schema with the current admin API code.
ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "password" TEXT;
ALTER TABLE "User" ADD COLUMN "usedQuota" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

CREATE TABLE "Provider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'custom',
    "baseUrl" TEXT,
    "apiKey" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

ALTER TABLE "ModelConfig" ADD COLUMN "providerId" TEXT;
ALTER TABLE "ModelConfig" ADD COLUMN "apiBaseUrl" TEXT;
ALTER TABLE "ModelConfig" ADD COLUMN "apiKey" TEXT;
ALTER TABLE "ModelConfig" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'chat';

CREATE TABLE "AppRelease" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'latest',
    "platform" TEXT NOT NULL DEFAULT 'win32',
    "arch" TEXT NOT NULL DEFAULT 'x64',
    "fileName" TEXT NOT NULL,
    "sha512" TEXT NOT NULL,
    "size" INTEGER,
    "releaseDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releaseNotes" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "AppRelease_channel_platform_arch_version_key" ON "AppRelease"("channel", "platform", "arch", "version");
