-- Add JSONB finances column for per-sector taxRates and claimedMilestones,
-- and update default founding capital & tax rate for new cities.
ALTER TABLE "City" ADD COLUMN IF NOT EXISTS "finances" JSONB;
ALTER TABLE "City" ALTER COLUMN "money" SET DEFAULT 15000;
ALTER TABLE "City" ALTER COLUMN "taxRate" SET DEFAULT 9;
