import {
  BuildingType,
  MAX_BUILDING_UPGRADE_LEVEL,
  isUpgradableBuilding,
  isZone,
  type PlacedBuilding,
} from '../types/building.js';
import { BUILDING_DEFS, ZONE_DENSITY_COSTS } from './buildings.js';

export interface BuildingUpgradeTier {
  tier: 1 | 2 | 3;
  name: string;
  description: string;
  /** Multiplier on base building cost to purchase this tier. */
  costMultiplier: number;
  /** Cumulative multiplier on output / capacity (citizens served, MW, m³/h, jobs). */
  outputMultiplier: number;
  /** Cumulative multiplier on service quality (Maslow value). */
  qualityMultiplier: number;
  /** Cumulative multiplier on base maintenance ($/tick). */
  upkeepMultiplier: number;
  /** Cumulative multiplier on utility consumption (power/water/sewage demand). */
  demandMultiplier: number;
  /** Cumulative flat happiness bonus at this tier. */
  happinessBonus: number;
}

interface TierFlavor {
  name: string;
  description: string;
  happinessBonus?: number;
}

const DEFAULT_TIER_STATS: readonly Omit<BuildingUpgradeTier, 'name' | 'description' | 'happinessBonus'>[] = [
  { tier: 1, costMultiplier: 0.5, outputMultiplier: 1.35, qualityMultiplier: 1.10, upkeepMultiplier: 1.25, demandMultiplier: 1.15 },
  { tier: 2, costMultiplier: 1.0, outputMultiplier: 1.75, qualityMultiplier: 1.20, upkeepMultiplier: 1.55, demandMultiplier: 1.30 },
  { tier: 3, costMultiplier: 1.5, outputMultiplier: 2.25, qualityMultiplier: 1.35, upkeepMultiplier: 1.90, demandMultiplier: 1.50 },
];

function makeTiers(flavors: readonly [TierFlavor, TierFlavor, TierFlavor]): readonly BuildingUpgradeTier[] {
  return DEFAULT_TIER_STATS.map((stats, idx) => ({
    ...stats,
    name: flavors[idx].name,
    description: flavors[idx].description,
    happinessBonus: flavors[idx].happinessBonus ?? 0,
  }));
}

/**
 * Bespoke 3-tier upgrade catalog for every upgradable building (all standalone & infrastructure buildings).
 * Zones, roads, and utility conduits are excluded.
 */
