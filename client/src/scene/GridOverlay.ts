import * as THREE from 'three';
import { DEFAULT_GRID_SIZE, CELL_SIZE } from '@cityzen/shared';

export function createGridOverlay(scene: THREE.Scene): THREE.GridHelper {
  const size = DEFAULT_GRID_SIZE * CELL_SIZE;
  const divisions = DEFAULT_GRID_SIZE;

  const gridHelper = new THREE.GridHelper(size, divisions, 0x888888, 0xcccccc);
  gridHelper.position.set(size / 2, 0.01, size / 2); // Slightly above ground to avoid z-fighting
  gridHelper.material.opacity = 0.3;
  gridHelper.material.transparent = true;
  scene.add(gridHelper);
  return gridHelper;
}
