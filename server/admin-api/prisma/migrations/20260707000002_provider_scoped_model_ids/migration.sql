DROP INDEX IF EXISTS "ModelConfig_modelId_key";

CREATE UNIQUE INDEX "ModelConfig_providerId_modelId_key" ON "ModelConfig"("providerId", "modelId");
CREATE INDEX "ModelConfig_modelId_idx" ON "ModelConfig"("modelId");
