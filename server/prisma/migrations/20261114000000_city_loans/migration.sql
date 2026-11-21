-- Migration: store each city's outstanding loans
--
-- The server reads/writes this column with raw SQL and checks that it exists
-- first (see persistence/jsonStore.ts), so it is deliberately NOT declared in
-- schema.prisma yet: a regenerated Prisma client would otherwise select the
-- column from databases where this migration hasn't run. Once every database
-- has it, add `loans Json @default("[]")` to the City model.

ALTER TABLE "City" ADD COLUMN "loans" JSONB NOT NULL DEFAULT '[]';
