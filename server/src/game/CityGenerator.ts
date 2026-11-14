import { v4 as uuid } from 'uuid';
import {
  type Grid,
  type Position,
  type PlacedBuilding,
  type EdgeConnection,
  type RoadOrientation,
  type WorldCityEntry,
  type WorldPosition,
  type EdgeDirection,
  BuildingType,
  ZoneDensity,
  BUILDING_DEFS,
  DEFAULT_GRID_SIZE,
  createEmptyGrid,
  getEffectiveSize,
  calculateEdgeConnections,
  getOppositeDirection,
} from '@cityzen/shared';

// ── Types ────────────────────────────────────────────────

export type CitySize = 'small' | 'medium' | 'large';

export interface GenerationConfig {
  gridSize?: number;
  neighborCities?: WorldCityEntry[];
  worldPosition?: WorldPosition;
  citySize?: CitySize;
}

/** Size-dependent generation parameters */
interface SizeParams {
  arteryCount: number;
  secondarySpacing: number;
  exitRoadCount: [number, number]; // [min, max]
  infraTiers: number; // 1=essential only, 2=+important, 3=+nice-to-have
  parkRatio: number;  // 1 park per N residential zones
  densityRadii: { high: number; medium: number }; // from center
  zoneIndustrialEdge: number; // cells from edge for industrial
  populationSeed: number;
  startingMoney: number;
}

const SIZE_PARAMS: Record<CitySize, SizeParams> = {
  small: {
    arteryCount: 2,
    secondarySpacing: 7,
    exitRoadCount: [1, 1],
    infraTiers: 1,
    parkRatio: 30,
    densityRadii: { high: 8, medium: 16 },
    zoneIndustrialEdge: 6,
    populationSeed: 5,
    startingMoney: 15000,
  },
  medium: {
    arteryCount: 3,
    secondarySpacing: 5,
    exitRoadCount: [1, 2],
    infraTiers: 2,
    parkRatio: 20,
    densityRadii: { high: 12, medium: 24 },
    zoneIndustrialEdge: 8,
    populationSeed: 15,
    startingMoney: 50000,
  },
  large: {
    arteryCount: 4,
    secondarySpacing: 4,
    exitRoadCount: [2, 3],
    infraTiers: 3,
    parkRatio: 15,
    densityRadii: { high: 18, medium: 30 },
    zoneIndustrialEdge: 10,
    populationSeed: 30,
    startingMoney: 100000,
  },
};

export interface GenerationResult {
  grid: Grid;
  buildings: PlacedBuilding[];
  edgeConnections: EdgeConnection[];
  populationSeed: number;
  startingMoney: number;
}

interface EdgeAnchor {
  direction: EdgeDirection;
  positions: number[];
}

interface Arteries {
  horizontal: number[]; // z-values of EW avenues
  vertical: number[];   // x-values of NS avenues
}

// ── City Name Generator ──────────────────────────────────

const CITY_PREFIXES = [
  'New', 'San', 'Port', 'Fort', 'Lake', 'Mount', 'East', 'West', 'North', 'South',
  'Grand', 'Old', 'Fair', 'Spring', 'Green', 'Stone', 'River', 'Silver', 'Gold', 'Iron',
];
const CITY_ROOTS = [
  'Oak', 'Maple', 'Cedar', 'Pine', 'Elm', 'Ash', 'Birch', 'Willow',
  'Stone', 'Iron', 'Crystal', 'Amber', 'Jade', 'Pearl', 'Ruby', 'Coral',
];
const CITY_SUFFIXES = [
  'ville', 'town', 'burg', 'field', 'port', 'haven', 'dale', 'wood', 'ford', 'bridge',
  'view', 'land', 'ton', 'worth', 'creek', 'springs', 'falls', 'ridge', 'hill', 'vale',
];

