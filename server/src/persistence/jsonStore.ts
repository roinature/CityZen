import prisma from './prismaClient.js';
import type { CityState } from '@cityzen/shared';
import type { Prisma } from '../generated/prisma/index.js';

export async function saveCityState(cityId: string, state: CityState): Promise<void> {
  await prisma.city.upsert({
    where: { id: cityId },
    update: {
      name: state.name,
      ownerId: state.ownerId || '',
      state: state as unknown as Prisma.InputJsonValue,
      updatedAt: new Date(),
    },
    create: {
      id: cityId,
      name: state.name,
      ownerId: state.ownerId || '',
      state: state as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function loadCityState(cityId: string): Promise<CityState | null> {
  const city = await prisma.city.findUnique({
    where: { id: cityId },
  });

  if (!city) return null;
  return city.state as unknown as CityState;
}

export async function listSavedCities(): Promise<string[]> {
  const cities = await prisma.city.findMany({
    select: { id: true },
  });
  return cities.map(c => c.id);
}

export async function deleteCityState(cityId: string): Promise<void> {
  await prisma.city.delete({
    where: { id: cityId },
  }).catch(() => {
    // City may not exist
  });
}
