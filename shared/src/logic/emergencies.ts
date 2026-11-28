import { newId } from '../sim/id.js';
import { BUILDING_DEFS } from '../constants/buildings.js';
import {
  BuildingType,
  getEffectiveFleetSize,
  isRoad,
  isUtilityConduit,
  isZone,
  type PlacedBuilding,
} from '../types/building.js';
import type { CityState } from '../types/city.js';
import type { CityEmergency, CityEmergencyKind, CityEmergencyOutcome } from '../types/emergencies.js';
import { MaslowNeed } from '../types/person.js';
import { clearGridBuilding, getEffectiveSize } from './placement.js';
import { evaluateCityUtilities, type UtilityGridReport } from './utilities.js';
import type { PopulationManager } from '../sim/PopulationManager.js';

// ── Tuning Constants ─────────────────────────────────────────

export const MAX_ACTIVE_EMERGENCIES = 3;
/** Minimum city ticks between random emergency spawns in the same city. */
export const EMERGENCY_SPAWN_COOLDOWN_TICKS = 8;
/** Minimum developed buildings or residents before emergencies begin. */
export const EMERGENCY_MIN_DEVELOPED_ZONES = 3;

/** How many city ticks (at 2 s/tick) the service has to arrive on scene before catastrophe. */
export const EMERGENCY_DEADLINE_TICKS: Record<CityEmergencyKind, number> = {
  robbery: 22,          // ~44s
  fire: 26,             // ~52s
  medical: 22,          // ~44s
  sewage_overflow: 28,  // ~56s
};

/** Fallback auto-resolve ticks if a service building covers the city (e.g. headless server ticks without a viewer). */
export const EMERGENCY_AUTO_RESPONSE_TICKS = 16;

const KIND_SERVICE_BUILDINGS: Record<CityEmergencyKind, readonly BuildingType[]> = {
  robbery: [BuildingType.POLICE_STATION, BuildingType.POLICE_HQ],
  fire: [BuildingType.FIRE_STATION, BuildingType.FIRE_HQ],
  medical: [BuildingType.HEALTH_CLINIC, BuildingType.HEALTH_HOSPITAL],
  sewage_overflow: [BuildingType.WATER_SEWAGE_PLANT, BuildingType.SEWAGE_PUMP_STATION],
};

export const EMERGENCY_LABELS: Record<CityEmergencyKind, string> = {
  robbery: 'Robbery in Progress',
  fire: 'Building Fire',
  medical: 'Medical Emergency',
  sewage_overflow: 'Sewage Overflow',
};

// ── Helpers ──────────────────────────────────────────────────

/** Whether a building fronts at least one non-roundabout road tile so a vehicle can reach it. */
export function hasRoadFrontage(state: CityState, b: PlacedBuilding): boolean {
  const { w, d } = getEffectiveSize(b.type, b.orientation);
  const size = state.grid.length;
  const isReachableRoad = (x: number, z: number): boolean => {
    if (x < 0 || z < 0 || x >= size || z >= size) return false;
    const bid = state.grid[x]?.[z]?.buildingId;
    if (!bid) return false;
    const rb = state.buildings.find(item => item.id === bid);
    return !!rb && isRoad(rb.type) && rb.type !== BuildingType.ROAD_ROUNDABOUT;
  };

  for (let dx = 0; dx < w; dx++) {
    if (isReachableRoad(b.position.x + dx, b.position.z - 1)) return true;
    if (isReachableRoad(b.position.x + dx, b.position.z + d)) return true;
  }
  for (let dz = 0; dz < d; dz++) {
    if (isReachableRoad(b.position.x - 1, b.position.z + dz)) return true;
    if (isReachableRoad(b.position.x + w, b.position.z + dz)) return true;
  }
  return false;
}

/** Whether the city has at least one operational service depot of the required kind on a road. */
export function hasOperationalResponder(
  state: CityState,
  kind: CityEmergencyKind,
  utilities?: UtilityGridReport,
): boolean {
  const allowed = KIND_SERVICE_BUILDINGS[kind];
  for (const b of state.buildings) {
    if (!allowed.includes(b.type)) continue;
    if (getEffectiveFleetSize(b) <= 0) continue;
    if (!hasRoadFrontage(state, b)) continue;
    if (utilities) {
      const st = utilities.buildings.get(b.id);
      if (st && st.efficiency <= 0) continue;
    }
    return true;
  }
  return false;
}

