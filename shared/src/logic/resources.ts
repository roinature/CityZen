import type { CityState } from '../types/city.js';
import type { CityMilestone, ResourceState, TaxRates } from '../types/resources.js';
import { BUILDING_DEFS, getZoneLevelDef } from '../constants/buildings.js';
import {
  BuildingType, SERVICE_BUILDING_FLEETS, UTILITY_PUMP_LEVELS, ZoneDensity,
  getEffectiveFleetSize, getEffectivePumpLevel, isRoad, isUtilityConduit, isZone,
  INFRA_ENERGY_TYPES, INFRA_WATER_TYPES, INFRA_SEWAGE_TYPES,
  INFRA_POLICE_TYPES, INFRA_FIRE_TYPES, INFRA_TRANS_TYPES,
  type PlacedBuilding, type ZoneType,
} from '../types/building.js';
import {
  TAX_PER_PERSON, TAX_PER_PERSON_FALLBACK, DEFICIT_MASLOW_PENALTY_RATE, MIN_BUDGET_MULTIPLIER,
  TAX_COMFORT_RATE, TAX_MASLOW_PENALTY_PER_POINT, TAX_MASLOW_BONUS_PER_POINT, MAX_TAX_MASLOW_BONUS,
  UNEMPLOYED_INCOME_SHARE, COMMERCIAL_INCOME_PER_JOB, INDUSTRIAL_INCOME_PER_JOB,
  ZONE_LEVEL_TAX_MULTIPLIER, ZONE_DENSITY_TAX_MULTIPLIER,
  TAX_LAFFER_THRESHOLD, TAX_LAFFER_DECAY, MIN_TAX_COMPLIANCE,
  TAX_DEMAND_BOOST_PER_POINT, TAX_DEMAND_DRAG_PER_POINT,
  SMALL_TOWN_SUBSIDY_MAX, SMALL_TOWN_SUBSIDY_FULL_POP, SMALL_TOWN_SUBSIDY_FADE_POP,
  CITY_MILESTONES,
  PLANNED_TOWN_MIN_MONEY, PLANNED_TOWN_MAX_MONEY, PLANNED_TOWN_RUNWAY_TICKS,
} from '../constants/economy.js';
import { LifeStage } from '../types/person.js';
import { calculateLaborStats } from './labor.js';
import { evaluateCityUtilities } from './utilities.js';

const round2 = (n: number): number => Math.round(n * 100) / 100;

const UTILITY_BUILDING_SET = new Set<BuildingType>([
  ...INFRA_ENERGY_TYPES,
  ...INFRA_WATER_TYPES,
  ...INFRA_SEWAGE_TYPES,
]);
const SAFETY_BUILDING_SET = new Set<BuildingType>([
  ...INFRA_POLICE_TYPES,
  ...INFRA_FIRE_TYPES,
]);
const TRANSIT_BUILDING_SET = new Set<BuildingType>([
  ...INFRA_TRANS_TYPES,
  BuildingType.PARKING,
]);

export interface TaxBreakdown {
  /** Income + property-value tax paid by residents. */
  residents: number;
  /** Tax paid by commercial businesses (shops/offices). */
  commercial: number;
  /** Tax paid by industrial businesses (factories/warehouses). */
  industrial: number;
  /** Combined commercial + industrial business taxes. */
  businesses: number;
  /** Tapering municipal startup subsidy for small towns (< 150 pop). */
  subsidy: number;
  /** Effective Laffer-curve collection efficiency (0.45–1.0) per sector. */
  compliance: TaxRates;
  /** Exact total per-tick revenue (residents + businesses + subsidy). */
  total: number;
}

export interface ExpenseBreakdown {
  utilities: number;
  safety: number;
  civic: number;
  roads: number;
  zones: number;
  total: number;
}

export interface MilestoneEvaluation {
  newlyClaimed: CityMilestone[];
  nextMilestone: CityMilestone | null;
  totalGrant: number;
}

