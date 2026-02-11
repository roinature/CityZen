import prisma from './prismaClient.js';
import type { CityState, PlacedBuilding } from '@cityzen/shared';
import { createEmptyGrid, BUILDING_DEFS, MaslowNeed } from '@cityzen/shared';

export async function saveCityState(cityId: string, state: CityState): Promise<void> {
  // Use interactive transaction with increased timeout (15s) to handle large city saves
  await prisma.$transaction(async (tx) => {
    // 1. Upsert city metadata (resources, clock, tick)
    await tx.city.upsert({
      where: { id: cityId },
      update: {
        name: state.name,
        ownerId: state.ownerId || '',
        money: state.resources.money,
        population: state.resources.population,
        happiness: state.resources.happiness,
        taxRate: state.resources.taxRate,
        demandResidential: state.resources.demand.residential,
        demandCommercial: state.resources.demand.commercial,
        demandIndustrial: state.resources.demand.industrial,
        clockGameTimeMs: state.clock.gameTimeMs,
        clockSpeed: state.clock.speed,
        clockGameDay: state.clock.gameDay,
        clockGameYear: state.clock.gameYear,
        maslowPhysiological: state.resources.populationSummary?.averageMaslow?.[MaslowNeed.PHYSIOLOGICAL] ?? 50,
        maslowSafety: state.resources.populationSummary?.averageMaslow?.[MaslowNeed.SAFETY] ?? 50,
        maslowLoveBelonging: state.resources.populationSummary?.averageMaslow?.[MaslowNeed.LOVE_BELONGING] ?? 50,
        maslowEsteem: state.resources.populationSummary?.averageMaslow?.[MaslowNeed.ESTEEM] ?? 50,
        maslowCognitive: state.resources.populationSummary?.averageMaslow?.[MaslowNeed.COGNITIVE] ?? 50,
        maslowAesthetic: state.resources.populationSummary?.averageMaslow?.[MaslowNeed.AESTHETIC] ?? 50,
        maslowSelfActualization: state.resources.populationSummary?.averageMaslow?.[MaslowNeed.SELF_ACTUALIZATION] ?? 50,
        tick: state.tick,
        updatedAt: new Date(),
      },
      create: {
        id: cityId,
        name: state.name,
        ownerId: state.ownerId || '',
        money: state.resources.money,
        population: state.resources.population,
        happiness: state.resources.happiness,
        taxRate: state.resources.taxRate,
        demandResidential: state.resources.demand.residential,
        demandCommercial: state.resources.demand.commercial,
        demandIndustrial: state.resources.demand.industrial,
        clockGameTimeMs: state.clock.gameTimeMs,
        clockSpeed: state.clock.speed,
        clockGameDay: state.clock.gameDay,
        clockGameYear: state.clock.gameYear,
        maslowPhysiological: state.resources.populationSummary?.averageMaslow?.[MaslowNeed.PHYSIOLOGICAL] ?? 50,
        maslowSafety: state.resources.populationSummary?.averageMaslow?.[MaslowNeed.SAFETY] ?? 50,
        maslowLoveBelonging: state.resources.populationSummary?.averageMaslow?.[MaslowNeed.LOVE_BELONGING] ?? 50,
        maslowEsteem: state.resources.populationSummary?.averageMaslow?.[MaslowNeed.ESTEEM] ?? 50,
        maslowCognitive: state.resources.populationSummary?.averageMaslow?.[MaslowNeed.COGNITIVE] ?? 50,
        maslowAesthetic: state.resources.populationSummary?.averageMaslow?.[MaslowNeed.AESTHETIC] ?? 50,
        maslowSelfActualization: state.resources.populationSummary?.averageMaslow?.[MaslowNeed.SELF_ACTUALIZATION] ?? 50,
        tick: state.tick,
      },
    });

    // 2. Replace all buildings: delete existing, then bulk insert
    await tx.building.deleteMany({ where: { cityId } });

    if (state.buildings.length > 0) {
      await tx.building.createMany({
        data: state.buildings.map((b) => ({
          id: b.id,
          cityId,
          type: b.type,
          positionX: b.position.x,
          positionZ: b.position.z,
          placedBy: b.placedBy,
          placedAt: b.placedAt,
          developmentLevel: b.developmentLevel ?? null,
          developedAt: b.developedAt ?? null,
        })),
      });
    }
  }, {
    maxWait: 10000, // Wait up to 10s to acquire a connection
    timeout: 15000, // 15s execution timeout
  });
}

export async function loadCityState(cityId: string): Promise<CityState | null> {
  const city = await prisma.city.findUnique({
    where: { id: cityId },
    include: { buildings: true },
  });

  if (!city) return null;

  // Reconstruct buildings array
  const buildings: PlacedBuilding[] = city.buildings.map((b: typeof city.buildings[number]) => ({
    id: b.id,
    type: b.type as PlacedBuilding['type'],
    position: { x: b.positionX, z: b.positionZ },
    placedBy: b.placedBy,
    placedAt: b.placedAt,
    ...(b.developmentLevel != null ? { developmentLevel: b.developmentLevel } : {}),
    ...(b.developedAt != null ? { developedAt: b.developedAt } : {}),
  }));

  // Reconstruct grid from buildings (no empty cells stored)
  const grid = createEmptyGrid();
  for (const b of buildings) {
    const def = BUILDING_DEFS[b.type as keyof typeof BUILDING_DEFS];
    if (def) {
      for (let dx = 0; dx < def.size.w; dx++) {
        for (let dz = 0; dz < def.size.d; dz++) {
          grid[b.position.x + dx][b.position.z + dz].buildingId = b.id;
        }
      }
    }
  }

  return {
    id: city.id,
    name: city.name,
    ownerId: city.ownerId,
    grid,
    buildings,
    resources: {
      money: city.money,
      population: city.population,
      happiness: city.happiness,
      taxRate: city.taxRate,
      demand: {
        residential: city.demandResidential,
        commercial: city.demandCommercial,
        industrial: city.demandIndustrial,
      },
      // Restore Maslow summary stub — full summary recomputed by PopulationManager on first tick
      populationSummary: city.population > 0 ? {
        total: city.population,
        children: 0,
        teens: 0,
        youngAdults: 0,
        adults: 0,
        elders: 0,
        averageHappiness: city.happiness,
        averageMaslow: {
          [MaslowNeed.PHYSIOLOGICAL]: city.maslowPhysiological,
          [MaslowNeed.SAFETY]: city.maslowSafety,
          [MaslowNeed.LOVE_BELONGING]: city.maslowLoveBelonging,
          [MaslowNeed.ESTEEM]: city.maslowEsteem,
          [MaslowNeed.COGNITIVE]: city.maslowCognitive,
          [MaslowNeed.AESTHETIC]: city.maslowAesthetic,
          [MaslowNeed.SELF_ACTUALIZATION]: city.maslowSelfActualization,
        },
      } : undefined,
    },
    clock: {
      gameTimeMs: city.clockGameTimeMs,
      speed: city.clockSpeed,
      gameDay: city.clockGameDay,
      gameYear: city.clockGameYear,
    },
    tick: city.tick,
    createdAt: city.createdAt.getTime(),
    updatedAt: city.updatedAt.getTime(),
  };
}

export async function listSavedCities(): Promise<string[]> {
  const cities = await prisma.city.findMany({
    select: { id: true },
  });
  return cities.map((c: { id: string }) => c.id);
}

export async function deleteCityState(cityId: string): Promise<void> {
  await prisma.city.delete({
    where: { id: cityId },
  }).catch(() => {
    // City may not exist
  });
}