function getTargetCandidates(
  state: CityState,
  kind: CityEmergencyKind,
  activeBuildingIds: Set<string>,
  utilities?: UtilityGridReport,
): PlacedBuilding[] {
  const candidates: PlacedBuilding[] = [];
  for (const b of state.buildings) {
    if (activeBuildingIds.has(b.id)) continue;
    if (isRoad(b.type) || isUtilityConduit(b.type)) continue;
    if (isZone(b.type) && (b.developmentLevel ?? 0) <= 0) continue;
    if (!hasRoadFrontage(state, b)) continue;

    if (kind === 'robbery') {
      // Commercial shops, residential homes, and civic offices
      if (
        b.type === BuildingType.ZONE_COMMERCIAL ||
        b.type === BuildingType.ZONE_RESIDENTIAL ||
        b.type === BuildingType.GOV_CITY_HALL
      ) {
        candidates.push(b);
      }
    } else if (kind === 'fire') {
      // Any developed zone or non-park/waterfront structure can catch fire
      if (
        isZone(b.type) ||
        (b.type !== BuildingType.PARK &&
          b.type !== BuildingType.PARKING &&
          b.type !== BuildingType.HEALTH_CEMETERY &&
          b.type !== BuildingType.ART_SCULPTURE_PARK &&
          !KIND_SERVICE_BUILDINGS.fire.includes(b.type))
      ) {
        candidates.push(b);
      }
    } else if (kind === 'medical') {
      if (isZone(b.type)) {
        candidates.push(b);
      }
    } else if (kind === 'sewage_overflow') {
      if (isZone(b.type)) {
        candidates.push(b);
        // Backed-up or unconnected buildings are much more likely to overflow
        const st = utilities?.buildings.get(b.id);
        if (st && !st.drained) {
          candidates.push(b, b);
        }
      }
    }
  }
  return candidates;
}

/** Pick a random emergency to spawn on this tick, or null if none triggers. */
export function maybeSpawnEmergency(
  state: CityState,
  lastSpawnTick: number,
  rng: () => number = Math.random,
): CityEmergency | null {
  const active = state.emergencies ?? [];
  if (active.length >= MAX_ACTIVE_EMERGENCIES) return null;
  if (state.tick - lastSpawnTick < EMERGENCY_SPAWN_COOLDOWN_TICKS) return null;

  const developedZones = state.buildings.filter(b => isZone(b.type) && (b.developmentLevel ?? 0) > 0);
  if (developedZones.length < EMERGENCY_MIN_DEVELOPED_ZONES && state.resources.population < 12) {
    return null;
  }

  // Base per-tick probability scales mildly with city size (~5% to ~11% per tick when off cooldown)
  const scale = Math.min(1, developedZones.length / 40);
  const spawnChance = 0.05 + 0.06 * scale;
  if (rng() >= spawnChance) return null;

  const utilities = evaluateCityUtilities(state);
  const activeKinds = new Set(active.map(e => e.kind));
  const activeBuildingIds = new Set(active.map(e => e.buildingId));

  // Weight emergency types by city conditions (e.g. backed up sewage raises overflow risk)
  const weights: Array<{ kind: CityEmergencyKind; weight: number }> = [
    { kind: 'robbery', weight: activeKinds.has('robbery') ? 0.25 : 1.0 },
    { kind: 'fire', weight: activeKinds.has('fire') ? 0.25 : 1.0 },
    { kind: 'medical', weight: state.resources.population > 0 ? (activeKinds.has('medical') ? 0.25 : 1.0) : 0 },
    {
      kind: 'sewage_overflow',
      weight: (activeKinds.has('sewage_overflow') ? 0.25 : 0.85) +
        (utilities.summary.backedUpBuildings > 0 ? 1.2 : 0),
    },
  ];

  // Shuffle/pick weighted order
  const pool = weights.filter(w => w.weight > 0);
  while (pool.length > 0) {
    const totalW = pool.reduce((sum, item) => sum + item.weight, 0);
    let roll = rng() * totalW;
    let pickedIdx = 0;
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i].weight;
      if (roll <= 0) {
        pickedIdx = i;
        break;
      }
    }
    const [{ kind }] = pool.splice(pickedIdx, 1);
    const candidates = getTargetCandidates(state, kind, activeBuildingIds, utilities);
    if (candidates.length === 0) continue;

    const target = candidates[Math.floor(rng() * candidates.length)];
    return createEmergency(state.tick, kind, target);
  }

  return null;
}