export const BUILDING_UPGRADES: Partial<Record<BuildingType, readonly BuildingUpgradeTier[]>> = {
  // === STANDALONE ===
  [BuildingType.PARK]: makeTiers([
    { name: 'Botanical Pavilions', description: 'Shaded garden walks and flowerbeds welcome more visitors.', happinessBonus: 2 },
    { name: 'Amphitheater Lawn', description: 'Open-air events and playgrounds expand neighborhood appeal.', happinessBonus: 5 },
    { name: 'Conservatory & Pond', description: 'Glasshouse gardens and water features elevate civic pride.', happinessBonus: 9 },
  ]),
  [BuildingType.PARKING]: makeTiers([
    { name: 'Double-Deck Ramps', description: 'Second-level stalls expand downtown parking capacity.', happinessBonus: 2 },
    { name: 'EV Charging Bays', description: 'Fast chargers and smart bays ease commuter congestion.', happinessBonus: 4 },
    { name: 'Automated Valet Tower', description: 'High-density mechanical stacking maximizes lot throughput.', happinessBonus: 7 },
  ]),

  // === ENERGY ===
  [BuildingType.ENERGY_SUBSTATION]: makeTiers([
    { name: 'High-Voltage Step-Down Bus', description: 'Reinforced transformers extend power distribution by +2 tiles.' },
    { name: 'Automated Load Balancers', description: 'Smart switchgear widens grid coverage by +4 tiles.' },
    { name: 'Superconducting Feeder Grid', description: 'Ultra-low-loss feeders push distribution reach to +6 tiles.' },
  ]),
  [BuildingType.ENERGY_WIND_TURBINE]: makeTiers([
    { name: 'Composite Aeroblades', description: 'Longer carbon blades harvest more power from light breezes.' },
    { name: 'Direct-Drive Nacelle', description: 'Gearless generator reduces friction and boosts MW output.' },
    { name: 'Flywheel Grid Stabilizer', description: 'Kinetic storage smooths output to serve more citizens.' },
  ]),
  [BuildingType.ENERGY_SOLAR_FARM]: makeTiers([
    { name: 'Dual-Axis Solar Trackers', description: 'Motorized arrays follow the sun for higher daily yield.' },
    { name: 'Bifacial Photovoltaic Cells', description: 'Double-sided panels capture reflected light for extra MW.' },
    { name: 'Grid-Scale Battery Bank', description: 'Megawatt storage sustains peak delivery across the city.' },
  ]),
  [BuildingType.ENERGY_COAL_PLANT]: makeTiers([
    { name: 'Pulverized Coal Injectors', description: 'Finer fuel combustion raises boiler heat and MW output.' },
    { name: 'Superheated Steam Turbines', description: 'High-pressure turbines significantly expand generation.' },
    { name: 'Cogeneration Recovery Hall', description: 'Waste-heat boilers push plant output to maximum capacity.' },
  ]),
  [BuildingType.ENERGY_NUCLEAR_PLANT]: makeTiers([
    { name: 'High-Density Fuel Rods', description: 'Enriched core assemblies boost thermal output and supply.' },
    { name: 'Auxiliary Cooling Loops', description: 'Secondary heat exchangers expand safe reactor throughput.' },
    { name: 'Dual-Turbine Generator Hall', description: 'Twin steam turbines maximize MW output and city reach.' },
  ]),

  // === WATER ===
  [BuildingType.WATER_TOWER]: makeTiers([
    { name: 'Reinforced Pressure Tank', description: 'Expanded elevated storage increases municipal flow.' },
    { name: 'Booster Valve Manifold', description: 'High-flow risers deliver water to more neighborhoods.' },
    { name: 'Dual-Chamber Reservoir', description: 'Twin pressurized tanks maximize local supply capacity.' },
  ]),
  [BuildingType.WATER_PUMP_STATION]: makeTiers([
    { name: 'Deep-Well Intake Screens', description: 'Wider intake pipes draw greater volume from water sources.' },
    { name: 'High-Torque Impellers', description: 'Upgraded turbines lift municipal pumping throughput.' },
    { name: 'Multi-Stage Pressurization Bay', description: 'Parallel pump arrays push extraction to peak capacity.' },
  ]),
  [BuildingType.WATER_TREATMENT]: makeTiers([
    { name: 'Rapid Sand Filtration', description: 'Faster particulate beds increase clean water throughput.' },
    { name: 'UV & Ozone Purifiers', description: 'Advanced disinfection boosts water quality and capacity.' },
    { name: 'Reverse Osmosis Membrane Hall', description: 'High-volume desalination & purification maximizes output.' },
  ]),

  // === SEWAGE ===
  [BuildingType.SEWAGE_PUMP_STATION]: makeTiers([
    { name: 'Heavy-Duty Grinder Pumps', description: 'Higher-throughput lift pumps prevent neighborhood backups.' },
    { name: 'Surge Retention Basin', description: 'Buffer tanks absorb peak wastewater loads smoothly.' },
    { name: 'Twin Force-Main Outfall', description: 'Dual pressurized mains double trunk drainage capacity.' },
  ]),
  [BuildingType.WATER_SEWAGE_PLANT]: makeTiers([
    { name: 'Expanded Aeration Basins', description: 'Higher biological breakdown increases treatment capacity.' },
    { name: 'Clarifier & Methane Digester', description: 'Industrial digesters process heavier city wastewater.' },
    { name: 'Tertiary Water Reclamation', description: 'Closed-loop polishing pushes plant capacity to its peak.' },
  ]),

  // === POLICE ===
  [BuildingType.POLICE_STATION]: makeTiers([
    { name: 'Digital Dispatch Desk', description: 'Centralized call routing lets officers cover more residents.' },
    { name: 'Neighborhood Patrol Wing', description: 'Expanded briefing rooms and holding cells boost coverage.' },
    { name: 'Rapid Response Taskforce', description: 'Specialized units maximize district safety and reach.' },
  ]),
  [BuildingType.POLICE_HQ]: makeTiers([
    { name: 'Forensic Crime Lab', description: 'In-house analysis speeds up investigations citywide.' },
    { name: 'Metropolitan Command Center', description: 'Live telemetry coordinates patrols across larger districts.' },
    { name: 'Tactical Operations Directorate', description: 'Elite citywide divisions maximize safety coverage.' },
  ]),
  [BuildingType.POLICE_JAIL]: makeTiers([
    { name: 'Reinforced Cellblock B', description: 'Additional secure wings expand correctional capacity.' },
    { name: 'Automated Perimeter Control', description: 'Modern monitoring systems improve facility security.' },
    { name: 'Rehabilitation & Intake Annex', description: 'Full-scale complex serves a much larger population.' },
  ]),
  [BuildingType.POLICE_ACADEMY]: makeTiers([
    { name: 'Tactical Simulation Arena', description: 'Realistic drills raise graduate readiness and city safety.' },
    { name: 'Driver & Pursuit Track', description: 'Expanded training grounds graduate larger cadet classes.' },
    { name: 'Regional Law Institute', description: 'Premier academy programs maximize citywide safety reach.' },
  ]),

  // === FIRE DEPARTMENT ===
  [BuildingType.FIRE_STATION]: makeTiers([
    { name: 'High-Pressure Hydrant Gear', description: 'Upgraded hoses and foam kits expand firefighting coverage.' },
    { name: 'Extended Apparatus Bay', description: 'Additional ladder equipment serves more city blocks.' },
    { name: 'Hazmat & Rescue Company', description: 'Specialized crews maximize neighborhood fire protection.' },
  ]),
  [BuildingType.FIRE_HQ]: makeTiers([
    { name: 'Thermal Dispatch Network', description: 'Early-warning sensors speed response across the city.' },
    { name: 'Heavy Rescue Logistics Wing', description: 'Expanded staging halls coordinate more emergency crews.' },
    { name: 'Metropolitan Fire Command', description: 'Citywide disaster coordination maximizes safety capacity.' },
  ]),
  [BuildingType.FIRE_HELICOPTER]: makeTiers([
    { name: 'High-Capacity Bambi Buckets', description: 'Larger aerial water drops cover wider urban zones.' },
    { name: 'Night-Vision Avionics Suite', description: 'All-weather radar enables 24/7 aerial firefighting.' },
    { name: 'Twin-Pad Airlift Hangar', description: 'Dual helipads dramatically expand rapid aerial coverage.' },
  ]),
  [BuildingType.FIRE_TRAINING]: makeTiers([
    { name: 'Live-Burn Tower', description: 'Multi-story drills sharpen structural rescue skills.' },
    { name: 'Urban Search & Collapse Yard', description: 'Expanded courses train more firefighters each season.' },
    { name: 'National Fire Science Center', description: 'Elite certification programs maximize citywide readiness.' },
  ]),

  // === HEALTH ===
  [BuildingType.HEALTH_CLINIC]: makeTiers([
    { name: 'Outpatient Exam Suite', description: 'Extra consultation rooms increase daily patient capacity.' },
    { name: 'Diagnostic Imaging Lab', description: 'On-site X-ray and bloodwork improve treatment quality.' },
    { name: '24-Hour Urgent Care Wing', description: 'Round-the-clock triage serves far more neighborhood residents.' },
  ]),
  [BuildingType.HEALTH_HOSPITAL]: makeTiers([
    { name: 'Expanded Trauma Center', description: 'Additional ER bays raise emergency patient throughput.' },
    { name: 'Surgical & ICU Pavilion', description: 'Specialized operating theaters boost care quality and capacity.' },
    { name: 'Metropolitan Medical Tower', description: 'Full-spectrum inpatient wards maximize city healthcare reach.' },
  ]),
  [BuildingType.HEALTH_RESEARCH_CENTER]: makeTiers([
    { name: 'Genomics Sequencing Core', description: 'High-throughput labs accelerate medical breakthroughs.' },
    { name: 'Clinical Trials Wing', description: 'Expanded treatment protocols reach more citizens.' },
    { name: 'Biomedical Innovation Campus', description: 'World-class research complex maximizes health impact.' },
  ]),
  [BuildingType.HEALTH_CEMETERY]: makeTiers([
    { name: 'Memorial Garden Terrace', description: 'Landscaped plots expand serene resting capacity.' },
    { name: 'Columbarium & Chapel', description: 'Multi-tier niches and hall serve a growing population.' },
    { name: 'Heritage Sanctuary Grounds', description: 'Expanded wooded grounds maximize long-term capacity.' },
  ]),

  // === EDUCATION ===
  [BuildingType.EDU_ELEMENTARY]: makeTiers([
    { name: 'Modular Classroom Wing', description: 'New classrooms welcome more young students.' },
    { name: 'STEM & Arts Studio', description: 'Dedicated labs and music rooms enrich early learning.' },
    { name: 'Full-Campus Learning Center', description: 'Expanded library and gymnasium maximize student capacity.' },
  ]),
  [BuildingType.EDU_HIGH_SCHOOL]: makeTiers([
    { name: 'Science & Robotics Labs', description: 'Modern laboratories elevate academic quality and capacity.' },
    { name: 'Athletics & Auditorium Complex', description: 'Expanded campus facilities serve more teen students.' },
    { name: 'Honors & Vocational Academy', description: 'Dual-track wings maximize graduation throughput.' },
  ]),
  [BuildingType.EDU_UNIVERSITY]: makeTiers([
    { name: 'Graduate Research Halls', description: 'New faculties expand enrollment and scholarly output.' },
    { name: 'Supercomputing & Engineering Quad', description: 'Advanced institutes raise citywide education quality.' },
    { name: 'Global Academic Campus', description: 'Flagship colleges maximize student capacity and prestige.' },
  ]),
  [BuildingType.EDU_LIBRARY]: makeTiers([
    { name: 'Digital Media Commons', description: 'Public terminals and study rooms serve more patrons.' },
    { name: 'Rare Archives & Reading Rotunda', description: 'Expanded stacks elevate community learning quality.' },
    { name: 'Central Knowledge Hub', description: 'Multi-floor annex maximizes civic education reach.' },
  ]),

  // === GOVERNMENT ===
  [BuildingType.GOV_CITY_HALL]: makeTiers([
    { name: 'Citizen Services Pavilion', description: 'Streamlined permit halls serve more residents efficiently.' },
    { name: 'Urban Planning Directorate', description: 'Expanded council offices strengthen civic administration.' },
    { name: 'Grand Municipal Plaza', description: 'Flagship administrative wing maximizes citywide reach.' },
  ]),
  [BuildingType.GOV_COURTHOUSE]: makeTiers([
    { name: 'Additional Trial Chambers', description: 'More courtrooms speed up civil and criminal dockets.' },
    { name: 'Public Law Library & Records', description: 'Digital case archives raise judicial quality and capacity.' },
    { name: 'Appellate Justice Wing', description: 'Expanded chambers maximize legal coverage across the city.' },
  ]),
  [BuildingType.GOV_PARLIAMENT]: makeTiers([
    { name: 'Committee Hearing Rooms', description: 'Expanded legislative wings serve a larger constituency.' },
    { name: 'Diplomatic & Press Gallery', description: 'Public transparency halls elevate democratic stature.' },
    { name: 'Grand Assembly Rotunda', description: 'Monumental chambers maximize national civic pride.' },
  ]),
  [BuildingType.GOV_MONUMENT]: makeTiers([
    { name: 'Reflective Pool & Lighting', description: 'Illuminated plaza draws more visitors day and night.', happinessBonus: 2 },
    { name: 'Heritage Visitor Colonnade', description: 'Historical plaques and terraces expand civic reach.', happinessBonus: 4 },
    { name: 'Ceremonial Esplanade', description: 'Grand public promenade maximizes monument prestige.', happinessBonus: 7 },
  ]),

  // === TOURISM ===
  [BuildingType.TOUR_LANDMARK]: makeTiers([
    { name: 'Observation Deck', description: 'Panoramic viewing platforms welcome larger crowds.', happinessBonus: 2 },
    { name: 'Nighttime Light Show', description: 'Architectural illumination boosts evening attendance.', happinessBonus: 4 },
    { name: 'World Heritage Visitor Center', description: 'Guided tours and plaza pavilions maximize visitor capacity.', happinessBonus: 7 },
  ]),
  [BuildingType.TOUR_MUSEUM]: makeTiers([
    { name: 'Natural History Wing', description: 'New exhibition halls accommodate many more visitors.' },
    { name: 'Interactive Planetarium', description: 'Immersive dome shows raise cultural prestige and reach.' },
    { name: 'International Curatorial Pavilion', description: 'Touring masterpieces maximize attendance and esteem.' },
  ]),
  [BuildingType.TOUR_STADIUM]: makeTiers([
    { name: 'Upper-Deck Seating Bowl', description: 'Expanded grandstands pack in thousands more fans.' },
    { name: 'Retractable Roof & Jumbotron', description: 'All-weather arena hosts major year-round events.' },
    { name: 'Championship Fan Concourse', description: 'Premier hospitality and seating maximize stadium capacity.' },
  ]),
  [BuildingType.TOUR_AMUSEMENT]: makeTiers([
    { name: 'Mega Coaster Expansion', description: 'Signature thrill rides draw bigger weekend crowds.' },
    { name: 'Waterpark & Splash Zone', description: 'Seasonal attractions expand daily guest throughput.' },
    { name: 'Grand Resort Midway', description: 'Themed lands and evening parades maximize park capacity.' },
  ]),

  // === TRANSPORT ===
  [BuildingType.TRANS_BUS_DEPOT]: makeTiers([
    { name: 'Express Route Dispatch', description: 'Timed transfer bays move more daily commuters.' },
    { name: 'Articulated Bus Maintenance Bay', description: 'High-capacity coaches expand neighborhood transit reach.' },
    { name: 'Electric Rapid Transit Hub', description: 'Zero-emission fleet infrastructure maximizes ridership.' },
  ]),
  [BuildingType.TRANS_TRAIN_STATION]: makeTiers([
    { name: 'Extended Commuter Platforms', description: 'Longer platforms handle higher-capacity passenger trains.' },
    { name: 'High-Speed Rail Concourse', description: 'Express tracks and concourses expand daily ridership.' },
    { name: 'Grand Intermodal Terminal', description: 'Multi-level rail hub maximizes metropolitan throughput.' },
  ]),
  [BuildingType.TRANS_AIRPORT]: makeTiers([
    { name: 'International Concourse B', description: 'Additional jet bridges expand daily passenger volume.' },
    { name: 'Parallel Heavy Runway', description: 'Dual runways boost flight frequency and capacity.' },
    { name: 'Global Aviation Megahub', description: 'Automated terminals and cargo apron maximize air reach.' },
  ]),
  [BuildingType.TRANS_HARBOR]: makeTiers([
    { name: 'Deepwater Pier Extension', description: 'Extended quays welcome larger passenger and trade vessels.' },
    { name: 'Automated Berth Cranes', description: 'Faster turnaround expands daily harbor throughput.' },
    { name: 'Metropolitan Seaport Terminal', description: 'Expanded slips and customs halls maximize maritime reach.' },
  ]),

  // === ART & CULTURE ===
  [BuildingType.ART_GALLERY]: makeTiers([
    { name: 'Modernist Atrium', description: 'Skylit gallery rooms host larger exhibitions and crowds.' },
    { name: 'Sculpture Courtyard & Cafe', description: 'Expanded public spaces enrich visitor experience.' },
    { name: 'Biennale Exhibition Wing', description: 'Flagship showcase halls maximize cultural reach.' },
  ]),
  [BuildingType.ART_THEATER]: makeTiers([
    { name: 'Mezzanine Balcony Seating', description: 'Upper tiers expand nightly audience capacity.' },
    { name: 'Revolving Stage & Rigging', description: 'Broadway-grade production gear elevates show quality.' },
    { name: 'Grand Repertory House', description: 'Second black-box stage and grand foyer maximize reach.' },
  ]),
  [BuildingType.ART_CONCERT_HALL]: makeTiers([
    { name: 'Acoustic Canopy & Pipe Organ', description: 'World-class acoustics elevate orchestral performances.' },
    { name: 'Symphony Choral Loft', description: 'Expanded seating and stage wings serve larger audiences.' },
    { name: 'Philharmonic Cultural Complex', description: 'Recital halls and terraces maximize cultural impact.' },
  ]),
  [BuildingType.ART_SCULPTURE_PARK]: makeTiers([
    { name: 'Kinetic Art Promenade', description: 'New outdoor installations draw more strolling visitors.', happinessBonus: 2 },
    { name: 'Artist-in-Residence Pavilions', description: 'Live workshops and gardens expand community engagement.', happinessBonus: 4 },
    { name: 'Monumental Sculpture Meadow', description: 'Curated parkland maximizes aesthetic reach.', happinessBonus: 7 },
  ]),

  // === WATERFRONT ===
  [BuildingType.WATERFRONT_DOCK]: makeTiers([
    { name: 'Cold-Storage Icehouse', description: 'Fresh catch preservation expands food supply and dock jobs.' },
    { name: 'Extended Trawler Slipways', description: 'Extra berths accommodate more fishing boats and crew.' },
    { name: 'Artisanal Seafood Market', description: 'Waterfront processing & market maximize output and jobs.' },
  ]),
  [BuildingType.WATERFRONT_MARINA]: makeTiers([
    { name: 'Floating Yacht Pontoons', description: 'Additional boat slips expand marina capacity and jobs.' },
    { name: 'Harborside Clubhouse', description: 'Dining and promenade decks elevate waterfront appeal.' },
    { name: 'Regatta & Dry-Stack Basin', description: 'Full-service yachting complex maximizes coastal reach.' },
  ]),
  [BuildingType.WATERFRONT_FERRY]: makeTiers([
    { name: 'Twin Boarding Ramps', description: 'Faster roll-on/roll-off loading boosts commuter volume.' },
    { name: 'High-Speed Catamaran Berth', description: 'Express hydrofoil slips serve far more passengers.' },
    { name: 'Regional Ferry Concourse', description: 'Expanded waiting halls and piers maximize maritime transit.' },
  ]),
  [BuildingType.WATERFRONT_PORT]: makeTiers([
    { name: 'Post-Panamax Gantry Cranes', description: 'Heavy container cranes accelerate cargo throughput and jobs.' },
    { name: 'Automated Container Yard', description: 'Stacked logistics bays expand trade and supply capacity.' },
    { name: 'Deepwater Free-Trade Quay', description: 'Multi-berth mega-terminal maximizes port output and jobs.' },
  ]),
};

