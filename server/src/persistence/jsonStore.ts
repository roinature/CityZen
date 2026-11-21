import prisma from './prismaClient.js';
import type { Prisma } from '../generated/prisma/index.js';
import { writeWorldCityEdges } from './worldStore.js';
import type { WorldCityEntry, CityState, PlacedBuilding, RoadOrientation, Loan } from '@cityzen/shared';
import { applySiteTerrain, createEmptyGrid, BUILDING_DEFS, MaslowNeed, getEffectiveSize, BuildingType, calculateEdgeConnections } from '@cityzen/shared';

// Loans are stored in City.loans (JSONB), added by the 20261114000000_city_loans
// migration. Until that migration has been applied the column doesn't exist, so
// it is read and written with raw SQL behind an existence check: the game keeps
// working either way, loans just aren't persisted across server restarts yet.
let loansColumnExists = false;
let loansColumnCheckedAt = 0;
let loansColumnWarned = false;

async function hasLoansColumn(): Promise<boolean> {
  if (loansColumnExists) return true;
  if (Date.now() - loansColumnCheckedAt < 60_000) return false;
  loansColumnCheckedAt = Date.now();
  try {
    const rows = await prisma.$queryRaw<unknown[]>`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'City' AND column_name = 'loans'
    `;
    loansColumnExists = rows.length > 0;
  } catch {
    loansColumnExists = false;
  }
  if (!loansColumnExists && !loansColumnWarned) {
    loansColumnWarned = true;
    console.warn('City.loans column not found — loans will not survive a server restart. Run `npx prisma migrate deploy` in server/.');
  }
  return loansColumnExists;
}

async function loadCityLoans(cityId: string, db: Prisma.TransactionClient, persistLoans: boolean): Promise<Loan[]> {
  if (!persistLoans) return [];
  const rows = await db.$queryRaw<Array<{ loans: unknown }>>`
    SELECT "loans" FROM "City" WHERE "id" = ${cityId}
  `;
  const loans = rows[0]?.loans;
  return Array.isArray(loans) ? (loans as Loan[]) : [];
}

const cityTransactionOptions = { maxWait: 10_000, timeout: 15_000 };

export async function saveCityState(cityId: string, state: CityState, expectedRevision?: number): Promise<number | null> {
  const persistLoans = await hasLoansColumn();
  return prisma.$transaction(async (tx) => {
    if (expectedRevision !== undefined) {
      const revision = await lockCity(tx, cityId);
      if (revision !== expectedRevision) return null;
    }
    return writeCityState(tx, cityId, state, persistLoans, expectedRevision);
  }, cityTransactionOptions);
}

/** Commit the site claim and its playable city together, including across workers. */
export async function foundEarthCity(state: CityState, entry: WorldCityEntry): Promise<number | null> {
  const persistLoans = await hasLoansColumn();
  return prisma.$transaction(async tx => {
    const count = await tx.$executeRaw`
      UPDATE "World" SET "cities" = "cities" || ${JSON.stringify([entry])}::jsonb, "updatedAt" = NOW()
      WHERE "id" = 'default' AND NOT ("cities" @> ${JSON.stringify([{ siteId: entry.siteId }])}::jsonb)
    `;
    if (!count) return null;
    return writeCityState(tx, state.id, state, persistLoans);
  }, cityTransactionOptions);
}

async function lockCity(tx: Prisma.TransactionClient, cityId: string): Promise<number | null> {
  const [row] = await tx.$queryRaw<Array<{ updatedAt: Date }>>`
    SELECT "updatedAt" FROM "City" WHERE "id" = ${cityId} FOR UPDATE
  `;
  return row?.updatedAt.getTime() ?? null;
}

