import { EARTH_SITES } from '@cityzen/shared';
import prisma from './prismaClient.js';
import type { EdgeConnection, WorldState } from '@cityzen/shared';
import type { Prisma } from '../generated/prisma/index.js';

export async function saveWorldState(
  state: WorldState,
  populationData?: unknown[],
  preserveCities = false,
): Promise<void> {
  // A batch (not interactive) transaction: populationData is a large JSON
  // value that can take minutes to upload over a slow link, which blew past
  // the 5s interactive-transaction timeout and rolled the whole save back.
  const update = prisma.world.update({
    where: { id: state.id },
    data: {
      totalPopulation: state.totalPopulation,
      clock: state.clock as unknown as Prisma.InputJsonValue,
      // Omitted while the people are still loading, so the stored ones are kept
      ...(populationData && { populationData: populationData as unknown as Prisma.InputJsonValue }),
    },
  });
  if (preserveCities) {
    await update;
    return;
  }
  // Keep sites claimed by another request while this snapshot was in flight.
  const mergeCities = prisma.$executeRaw`
    UPDATE "World" SET cities = COALESCE((
      SELECT jsonb_agg(COALESCE(snapshot.entry, live.entry) ORDER BY live.ord)
      FROM jsonb_array_elements(cities) WITH ORDINALITY AS live(entry, ord)
      LEFT JOIN jsonb_array_elements(${JSON.stringify(state.cities)}::jsonb) AS snapshot(entry)
        ON snapshot.entry->>'cityId' = live.entry->>'cityId'
    ), '[]'::jsonb) WHERE id = ${state.id}
  `;
  await prisma.$transaction([update, mergeCities]);
}

export async function writeWorldCityEdges(
  tx: Prisma.TransactionClient, cityId: string, connections: EdgeConnection[],
): Promise<string[]> {
  const worlds = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE "World" AS world SET "cities" = (
      SELECT jsonb_agg(
        CASE WHEN entry->>'cityId' = ${cityId}
          THEN jsonb_set(entry, '{edgeConnections}', ${JSON.stringify(connections)}::jsonb)
          ELSE entry END
        ORDER BY ordinal
      )
      FROM jsonb_array_elements(world."cities") WITH ORDINALITY AS city(entry, ordinal)
    )
    WHERE world.id = 'default' AND world."cities" @> ${JSON.stringify([{ cityId }])}::jsonb
    RETURNING world."id"
  `;
  return worlds.map(world => world.id);
}

export async function loadWorldState(worldId: string): Promise<WorldState | null> {
  const world = await prisma.world.findUnique({
    where: { id: worldId },
    // The residents are large and slow to fetch; loadPopulationData gets them separately.
    omit: { populationData: true },
  });

  if (!world) return null;

  return {
    id: world.id,
    name: world.name,
    gridSize: world.gridSize,
    maxCities: world.maxCities,
    cities: world.cities as unknown as WorldState['cities'],
    clock: world.clock as unknown as WorldState['clock'],
    totalPopulation: world.totalPopulation,
    initialPopulation: world.initialPopulation,
    createdAt: world.createdAt.getTime(),
    updatedAt: world.updatedAt.getTime(),
  };
}

export async function loadPopulationData(worldId: string): Promise<unknown[] | null> {
  const world = await prisma.world.findUnique({
    where: { id: worldId },
    select: { populationData: true },
  });

  if (!world) return null;
  return world.populationData as unknown as unknown[];
}

export async function loadOrCreateDefaultWorld(): Promise<{ state: WorldState; isNew: boolean }> {
  const existing = await loadWorldState('default');
  if (existing) return { state: existing, isNew: false };

  const state: WorldState = {
    id: 'default',
    name: 'Earth',
    gridSize: 8,
    maxCities: EARTH_SITES.length,
    cities: [],
    clock: { gameTimeMs: 0, speed: 1, gameDay: 0, gameYear: 1 },
    totalPopulation: 100,
    initialPopulation: 100,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const result = await prisma.world.createMany({
    data: { id: state.id, name: state.name, maxCities: state.maxCities, clock: state.clock as unknown as Prisma.InputJsonValue },
    skipDuplicates: true,
  });
  return result.count ? { state, isNew: true } : { state: (await loadWorldState('default'))!, isNew: false };
}
