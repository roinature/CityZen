import { getSite } from '@cityzen/shared';
import { drawSiteMap } from './SiteMap.js';
import * as THREE from 'three';
import { BUILDING_DEFS, BuildingType, DEFAULT_GRID_SIZE, CELL_SIZE, getStarterEntranceX } from '@cityzen/shared';

// Cluster positions are relative to the plot. Gaps keep the boundary readable.
const TREE_GROVES = [
  { x: 0.29, z: 1.10, count: 11 },
  { x: 0.47, z: 1.13, count: 9 },
  { x: 0.68, z: 1.08, count: 12 },
  { x: 0.86, z: 1.16, count: 8 },
  { x: 1.08, z: 0.74, count: 10 },
  { x: 1.11, z: 0.33, count: 9 },
  { x: 0.75, z: -0.09, count: 10 },
  { x: 0.25, z: -0.12, count: 10 },
  { x: -0.09, z: 0.28, count: 10 },
  { x: -0.12, z: 0.72, count: 9 },
];

const LEAF_COLORS = [0x689351, 0x4f824b, 0x86a95b, 0x728f53];
const PINE_COLORS = [0x3c714e, 0x538459, 0x5d8c5a];

interface CountrysideTree {
  x: number;
  z: number;
  pine: boolean;
  angle: number;
  scale: number;
  color: number;
}

function addTreeGroves(scene: THREE.Scene, size: number, entranceX: number): void {
  const trees: CountrysideTree[] = [];
  let seed = 14771;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  for (const grove of TREE_GROVES) {
    for (let i = 0; i < grove.count; i++) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * CELL_SIZE;
      const x = grove.x * size + Math.cos(angle) * radius * 6;
      const z = grove.z * size + Math.sin(angle) * radius * 5;
      // Keep trunks and overhanging crowns clear of the grid and the road.
      if (x > -2 && x < size + 2 && z > -2 && z < size + 2) continue;
      if (z >= size && Math.abs(x - entranceX) < 2.4) continue;
      if (trees.some(tree => Math.hypot(tree.x - x, tree.z - z) < 1.25)) continue;
      const pine = random() < 0.37;
      const palette = pine ? PINE_COLORS : LEAF_COLORS;
      trees.push({
        x,
        z,
        pine,
        angle,
        scale: (0.75 + random() * 0.65) * CELL_SIZE,
        color: palette[Math.floor(random() * palette.length)],
      });
    }
  }

  const pineCount = trees.filter(tree => tree.pine).length;
  const canopyMaterial = new THREE.MeshLambertMaterial({ flatShading: true });
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.085, 0.135, 1.15, 6),
    new THREE.MeshLambertMaterial({ color: 0x795a40 }),
    trees.length,
  );
  const broadleaves = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1), canopyMaterial, trees.length - pineCount);
  const pines = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), canopyMaterial, pineCount * 2);
  let leafIndex = 0;
  let pineIndex = 0;
  const transform = new THREE.Object3D();
  const color = new THREE.Color();

  trees.forEach((tree, index) => {
    const { x, z, scale } = tree;
    transform.position.set(x, scale * 0.54, z);
    transform.rotation.y = tree.angle;
    transform.scale.setScalar(scale);
    transform.updateMatrix();
    trunks.setMatrixAt(index, transform.matrix);

    color.setHex(tree.color);
    if (tree.pine) {
      for (const [height, width, depth] of [[1.48, 0.77, 1.62], [2.17, 0.58, 1.48]]) {
        transform.position.y = height * scale;
        transform.scale.set(width * scale, depth * scale, width * scale);
        transform.updateMatrix();
        pines.setMatrixAt(pineIndex, transform.matrix);
        pines.setColorAt(pineIndex, color);
        pineIndex++;
      }
    } else {
      transform.position.y = 1.58 * scale;
      transform.scale.set(0.91 * scale, 0.94 * scale, 0.82 * scale);
      transform.updateMatrix();
      broadleaves.setMatrixAt(leafIndex, transform.matrix);
      broadleaves.setColorAt(leafIndex, color);
      leafIndex++;
    }
  });

  const groves = new THREE.Group();
  groves.name = 'countryside-trees';
  for (const mesh of [trunks, broadleaves, pines]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    groves.add(mesh);
  }
  scene.add(groves);
}

