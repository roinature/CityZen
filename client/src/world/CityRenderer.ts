import * as THREE from 'three';
import type { CityState } from '@cityzen/shared';
import { BuildingFactory } from './BuildingFactory.js';

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
        const mesh = this.factory.createBuilding(building);
        this.scene.add(mesh);
        this.meshes.set(building.id, mesh);
      }
    }
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