async function writeCityState(
  tx: Prisma.TransactionClient, cityId: string, state: CityState, persistLoans: boolean, previousRevision?: number,
  previousBuildings?: Map<string, PlacedBuilding>,
): Promise<number> {
  const updatedAt = new Date(Math.max(Date.now(), (previousRevision ?? 0) + 1));
  const cityData = {
    siteId: state.siteId,
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
    updatedAt,
  };
  await tx.city.upsert({
    where: { id: cityId },
    update: cityData,
    create: { id: cityId, ...cityData },
  });

  if (persistLoans) {
    const loansJson = JSON.stringify(state.resources.loans ?? []);
    await tx.$executeRaw`UPDATE "City" SET "loans" = ${loansJson}::jsonb WHERE "id" = ${cityId}`;
  }

  const buildingsToWrite = state.buildings.filter(building => previousBuildings?.get(building.id) !== building);
  if (previousBuildings) {
    const currentBuildings = new Map(state.buildings.map(building => [building.id, building]));
    const removedIds = [...previousBuildings].filter(([id, building]) => currentBuildings.get(id) !== building)
      .map(([id]) => id);
    if (removedIds.length) await tx.building.deleteMany({ where: { cityId, id: { in: removedIds } } });
  } else {
    await tx.building.deleteMany({ where: { cityId } });
  }

  if (buildingsToWrite.length) {
    await tx.building.createMany({
      data: buildingsToWrite.map((b) => ({
        id: b.id,
        cityId,
        type: b.type,
        positionX: b.position.x,
        positionZ: b.position.z,
        placedBy: b.placedBy,
        placedAt: b.placedAt,
        developmentLevel: b.developmentLevel ?? null,
        developedAt: b.developedAt ?? null,
        density: b.density ?? null,
        orientation: b.orientation ?? null,
      })),
    });
  }
  return updatedAt.getTime();
}

export async function mutateCityState<T extends { success: boolean; roadsChanged?: boolean }>(
  cityId: string, mutate: (state: CityState) => { result: T; state: CityState },
): Promise<{ result: T; state: CityState; updatedWorldIds: string[] } | null> {
  const persistLoans = await hasLoansColumn();
  return prisma.$transaction(async (tx) => {
    const revision = await lockCity(tx, cityId);
    if (revision === null) return null;
    const savedState = await readCityState(cityId, tx, persistLoans);
    if (!savedState) return null;
    const previousBuildings = new Map(savedState.buildings.map(building => [building.id, building]));
    const { result, state } = mutate(savedState);
    let updatedWorldIds: string[] = [];
    if (result.success) {
      state.updatedAt = await writeCityState(tx, cityId, state, persistLoans, revision, previousBuildings);
      if (result.roadsChanged) {
        const before = calculateEdgeConnections([...previousBuildings.values()]);
        const after = calculateEdgeConnections(state.buildings);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          updatedWorldIds = await writeWorldCityEdges(tx, cityId, after);
        }
      }
    }
    return { result, state, updatedWorldIds };
  }, cityTransactionOptions);
}

export async function loadCityState(cityId: string): Promise<CityState | null> {
  return readCityState(cityId, prisma, await hasLoansColumn());
}

async function readCityState(cityId: string, db: Prisma.TransactionClient, persistLoans: boolean): Promise<CityState | null> {
  const [city, loans] = await Promise.all([
    db.city.findUnique({
      where: { id: cityId },
      include: { buildings: true },
    }),
    loadCityLoans(cityId, db, persistLoans),
  ]);

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
    ...(b.density ? { density: b.density as PlacedBuilding['density'] } : {}),
    ...(b.orientation ? { orientation: b.orientation as RoadOrientation } : {}),
  }));

  // Reconstruct grid from buildings (no empty cells stored)
  const grid = createEmptyGrid();
  applySiteTerrain(grid, city.siteId);
  for (const b of buildings) {
    const { w, d } = getEffectiveSize(b.type as BuildingType, b.orientation);
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        grid[b.position.x + dx][b.position.z + dz].buildingId = b.id;
      }
    }
  }

  return {
    siteId: city.siteId ?? undefined,
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
      loans,
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