export function createEmergency(
  tick: number,
  kind: CityEmergencyKind,
  building: PlacedBuilding,
): CityEmergency {
  return {
    id: newId(),
    kind,
    buildingId: building.id,
    position: { x: building.position.x, z: building.position.z },
    startedAtTick: tick,
    deadlineTick: tick + EMERGENCY_DEADLINE_TICKS[kind],
  };
}

// ── Consequence Application ──────────────────────────────────

function killResidentsNearBuilding(
  populationManager: PopulationManager | undefined,
  cityId: string,
  buildingId: string,
  count: number,
  shockNeed?: MaslowNeed,
): number {
  if (!populationManager || count <= 0) return 0;
  const citizens = populationManager.getCityPopulation(cityId);
  if (citizens.length === 0) return 0;

  // Prefer residents living in the affected zone first, then random citizens in the city
  const inBuilding = citizens.filter(p => p.residenceZoneId === buildingId);
  const others = citizens.filter(p => p.residenceZoneId !== buildingId);
  const ordered = [...inBuilding, ...others];

  const victims = ordered.slice(0, count);
  for (const victim of victims) {
    populationManager.death(victim.id);
  }

  if (shockNeed) {
    for (const survivor of populationManager.getCityPopulation(cityId)) {
      survivor.maslow[shockNeed] = Math.max(0, survivor.maslow[shockNeed] - 8);
    }
  }

  return victims.length;
}

/**
 * Apply the failure consequences of an unaddressed emergency to the city state
 * (and optional PopulationManager). Mutates `state` in place and returns the outcome.
 */