const FALLBACK_TIERS = makeTiers([
  { name: 'Capacity Expansion I', description: 'Expands facility throughput and service capacity.' },
  { name: 'Efficiency Overhaul II', description: 'Modernized systems boost output and service quality.' },
  { name: 'Flagship Modernization III', description: 'Peak infrastructure maximizes capacity and reach.' },
]);

export function getBuildingUpgradeTiers(type: BuildingType): readonly BuildingUpgradeTier[] {
  if (!isUpgradableBuilding(type)) return [];
  return BUILDING_UPGRADES[type] ?? FALLBACK_TIERS;
}

export function getEffectiveUpgradeLevel(building: Pick<PlacedBuilding, 'type' | 'upgradeLevel'>): number {
  if (!isUpgradableBuilding(building.type)) return 0;
  const raw = building.upgradeLevel ?? 0;
  return Math.max(0, Math.min(MAX_BUILDING_UPGRADE_LEVEL, Math.round(raw)));
}

export function getActiveUpgradeTier(building: Pick<PlacedBuilding, 'type' | 'upgradeLevel'>): BuildingUpgradeTier | null {
  const level = getEffectiveUpgradeLevel(building);
  if (level <= 0) return null;
  const tiers = getBuildingUpgradeTiers(building.type);
  return tiers[level - 1] ?? null;
}

