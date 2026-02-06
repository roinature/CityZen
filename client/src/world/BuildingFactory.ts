import * as THREE from 'three';
import { type PlacedBuilding, BUILDING_DEFS, CELL_SIZE, BuildingType } from '@cityzen/shared';

export interface RoadNeighbors {
  hasNorth: boolean;
  hasSouth: boolean;
  hasEast: boolean;
  hasWest: boolean;
}

export class BuildingFactory {
  createBuilding(building: PlacedBuilding, neighbors?: RoadNeighbors): THREE.Group {
    const def = BUILDING_DEFS[building.type];
    const group = new THREE.Group();

    const w = def.size.w * CELL_SIZE;
    const d = def.size.d * CELL_SIZE;
    const h = def.height;

    if (building.type === BuildingType.PARK) {
      // Park: green ground plane with small tree
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(w * 0.95, d * 0.95),
        new THREE.MeshLambertMaterial({ color: 0x4caf50 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0.02;
      ground.receiveShadow = true;
      group.add(ground);

      // Simple tree: trunk + sphere canopy
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.08, 0.6, 6),
        new THREE.MeshLambertMaterial({ color: 0x8b4513 }),
      );
      trunk.position.y = 0.3;
      trunk.castShadow = true;
      group.add(trunk);

      const canopy = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 8, 6),
        new THREE.MeshLambertMaterial({ color: 0x228b22 }),
      );
      canopy.position.y = 0.7;
      canopy.castShadow = true;
      group.add(canopy);
    } else if (building.type === BuildingType.ROAD) {
      // Road: dark flat plane
      const road = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshLambertMaterial({ color: def.color }),
      );
      road.rotation.x = -Math.PI / 2;
      road.position.y = 0.02;
      road.receiveShadow = true;
      group.add(road);

      // Add dashed lane separator line (white center line)
      const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const dashLength = CELL_SIZE * 0.2;
      const dashWidth = CELL_SIZE * 0.025;
      const dashSpacing = CELL_SIZE * 0.35;

      // Determine road orientation based on neighbors
      const hasVertical = neighbors?.hasNorth || neighbors?.hasSouth;
      const hasHorizontal = neighbors?.hasEast || neighbors?.hasWest;

      // Draw dashes based on orientation
      if (hasVertical && !hasHorizontal) {
        // Vertical road only - draw horizontal dashes along Z axis
        this.addDashedLine(group, lineMaterial, dashWidth, dashLength, dashSpacing, 'z');
      } else if (hasHorizontal && !hasVertical) {
        // Horizontal road only - draw dashes along X axis
        this.addDashedLine(group, lineMaterial, dashLength, dashWidth, dashSpacing, 'x');
      } else if (hasVertical && hasHorizontal) {
        // Intersection - no center line
      } else {
        // No neighbors or standalone - draw both (will look like a cross for single tiles)
        this.addDashedLine(group, lineMaterial, dashLength, dashWidth, dashSpacing, 'x');
      }
    } else {
      // Standard building: colored box
      const geometry = new THREE.BoxGeometry(w * 0.85, h, d * 0.85);
      const material = new THREE.MeshLambertMaterial({ color: def.color });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = h / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    // Position on grid
    group.position.set(
      building.position.x * CELL_SIZE + w / 2,
      0,
      building.position.z * CELL_SIZE + d / 2,
    );
    group.userData = { buildingId: building.id, buildingType: building.type };

    return group;
  }

  private addDashedLine(
    group: THREE.Group,
    material: THREE.Material,
    width: number,
    length: number,
    spacing: number,
    axis: 'x' | 'z'
  ): void {
    // Create 3 dashes centered on the tile
    const positions = [-spacing, 0, spacing];

    for (const offset of positions) {
      const dash = new THREE.Mesh(
        new THREE.PlaneGeometry(width, length),
        material,
      );
      dash.rotation.x = -Math.PI / 2;

      if (axis === 'x') {
        dash.position.set(offset, 0.025, 0);
      } else {
        dash.position.set(0, 0.025, offset);
      }

      group.add(dash);
    }
  }

  createPreview(type: BuildingType, valid: boolean): THREE.Group {
    const def = BUILDING_DEFS[type];
    const group = new THREE.Group();

    const w = def.size.w * CELL_SIZE;
    const d = def.size.d * CELL_SIZE;
    const h = def.height || 1;

    const geometry = new THREE.BoxGeometry(w * 0.85, h, d * 0.85);
    const material = new THREE.MeshLambertMaterial({
      color: valid ? 0x00ff00 : 0xff0000,
      transparent: true,
      opacity: 0.5,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = h / 2;
    group.add(mesh);

    return group;
  }
}
