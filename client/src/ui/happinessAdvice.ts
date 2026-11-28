import {
  BUILDING_DEFS, BuildingType, INFRA_CATEGORIES, MASLOW_NEEDS_ORDERED, MaslowNeed, TAX_COMFORT_RATE,
  calculateBaseMaslowTargets, calculateBudgetPenalty, calculateCityMaslowCapacity, calculateLoanPayments,
  calculateNetIncome, calculateTaxPenalty, canPlaceBuilding, evaluateCityUtilities, getEffectiveTaxRates,
  getZoneLevelHappinessRequirement, isUtilityConduit, isZone,
  type CityState, type UtilityLayer,
} from '@cityzen/shared';

export const LOW_HAPPINESS = 40;

export type AdvisorAction =
  | { kind: 'finance' }
  | { kind: 'needs' }
  | { kind: 'layer'; layer: Exclude<UtilityLayer, 'surface'> }
  | { kind: 'build'; building: BuildingType };

export interface HappinessAdvice {
  title: string;
  detail: string;
  action: AdvisorAction;
}

const NEED_NAMES: Record<MaslowNeed, string> = {
  [MaslowNeed.PHYSIOLOGICAL]: 'Basic services',
  [MaslowNeed.SAFETY]: 'Safety',
  [MaslowNeed.LOVE_BELONGING]: 'Community',
  [MaslowNeed.ESTEEM]: 'Civic pride',
  [MaslowNeed.COGNITIVE]: 'Education',
  [MaslowNeed.AESTHETIC]: 'Public spaces',
  [MaslowNeed.SELF_ACTUALIZATION]: 'Civic participation',
};

const SERVICE_TYPES = [
  BuildingType.PARK,
  ...INFRA_CATEGORIES.flatMap(category => category.types).filter(type => !isUtilityConduit(type)),
];

export function needsHappinessAdvice(city: CityState): boolean {
  return city.resources.population > 0 && city.resources.happiness < LOW_HAPPINESS;
}

/** Next zone level (2 or 3) currently blocked by city happiness, if any zone is ready for it. */
export function getBlockedZoneLevel(city: CityState): number | undefined {
  return [2, 3].find(level =>
    city.resources.happiness < getZoneLevelHappinessRequirement(level) &&
    city.buildings.some(b => isZone(b.type) && (b.developmentLevel ?? 0) === level - 1));
}