export function getNextUpgradeTier(building: Pick<PlacedBuilding, 'type' | 'upgradeLevel'>): BuildingUpgradeTier | null {
  if (!isUpgradableBuilding(building.type)) return null;
  const level = getEffectiveUpgradeLevel(building);
  if (level >= MAX_BUILDING_UPGRADE_LEVEL) return null;
  const tiers = getBuildingUpgradeTiers(building.type);
  return tiers[level] ?? null;
}

export function getUpgradeTierCost(type: BuildingType, tier: 1 | 2 | 3): number {
  const def = BUILDING_DEFS[type];
  const tiers = getBuildingUpgradeTiers(type);
  const tierDef = tiers[tier - 1];
  if (!def || !tierDef) return 0;
  return Math.max(25, Math.round((def.cost * tierDef.costMultiplier) / 5) * 5);
}

export function getUpgradeOutputMultiplier(building: Pick<PlacedBuilding, 'type' | 'upgradeLevel'>): number {
  return getActiveUpgradeTier(building)?.outputMultiplier ?? 1;
}

export function getUpgradeQualityMultiplier(building: Pick<PlacedBuilding, 'type' | 'upgradeLevel'>): number {
  return getActiveUpgradeTier(building)?.qualityMultiplier ?? 1;
}

export function getUpgradeUpkeepMultiplier(building: Pick<PlacedBuilding, 'type' | 'upgradeLevel'>): number {
  return getActiveUpgradeTier(building)?.upkeepMultiplier ?? 1;
}

