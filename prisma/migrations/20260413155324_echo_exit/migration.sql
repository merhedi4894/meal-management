-- CreateTable
CREATE TABLE "PriceSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "month" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "breakfastPrice" INTEGER NOT NULL DEFAULT 0,
    "lunchPrice" INTEGER NOT NULL DEFAULT 0,
    "morningSpecial" INTEGER NOT NULL DEFAULT 0,
    "lunchSpecial" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MealEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "month" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "mobile" TEXT NOT NULL DEFAULT '',
    "breakfastCount" INTEGER NOT NULL DEFAULT 0,
    "lunchCount" INTEGER NOT NULL DEFAULT 0,
    "morningSpecial" INTEGER NOT NULL DEFAULT 0,
    "lunchSpecial" INTEGER NOT NULL DEFAULT 0,
    "totalBill" INTEGER NOT NULL DEFAULT 0,
    "deposit" INTEGER NOT NULL DEFAULT 0,
    "depositDate" TEXT NOT NULL DEFAULT '',
    "designation" TEXT NOT NULL DEFAULT '',
    "department" TEXT NOT NULL DEFAULT '',
    "prevBalance" INTEGER NOT NULL DEFAULT 0,
    "curBalance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceSetting_month_year_key" ON "PriceSetting"("month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");
