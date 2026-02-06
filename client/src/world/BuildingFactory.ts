import * as THREE from 'three';
import { type PlacedBuilding, BUILDING_DEFS, CELL_SIZE, BuildingType } from '@cityzen/shared';

export class BuildingFactory {
  createBuilding(building: PlacedBuilding): THREE.Group {
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
