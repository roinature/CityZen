-- Migration: Add population data to World, Maslow summary to City

-- World: add population tracking and serialized person data
ALTER TABLE "World" ADD COLUMN "maxCities" INTEGER NOT NULL DEFAULT 64;
ALTER TABLE "World" ADD COLUMN "totalPopulation" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "World" ADD COLUMN "initialPopulation" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "World" ADD COLUMN "populationData" JSONB NOT NULL DEFAULT '[]';

-- City: add Maslow satisfaction summary fields
ALTER TABLE "City" ADD COLUMN "maslowPhysiological" DOUBLE PRECISION NOT NULL DEFAULT 50;
ALTER TABLE "City" ADD COLUMN "maslowSafety" DOUBLE PRECISION NOT NULL DEFAULT 50;
ALTER TABLE "City" ADD COLUMN "maslowLoveBelonging" DOUBLE PRECISION NOT NULL DEFAULT 50;
ALTER TABLE "City" ADD COLUMN "maslowEsteem" DOUBLE PRECISION NOT NULL DEFAULT 50;
ALTER TABLE "City" ADD COLUMN "maslowCognitive" DOUBLE PRECISION NOT NULL DEFAULT 50;
ALTER TABLE "City" ADD COLUMN "maslowAesthetic" DOUBLE PRECISION NOT NULL DEFAULT 50;
ALTER TABLE "City" ADD COLUMN "maslowSelfActualization" DOUBLE PRECISION NOT NULL DEFAULT 50;
