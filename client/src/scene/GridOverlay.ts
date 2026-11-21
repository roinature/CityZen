import * as THREE from 'three';
import { DEFAULT_GRID_SIZE, CELL_SIZE } from '@cityzen/shared';

const IDLE_OPACITY = 0.06;
const EDIT_OPACITY = 0.24;

export function createGridOverlay(scene: THREE.Scene): THREE.GridHelper {
  const size = DEFAULT_GRID_SIZE * CELL_SIZE;
  const divisions = DEFAULT_GRID_SIZE;

  const gridHelper = new THREE.GridHelper(size, divisions, 0xe3ebd4, 0xe3ebd4);
  gridHelper.position.set(size / 2, 0.01, size / 2); // Slightly above ground to avoid z-fighting
  gridHelper.material.opacity = IDLE_OPACITY;
  gridHelper.material.transparent = true;
  gridHelper.material.depthWrite = false;
  scene.add(gridHelper);
  return gridHelper;
}

export function setGridEditing(grid: THREE.GridHelper, editing: boolean): void {
  grid.material.opacity = editing ? EDIT_OPACITY : IDLE_OPACITY;
}