export function getUpgradeDemandMultiplier(building: Pick<PlacedBuilding, 'type' | 'upgradeLevel'>): number {
  return getActiveUpgradeTier(building)?.demandMultiplier ?? 1;
}

export function getUpgradeHappinessBonus(building: Pick<PlacedBuilding, 'type' | 'upgradeLevel'>): number {
  return getActiveUpgradeTier(building)?.happinessBonus ?? 0;
}

/** Extra power distribution radius (in tiles) for upgraded substations (+2 / +4 / +6). */
export function getSubstationUpgradeRadiusBonus(building: Pick<PlacedBuilding, 'type' | 'upgradeLevel'>): number {
  if (building.type !== BuildingType.ENERGY_SUBSTATION) return 0;
  return getEffectiveUpgradeLevel(building) * 2;
}

/** Total money invested in a building: base cost (or density cost for zones) plus all purchased upgrade tiers. */
export function getBuildingTotalInvestedCost(
  building: Pick<PlacedBuilding, 'type' | 'density' | 'upgradeLevel'>,
): number {
  const def = BUILDING_DEFS[building.type];
  const base = isZone(building.type) && building.density
    ? ZONE_DENSITY_COSTS[building.density]
    : (def?.cost ?? 0);
  const level = getEffectiveUpgradeLevel(building);
  let upgradeSpent = 0;
  for (let t = 1; t <= level; t++) {
    upgradeSpent += getUpgradeTierCost(building.type, t as 1 | 2 | 3);
  }
  return base + upgradeSpent;
}