export function generateCityName(): string {
  const rng = Math.random;
  const usePrefix = rng() > 0.5;
  const root = CITY_ROOTS[Math.floor(rng() * CITY_ROOTS.length)];
  const suffix = CITY_SUFFIXES[Math.floor(rng() * CITY_SUFFIXES.length)];
  if (usePrefix) {
    const prefix = CITY_PREFIXES[Math.floor(rng() * CITY_PREFIXES.length)];
    return `${prefix} ${root}${suffix}`;
  }
  return `${root}${suffix}`;
}

// ── CityGenerator ────────────────────────────────────────

export class CityGenerator {
  private grid!: Grid;
  private buildings!: PlacedBuilding[];
  private gridSize!: number;
  private sizeParams!: SizeParams;

  generateCityLayout(config: GenerationConfig): GenerationResult {
    this.gridSize = config.gridSize ?? DEFAULT_GRID_SIZE;
    this.grid = createEmptyGrid(this.gridSize);
    this.buildings = [];
    this.sizeParams = SIZE_PARAMS[config.citySize ?? 'medium'];

    // Phase 1: Match neighbor edge connections
    const edgeAnchors = this.placeEdgeMatchingRoads(config);

    // Phase 2: Main artery grid
    const arteries = this.placeMainArteries();

    // Phase 3: Connect edges to arteries
    this.placeEdgeFeederRoads(edgeAnchors, arteries);

    // Phase 4: Secondary streets
    this.placeSecondaryStreets(arteries);

    // Phase 5: Zone placement
    this.placeZones(arteries);

    // Phase 6: Infrastructure (after zones; demolishes zones if needed)
    this.placeInfrastructure();

    // Phase 7: Scatter parks in residential areas
    this.placeParks();

    // Calculate final edge connections
    const edgeConnections = calculateEdgeConnections(this.buildings, this.gridSize);

    return {
      grid: this.grid,
      buildings: this.buildings,
      edgeConnections,
      populationSeed: this.sizeParams.populationSeed,
      startingMoney: this.sizeParams.startingMoney,
    };
  }

  // ── Phase 1: Edge Matching ───────────────────────────────

  private placeEdgeMatchingRoads(config: GenerationConfig): EdgeAnchor[] {
    const anchors: EdgeAnchor[] = [];
    if (!config.neighborCities || !config.worldPosition) return anchors;

    const { wx, wz } = config.worldPosition;
    const neighbors: Array<{ city: WorldCityEntry; direction: EdgeDirection }> = [];

    for (const city of config.neighborCities) {
      const { wx: nwx, wz: nwz } = city.position;
      if (nwx === wx - 1 && nwz === wz) neighbors.push({ city, direction: 'west' });
      else if (nwx === wx + 1 && nwz === wz) neighbors.push({ city, direction: 'east' });
      else if (nwx === wx && nwz === wz - 1) neighbors.push({ city, direction: 'north' });
      else if (nwx === wx && nwz === wz + 1) neighbors.push({ city, direction: 'south' });
    }

    for (const { city, direction } of neighbors) {
      const oppositeDir = getOppositeDirection(direction);
      const neighborEdge = city.edgeConnections?.find(e => e.direction === oppositeDir);
      if (!neighborEdge || neighborEdge.positions.length === 0) continue;

      const positions: number[] = [];
      for (const pos of neighborEdge.positions) {
        const placed = this.placeEdgeRoad(direction, pos);
        if (placed) positions.push(pos);
      }
      if (positions.length > 0) {
        anchors.push({ direction, positions });
      }
    }

    return anchors;
  }

  private placeEdgeRoad(direction: EdgeDirection, pos: number): boolean {
    let x: number, z: number;
    const orientation: RoadOrientation = (direction === 'north' || direction === 'south') ? 'NS' : 'EW';

    switch (direction) {
      case 'north': x = pos; z = 0; break;
      case 'south': x = pos; z = this.gridSize - 1; break;
      case 'west':  x = 0; z = pos; break;
      case 'east':  x = this.gridSize - 1; z = pos; break;
    }

    if (x < 0 || x >= this.gridSize || z < 0 || z >= this.gridSize) return false;
    if (this.grid[x][z].buildingId !== null) return false;

    this.placeBuildingDirect({ x, z }, BuildingType.ROAD_STREET, orientation);
    return true;
  }

