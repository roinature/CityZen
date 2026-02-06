import * as THREE from 'three';
import type { CityState, PlacedBuilding } from '@cityzen/shared';
import { BuildingType } from '@cityzen/shared';
import { BuildingFactory, type RoadNeighbors } from './BuildingFactory.js';

export class CityRenderer {
  private scene: THREE.Scene;
  private factory: BuildingFactory;
  private meshes: Map<string, THREE.Group> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.factory = new BuildingFactory();
  }

  syncState(state: CityState): void {
    const currentIds = new Set(this.meshes.keys());
    const newIds = new Set(state.buildings.map((b) => b.id));

    // Build a set of road positions for neighbor detection
    const roadPositions = new Set<string>();
    for (const b of state.buildings) {
      if (b.type === BuildingType.ROAD) {
        roadPositions.add(`${b.position.x},${b.position.z}`);
      }
    }

    // Remove demolished buildings
    for (const id of currentIds) {
      if (!newIds.has(id)) {
        const mesh = this.meshes.get(id)!;
        this.scene.remove(mesh);
        this.disposeMesh(mesh);
        this.meshes.delete(id);
      }
    }

    // Add new buildings
    for (const building of state.buildings) {
      if (!currentIds.has(building.id)) {
        // For roads, calculate neighbors
        let neighbors: RoadNeighbors | undefined;
        if (building.type === BuildingType.ROAD) {
          neighbors = this.getRoadNeighbors(building, roadPositions);
        }

        const mesh = this.factory.createBuilding(building, neighbors);
        this.scene.add(mesh);
        this.meshes.set(building.id, mesh);
      }
    }
  }

  private getRoadNeighbors(building: PlacedBuilding, roadPositions: Set<string>): RoadNeighbors {
    const { x, z } = building.position;
    return {
      hasNorth: roadPositions.has(`${x},${z - 1}`),
      hasSouth: roadPositions.has(`${x},${z + 1}`),
      hasEast: roadPositions.has(`${x + 1},${z}`),
      hasWest: roadPositions.has(`${x - 1},${z}`),
    };
  }

  clear(): void {
    for (const [id, mesh] of this.meshes) {
      this.scene.remove(mesh);
      this.disposeMesh(mesh);
    }
    this.meshes.clear();
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