export function getHappinessAdvice(city: CityState): HappinessAdvice[] {
  if (city.resources.population <= 0) return [];

  const { money, population, populationSummary } = city.resources;
  const effectiveRates = getEffectiveTaxRates(city.resources);
  const resTaxRate = effectiveRates.residential;
  const advice: HappinessAdvice[] = [];
  if (money < 0) {
    return [{
      title: 'Restore the city budget',
      detail: `The treasury is $${Math.ceil(-money).toLocaleString()} in debt, which reduces the benefit of city services. Review upkeep and income in Finance before adding more expenses.`,
      action: { kind: 'finance' },
    }];
  }

  if (resTaxRate > TAX_COMFORT_RATE) {
    const netAtLowerRate = calculateNetIncome({
      ...city,
      resources: {
        ...city.resources,
        taxRates: { ...effectiveRates, residential: TAX_COMFORT_RATE },
      },
    }) - calculateLoanPayments(city.resources);
    advice.push({
      title: 'Review high residential taxes',
      detail: `Residential taxes are at ${resTaxRate}%. Rates above ${TAX_COMFORT_RATE}% reduce satisfaction across all needs. ` +
        (netAtLowerRate < 0
          ? `At ${TAX_COMFORT_RATE}%, the city would lose about $${Math.ceil(-netAtLowerRate).toLocaleString()} per tick. Review expenses before cutting the rate.`
          : `Try lowering residential tax toward ${TAX_COMFORT_RATE}% while the budget can support it.`),
      action: { kind: 'finance' },
    });
  }

  const utilities = evaluateCityUtilities(city);
  const physioCurrent = populationSummary?.averageMaslow[MaslowNeed.PHYSIOLOGICAL];
  if (physioCurrent === undefined || physioCurrent < 60) {
    const u = utilities.summary;
    if (u.unpoweredBuildings > 0 || u.brownoutBuildings > 0) {
      advice.push({
        title: u.powerDemandMW > u.powerGenerationMW
          ? `Expand power generation (${u.powerDemandMW.toFixed(1)} / ${u.powerGenerationMW.toFixed(1)} MW)`
          : 'Connect buildings to the Power Grid',
        detail: u.powerDemandMW > u.powerGenerationMW
          ? 'Electricity demand exceeds generator capacity, causing brownouts and blackouts. Add a generator and link it with Power Lines.'
          : `${u.unpoweredBuildings} building${u.unpoweredBuildings === 1 ? ' has' : 's have'} no electricity. Open the Power Layer to run Power Lines or place a Substation.`,
        action: { kind: 'layer', layer: 'power' },
      });
    }
    if (advice.length < 3 && u.unwateredBuildings > 0) {
      advice.push({
        title: u.activeWaterSources === 0 ? 'Build a Water Source & Pipes' : 'Extend Water Pipes to dry buildings',
        detail: u.activeWaterSources === 0
          ? 'Place a powered Pump Station or Water Tower on a blue shoreline or aquifer tile, then connect buildings with Water Pipes.'
          : `${u.unwateredBuildings} building${u.unwateredBuildings === 1 ? ' lacks' : 's lack'} piped water. Zones cannot upgrade past Level 1 without Water.`,
        action: { kind: 'layer', layer: 'water' },
      });
    }
    if (advice.length < 3 && u.backedUpBuildings > 0) {
      advice.push({
        title: u.sewageCapacityM3 === 0 ? 'Add Sewage Treatment & Pipes' : 'Connect Sewer Pipes to buildings',
        detail: `${u.backedUpBuildings} building${u.backedUpBuildings === 1 ? ' has' : 's have'} untreated wastewater. Open the Sewage Layer to place a Sewage Station and run Sewage Pipes.`,
        action: { kind: 'layer', layer: 'sewage' },
      });
    }
  }

  const profile = calculateCityMaslowCapacity(city, utilities);
  const baseline = calculateBaseMaslowTargets(profile, population);
  const penalty = calculateBudgetPenalty(money) * calculateTaxPenalty(city.resources);
  const recommended = new Set<BuildingType>();
  let unaffordableImprovement = false;
  let noRoomForService = false;
  for (const need of MASLOW_NEEDS_ORDERED) {
    if (advice.length >= 3) break;
    const current = populationSummary?.averageMaslow[need];
    if (baseline[need] >= 70 || (current !== undefined && current >= 60)) continue;

    const candidates = SERVICE_TYPES.flatMap(type => {
      if (recommended.has(type)) return [];
      const def = BUILDING_DEFS[type];
      const contribution = def.effects.maslowContributions?.find(effect => effect.need === need);
      if (!contribution) return [];

      // Ask the same service model the simulation uses whether this building
      // improves coverage or quality for this need.
      const provision = profile[need];
      const after = calculateBaseMaslowTargets({
        ...profile,
        [need]: {
          ...provision,
          providers: [...provision.providers, { value: contribution.value, capacity: contribution.capacityServed }],
        },
      }, population)[need];
      const benefit = (after - baseline[need]) * penalty;
      if (benefit < 1) return [];
      if (def.cost > money) {
        unaffordableImprovement = true;
        return [];
      }
      return [{ def, benefit, score: benefit / Math.sqrt(def.cost) }];
    }).sort((a, b) => b.score - a.score);

    const candidate = candidates.find(({ def }) =>
      city.grid.some((column, x) => column.some((_, z) =>
        canPlaceBuilding(city.grid, { x, z }, def.type, city.resources, false, city.buildings).valid)));
    if (!candidate) {
      if (candidates.length > 0) noRoomForService = true;
      continue;
    }

    const { def, benefit } = candidate;
    recommended.add(def.type);
    const status = current === undefined
      ? `${NEED_NAMES[need]} satisfaction is projected at ${Math.round(baseline[need] * penalty)}%.`
      : `${NEED_NAMES[need]} satisfaction is at ${Math.round(current)}%.`;
    advice.push({
      title: `Build a ${def.label}`,
      detail: `${status} This could raise the satisfaction target by about ${Math.round(benefit)} points. ` +
        `Costs $${def.cost.toLocaleString()} to build and $${def.effects.maintenance ?? 0} per tick to maintain.`,
      action: { kind: 'build', building: def.type },
    });
  }
  if (advice.length === 0 && (needsHappinessAdvice(city) || getBlockedZoneLevel(city) !== undefined)) {
    advice.push(noRoomForService ? {
      title: 'Find room for city services',
      detail: 'The current layout has no open footprint for services that would improve these needs. Review the needs breakdown before deciding which land to redevelop.',
      action: { kind: 'needs' },
    } : unaffordableImprovement ? {
      title: 'Make room in the budget for services',
      detail: 'The services that would help most are above the current construction budget. Review expenses and income in Finance.',
      action: { kind: 'finance' },
    } : {
      title: 'Review City Needs',
      detail: 'Existing services can take time to affect happiness. Check the needs breakdown before spending more.',
      action: { kind: 'needs' },
    });
  }
  return advice;
}