export function failEmergency(
  state: CityState,
  emergency: CityEmergency,
  populationManager?: PopulationManager,
): CityEmergencyOutcome {
  const target = state.buildings.find(b => b.id === emergency.buildingId);
  let deaths = 0;
  let moneyLost = 0;
  let destroyedBuildingId: string | undefined;
  let razedZoneId: string | undefined;
  let damagedZoneId: string | undefined;
  let summary = '';

  switch (emergency.kind) {
    case 'fire': {
      // Unchecked fire burns the building to the ground and causes casualties!
      const rawDeaths = state.resources.population > 0 ? Math.min(state.resources.population, 2 + Math.floor(Math.random() * 3)) : 0;
      deaths = populationManager
        ? killResidentsNearBuilding(populationManager, state.id, emergency.buildingId, rawDeaths, MaslowNeed.SAFETY)
        : rawDeaths;
      if (!populationManager && deaths > 0) {
        state.resources.population = Math.max(0, state.resources.population - deaths);
      }

      if (target) {
        if (isZone(target.type)) {
          target.developmentLevel = 0;
          target.developedAt = state.tick;
          razedZoneId = target.id;
        } else {
          clearGridBuilding(state.grid, target);
          state.buildings = state.buildings.filter(b => b.id !== target.id);
          destroyedBuildingId = target.id;
        }
      }
      state.resources.happiness = Math.max(0, state.resources.happiness - 6);
      summary = deaths > 0
        ? `Fire burned down ${target ? BUILDING_DEFS[target.type].label : 'a building'} and claimed ${deaths} ${deaths === 1 ? 'life' : 'lives'}! Build a Fire Station nearby.`
        : `Fire destroyed ${target ? BUILDING_DEFS[target.type].label : 'a building'}! Build a Fire Station to protect the city.`;
      break;
    }

    case 'robbery': {
      // Unchecked robbery loots funds, damages/loots the property, and may cause a fatality!
      moneyLost = Math.min(Math.max(150, Math.floor(Math.max(0, state.resources.money) * 0.06)), 1200);
      state.resources.money -= moneyLost;

      const fatal = state.resources.population > 3 && Math.random() < 0.45 ? 1 : 0;
      deaths = populationManager
        ? killResidentsNearBuilding(populationManager, state.id, emergency.buildingId, fatal, MaslowNeed.SAFETY)
        : fatal;
      if (!populationManager && deaths > 0) {
        state.resources.population = Math.max(0, state.resources.population - deaths);
      }

      if (target && isZone(target.type) && (target.developmentLevel ?? 0) > 0) {
        target.developmentLevel = Math.max(0, (target.developmentLevel ?? 1) - 1);
        target.developedAt = state.tick;
        if (target.developmentLevel === 0) razedZoneId = target.id;
        else damagedZoneId = target.id;
      }
      state.resources.happiness = Math.max(0, state.resources.happiness - 4);
      summary = deaths > 0
        ? `Robbers looted $${moneyLost}, trashed the building, and killed ${deaths} citizen! Build a Police Station.`
        : `Robbers escaped with $${moneyLost} and trashed the building! Build a Police Station to stop crime.`;
      break;
    }

    case 'medical': {
      // Untreated medical emergency leads to citizen deaths!
      const rawDeaths = state.resources.population > 0 ? Math.min(state.resources.population, 1 + Math.floor(Math.random() * 3)) : 0;
      deaths = populationManager
        ? killResidentsNearBuilding(populationManager, state.id, emergency.buildingId, rawDeaths, MaslowNeed.LOVE_BELONGING)
        : rawDeaths;
      if (!populationManager && deaths > 0) {
        state.resources.population = Math.max(0, state.resources.population - deaths);
      }
      state.resources.happiness = Math.max(0, state.resources.happiness - 5);
      summary = deaths > 0
        ? `No ambulance arrived in time — ${deaths} ${deaths === 1 ? 'citizen died' : 'citizens died'} from a medical emergency! Build a Clinic or Hospital.`
        : `A medical emergency went unanswered! Build a Clinic or Hospital.`;
      break;
    }

    case 'sewage_overflow': {
      // Toxic sewage backup ruins property, costs cleanup money, and causes disease deaths!
      moneyLost = 250;
      state.resources.money -= moneyLost;

      const rawDeaths = state.resources.population > 2 ? Math.min(state.resources.population, 1 + Math.floor(Math.random() * 2)) : 0;
      deaths = populationManager
        ? killResidentsNearBuilding(populationManager, state.id, emergency.buildingId, rawDeaths, MaslowNeed.PHYSIOLOGICAL)
        : rawDeaths;
      if (!populationManager && deaths > 0) {
        state.resources.population = Math.max(0, state.resources.population - deaths);
      }

      if (target && isZone(target.type) && (target.developmentLevel ?? 0) > 0) {
        target.developmentLevel = Math.max(0, (target.developmentLevel ?? 1) - 1);
        target.developedAt = state.tick;
        if (target.developmentLevel === 0) razedZoneId = target.id;
        else damagedZoneId = target.id;
      }
      state.resources.happiness = Math.max(0, state.resources.happiness - 5);
      summary = deaths > 0
        ? `Toxic sewage overflow condemned a building, cost $${moneyLost} in cleanup, and killed ${deaths} ${deaths === 1 ? 'resident' : 'residents'}! Build a Sewage Station or Plant.`
        : `Sewage overflow ruined a building and cost $${moneyLost} in emergency cleanup! Build a Sewage Station or Plant.`;
      break;
    }
  }

  return {
    emergency,
    resolution: 'failed',
    deaths,
    moneyLost,
    destroyedBuildingId,
    razedZoneId,
    damagedZoneId,
    summary,
  };
}

export function resolveEmergencyOutcome(emergency: CityEmergency): CityEmergencyOutcome {
  const responderName: Record<CityEmergencyKind, string> = {
    robbery: 'Police officers arrested the suspects and secured the scene.',
    fire: 'Firefighters extinguished the blaze before the building collapsed.',
    medical: 'Paramedics stabilized and rescued the patient in time.',
    sewage_overflow: 'Sanitation crews pumped out and contained the sewage overflow.',
  };
  return {
    emergency,
    resolution: 'resolved',
    deaths: 0,
    moneyLost: 0,
    summary: responderName[emergency.kind],
  };
}