  // ── Phase 2: Main Arteries ───────────────────────────────

  private placeMainArteries(): Arteries {
    const margin = 3;
    const arteryCount = this.sizeParams.arteryCount;
    const spacing = Math.floor((this.gridSize - 2 * margin) / (arteryCount + 1));

    const horizontal: number[] = [];
    const vertical: number[] = [];

    for (let i = 1; i <= arteryCount; i++) {
      const baseZ = margin + i * spacing;
      const jitter = Math.floor(Math.random() * 5) - 2;
      horizontal.push(clamp(baseZ + jitter, margin, this.gridSize - margin - 3));

      const baseX = margin + i * spacing;
      const jitterX = Math.floor(Math.random() * 5) - 2;
      vertical.push(clamp(baseX + jitterX, margin, this.gridSize - margin - 3));
    }

    // Place horizontal avenues (EW orientation: size stays {w:1, d:2})
    for (const z of horizontal) {
      for (let x = margin; x < this.gridSize - margin; x++) {
        if (z + 1 < this.gridSize &&
            this.grid[x][z].buildingId === null &&
            this.grid[x][z + 1].buildingId === null) {
          this.placeBuildingDirect({ x, z }, BuildingType.ROAD_AVENUE, 'EW');
        }
      }
    }

    // Place vertical avenues (NS orientation: size becomes {w:2, d:1})
    for (const x of vertical) {
      for (let z = margin; z < this.gridSize - margin; z++) {
        if (x + 1 < this.gridSize &&
            this.grid[x][z].buildingId === null &&
            this.grid[x + 1][z].buildingId === null) {
          this.placeBuildingDirect({ x, z }, BuildingType.ROAD_AVENUE, 'NS');
        }
      }
    }

    return { horizontal, vertical };
  }

  // ── Phase 3: Edge Feeder Roads ───────────────────────────

  private placeEdgeFeederRoads(anchors: EdgeAnchor[], arteries: Arteries): void {
    // Connect existing edge anchors to nearest artery
    for (const anchor of anchors) {
      for (const pos of anchor.positions) {
        this.connectEdgeToArtery(anchor.direction, pos, arteries);
      }
    }

    // Generate exit roads on edges without anchors
    const anchoredDirections = new Set(anchors.map(a => a.direction));
    const allDirections: EdgeDirection[] = ['north', 'south', 'east', 'west'];

    for (const dir of allDirections) {
      if (anchoredDirections.has(dir)) continue;
      this.generateExitRoads(dir, arteries);
    }
  }

  private connectEdgeToArtery(direction: EdgeDirection, pos: number, arteries: Arteries): void {
    switch (direction) {
      case 'north': {
        // Road at (pos, 0), connect southward to nearest horizontal artery
        const targetZ = this.findNearest(arteries.horizontal, 0);
        if (targetZ === null) return;
        for (let z = 1; z < targetZ; z++) {
          if (this.grid[pos]?.[z]?.buildingId === null) {
            this.placeBuildingDirect({ x: pos, z }, BuildingType.ROAD_STREET, 'NS');
          }
        }
        break;
      }
      case 'south': {
        const targetZ = this.findNearest(arteries.horizontal, this.gridSize - 1);
        if (targetZ === null) return;
        for (let z = this.gridSize - 2; z > targetZ + 1; z--) {
          if (this.grid[pos]?.[z]?.buildingId === null) {
            this.placeBuildingDirect({ x: pos, z }, BuildingType.ROAD_STREET, 'NS');
          }
        }
        break;
      }
      case 'west': {
        const targetX = this.findNearest(arteries.vertical, 0);
        if (targetX === null) return;
        for (let x = 1; x < targetX; x++) {
          if (this.grid[x]?.[pos]?.buildingId === null) {
            this.placeBuildingDirect({ x, z: pos }, BuildingType.ROAD_STREET, 'EW');
          }
        }
        break;
      }
      case 'east': {
        const targetX = this.findNearest(arteries.vertical, this.gridSize - 1);
        if (targetX === null) return;
        for (let x = this.gridSize - 2; x > targetX + 1; x--) {
          if (this.grid[x]?.[pos]?.buildingId === null) {
            this.placeBuildingDirect({ x, z: pos }, BuildingType.ROAD_STREET, 'EW');
          }
        }
        break;
      }
    }
  }