/** Resolve per-sector tax rates, falling back to legacy unified `taxRate`. */
export function getEffectiveTaxRates(
  resources: Pick<ResourceState, 'taxRate' | 'taxRates'>,
): TaxRates {
  const fallback = resources.taxRate;
  return {
    residential: resources.taxRates?.residential ?? fallback,
    commercial: resources.taxRates?.commercial ?? fallback,
    industrial: resources.taxRates?.industrial ?? fallback,
  };
}

/** Integer average tax rate for legacy display & DB column compatibility. */
export function getAverageTaxRate(rates: TaxRates): number {
  return Math.round((rates.residential + rates.commercial + rates.industrial) / 3);
}

/**
 * Laffer curve collection efficiency (0.45–1.0).
 * Rates up to 12% collect at 100% efficiency; higher rates trigger avoidance
 * and capital flight, creating diminishing returns at punitive levels.
 */
export function calculateTaxCompliance(rate: number): number {
  if (rate <= TAX_LAFFER_THRESHOLD) return 1.0;
  const excess = rate - TAX_LAFFER_THRESHOLD;
  return Math.max(MIN_TAX_COMPLIANCE, 1.0 - TAX_LAFFER_DECAY * excess * excess);
}

/**
 * Signed demand modifier from a sector's tax rate.
 * Below TAX_COMFORT_RATE (9%): positive incentive boost.
 * 9%–10%: neutral band (no drag on default/legacy cities).
 * Above 10%: negative tax drag that suppresses demand.
 */
export function calculateTaxDemandEffect(rate: number): number {
  if (rate < TAX_COMFORT_RATE) {
    return (TAX_COMFORT_RATE - rate) * TAX_DEMAND_BOOST_PER_POINT;
  }
  if (rate <= TAX_COMFORT_RATE + 1) return 0;
  return -(rate - (TAX_COMFORT_RATE + 1)) * TAX_DEMAND_DRAG_PER_POINT;
}

/**
 * Tapering municipal startup subsidy ($/tick) for small towns.
 * Cushions starter utilities & services until population reaches 150.
 */
export function calculateSmallTownSubsidy(state: CityState): number {
  const pop = state.resources.population;
  if (pop <= 0 || pop >= SMALL_TOWN_SUBSIDY_FADE_POP) return 0;
  if (pop <= SMALL_TOWN_SUBSIDY_FULL_POP) return SMALL_TOWN_SUBSIDY_MAX;
  const fade = (SMALL_TOWN_SUBSIDY_FADE_POP - pop) / (SMALL_TOWN_SUBSIDY_FADE_POP - SMALL_TOWN_SUBSIDY_FULL_POP);
  return round2(SMALL_TOWN_SUBSIDY_MAX * fade);
}

/** Economic value multiplier for a developed zone building based on level and density. */
export function getZoneTaxValueMultiplier(building: PlacedBuilding): number {
  const level = building.developmentLevel ?? 0;
  if (level <= 0) return 1.0;
  const levelMult = ZONE_LEVEL_TAX_MULTIPLIER[Math.min(level, ZONE_LEVEL_TAX_MULTIPLIER.length) - 1] ?? 1.0;
  const densityMult = ZONE_DENSITY_TAX_MULTIPLIER[building.density ?? ZoneDensity.MEDIUM] ?? 1.0;
  return levelMult * densityMult;
}

/** Evaluate which population milestones are newly reached and which milestone comes next. */
export function evaluateMilestones(
  population: number,
  claimedIds: readonly string[] = [],
): MilestoneEvaluation {
  const claimed = new Set(claimedIds);
  const newlyClaimed: CityMilestone[] = [];
  let nextMilestone: CityMilestone | null = null;
  let totalGrant = 0;

  for (const m of CITY_MILESTONES) {
    if (claimed.has(m.id)) continue;
    if (population >= m.population) {
      newlyClaimed.push(m);
      totalGrant += m.grant;
    } else if (!nextMilestone) {
      nextMilestone = m;
    }
  }

  return { newlyClaimed, nextMilestone, totalGrant };
}