function createEntranceRoad(entranceX: number, startZ: number, endZ: number): THREE.Group {
  const exterior = new THREE.Group();
  exterior.name = 'countryside-entrance-road';
  exterior.visible = false;

  const length = endZ - startZ;
  const shoulder = new THREE.PlaneGeometry(CELL_SIZE * 1.44, length);
  shoulder.rotateX(-Math.PI / 2);
  const verge = new THREE.Mesh(shoulder, new THREE.MeshLambertMaterial({ color: 0x82765d }));
  verge.position.set(entranceX, -0.018, startZ + length / 2);
  verge.receiveShadow = true;
  exterior.add(verge);

  const surface = new THREE.PlaneGeometry(CELL_SIZE, length);
  surface.rotateX(-Math.PI / 2);
  const road = new THREE.Mesh(surface, new THREE.MeshLambertMaterial({ color: BUILDING_DEFS[BuildingType.ROAD_STREET].color }));
  road.position.set(entranceX, 0.02, startZ + length / 2);
  road.receiveShadow = true;
  exterior.add(road);

  const mark = new THREE.PlaneGeometry(CELL_SIZE * 0.025, CELL_SIZE * 0.2);
  mark.rotateX(-Math.PI / 2);
  const segments = Math.floor(length / CELL_SIZE);
  const markings = new THREE.InstancedMesh(mark, new THREE.MeshBasicMaterial({ color: 0xe8e7df }), segments * 3);
  const offset = new THREE.Matrix4();
  let index = 0;
  for (let tile = 0; tile < segments; tile++) {
    for (const dash of [0.15, 0.5, 0.85]) {
      markings.setMatrixAt(index++, offset.makeTranslation(entranceX, 0.025, startZ + (tile + dash) * CELL_SIZE));
    }
  }
  exterior.add(markings);

  return exterior;
}

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

export function createTerrain(scene: THREE.Scene) {
  const size = DEFAULT_GRID_SIZE * CELL_SIZE;

  // Playable plot
  const grass = createGrassTexture('#8cac6d', ['#7f9e60', '#98b77a', '#85a467', '#a0bc82']);
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
  const outerGrass = createGrassTexture('#78965d', ['#6d8a53', '#829f66', '#748f58']);
  outerGrass.repeat.set(outerSize / 8, outerSize / 8);
  const outerGeometry = new THREE.PlaneGeometry(outerSize, outerSize);
  outerGeometry.rotateX(-Math.PI / 2);
  const outer = new THREE.Mesh(outerGeometry, new THREE.MeshLambertMaterial({ map: outerGrass }));
  outer.position.set(size / 2, -0.03, size / 2);
  outer.receiveShadow = true;
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
    new THREE.LineBasicMaterial({ color: 0xe3ebd4, transparent: true, opacity: 0.23 }),
  );
  border.name = 'terrain-border';
  scene.add(border);

  const entranceX = (getStarterEntranceX(DEFAULT_GRID_SIZE) + 0.5) * CELL_SIZE;
  addTreeGroves(scene, size, entranceX);
  const entranceRoad = createEntranceRoad(entranceX, size, (size + outerSize) / 2);
  scene.add(entranceRoad);

  let activeSite: string | undefined;
  let siteTexture: THREE.CanvasTexture | undefined;
  function setSite(siteId?: string) {
    if (activeSite === siteId) return;
    activeSite = siteId;
    siteTexture?.dispose();
    const site = getSite(siteId);
    siteTexture = site ? new THREE.CanvasTexture(drawSiteMap(site.id).canvas) : undefined;
    if (siteTexture) {
      siteTexture.magFilter = THREE.NearestFilter;
      siteTexture.colorSpace = THREE.SRGBColorSpace;
    }
    mesh.material.map = siteTexture ?? grass;
    mesh.material.needsUpdate = true;
  }
  return { entranceRoad, setSite };
}