  private generateExitRoads(direction: EdgeDirection, arteries: Arteries): void {
    const [minExits, maxExits] = this.sizeParams.exitRoadCount;
    const count = minExits + Math.floor(Math.random() * (maxExits - minExits + 1));

    switch (direction) {
      case 'north':
      case 'south': {
        const z = direction === 'north' ? 0 : this.gridSize - 1;
        const candidates = arteries.vertical.slice();
        this.shuffle(candidates);
        for (let i = 0; i < Math.min(count, candidates.length); i++) {
          const x = candidates[i];
          if (this.grid[x]?.[z]?.buildingId === null) {
            this.placeBuildingDirect({ x, z }, BuildingType.ROAD_STREET, 'NS');
            // Connect to nearest horizontal artery
            this.connectEdgeToArtery(direction, x, arteries);
          }
        }
        break;
      }
      case 'west':
      case 'east': {
        const x = direction === 'west' ? 0 : this.gridSize - 1;
        const candidates = arteries.horizontal.slice();
        this.shuffle(candidates);
        for (let i = 0; i < Math.min(count, candidates.length); i++) {
          const z = candidates[i];
          if (this.grid[x]?.[z]?.buildingId === null) {
            this.placeBuildingDirect({ x, z }, BuildingType.ROAD_STREET, 'EW');
            this.connectEdgeToArtery(direction, z, arteries);
          }
        }
        break;
      }
    }
  }

  // ── Phase 4: Secondary Streets ───────────────────────────

  private placeSecondaryStreets(arteries: Arteries): void {
    const margin = 3;

    // Build sorted boundary arrays including grid edges and artery positions
    const hBounds = [margin, ...arteries.horizontal.sort((a, b) => a - b), this.gridSize - margin];
    const vBounds = [margin, ...arteries.vertical.sort((a, b) => a - b), this.gridSize - margin];

    const secondarySpacing = this.sizeParams.secondarySpacing;

    // Place vertical secondary streets (NS) between horizontal arteries
    for (let hi = 0; hi < hBounds.length - 1; hi++) {
      const z0 = hBounds[hi];
      const z1 = hBounds[hi + 1];

      for (let vi = 0; vi < vBounds.length - 1; vi++) {
        const x0 = vBounds[vi];
        const x1 = vBounds[vi + 1];

        const blockW = x1 - x0;
        const blockD = z1 - z0;

        // Vertical secondary streets within this block
        if (blockW > secondarySpacing * 2) {
          for (let sx = x0 + secondarySpacing; sx < x1; sx += secondarySpacing) {
            for (let sz = z0 + 1; sz < z1; sz++) {
              if (this.grid[sx]?.[sz]?.buildingId === null) {
                this.placeBuildingDirect({ x: sx, z: sz }, BuildingType.ROAD_STREET, 'NS');
              }
            }
          }
        }

        // Horizontal secondary streets within this block
        if (blockD > secondarySpacing * 2) {
          for (let sz = z0 + secondarySpacing; sz < z1; sz += secondarySpacing) {
            for (let sx = x0 + 1; sx < x1; sx++) {
              if (this.grid[sx]?.[sz]?.buildingId === null) {
                this.placeBuildingDirect({ x: sx, z: sz }, BuildingType.ROAD_STREET, 'EW');
              }
            }
          }
        }
      }
    }
  }

  // ── Phase 5: Zone Placement ──────────────────────────────

