CREATE TABLE "RechargeProduct" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "productType" TEXT NOT NULL DEFAULT 'balance',
  "priceCents" INTEGER NOT NULL,
  "amount" INTEGER NOT NULL,
  "planType" TEXT NOT NULL DEFAULT 'balance',
  "windowHours" INTEGER,
  "validDays" INTEGER,
  "badge" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "PaymentConfig" (
  "id" TEXT NOT NULL DEFAULT 'default' PRIMARY KEY,
  "provider" TEXT NOT NULL DEFAULT 'epay',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "apiBaseUrl" TEXT,
  "merchantId" TEXT,
  "merchantKey" TEXT,
  "allowedTypes" TEXT NOT NULL DEFAULT 'alipay,wxpay',
  "siteName" TEXT NOT NULL DEFAULT 'LingAI',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "PaymentOrder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderNo" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "productId" TEXT,
  "productSnapshotJson" TEXT NOT NULL,
  "paymentProvider" TEXT NOT NULL DEFAULT 'epay',
  "paymentType" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "quotaAmount" INTEGER NOT NULL,
  "planType" TEXT NOT NULL DEFAULT 'balance',
  "windowHours" INTEGER,
  "validDays" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "providerTradeNo" TEXT,
  "paidAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PaymentOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PaymentOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "RechargeProduct" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "RechargeProduct_enabled_sortOrder_idx" ON "RechargeProduct"("enabled", "sortOrder");
CREATE UNIQUE INDEX "PaymentOrder_orderNo_key" ON "PaymentOrder"("orderNo");
CREATE INDEX "PaymentOrder_userId_createdAt_idx" ON "PaymentOrder"("userId", "createdAt");
CREATE INDEX "PaymentOrder_status_createdAt_idx" ON "PaymentOrder"("status", "createdAt");