/**
 * Where the city's per-tick revenue comes from:
 * - Residents pay income & property-value taxes (scaled by employment, zone tier, & compliance).
 * - Commercial & Industrial zones pay per filled job (scaled by sector rate, zone tier, utility efficiency, & compliance).
 * - Small towns (< 150 pop) receive a tapering municipal startup subsidy.
 */
export function calculateTaxBreakdown(state: CityState): TaxBreakdown {
  const rates = getEffectiveTaxRates(state.resources);
  const compliance: TaxRates = {
    residential: calculateTaxCompliance(rates.residential),
    commercial: calculateTaxCompliance(rates.commercial),
    industrial: calculateTaxCompliance(rates.industrial),
  };

  const { employed, employmentRate, commercialJobs, industrialJobs, jobs } = calculateLaborStats(state);
  const incomeFactor = UNEMPLOYED_INCOME_SHARE + (1 - UNEMPLOYED_INCOME_SHARE) * employmentRate;

  const summary = state.resources.populationSummary;
  const residentBaseIncome = summary
    ? (summary.youngAdults * TAX_PER_PERSON[LifeStage.YOUNG_ADULT] +
        summary.adults * TAX_PER_PERSON[LifeStage.ADULT]) * incomeFactor +
      summary.elders * TAX_PER_PERSON[LifeStage.ELDER]
    : state.resources.population * TAX_PER_PERSON_FALLBACK * incomeFactor;

  const utilities = evaluateCityUtilities(state);

  // Compute capacity/job-weighted average value multipliers & utility efficiency per zone sector
  let resWeight = 0;
  let resValueSum = 0;
  let comWeight = 0;
  let comValueEffSum = 0;
  let indWeight = 0;
  let indValueEffSum = 0;

  for (const b of state.buildings) {
    if (!isZone(b.type) || (b.developmentLevel ?? 0) <= 0) continue;
    const levelDef = getZoneLevelDef(b.type as ZoneType, b.density, b.developmentLevel!);
    const valMult = getZoneTaxValueMultiplier(b);
    const eff = utilities.buildings.get(b.id)?.efficiency ?? 1;

    if (b.type === BuildingType.ZONE_RESIDENTIAL) {
      const w = Math.max(1, levelDef.populationCapacity);
      resWeight += w;
      resValueSum += w * valMult;
    } else if (b.type === BuildingType.ZONE_COMMERCIAL) {
      const w = Math.max(1, levelDef.jobs);
      comWeight += w;
      comValueEffSum += w * valMult * eff;
    } else if (b.type === BuildingType.ZONE_INDUSTRIAL) {
      const w = Math.max(1, levelDef.jobs);
      indWeight += w;
      indValueEffSum += w * valMult * eff;
    }
  }

  const resValueFactor = resWeight > 0 ? resValueSum / resWeight : 1.0;
  const comValueEffFactor = comWeight > 0 ? comValueEffSum / comWeight : 1.0;
  const indValueEffFactor = indWeight > 0 ? indValueEffSum / indWeight : 1.0;

  // Split filled city jobs between commercial and industrial proportionally to offered jobs
  const comShare = jobs > 0 ? commercialJobs / jobs : 0;
  const indShare = jobs > 0 ? industrialJobs / jobs : 0;
  const employedCom = employed * comShare;
  const employedInd = employed * indShare;

  const residents = round2(residentBaseIncome * resValueFactor * (rates.residential / 100) * compliance.residential);
  const commercial = round2(
    employedCom * COMMERCIAL_INCOME_PER_JOB * comValueEffFactor * (rates.commercial / 100) * compliance.commercial,
  );
  const industrial = round2(
    employedInd * INDUSTRIAL_INCOME_PER_JOB * indValueEffFactor * (rates.industrial / 100) * compliance.industrial,
  );
  const businesses = round2(commercial + industrial);
  const subsidy = calculateSmallTownSubsidy(state);
  const total = round2(residents + businesses + subsidy);

  return { residents, commercial, industrial, businesses, subsidy, compliance, total };
}