  private placeZones(arteries: Arteries): void {
    const center = this.gridSize / 2;
    const avenuePositions = new Set<string>();

    // Build a set of all avenue-adjacent cells
    for (const b of this.buildings) {
      if (b.type === BuildingType.ROAD_AVENUE) {
        const { w, d } = getEffectiveSize(b.type, b.orientation);
        for (let dx = -1; dx <= w; dx++) {
          for (let dz = -1; dz <= d; dz++) {
            const ax = b.position.x + dx;
            const az = b.position.z + dz;
            if (ax >= 0 && ax < this.gridSize && az >= 0 && az < this.gridSize) {
              avenuePositions.add(`${ax},${az}`);
            }
          }
        }
      }
    }

    for (let x = 0; x < this.gridSize; x++) {
      for (let z = 0; z < this.gridSize; z++) {
        if (this.grid[x][z].buildingId !== null) continue;

        const distFromCenter = Math.sqrt((x - center) ** 2 + (z - center) ** 2);
        const distFromEdge = Math.min(x, z, this.gridSize - 1 - x, this.gridSize - 1 - z);
        const isNearAvenue = avenuePositions.has(`${x},${z}`);

        // Determine zone type
        let zoneType: BuildingType;
        if (distFromEdge < this.sizeParams.zoneIndustrialEdge && distFromCenter > 18) {
          zoneType = BuildingType.ZONE_INDUSTRIAL;
        } else if (isNearAvenue && distFromCenter < 28) {
          zoneType = BuildingType.ZONE_COMMERCIAL;
        } else {
          zoneType = BuildingType.ZONE_RESIDENTIAL;
        }

        // Determine density based on distance from center (scaled by city size)
        let density: ZoneDensity;
        if (distFromCenter < this.sizeParams.densityRadii.high) {
          density = ZoneDensity.HIGH;
        } else if (distFromCenter < this.sizeParams.densityRadii.medium) {
          density = ZoneDensity.MEDIUM;
        } else {
          density = ZoneDensity.LOW;
        }

        this.placeBuildingDirect({ x, z }, zoneType, undefined, density);
      }
    }
  }

  // ── Phase 6: Infrastructure ──────────────────────────────

