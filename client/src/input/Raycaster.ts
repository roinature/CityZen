import * as THREE from 'three';
import { CELL_SIZE, DEFAULT_GRID_SIZE, type Position } from '@cityzen/shared';

export class GridRaycaster {
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  getGridPosition(screenX: number, screenY: number, camera: THREE.Camera): Position | null {
    const ndc = new THREE.Vector2(
      (screenX / window.innerWidth) * 2 - 1,
      -(screenY / window.innerHeight) * 2 + 1,
    );

    this.raycaster.setFromCamera(ndc, camera);
    const intersection = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, intersection);

    if (!hit) return null;

    const x = Math.floor(intersection.x / CELL_SIZE);
    const z = Math.floor(intersection.z / CELL_SIZE);

    if (x < 0 || x >= DEFAULT_GRID_SIZE || z < 0 || z >= DEFAULT_GRID_SIZE) {
      return null;
    }

    return { x, z };
  }
}
