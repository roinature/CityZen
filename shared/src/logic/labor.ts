import type { CityState } from '../types/city.js';
import { BuildingType, isZone, type ZoneType } from '../types/building.js';
import { BUILDING_DEFS, getZoneLevelDef } from '../constants/buildings.js';
import {
  WORKFORCE_PARTICIPATION,
  WORKFORCE_SHARE_FALLBACK,
  COMMUTER_JOBS,
} from '../constants/economy.js';

export interface LaborStats {
  /** Jobs offered by developed commercial + industrial zones. */
  jobs: number;
  commercialJobs: number;
  industrialJobs: number;
  /** Residents who want a job. */
  workers: number;
  /** Workers with a job inside the city (these are the ones businesses pay tax on). */
  employed: number;
  /** Share of workers with any job, counting the few who can commute out of town (0-1). */
  employmentRate: number;
  housingCapacity: number;
}

/** Jobs, workers and housing of a city: the numbers demand and taxes are both built on. */
export function calculateLaborStats(state: CityState): LaborStats {
  let commercialJobs = 0;
  let industrialJobs = 0;
  let housingCapacity = 0;

  for (const b of state.buildings) {
    housingCapacity += BUILDING_DEFS[b.type]?.effects?.populationCapacity ?? 0;
    if (!isZone(b.type) || !b.developmentLevel || b.developmentLevel <= 0) continue;

    const levelDef = getZoneLevelDef(b.type as ZoneType, b.density, b.developmentLevel);
    housingCapacity += levelDef.populationCapacity;
    if (b.type === BuildingType.ZONE_COMMERCIAL) commercialJobs += levelDef.jobs;
    else if (b.type === BuildingType.ZONE_INDUSTRIAL) industrialJobs += levelDef.jobs;
  }

  const summary = state.resources.populationSummary;
  const workers = summary
    ? (summary.youngAdults + summary.adults) * WORKFORCE_PARTICIPATION
    : state.resources.population * WORKFORCE_SHARE_FALLBACK;

  const jobs = commercialJobs + industrialJobs;
  const employed = Math.min(workers, jobs);
  const employmentRate = workers > 0 ? Math.min(1, (jobs + COMMUTER_JOBS) / workers) : 1;

  return { jobs, commercialJobs, industrialJobs, workers, employed, employmentRate, housingCapacity };
}