  private placeInfrastructure(): void {
    const center = this.gridSize / 2;

    // Infrastructure placement list with preferred zones and tier level
    const infraPlan: Array<{
      type: BuildingType;
      prefer: 'periphery' | 'center' | 'residential' | 'distributed';
      essential: boolean;
      tier: number; // 1=essential, 2=important, 3=nice-to-have
    }> = [
      // Essential (tier 1)
      { type: BuildingType.ENERGY_SOLAR_FARM, prefer: 'periphery', essential: true, tier: 1 },
      { type: BuildingType.WATER_TOWER, prefer: 'periphery', essential: true, tier: 1 },
      { type: BuildingType.POLICE_STATION, prefer: 'distributed', essential: true, tier: 1 },
      { type: BuildingType.FIRE_STATION, prefer: 'distributed', essential: true, tier: 1 },
      // Important (tier 2)
      { type: BuildingType.HEALTH_CLINIC, prefer: 'residential', essential: false, tier: 2 },
      { type: BuildingType.EDU_ELEMENTARY, prefer: 'residential', essential: false, tier: 2 },
      { type: BuildingType.GOV_CITY_HALL, prefer: 'center', essential: false, tier: 2 },
      { type: BuildingType.TRANS_BUS_DEPOT, prefer: 'distributed', essential: false, tier: 2 },
      // Nice-to-have (tier 3)
      { type: BuildingType.EDU_LIBRARY, prefer: 'residential', essential: false, tier: 3 },
      { type: BuildingType.ART_GALLERY, prefer: 'center', essential: false, tier: 3 },
      { type: BuildingType.GOV_MONUMENT, prefer: 'center', essential: false, tier: 3 },
      { type: BuildingType.ENERGY_WIND_TURBINE, prefer: 'periphery', essential: false, tier: 3 },
      { type: BuildingType.WATER_PUMP_STATION, prefer: 'periphery', essential: false, tier: 3 },
    ];

    // Filter infrastructure by allowed tiers based on city size
    const allowedTier = this.sizeParams.infraTiers;

    // Distribute police/fire to different quadrants
    let quadrantIndex = 0;
    const quadrants = [
      { x0: 5, z0: 5, x1: center - 2, z1: center - 2 },            // NW
      { x0: center + 2, z0: 5, x1: this.gridSize - 5, z1: center - 2 }, // NE
      { x0: 5, z0: center + 2, x1: center - 2, z1: this.gridSize - 5 }, // SW
      { x0: center + 2, z0: center + 2, x1: this.gridSize - 5, z1: this.gridSize - 5 }, // SE
    ];

    for (const item of infraPlan) {
      if (item.tier > allowedTier) continue;
      const def = BUILDING_DEFS[item.type];
      const { w, d } = getEffectiveSize(item.type);

      let pos: Position | null = null;

      switch (item.prefer) {
        case 'periphery':
          pos = this.findEmptyRect(2, 2, 14, 14, w, d)
            ?? this.findEmptyRect(this.gridSize - 14, 2, this.gridSize - 2, 14, w, d)
            ?? this.findEmptyRect(2, this.gridSize - 14, 14, this.gridSize - 2, w, d)
            ?? this.findEmptyRect(this.gridSize - 14, this.gridSize - 14, this.gridSize - 2, this.gridSize - 2, w, d);
          break;
        case 'center':
          pos = this.findEmptyRect(
            Math.floor(center - 8), Math.floor(center - 8),
            Math.floor(center + 8), Math.floor(center + 8),
            w, d
          );
          break;
        case 'residential':
          pos = this.findEmptyRect(
            Math.floor(center - 16), Math.floor(center - 16),
            Math.floor(center + 16), Math.floor(center + 16),
            w, d
          );
          break;
        case 'distributed': {
          const q = quadrants[quadrantIndex % quadrants.length];
          pos = this.findEmptyRect(
            Math.floor(q.x0), Math.floor(q.z0),
            Math.floor(q.x1), Math.floor(q.z1),
            w, d
          );
          quadrantIndex++;
          break;
        }
      }

      // Fallback: search entire grid
      if (!pos) {
        pos = this.findEmptyRect(2, 2, this.gridSize - 2, this.gridSize - 2, w, d);
      }

      // If essential and still no space, demolish zones to make room
      if (!pos && item.essential) {
        pos = this.clearSpaceForBuilding(w, d, item.prefer);
      }

      if (pos) {
        this.placeBuildingDirect(pos, item.type);
      }
    }
  }

  // ── Phase 7: Parks ───────────────────────────────────────

  private placeParks(): void {
    // Count residential zones and scatter parks
    const residentialBuildings = this.buildings.filter(
      b => b.type === BuildingType.ZONE_RESIDENTIAL
    );

    const parkCount = Math.floor(residentialBuildings.length / this.sizeParams.parkRatio);
    const candidates = residentialBuildings.slice();
    this.shuffle(candidates);

    for (let i = 0; i < Math.min(parkCount, candidates.length); i++) {
      const target = candidates[i];
      // Remove the residential zone and replace with park
      this.removeBuildingAt(target.position);
      this.placeBuildingDirect(target.position, BuildingType.PARK);
    }
  }

  // ── Helpers ──────────────────────────────────────────────

