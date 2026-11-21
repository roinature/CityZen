import * as THREE from 'three';
import type { BuildingType, CityState, PlacedBuilding, ZoneType } from '@cityzen/shared';
import { BUILDING_DEFS, CELL_SIZE, DEFAULT_GRID_SIZE, isRoad, isStarterEntranceRoad, isZone, getZoneLevelDef, getEffectiveSize } from '@cityzen/shared';
import { calculateCityScore } from '@cityzen/shared';
import { BuildingFactory, type RoadNeighbors } from './BuildingFactory.js';
import { createStreetscape } from './Streetscape.js';
import { createCityOverview } from './CityOverview.js';

const GROW_SECONDS = 0.45;
const CHUNK_SIZE = 4;
const MAX_NIGHT_LIGHTS = 12;
const NO_ROAD_CHANGES: ReadonlySet<string> = new Set();

interface CityChunk {
  buildings: Array<{ building: PlacedBuilding; bounds: THREE.Box3 }>;
  bounds: THREE.Box3;
}

/** Overshoots slightly past 1 before settling, giving new buildings a little bounce. */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export class CityRenderer {
  private scene: THREE.Scene;
  private factory: BuildingFactory;
  private zonesHighlighted = false;
  private roadTiles = new Map<string, BuildingType>();
  private pendingStreetscapeSize: number | null = null;
  private streetscape: THREE.Group | null = null;
  private meshes: Map<string, THREE.Group> = new Map();
  private buildingLevels: Map<string, number> = new Map();
  private zonePopRatios: Map<string, number> = new Map();
  /** Buildings currently playing their "rise from the ground" animation (id → progress 0..1). */
  private growAnims: Map<string, number> = new Map();

  private state: CityState | null = null;
  private chunks = new Map<string, CityChunk>();
  private needsSync = false;
  private detailKey = '';
  private overview: THREE.Group | null = null;
  private frustum = new THREE.Frustum();
  private projectionView = new THREE.Matrix4();
  private previousProjectionView = new THREE.Matrix4();
  private cameraDirection = new THREE.Vector3();
  private newlyPlaced = new Set<string>();
  private indexedIds: Set<string> | null = null;
  private nightCandidates: Array<{ light: THREE.PointLight; x: number; z: number }> = [];
  private activeNightLights: THREE.PointLight[] = [];
  private lastLightFocus = new THREE.Vector2(Infinity, Infinity);

  constructor(scene: THREE.Scene, private entranceRoad: THREE.Group, private maxDetailBuildings: number) {
    this.scene = scene;
    this.factory = new BuildingFactory();
  }

  /** Advance construction animations. Call once per frame. */
  update(deltaTime: number, camera: THREE.Camera, night: boolean): void {
    this.updateView(camera);
    this.updateNightLights(camera, night);
    if (this.pendingStreetscapeSize !== null) {
      this.clearStreetscape();
      this.streetscape = createStreetscape(this.roadTiles, this.pendingStreetscapeSize);
      this.scene.add(this.streetscape);
      this.pendingStreetscapeSize = null;
    }

    if (this.growAnims.size === 0) return;
    for (const [id, progress] of this.growAnims) {
      const mesh = this.meshes.get(id);
      if (!mesh) {
        this.growAnims.delete(id);
        continue;
      }
      const t = Math.min(1, progress + deltaTime / GROW_SECONDS);
      mesh.scale.y = easeOutBack(t);
      if (t >= 1) {
        mesh.scale.y = 1;
        this.growAnims.delete(id);
      } else {
        this.growAnims.set(id, t);
      }
    }
  }

  highlightZones(highlight: boolean): void {
    if (highlight === this.zonesHighlighted) return;
    this.zonesHighlighted = highlight;
    const lots = this.overview?.getObjectByName('overview-zone-lots');
    if (lots instanceof THREE.InstancedMesh && lots.material instanceof THREE.MeshLambertMaterial) {
      lots.material.opacity = highlight ? 0.68 : 0.25;
    }
    for (const id of this.buildingLevels.keys()) {
      const mesh = this.meshes.get(id);
      if (mesh) this.factory.setZoneHighlight(mesh, highlight);
    }
  }

  private startGrowAnim(id: string, mesh: THREE.Group): void {
    mesh.scale.y = 0.02;
    this.growAnims.set(id, 0);
  }

  syncState(state: CityState): void {
    this.state = state;
    this.needsSync = true;
  }

  private updateView(camera: THREE.Camera): void {
    if (!this.state) return;
    const state = this.state;
    const dirty = this.needsSync;
    const changedRoadTiles = dirty ? this.reindex(state) : NO_ROAD_CHANGES;
    this.needsSync = false;

    this.projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!dirty && this.previousProjectionView.equals(this.projectionView)) return;
    this.previousProjectionView.copy(this.projectionView);
    this.frustum.setFromProjectionMatrix(this.projectionView);
    const visibleBuildings: PlacedBuilding[] = [];
    const detailLimit = this.overview ? this.maxDetailBuildings * 0.8 : this.maxDetailBuildings;
    for (const chunk of this.chunks.values()) {
      if (!this.frustum.intersectsBox(chunk.bounds)) continue;
      for (const { building, bounds } of chunk.buildings) {
        if (this.frustum.intersectsBox(bounds)) visibleBuildings.push(building);
      }
      if (visibleBuildings.length > detailLimit) break;
    }

    if (visibleBuildings.length > detailLimit) {
      if (dirty || !this.overview) {
        this.clearOverview();
        this.clearDetailedMeshes();
        this.detailKey = '';
        this.overview = createCityOverview(state.buildings, this.zonesHighlighted);
        this.scene.add(this.overview);
        this.newlyPlaced.clear();
      }
      return;
    }

    this.clearOverview();
    const detailKey = visibleBuildings.map(building => building.id).join(';');
    if (!dirty && detailKey === this.detailKey) return;
    this.detailKey = detailKey;
    this.syncDetailedState(state, visibleBuildings, changedRoadTiles);
    this.newlyPlaced.clear();
    this.nightCandidates = [];
    this.lastLightFocus.set(Infinity, Infinity);
    for (const group of this.meshes.values()) {
      for (const light of group.children) {
        if (!(light instanceof THREE.PointLight)) continue;
        light.visible = false;
        this.nightCandidates.push({ light, x: group.position.x + light.position.x, z: group.position.z + light.position.z });
      }
    }
    this.activeNightLights = [];
  }

  private reindex(state: CityState): Set<string> {
    this.entranceRoad.visible = state.buildings.length === 0
      || state.buildings.some(building => isStarterEntranceRoad(building, DEFAULT_GRID_SIZE));
    this.chunks.clear();
    this.newlyPlaced.clear();
    const previousIds = this.indexedIds;
    this.indexedIds = new Set();
    const roadTiles = new Map<string, BuildingType>();

    for (const building of state.buildings) {
      this.indexedIds.add(building.id);
      if (previousIds && !previousIds.has(building.id)) this.newlyPlaced.add(building.id);
      const { x, z } = building.position;
      const { w, d } = getEffectiveSize(building.type, building.orientation);
      const key = `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
      let chunk = this.chunks.get(key);
      if (!chunk) {
        chunk = { buildings: [], bounds: new THREE.Box3() };
        this.chunks.set(key, chunk);
      }
      // Use conservative bounds so roof details stay visible as the camera moves.
      const level = building.developmentLevel ?? 0;
      const height = isZone(building.type)
        ? (level > 0 ? getZoneLevelDef(building.type, building.density, level).height + 0.6 : 0.1)
        : isRoad(building.type) ? 0.4 : (BUILDING_DEFS[building.type].height ?? 1) + 2;
      const margin = 0.6;
      const bounds = new THREE.Box3(
        new THREE.Vector3((x - margin) * CELL_SIZE, 0, (z - margin) * CELL_SIZE),
        new THREE.Vector3((x + w + margin) * CELL_SIZE, height, (z + d + margin) * CELL_SIZE),
      );
      chunk.buildings.push({ building, bounds });
      chunk.bounds.union(bounds);

      if (isRoad(building.type)) {
        for (let dx = 0; dx < w; dx++) {
          for (let dz = 0; dz < d; dz++) {
            roadTiles.set(`${x + dx},${z + dz}`, building.type);
          }
        }
      }
    }

    const changedRoadTiles = new Set<string>();
    for (const [tile, type] of this.roadTiles) {
      if (roadTiles.get(tile) !== type) changedRoadTiles.add(tile);
    }
    for (const tile of roadTiles.keys()) {
      if (!this.roadTiles.has(tile)) changedRoadTiles.add(tile);
    }
    if (changedRoadTiles.size) this.pendingStreetscapeSize = state.grid.length;
    this.roadTiles = roadTiles;
    return changedRoadTiles;
  }

  private syncDetailedState(state: CityState, buildings: PlacedBuilding[], changedRoadTiles: ReadonlySet<string>): void {
    const currentIds = new Set(this.meshes.keys());
    const newIds = new Set(buildings.map(building => building.id));
    // Update factory with current city score
    const score = calculateCityScore(state);
    this.factory.setCityScore(score);

    // Compute zone population ratios from state
    const newZonePopRatios = new Map<string, number>();
    if (state.resources.zonePopulations) {
      for (const entry of state.resources.zonePopulations) {
        newZonePopRatios.set(entry.buildingId, entry.capacity > 0 ? entry.population / entry.capacity : 0);
      }
    }

    const roadTiles = this.roadTiles;
    const buildingByPos = new Map<string, PlacedBuilding>();
    if (changedRoadTiles.size) {
      for (const building of buildings) {
        if (!isRoad(building.type)) continue;
        const { x, z } = building.position;
        const { w, d } = getEffectiveSize(building.type, building.orientation);
        for (let dx = 0; dx < w; dx++) {
          for (let dz = 0; dz < d; dz++) buildingByPos.set(`${x + dx},${z + dz}`, building);
        }
      }
    }

    // Remove demolished buildings
    for (const id of currentIds) {
      if (!newIds.has(id)) {
        const mesh = this.meshes.get(id)!;
        this.scene.remove(mesh);
        this.disposeMesh(mesh);
        this.meshes.delete(id);
        this.buildingLevels.delete(id);
        this.growAnims.delete(id);
      }
    }

    // Add new buildings
    for (const building of buildings) {
      if (!currentIds.has(building.id)) {
        let neighbors: RoadNeighbors | undefined;
        if (isRoad(building.type)) {
          neighbors = this.getRoadNeighbors(building, roadTiles);
        }

        const ratio = newZonePopRatios.get(building.id);
        const mesh = this.factory.createBuilding(building, neighbors, ratio);
        this.scene.add(mesh);
        this.meshes.set(building.id, mesh);
        if (this.newlyPlaced.has(building.id) && !isRoad(building.type)) {
          this.startGrowAnim(building.id, mesh);
        }

        if (isZone(building.type)) {
          this.factory.setZoneHighlight(mesh, this.zonesHighlighted);
          this.buildingLevels.set(building.id, building.developmentLevel ?? 0);
        }
      }
    }

    // Check for zone level changes OR population ratio changes in existing buildings
    for (const building of buildings) {
      if (isZone(building.type) && currentIds.has(building.id)) {
        const prevLevel = this.buildingLevels.get(building.id) ?? 0;
        const currLevel = building.developmentLevel ?? 0;

        const levelChanged = prevLevel !== currLevel;
        let needsRebuild = levelChanged;

        // For density-aware zones, check if visible building count changed
        if (building.density && currLevel > 0) {
          const prevRatio = this.zonePopRatios.get(building.id) ?? 0;
          const currRatio = newZonePopRatios.get(building.id) ?? 0;
          const prevVisible = this.computeVisibleCount(prevRatio, building, prevLevel);
          const currVisible = this.computeVisibleCount(currRatio, building, currLevel);
          if (prevVisible !== currVisible) needsRebuild = true;
        }

        if (needsRebuild && this.meshes.has(building.id)) {
          const existing = this.meshes.get(building.id)!;
          this.scene.remove(existing);
          this.disposeMesh(existing);
          const ratio = newZonePopRatios.get(building.id);
          const mesh = this.factory.createBuilding(building, undefined, ratio);
          this.factory.setZoneHighlight(mesh, this.zonesHighlighted);
          this.scene.add(mesh);
          this.meshes.set(building.id, mesh);
          this.buildingLevels.set(building.id, currLevel);
          if (levelChanged) {
            this.startGrowAnim(building.id, mesh);
          }
        }
      }
    }

    // Update stored zone population ratios
    this.zonePopRatios = newZonePopRatios;

    // Refresh adjacent roads whose neighbor configuration may have changed
    const refreshed = new Set<string>();
    const offsets = [{ dx: 0, dz: -1 }, { dx: 0, dz: 1 }, { dx: 1, dz: 0 }, { dx: -1, dz: 0 }];

    for (const tile of changedRoadTiles) {
      const [x, z] = tile.split(',').map(Number);
      for (const { dx, dz } of offsets) {
        const nx = x + dx;
        const nz = z + dz;
        const key = `${nx},${nz}`;
        const neighbor = buildingByPos.get(key);
        if (neighbor && isRoad(neighbor.type) && currentIds.has(neighbor.id) && !refreshed.has(neighbor.id)) {
          refreshed.add(neighbor.id);
          this.refreshRoad(neighbor, roadTiles);
        }
      }
    }
  }

  private refreshRoad(building: PlacedBuilding, roadTiles: ReadonlyMap<string, BuildingType>): void {
    const existing = this.meshes.get(building.id);
    if (existing) {
      this.scene.remove(existing);
      this.disposeMesh(existing);
    }
    const neighbors = this.getRoadNeighbors(building, roadTiles);
    const mesh = this.factory.createBuilding(building, neighbors);
    this.scene.add(mesh);
    this.meshes.set(building.id, mesh);
  }

  private getRoadNeighbors(building: PlacedBuilding, roadTiles: ReadonlyMap<string, BuildingType>): RoadNeighbors {
    const { x, z } = building.position;
    const { w, d } = getEffectiveSize(building.type, building.orientation);

    // Build a set of this building's own cells to exclude from neighbor checks
    const ownCells = new Set<string>();
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        ownCells.add(`${x + dx},${z + dz}`);
      }
    }

    // Check along each edge of the building footprint
    let hasNorth = false, hasEast = false, hasWest = false;
    let hasSouth = isStarterEntranceRoad(building, DEFAULT_GRID_SIZE);
    for (let dx = 0; dx < w; dx++) {
      if (!ownCells.has(`${x + dx},${z - 1}`) && roadTiles.has(`${x + dx},${z - 1}`)) hasNorth = true;
      if (!ownCells.has(`${x + dx},${z + d}`) && roadTiles.has(`${x + dx},${z + d}`)) hasSouth = true;
    }
    for (let dz = 0; dz < d; dz++) {
      if (!ownCells.has(`${x - 1},${z + dz}`) && roadTiles.has(`${x - 1},${z + dz}`)) hasWest = true;
      if (!ownCells.has(`${x + w},${z + dz}`) && roadTiles.has(`${x + w},${z + dz}`)) hasEast = true;
    }

    return { hasNorth, hasSouth, hasEast, hasWest };
  }

  private computeVisibleCount(ratio: number, building: PlacedBuilding, level: number): number {
    if (!building.density || level <= 0) return 0;
    const levelDef = getZoneLevelDef(building.type as ZoneType, building.density, level);
    return Math.min(Math.max(1, Math.ceil(ratio * levelDef.maxBuildings)), levelDef.maxBuildings);
  }

  private clearStreetscape(): void {
    if (!this.streetscape) return;
    this.scene.remove(this.streetscape);
    this.disposeMesh(this.streetscape);
    this.streetscape = null;
  }

  private updateNightLights(camera: THREE.Camera, night: boolean): void {
    if (!night || this.nightCandidates.length === 0) {
      if (this.activeNightLights.length) {
        for (const light of this.activeNightLights) light.visible = false;
        this.activeNightLights = [];
        this.lastLightFocus.set(Infinity, Infinity);
      }
      return;
    }

    camera.getWorldDirection(this.cameraDirection);
    const distance = -camera.position.y / this.cameraDirection.y;
    const x = camera.position.x + distance * this.cameraDirection.x;
    const z = camera.position.z + distance * this.cameraDirection.z;
    if (Math.hypot(x - this.lastLightFocus.x, z - this.lastLightFocus.y) < 2 * CELL_SIZE) return;
    this.lastLightFocus.set(x, z);

    const distanceToFocus = (candidate: { x: number; z: number }) => (candidate.x - x) ** 2 + (candidate.z - z) ** 2;
    this.nightCandidates.sort((a, b) => distanceToFocus(a) - distanceToFocus(b));
    for (const light of this.activeNightLights) light.visible = false;
    this.activeNightLights = this.nightCandidates.slice(0, MAX_NIGHT_LIGHTS).map(candidate => candidate.light);
    for (const light of this.activeNightLights) light.visible = true;
  }

  private clearOverview(): void {
    if (!this.overview) return;
    this.scene.remove(this.overview);
    this.disposeMesh(this.overview);
    this.overview = null;
  }

  clear(): void {
    this.state = null;
    this.needsSync = false;
    this.detailKey = '';
    this.chunks.clear();
    this.newlyPlaced.clear();
    this.indexedIds = null;
    this.entranceRoad.visible = false;
    this.clearStreetscape();
    this.clearOverview();
    this.pendingStreetscapeSize = null;
    this.roadTiles.clear();
    this.clearDetailedMeshes();
  }

  private clearDetailedMeshes(): void {
    this.nightCandidates = [];
    this.activeNightLights = [];
    this.lastLightFocus.set(Infinity, Infinity);
    for (const [, mesh] of this.meshes) {
      this.scene.remove(mesh);
      this.disposeMesh(mesh);
    }
    this.meshes.clear();
    this.growAnims.clear();
    this.buildingLevels.clear();
    this.zonePopRatios.clear();
  }

  private disposeMesh(group: THREE.Group): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const maps = new Set<THREE.Texture>();
    group.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      if (child instanceof THREE.InstancedMesh) child.dispose();
      geometries.add(child.geometry);
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        materials.add(material);
        // BuildingFactory owns the source textures and gives each model its own maps.
        if ('map' in material && material.map instanceof THREE.Texture) maps.add(material.map);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const map of maps) map.dispose();
  }
}
