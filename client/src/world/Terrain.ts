import * as THREE from 'three';
import { DEFAULT_GRID_SIZE, CELL_SIZE } from '@cityzen/shared';

export function createTerrain(scene: THREE.Scene): THREE.Mesh {
  const size = DEFAULT_GRID_SIZE * CELL_SIZE;
  const geometry = new THREE.PlaneGeometry(size, size);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshLambertMaterial({ color: 0x7ec850 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(size / 2, 0, size / 2);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  scene.add(mesh);
  return mesh;
}
