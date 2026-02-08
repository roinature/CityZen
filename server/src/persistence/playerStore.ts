import prisma from './prismaClient.js';
import type { PlayerProfile } from '@cityzen/shared';

export async function savePlayerProfile(profile: PlayerProfile): Promise<void> {
  await prisma.player.upsert({
    where: { id: profile.id },
    update: {
      name: profile.name,
      ownedCityId: profile.ownedCityId,
      updatedAt: new Date(),
    },
    create: {
      id: profile.id,
      name: profile.name,
      ownedCityId: profile.ownedCityId,
    },
  });
}

export async function loadPlayerProfile(playerId: string): Promise<PlayerProfile | null> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
  });

  if (!player) return null;

  return {
    id: player.id,
    name: player.name,
    ownedCityId: player.ownedCityId,
    createdAt: player.createdAt.getTime(),
  };
}
