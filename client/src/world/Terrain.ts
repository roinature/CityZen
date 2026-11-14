import * as THREE from 'three';
import { DEFAULT_GRID_SIZE, CELL_SIZE } from '@cityzen/shared';

/** Tileable speckled grass so the ground isn't a single flat colour. */
function createGrassTexture(base: string, speckles: string[]): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Deterministic pseudo-random so the ground looks the same every session
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = speckles[Math.floor(rand() * speckles.length)];
    ctx.globalAlpha = 0.25 + rand() * 0.35;
    const r = 1 + rand() * 3;
    ctx.fillRect(rand() * size, rand() * size, r, r);
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createTerrain(scene: THREE.Scene): THREE.Mesh {
  const size = DEFAULT_GRID_SIZE * CELL_SIZE;

  // Playable plot
  const grass = createGrassTexture('#7ec850', ['#6fb944', '#8fd562', '#74c04a', '#9bdc6e']);
  grass.repeat.set(size / 8, size / 8);
  const geometry = new THREE.PlaneGeometry(size, size);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: grass }));
  mesh.position.set(size / 2, 0, size / 2);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);

  // Surrounding countryside, so the city doesn't float in an empty void
  const outerSize = size * 7;
  const outerGrass = createGrassTexture('#6aae45', ['#5f9f3d', '#74b84d', '#639f42']);
  outerGrass.repeat.set(outerSize / 8, outerSize / 8);
  const outerGeometry = new THREE.PlaneGeometry(outerSize, outerSize);
  outerGeometry.rotateX(-Math.PI / 2);
  const outer = new THREE.Mesh(outerGeometry, new THREE.MeshLambertMaterial({ map: outerGrass }));
  outer.position.set(size / 2, -0.03, size / 2);
  outer.name = 'terrain-outskirts';
  scene.add(outer);

  // Plot boundary
  const border = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.02, 0),
      new THREE.Vector3(size, 0.02, 0),
      new THREE.Vector3(size, 0.02, size),
      new THREE.Vector3(0, 0.02, size),
    ]),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
  );
  border.name = 'terrain-border';
  scene.add(border);

  return mesh;
}
