import * as THREE from 'three';
import { CELL_SIZE, DEFAULT_GRID_SIZE, clamp, type Position } from '@cityzen/shared';

export class GridRaycaster {
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(private canvas: HTMLCanvasElement) {}

  getGridPosition(screenX: number, screenY: number, camera: THREE.Camera, clampToGrid = false): Position | null {
    const bounds = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((screenX - bounds.left) / bounds.width) * 2 - 1,
      -((screenY - bounds.top) / bounds.height) * 2 + 1,
    );

    this.raycaster.setFromCamera(ndc, camera);
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