export function calculateTaxRevenue(state: CityState): number {
  return calculateTaxBreakdown(state).total;
}

/**
 * Calculate budget penalty multiplier (0.5–1.0).
 * When money hits 0, infrastructure starts degrading.
 * Deeper deficit = lower multiplier = lower Maslow targets.
 */
export function calculateBudgetPenalty(money: number): number {
  if (money > 0) return 1.0;
  const deficit = Math.abs(money);
  const multiplier = 1.0 - deficit * DEFICIT_MASLOW_PENALTY_RATE;
  return Math.max(multiplier, MIN_BUDGET_MULTIPLIER);
}

/**
 * Residential tax happiness multiplier (0.55–1.04) applied to Maslow targets.
 * Rates below TAX_COMFORT_RATE (9%) grant a mild happiness bonus;
 * rates above it reduce citizen satisfaction across all needs.
 */
export function calculateTaxPenalty(
  taxRateOrResources: number | Pick<ResourceState, 'taxRate' | 'taxRates'>,
): number {
  const resRate = typeof taxRateOrResources === 'number'
    ? taxRateOrResources
    : getEffectiveTaxRates(taxRateOrResources).residential;
  if (resRate < TAX_COMFORT_RATE) {
    const bonus = Math.min(MAX_TAX_MASLOW_BONUS, (TAX_COMFORT_RATE - resRate) * TAX_MASLOW_BONUS_PER_POINT);
    return 1.0 + bonus;
  }
  const excess = resRate - TAX_COMFORT_RATE;
  return Math.max(0.5, 1.0 - excess * TAX_MASLOW_PENALTY_PER_POINT);
}

export function getBuildingMaintenance(b: PlacedBuilding): number {
  const def = BUILDING_DEFS[b.type];
  let maint = def?.effects?.maintenance ?? 0;

  if (isZone(b.type) && b.developmentLevel && b.developmentLevel > 0) {
    const levelDef = getZoneLevelDef(b.type as ZoneType, b.density, b.developmentLevel!);
    maint += levelDef.maintenance;
  }

  const fleetCfg = SERVICE_BUILDING_FLEETS[b.type];
  if (fleetCfg) {
    const effective = getEffectiveFleetSize(b);
    const delta = (effective - fleetCfg.defaultFleet) * fleetCfg.upkeepPerUnit;
    maint = Math.max(Math.ceil(maint * 0.4), maint + delta);
  }

  const pumpCfg = UTILITY_PUMP_LEVELS[b.type];
  if (pumpCfg) {
    const level = getEffectivePumpLevel(b);
    maint += (level - pumpCfg.defaultLevel) * pumpCfg.upkeepPerLevel;
  }

  return maint;
}

/** Categorized per-tick maintenance breakdown for transparent budgeting. */
export function calculateExpenseBreakdown(state: CityState): ExpenseBreakdown {
  let utilities = 0;
  let safety = 0;
  let civic = 0;
  let roads = 0;
  let zones = 0;

  for (const b of state.buildings) {
    const maint = getBuildingMaintenance(b);
    if (maint <= 0) continue;

    if (isZone(b.type)) {
      zones += maint;
    } else if (isRoad(b.type) || TRANSIT_BUILDING_SET.has(b.type)) {
      roads += maint;
    } else if (isUtilityConduit(b.type) || UTILITY_BUILDING_SET.has(b.type)) {
      utilities += maint;
    } else if (SAFETY_BUILDING_SET.has(b.type)) {
      safety += maint;
    } else {
      civic += maint;
    }
  }

  const total = round2(utilities + safety + civic + roads + zones);
  return {
    utilities: round2(utilities),
    safety: round2(safety),
    civic: round2(civic),
    roads: round2(roads),
    zones: round2(zones),
    total,
  };
}

