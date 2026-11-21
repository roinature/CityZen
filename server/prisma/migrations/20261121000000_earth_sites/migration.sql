BEGIN;

ALTER TABLE "City" ADD COLUMN "siteId" TEXT;
CREATE UNIQUE INDEX "City_siteId_key" ON "City"("siteId");

-- Keep old cities playable without assigning invented geographic locations.
-- Moving each old grid as a unit preserves roads between adjacent cities.
INSERT INTO "World" ("id", "name", "clock", "updatedAt")
SELECT 'default', 'Earth', '{"gameTimeMs":0,"speed":1,"gameDay":0,"gameYear":1}', NOW()
WHERE EXISTS (SELECT 1 FROM "World" WHERE jsonb_array_length(cities) > 0)
ON CONFLICT ("id") DO NOTHING;

DO $$
DECLARE
  legacy RECORD;
  offset_x INTEGER := 0;
  legacy_cities JSONB;
BEGIN
  FOR legacy IN SELECT * FROM "World" WHERE id <> 'default' AND jsonb_array_length(cities) > 0 ORDER BY id LOOP
    offset_x := offset_x - GREATEST(legacy."gridSize", 8) - 2;
    SELECT jsonb_agg(jsonb_set(entry, '{position,wx}',
      to_jsonb((entry->'position'->>'wx')::integer + offset_x)) ORDER BY ord)
    INTO legacy_cities FROM jsonb_array_elements(legacy.cities) WITH ORDINALITY AS c(entry, ord);

    UPDATE "World" SET cities = cities || legacy_cities,
      "populationData" = "populationData" || legacy."populationData",
      "initialPopulation" = "initialPopulation" + legacy."initialPopulation",
      "totalPopulation" = "totalPopulation" + legacy."totalPopulation"
    WHERE id = 'default';
  END LOOP;
END $$;

UPDATE "World" SET "name" = 'Earth', "maxCities" = 3 WHERE "id" = 'default';
COMMIT;
