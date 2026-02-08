import * as THREE from 'three';
import type { CityState, PlacedBuilding } from '@cityzen/shared';
import { isRoad, isZone, BUILDING_DEFS } from '@cityzen/shared';
import { BuildingFactory, type RoadNeighbors } from './BuildingFactory.js';

export class CityRenderer {
  private scene: THREE.Scene;
  private factory: BuildingFactory;
  private meshes: Map<string, THREE.Group> = new Map();
  private buildingLevels: Map<string, number> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.factory = new BuildingFactory();
  }

  syncState(state: CityState): void {
    const currentIds = new Set(this.meshes.keys());
    const newIds = new Set(state.buildings.map((b) => b.id));

    // Build a set of road positions for neighbor detection (all cells of multi-cell roads)
    const roadPositions = new Set<string>();
    for (const b of state.buildings) {
      if (isRoad(b.type)) {
        const def = BUILDING_DEFS[b.type];
        for (let dx = 0; dx < def.size.w; dx++) {
          for (let dz = 0; dz < def.size.d; dz++) {
            roadPositions.add(`${b.position.x + dx},${b.position.z + dz}`);
          }
        }
      }
    }

    // Build a lookup from position key to building for quick neighbor refresh (all cells)
    const buildingByPos = new Map<string, PlacedBuilding>();
    for (const b of state.buildings) {
      const def = BUILDING_DEFS[b.type];
      for (let dx = 0; dx < def.size.w; dx++) {
        for (let dz = 0; dz < def.size.d; dz++) {
          buildingByPos.set(`${b.position.x + dx},${b.position.z + dz}`, b);
        }
      }
    }

    // Collect positions that changed (added/removed) so we can refresh adjacent roads
    const changedPositions: { x: number; z: number }[] = [];

    // Remove demolished buildings
    for (const id of currentIds) {
      if (!newIds.has(id)) {
        const mesh = this.meshes.get(id)!;
        const ud = mesh.userData as { buildingType?: string };
        if (ud.buildingType && isRoad(ud.buildingType as any)) {
          const pos = mesh.position;
          const gx = Math.floor(pos.x);
          const gz = Math.floor(pos.z);
          changedPositions.push({ x: gx, z: gz });
        }
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
          neighbors = this.getRoadNeighbors(building, roadPositions);
          changedPositions.push({ x: building.position.x, z: building.position.z });
        }

        const mesh = this.factory.createBuilding(building, neighbors);
        this.scene.add(mesh);
        this.meshes.set(building.id, mesh);

        if (isZone(building.type)) {
          this.buildingLevels.set(building.id, building.developmentLevel ?? 0);
        }
      }
    }

    // Check for zone level changes in existing buildings
    for (const building of state.buildings) {
      if (isZone(building.type) && currentIds.has(building.id)) {
        const prevLevel = this.buildingLevels.get(building.id) ?? 0;
        const currLevel = building.developmentLevel ?? 0;
        if (prevLevel !== currLevel && this.meshes.has(building.id)) {
          const existing = this.meshes.get(building.id)!;
          this.scene.remove(existing);
          this.disposeMesh(existing);
          const mesh = this.factory.createBuilding(building);
          this.scene.add(mesh);
          this.meshes.set(building.id, mesh);
          this.buildingLevels.set(building.id, currLevel);
        }
      }
    }

    // Refresh adjacent roads whose neighbor configuration may have changed
    const refreshed = new Set<string>();
    const offsets = [{ dx: 0, dz: -1 }, { dx: 0, dz: 1 }, { dx: 1, dz: 0 }, { dx: -1, dz: 0 }];

    for (const pos of changedPositions) {
      for (const { dx, dz } of offsets) {
        const nx = pos.x + dx;
        const nz = pos.z + dz;
        const key = `${nx},${nz}`;
        const neighbor = buildingByPos.get(key);
        if (neighbor && isRoad(neighbor.type) && !refreshed.has(neighbor.id)) {
          refreshed.add(neighbor.id);
          this.refreshRoad(neighbor, roadPositions);
        }
      }
    }
  }

  private refreshRoad(building: PlacedBuilding, roadPositions: Set<string>): void {
    const existing = this.meshes.get(building.id);
    if (existing) {
      this.scene.remove(existing);
      this.disposeMesh(existing);
    }
    const neighbors = this.getRoadNeighbors(building, roadPositions);
    const mesh = this.factory.createBuilding(building, neighbors);
    this.scene.add(mesh);
    this.meshes.set(building.id, mesh);
  }

  private getRoadNeighbors(building: PlacedBuilding, roadPositions: Set<string>): RoadNeighbors {
    const { x, z } = building.position;
    const def = BUILDING_DEFS[building.type];
    const w = def.size.w;
    const d = def.size.d;

    // Build a set of this building's own cells to exclude from neighbor checks
    const ownCells = new Set<string>();
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        ownCells.add(`${x + dx},${z + dz}`);
      }
    }

    // Check along each edge of the building footprint
    let hasNorth = false, hasSouth = false, hasEast = false, hasWest = false;
    for (let dx = 0; dx < w; dx++) {
      if (!ownCells.has(`${x + dx},${z - 1}`) && roadPositions.has(`${x + dx},${z - 1}`)) hasNorth = true;
      if (!ownCells.has(`${x + dx},${z + d}`) && roadPositions.has(`${x + dx},${z + d}`)) hasSouth = true;
    }
    for (let dz = 0; dz < d; dz++) {
      if (!ownCells.has(`${x - 1},${z + dz}`) && roadPositions.has(`${x - 1},${z + dz}`)) hasWest = true;
      if (!ownCells.has(`${x + w},${z + dz}`) && roadPositions.has(`${x + w},${z + dz}`)) hasEast = true;
    }

    return { hasNorth, hasSouth, hasEast, hasWest };
  }

  clear(): void {
    for (const [, mesh] of this.meshes) {
      this.scene.remove(mesh);
      this.disposeMesh(mesh);
    }
    this.meshes.clear();
    this.buildingLevels.clear();
  }

  private disposeMesh(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }
}
