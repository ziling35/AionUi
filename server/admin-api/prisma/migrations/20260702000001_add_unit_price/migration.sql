-- AlterTable
-- Add unitPrice column to ModelConfig
ALTER TABLE "ModelConfig" ADD COLUMN "unitPrice" REAL NOT NULL DEFAULT 0;
