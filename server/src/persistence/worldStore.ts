import prisma from './prismaClient.js';
import type { WorldState } from '@cityzen/shared';
import type { Prisma } from '../generated/prisma/index.js';

export async function saveWorldState(
  state: WorldState,
  populationData?: unknown[],
): Promise<void> {
  await prisma.world.upsert({
    where: { id: state.id },
    update: {
      name: state.name,
      gridSize: state.gridSize,
      maxCities: state.maxCities,
      totalPopulation: state.totalPopulation,
      initialPopulation: state.initialPopulation,
      cities: state.cities as unknown as Prisma.InputJsonValue,
      clock: state.clock as unknown as Prisma.InputJsonValue,
      populationData: (populationData ?? []) as unknown as Prisma.InputJsonValue,
      updatedAt: new Date(),
    },
    create: {
      id: state.id,
      name: state.name,
      gridSize: state.gridSize,
      maxCities: state.maxCities,
      totalPopulation: state.totalPopulation,
      initialPopulation: state.initialPopulation,
      cities: state.cities as unknown as Prisma.InputJsonValue,
      clock: state.clock as unknown as Prisma.InputJsonValue,
      populationData: (populationData ?? []) as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function loadWorldState(worldId: string): Promise<WorldState | null> {
  const world = await prisma.world.findUnique({
    where: { id: worldId },
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

export async function listWorlds(): Promise<Array<{ id: string; name: string; totalPopulation: number; cityCount: number }>> {
  const worlds = await prisma.world.findMany({
    select: { id: true, name: true, totalPopulation: true, cities: true },
  });
  return worlds.map(w => ({
    id: w.id,
    name: w.name,
    totalPopulation: w.totalPopulation,
    cityCount: Array.isArray(w.cities) ? (w.cities as unknown[]).length : 0,
  }));
}

export async function loadOrCreateDefaultWorld(): Promise<{ state: WorldState; isNew: boolean }> {
  const existing = await loadWorldState('default');
  if (existing) return { state: existing, isNew: false };

  const state: WorldState = {
    id: 'default',
    name: 'World',
    gridSize: 8,
    maxCities: 64,
    cities: [],
    clock: { gameTimeMs: 0, speed: 1, gameDay: 0, gameYear: 1 },
    totalPopulation: 100,
    initialPopulation: 100,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveWorldState(state);
  return { state, isNew: true };
}
