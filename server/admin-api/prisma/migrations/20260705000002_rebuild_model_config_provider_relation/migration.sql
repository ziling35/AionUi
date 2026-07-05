PRAGMA foreign_keys=OFF;

CREATE TABLE "new_ModelConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerId" TEXT,
    "apiBaseUrl" TEXT,
    "apiKey" TEXT,
    "multiplier" REAL NOT NULL DEFAULT 1.0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "type" TEXT NOT NULL DEFAULT 'chat',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "unitPrice" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "ModelConfig_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_ModelConfig" (
    "id",
    "modelId",
    "name",
    "providerId",
    "apiBaseUrl",
    "apiKey",
    "multiplier",
    "isActive",
    "type",
    "createdAt",
    "updatedAt",
    "unitPrice"
)
SELECT
    "id",
    "modelId",
    "name",
    "providerId",
    "apiBaseUrl",
    "apiKey",
    "multiplier",
    "isActive",
    COALESCE("type", 'chat'),
    "createdAt",
    "updatedAt",
    COALESCE("unitPrice", 0)
FROM "ModelConfig";

DROP TABLE "ModelConfig";
ALTER TABLE "new_ModelConfig" RENAME TO "ModelConfig";

CREATE UNIQUE INDEX "ModelConfig_modelId_key" ON "ModelConfig"("modelId");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