export function calculateMaintenance(state: CityState): number {
  return round2(state.buildings.reduce((sum, b) => sum + getBuildingMaintenance(b), 0));
}

export function calculateNetIncome(state: CityState): number {
  return round2(calculateTaxRevenue(state) - calculateMaintenance(state));
}

/** Compute an appropriate initial treasury for a pre-planned town based on its upkeep. */
export function calculatePlannedTownMoney(buildings: PlacedBuilding[]): number {
  const initialUpkeep = buildings.reduce((sum, b) => sum + getBuildingMaintenance(b), 0);
  const runway = Math.round((initialUpkeep * PLANNED_TOWN_RUNWAY_TICKS) / 1000) * 1000;
  return clamp(runway, PLANNED_TOWN_MIN_MONEY, PLANNED_TOWN_MAX_MONEY);
}

export function calculatePopulationGrowth(state: CityState): number {
  // When population is managed by PopulationManager (person entities exist),
  // growth is driven by births/deaths/migration — return 0 to avoid double-counting.
  if (state.resources.populationSummary) return 0;

  // Legacy fallback for cities without person entities
  let capacity = 0;
  let jobs = 0;

  for (const b of state.buildings) {
    const def = BUILDING_DEFS[b.type];
    capacity += def?.effects?.populationCapacity ?? 0;
    jobs += def?.effects?.jobs ?? 0;

    if (isZone(b.type) && b.developmentLevel && b.developmentLevel > 0) {
      const levelDef = getZoneLevelDef(b.type as ZoneType, b.density, b.developmentLevel!);
      capacity += levelDef.populationCapacity;
      jobs += levelDef.jobs;
    }
  }

  if (state.resources.population >= capacity) return 0;
  if (state.resources.happiness < 30) return -1;
  if (jobs < state.resources.population * 0.5) return 0;

  return Math.min(5, capacity - state.resources.population);
}

export function calculateHappiness(state: CityState): number {
  // When population summary exists, use Maslow-based average happiness
  if (state.resources.populationSummary) {
    return state.resources.populationSummary.averageHappiness;
  }

  // Legacy fallback: building effects + penalties
  const base = 50;

  let buildingEffect = 0;
  let capacity = 0;

  for (const b of state.buildings) {
    const def = BUILDING_DEFS[b.type];
    buildingEffect += def?.effects?.happiness ?? 0;
    capacity += def?.effects?.populationCapacity ?? 0;

    if (isZone(b.type) && b.developmentLevel && b.developmentLevel > 0) {
      const levelDef = getZoneLevelDef(b.type as ZoneType, b.density, b.developmentLevel!);
      buildingEffect += levelDef.happiness;
      capacity += levelDef.populationCapacity;
    }
  }

  const overcrowdingPenalty = capacity > 0 && state.resources.population > capacity
    ? Math.floor((state.resources.population - capacity) / 5) * -2
    : 0;

  const taxPenalty = state.resources.taxRate > 10
    ? -Math.floor((state.resources.taxRate - 10) / 2)
    : 0;

  return base + buildingEffect + overcrowdingPenalty + taxPenalty;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function calculateHousingCapacity(state: CityState): number {
  let capacity = 0;
  for (const b of state.buildings) {
    const def = BUILDING_DEFS[b.type];
    capacity += def?.effects?.populationCapacity ?? 0;
    if (isZone(b.type) && b.developmentLevel && b.developmentLevel > 0) {
      const levelDef = getZoneLevelDef(b.type as ZoneType, b.density, b.developmentLevel!);
      capacity += levelDef.populationCapacity;
    }
  }
  return capacity;
}

export function calculateCityScore(state: CityState): number {
  // Simple score formula: Population + (Money/100) + (Happiness * 10)
  // This provides a growth metric based on overall city health and size
  const popScore = state.resources.population;
  const moneyScore = Math.floor(state.resources.money / 100);
  const happinessScore = state.resources.happiness * 10;

  return popScore + moneyScore + happinessScore;
}
