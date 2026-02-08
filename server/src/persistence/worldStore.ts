import prisma from './prismaClient.js';
import type { WorldState } from '@cityzen/shared';
import type { Prisma } from '../generated/prisma/index.js';

export async function saveWorldState(state: WorldState): Promise<void> {
  await prisma.world.upsert({
    where: { id: state.id },
    update: {
      name: state.name,
      gridSize: state.gridSize,
      cities: state.cities as unknown as Prisma.InputJsonValue,
      clock: state.clock as unknown as Prisma.InputJsonValue,
      updatedAt: new Date(),
    },
    create: {
      id: state.id,
      name: state.name,
      gridSize: state.gridSize,
      cities: state.cities as unknown as Prisma.InputJsonValue,
      clock: state.clock as unknown as Prisma.InputJsonValue,
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
    cities: world.cities as unknown as WorldState['cities'],
    clock: world.clock as unknown as WorldState['clock'],
    createdAt: world.createdAt.getTime(),
    updatedAt: world.updatedAt.getTime(),
  };
}

export async function loadOrCreateDefaultWorld(): Promise<{ state: WorldState; isNew: boolean }> {
  const existing = await loadWorldState('default');
  if (existing) return { state: existing, isNew: false };

  const state: WorldState = {
    id: 'default',
    name: 'World',
    gridSize: 8,
    cities: [],
    clock: { gameTimeMs: 0, speed: 1, gameDay: 0, gameYear: 1 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveWorldState(state);
  return { state, isNew: true };
}
