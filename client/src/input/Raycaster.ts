import * as THREE from 'three';
import {
  BUILDING_DEFS,
  BuildingType,
  CELL_SIZE,
  DEFAULT_GRID_SIZE,
  ZoneDensity,
  clamp,
  getEffectiveSize,
  getZoneLevelDef,
  isRoad,
  isUtilityConduit,
  isZone,
  type CityState,
  type PlacedBuilding,
  type Position,
  type ZoneType,
} from '@cityzen/shared';

function estimateBuildingTopWorldY(b: PlacedBuilding): number {
  if (isZone(b.type)) {
    const level = b.developmentLevel ?? 0;
    if (level <= 0) return 0.08 * CELL_SIZE;
    const density = b.density ?? ZoneDensity.MEDIUM;
    const base = getZoneLevelDef(b.type as ZoneType, density, level).height;
    if (b.type === BuildingType.ZONE_RESIDENTIAL && density === ZoneDensity.LOW) {
      return (0.55 + level * 0.08) * CELL_SIZE;
    }
    if (b.type === BuildingType.ZONE_INDUSTRIAL) {
      return (0.6 + base * 0.1) * CELL_SIZE;
    }
    return Math.max(0.55, base * 0.38) * CELL_SIZE;
  }
  const def = BUILDING_DEFS[b.type];
  if (b.type === BuildingType.PARK || b.type === BuildingType.PARKING) {
    return 0.45 * CELL_SIZE;
  }
  return Math.max(0.45, 0.55 + def.height * 0.28) * CELL_SIZE;
}

export class GridRaycaster {
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmpBox = new THREE.Box3();
  private tmpHit = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement) {}

  private setRayFromScreen(screenX: number, screenY: number, camera: THREE.Camera): void {
    const bounds = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((screenX - bounds.left) / bounds.width) * 2 - 1,
      -((screenY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, camera);
  }

  /**
   * Picks the closest non-road, non-conduit building under `(screenX, screenY)`
   * using 3D bounding-box raycasting (so clicking upper floors of tall buildings works)
   * with a ground-cell fallback.
   */
  pickBuilding(screenX: number, screenY: number, camera: THREE.Camera, state: CityState): PlacedBuilding | null {
    this.setRayFromScreen(screenX, screenY, camera);
    const ray = this.raycaster.ray;

    let bestBuilding: PlacedBuilding | null = null;
    let bestDistSq = Infinity;

    for (const b of state.buildings) {
      if (isRoad(b.type) || isUtilityConduit(b.type)) continue;
      const { w, d } = getEffectiveSize(b.type, b.orientation);
      const x0 = b.position.x * CELL_SIZE;
      const z0 = b.position.z * CELL_SIZE;
      const x1 = (b.position.x + w) * CELL_SIZE;
      const z1 = (b.position.z + d) * CELL_SIZE;
      const topY = estimateBuildingTopWorldY(b);
      this.tmpBox.min.set(x0, 0, z0);
      this.tmpBox.max.set(x1, topY, z1);

      if (ray.intersectBox(this.tmpBox, this.tmpHit)) {
        const distSq = ray.origin.distanceToSquared(this.tmpHit);
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestBuilding = b;
        }
      }
    }

    if (bestBuilding) return bestBuilding;

    const pos = this.getGridPosition(screenX, screenY, camera);
    if (!pos) return null;
    const bid = state.grid[pos.x]?.[pos.z]?.buildingId;
    if (!bid) return null;
    const b = state.buildings.find(item => item.id === bid);
    if (!b || isRoad(b.type) || isUtilityConduit(b.type)) return null;
    return b;
  }

  getWorldPosition(screenX: number, screenY: number, camera: THREE.Camera): { x: number; z: number } | null {
    this.setRayFromScreen(screenX, screenY, camera);
    const intersection = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, intersection);
    if (!hit) return null;
    return { x: intersection.x, z: intersection.z };
  }

  getGridPosition(screenX: number, screenY: number, camera: THREE.Camera, clampToGrid = false): Position | null {
    this.setRayFromScreen(screenX, screenY, camera);
    const intersection = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, intersection);

    if (!hit) return null;

    const x = Math.floor(intersection.x / CELL_SIZE);
    const z = Math.floor(intersection.z / CELL_SIZE);

    if (clampToGrid) {
      return {
        x: clamp(x, 0, DEFAULT_GRID_SIZE - 1),
        z: clamp(z, 0, DEFAULT_GRID_SIZE - 1),
      };
    }

    if (x < 0 || x >= DEFAULT_GRID_SIZE || z < 0 || z >= DEFAULT_GRID_SIZE) {
      return null;
    }

    return { x, z };
  }
}
