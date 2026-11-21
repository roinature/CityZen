import * as THREE from 'three';
import type { BuildingType, CityState, PlacedBuilding, ZoneType } from '@cityzen/shared';
import { DEFAULT_GRID_SIZE, isRoad, isStarterEntranceRoad, isZone, getZoneLevelDef, getEffectiveSize } from '@cityzen/shared';
import { calculateCityScore } from '@cityzen/shared';
import { BuildingFactory, type RoadNeighbors } from './BuildingFactory.js';
import { createStreetscape } from './Streetscape.js';

const GROW_SECONDS = 0.45;

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

  constructor(scene: THREE.Scene, private entranceRoad: THREE.Group) {
    this.scene = scene;
    this.factory = new BuildingFactory();
  }

  /** Advance construction animations. Call once per frame. */
  update(deltaTime: number): void {
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
    // Older unbuilt saves still see the approach road at the edge of their plot.
    this.entranceRoad.visible = state.buildings.length === 0
      || state.buildings.some(building => isStarterEntranceRoad(building, DEFAULT_GRID_SIZE));
    const currentIds = new Set(this.meshes.keys());
    // Loading a whole city at once should appear instantly, not as a wave of pop-ins
    const animate = currentIds.size > 0 || state.buildings.length <= 3;
    const newIds = new Set(state.buildings.map((b: PlacedBuilding) => b.id));

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

    // Index full footprints for road adjacency and sidewalk placement.
    const roadTiles = new Map<string, BuildingType>();
    const buildingByPos = new Map<string, PlacedBuilding>();
    for (const building of state.buildings) {
      const { w, d } = getEffectiveSize(building.type, building.orientation);
      const road = isRoad(building.type);
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < d; dz++) {
          const key = `${building.position.x + dx},${building.position.z + dz}`;
          buildingByPos.set(key, building);
          if (road) roadTiles.set(key, building.type);
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

    if (changedRoadTiles.size > 0) {
      this.roadTiles = roadTiles;
      // Coalesce rapid placement events into one rebuild per frame.
      this.pendingStreetscapeSize = state.grid.length;
    }

    // Remove demolished buildings
    for (const id of currentIds) {
      if (!newIds.has(id)) {
        const mesh = this.meshes.get(id)!;
        this.scene.remove(mesh);
        this.disposeMesh(mesh);
        this.meshes.delete(id);
        this.buildingLevels.delete(id);
      }
    }

    // Add new buildings
    for (const building of state.buildings) {
      if (!currentIds.has(building.id)) {
        let neighbors: RoadNeighbors | undefined;
        if (isRoad(building.type)) {
          neighbors = this.getRoadNeighbors(building, roadTiles);
        }

        const ratio = newZonePopRatios.get(building.id);
        const mesh = this.factory.createBuilding(building, neighbors, ratio);
        this.scene.add(mesh);
        this.meshes.set(building.id, mesh);
        if (animate && !isRoad(building.type)) {
          this.startGrowAnim(building.id, mesh);
        }

        if (isZone(building.type)) {
          this.factory.setZoneHighlight(mesh, this.zonesHighlighted);
          this.buildingLevels.set(building.id, building.developmentLevel ?? 0);
        }
      }
    }

    // Check for zone level changes OR population ratio changes in existing buildings
    for (const building of state.buildings) {
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

  clear(): void {
    this.entranceRoad.visible = false;
    this.clearStreetscape();
    this.pendingStreetscapeSize = null;
    this.roadTiles.clear();
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
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child instanceof THREE.InstancedMesh) child.dispose();
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }
}
