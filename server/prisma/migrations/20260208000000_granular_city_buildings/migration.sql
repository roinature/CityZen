-- Migration: Break City JSON blob into granular columns + Building table
-- This drops existing city data since the JSON blob cannot be reliably migrated.

-- Step 1: Drop old City table (contains JSON blob state)
DROP TABLE IF EXISTS "City";

-- Step 2: Create new City table with flattened columns
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,

    -- Resources
    "money" DOUBLE PRECISION NOT NULL DEFAULT 5000,
    "population" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "happiness" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "taxRate" INTEGER NOT NULL DEFAULT 10,

    -- Demand
    "demandResidential" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "demandCommercial" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "demandIndustrial" DOUBLE PRECISION NOT NULL DEFAULT 0.3,

    -- Clock
    "clockGameTimeMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clockSpeed" INTEGER NOT NULL DEFAULT 1,
    "clockGameDay" INTEGER NOT NULL DEFAULT 0,
    "clockGameYear" INTEGER NOT NULL DEFAULT 1,

    -- Simulation
    "tick" INTEGER NOT NULL DEFAULT 0,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- Step 3: Create Building table
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "positionX" INTEGER NOT NULL,
    "positionZ" INTEGER NOT NULL,
    "placedBy" TEXT NOT NULL,
    "placedAt" INTEGER NOT NULL,
    "developmentLevel" INTEGER,
    "developedAt" INTEGER,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- Step 4: Create index and foreign key
CREATE INDEX "Building_cityId_idx" ON "Building"("cityId");

ALTER TABLE "Building" ADD CONSTRAINT "Building_cityId_fkey"
    FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
