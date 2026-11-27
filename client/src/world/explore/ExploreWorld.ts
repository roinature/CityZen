import { BUILDING_DEFS, BuildingType, isRoad, type CityState, type Grid } from '@cityzen/shared';
import type { CarManager } from '../CarManager.js';
import type { BoatManager } from '../BoatManager.js';
import { SIDEWALK, WALK_Y, isPaved } from '../RoadSurface.js';
import type { ObstacleMap } from './ObstacleMap.js';

export type Surface = 'road' | 'ground' | 'lot' | 'water' | 'steep' | 'outside';

const ROAD_Y = 0.02;
const GROUND_Y = 0.01;
const LOT_Y = 0.035;

/** The city as the explore modes see it: what each cell is, and how high the ground stands. */
export class ExploreWorld {
  state!: CityState;
  private typeById = new Map<string, BuildingType>();
  private indexed: CityState['buildings'] | null = null;
  private indexedCount = -1;
  private obstaclesFor: CityState['buildings'] | null = null;
  private obstacleCount = -1;
  obstacles!: ObstacleMap;

  constructor(
    readonly traffic: CarManager,
    readonly boats: BoatManager,
    private loadObstacles: () => ObstacleMap,
  ) {}

  /** Returns true when the layout changed since the last call. */
  sync(state: CityState): boolean {
    this.state = state;
    if (state.buildings !== this.obstaclesFor || state.buildings.length !== this.obstacleCount) {
      this.obstaclesFor = state.buildings;
      this.obstacleCount = state.buildings.length;
      this.obstacles = this.loadObstacles();
    }
    if (state.buildings === this.indexed && state.buildings.length === this.indexedCount) return false;
    this.indexed = state.buildings;
    this.indexedCount = state.buildings.length;
    this.typeById.clear();
    for (const b of state.buildings) this.typeById.set(b.id, b.type);
    return true;
  }

  get grid(): Grid {
    return this.state.grid;
  }

  get size(): number {
    return this.state.grid.length;
  }

  typeAt(x: number, z: number): BuildingType | undefined {
    const id = this.state.grid[Math.floor(x)]?.[Math.floor(z)]?.buildingId;
    return id ? this.typeById.get(id) : undefined;
  }

  typeOf(id: string): BuildingType | undefined {
    return this.typeById.get(id);
  }

  surfaceAt(x: number, z: number): Surface {
    const cx = Math.floor(x), cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= this.size || cz >= this.size) return 'outside';
    const cell = this.state.grid[cx][cz];
    if (cell.terrain === 'water') return 'water';
    const type = cell.buildingId ? this.typeById.get(cell.buildingId) : undefined;
    if (type && isRoad(type)) return 'road';
    if (cell.terrain === 'steep') return 'steep';
    return type ? 'lot' : 'ground';
  }

  /** Top speed multiplier of the road here, 1 off-road. */
  roadSpeedAt(x: number, z: number): number {
    const type = this.typeAt(x, z);
    return type ? BUILDING_DEFS[type].speedMultiplier ?? 1 : 1;
  }

  /** Whether this point is on the raised sidewalk along a paved street. */
  onSidewalk(x: number, z: number): boolean {
    const cx = Math.floor(x), cz = Math.floor(z);
    const fx = x - cx, fz = z - cz;
    const paved = (dx: number, dz: number) => isPaved(this.typeAt(cx + dx, cz + dz));
    return (fx > 1 - SIDEWALK && paved(1, 0)) || (fx < SIDEWALK && paved(-1, 0))
      || (fz > 1 - SIDEWALK && paved(0, 1)) || (fz < SIDEWALK && paved(0, -1))
      || (fx > 1 - SIDEWALK && fz > 1 - SIDEWALK && paved(1, 1))
      || (fx < SIDEWALK && fz > 1 - SIDEWALK && paved(-1, 1))
      || (fx > 1 - SIDEWALK && fz < SIDEWALK && paved(1, -1))
      || (fx < SIDEWALK && fz < SIDEWALK && paved(-1, -1));
  }

  /** Height of the walkable surface at a point, in cells. */
  groundY(x: number, z: number): number {
    switch (this.surfaceAt(x, z)) {
      case 'road': return ROAD_Y;
      case 'water': return 0;
      case 'lot': return this.onSidewalk(x, z) ? WALK_Y : this.typeAt(x, z) === BuildingType.PARK ? 0.024 : LOT_Y;
      default: return this.onSidewalk(x, z) ? WALK_Y : GROUND_Y;
    }
  }
}