  private placeBuildingDirect(
    pos: Position,
    type: BuildingType,
    orientation?: RoadOrientation,
    density?: ZoneDensity,
  ): PlacedBuilding {
    const { w, d } = getEffectiveSize(type, orientation);
    const isZoneType = type === BuildingType.ZONE_RESIDENTIAL ||
      type === BuildingType.ZONE_COMMERCIAL ||
      type === BuildingType.ZONE_INDUSTRIAL;

    const building: PlacedBuilding = {
      id: uuid(),
      type,
      position: pos,
      placedBy: 'system',
      placedAt: 0,
      ...(isZoneType ? { density: density ?? ZoneDensity.MEDIUM, developmentLevel: 0 } : {}),
      ...(orientation ? { orientation } : {}),
    };

    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        const cx = pos.x + dx;
        const cz = pos.z + dz;
        if (cx >= 0 && cx < this.gridSize && cz >= 0 && cz < this.gridSize) {
          this.grid[cx][cz].buildingId = building.id;
        }
      }
    }

    this.buildings.push(building);
    return building;
  }

  private removeBuildingAt(pos: Position): void {
    const cell = this.grid[pos.x]?.[pos.z];
    if (!cell || !cell.buildingId) return;

    const buildingId = cell.buildingId;
    const building = this.buildings.find(b => b.id === buildingId);
    if (!building) return;

    const { w, d } = getEffectiveSize(building.type, building.orientation);
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        const cx = building.position.x + dx;
        const cz = building.position.z + dz;
        if (cx >= 0 && cx < this.gridSize && cz >= 0 && cz < this.gridSize) {
          this.grid[cx][cz].buildingId = null;
        }
      }
    }

    this.buildings = this.buildings.filter(b => b.id !== buildingId);
  }

  private findEmptyRect(
    startX: number, startZ: number,
    endX: number, endZ: number,
    width: number, depth: number,
  ): Position | null {
    const sx = Math.max(0, Math.floor(startX));
    const sz = Math.max(0, Math.floor(startZ));
    const ex = Math.min(this.gridSize, Math.floor(endX));
    const ez = Math.min(this.gridSize, Math.floor(endZ));

    for (let x = sx; x <= ex - width; x++) {
      for (let z = sz; z <= ez - depth; z++) {
        let fits = true;
        for (let dx = 0; dx < width && fits; dx++) {
          for (let dz = 0; dz < depth && fits; dz++) {
            if (this.grid[x + dx][z + dz].buildingId !== null) {
              fits = false;
            }
          }
        }
        if (fits) return { x, z };
      }
    }
    return null;
  }

  private clearSpaceForBuilding(
    width: number, depth: number,
    prefer: 'periphery' | 'center' | 'residential' | 'distributed',
  ): Position | null {
    const center = this.gridSize / 2;
    let searchX: number, searchZ: number;

    switch (prefer) {
      case 'periphery':
        searchX = 4; searchZ = 4; break;
      case 'center':
        searchX = Math.floor(center - 6); searchZ = Math.floor(center - 6); break;
      default:
        searchX = Math.floor(center - 12); searchZ = Math.floor(center - 12); break;
    }

    // Scan for a spot where we can demolish zones (not roads/infra)
    for (let x = searchX; x < this.gridSize - width - 2; x++) {
      for (let z = searchZ; z < this.gridSize - depth - 2; z++) {
        let canClear = true;
        for (let dx = 0; dx < width && canClear; dx++) {
          for (let dz = 0; dz < depth && canClear; dz++) {
            const cell = this.grid[x + dx][z + dz];
            if (cell.buildingId) {
              const b = this.buildings.find(b => b.id === cell.buildingId);
              if (!b || !(
                b.type === BuildingType.ZONE_RESIDENTIAL ||
                b.type === BuildingType.ZONE_COMMERCIAL ||
                b.type === BuildingType.ZONE_INDUSTRIAL ||
                b.type === BuildingType.PARK
              )) {
                canClear = false;
              }
            }
          }
        }

        if (canClear) {
          // Demolish all zones in this area
          for (let dx = 0; dx < width; dx++) {
            for (let dz = 0; dz < depth; dz++) {
              this.removeBuildingAt({ x: x + dx, z: z + dz });
            }
          }
          return { x, z };
        }
      }
    }

    return null;
  }

  private findNearest(values: number[], target: number): number | null {
    if (values.length === 0) return null;
    let best = values[0];
    let bestDist = Math.abs(best - target);
    for (const v of values) {
      const dist = Math.abs(v - target);
      if (dist < bestDist) {
        best = v;
        bestDist = dist;
      }
    }
    return best;
  }

  private shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
