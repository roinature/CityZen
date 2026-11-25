import * as THREE from 'three';
import { BuildingType, CELL_SIZE } from '@cityzen/shared';

interface Paving {
  x: number;
  z: number;
  width: number;
  depth: number;
}

interface StreetTree {
  x: number;
  z: number;
  variant: number;
}

const SIDEWALK_WIDTH = 0.31 * CELL_SIZE;
const PAVING_HEIGHT = 0.05 * CELL_SIZE;
const PAVING_BASE = 0.018;
const TREE_EDGE_INSET = 0.025 * CELL_SIZE;
const LEAF_COLORS = [0x78a456, 0x91b366, 0x5f9259];

type Side = 'north' | 'east' | 'south' | 'west';

const SIDES = [
  { side: 'north', dx: 0, dz: -1 },
  { side: 'east', dx: 1, dz: 0 },
  { side: 'south', dx: 0, dz: 1 },
  { side: 'west', dx: -1, dz: 0 },
] as const;

function isPaved(type: BuildingType | undefined): boolean {
  return type === BuildingType.ROAD_STREET || type === BuildingType.ROAD_AVENUE || type === BuildingType.ROAD_ROUNDABOUT;
}

export function createStreetscape(roads: ReadonlyMap<string, BuildingType>, gridSize: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'streetscape';

  const paving: Paving[] = [];
  const trees: StreetTree[] = [];
  const hasRoad = (x: number, z: number) => roads.has(`${x},${z}`);
  const isFrontage = (x: number, z: number) => x >= 0 && z >= 0 && x < gridSize && z < gridSize && !hasRoad(x, z);
  const inset = (CELL_SIZE - SIDEWALK_WIDTH) / 2;
  const midLength = CELL_SIZE - 2 * SIDEWALK_WIDTH;

  // Collect the lot-facing edges of paved roads. Paving goes on the lot side
  // of the boundary to leave the existing car lanes clear.
  const frontages = new Map<string, Set<Side>>();
  for (const [tile, type] of roads) {
    if (!isPaved(type)) continue;

    const [x, z] = tile.split(',').map(Number);
    const connectedSides = SIDES.filter(({ dx, dz }) => hasRoad(x + dx, z + dz));
    // Single-cell road ends are rounded and don't have a straight frontage.
    if (type === BuildingType.ROAD_STREET && connectedSides.length < 2) continue;

    for (const { side, dx, dz } of SIDES) {
      const nx = x - dx;
      const nz = z - dz;
      if (!isFrontage(nx, nz)) continue;

      const key = `${nx},${nz}`;
      let sides = frontages.get(key);
      if (!sides) {
        sides = new Set();
        frontages.set(key, sides);
      }
      sides.add(side);
    }
  }

  for (const [tile, sides] of frontages) {
    const [x, z] = tile.split(',').map(Number);
    const cx = (x + 0.5) * CELL_SIZE;
    const cz = (z + 0.5) * CELL_SIZE;
    for (const { side, dx, dz } of SIDES) {
      if (!sides.has(side)) continue;
      paving.push({
        x: cx + dx * inset, z: cz + dz * inset,
        width: dx === 0 ? midLength : SIDEWALK_WIDTH,
        depth: dz === 0 ? midLength : SIDEWALK_WIDTH,
      });

      // Stagger the two sides and keep the first tile next to an intersection
      // or a bend clear by planting only where the frontage continues.
      const offset = dx === 0 ? x : z;
      const alongX = dz !== 0 ? 1 : 0;
      const alongZ = dx !== 0 ? 1 : 0;
      if ((offset + (dx + dz > 0 ? 1 : 0)) % 3 === 0
          && frontages.get(`${x - alongX},${z - alongZ}`)?.has(side)
          && frontages.get(`${x + alongX},${z + alongZ}`)?.has(side)) {
        const treeOffset = CELL_SIZE / 2 - TREE_EDGE_INSET;
        trees.push({
          x: cx + dx * treeOffset,
          z: cz + dz * treeOffset,
          variant: (x * 5 + z * 7 + (dx + dz > 0 ? 1 : 0)) % LEAF_COLORS.length,
        });
      }
    }

    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        if (sides.has(dx < 0 ? 'west' : 'east') || sides.has(dz < 0 ? 'north' : 'south')) {
          paving.push({ x: cx + dx * inset, z: cz + dz * inset, width: SIDEWALK_WIDTH, depth: SIDEWALK_WIDTH });
        }
      }
    }
  }

  const transform = new THREE.Object3D();

  function batch(geometry: THREE.BufferGeometry, color: number, count: number): THREE.InstancedMesh {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  if (paving.length > 0) {
    const slabs = batch(new THREE.BoxGeometry(1, PAVING_HEIGHT, 1), 0xd5c8af, paving.length);
    paving.forEach(({ x, z, width, depth }, index) => {
      transform.position.set(x, PAVING_BASE + PAVING_HEIGHT / 2, z);
      transform.scale.set(width, 1, depth);
      transform.updateMatrix();
      slabs.setMatrixAt(index, transform.matrix);
    });
  }

  if (trees.length > 0) {
    const wells = batch(new THREE.BoxGeometry(0.16 * CELL_SIZE, 0.01 * CELL_SIZE, 0.16 * CELL_SIZE), 0x655841, trees.length);
    const trunks = batch(new THREE.CylinderGeometry(0.03 * CELL_SIZE, 0.045 * CELL_SIZE, 0.43 * CELL_SIZE, 5), 0x77583f, trees.length);
    const crowns = batch(new THREE.DodecahedronGeometry(0.29 * CELL_SIZE), 0xffffff, trees.length);
    const color = new THREE.Color();
    trunks.castShadow = true;
    crowns.castShadow = true;

    trees.forEach(({ x, z, variant }, index) => {
      transform.rotation.y = 0;
      transform.scale.setScalar(1);
      transform.position.set(x, PAVING_BASE + PAVING_HEIGHT + 0.004 * CELL_SIZE, z);
      transform.updateMatrix();
      wells.setMatrixAt(index, transform.matrix);

      transform.position.y = PAVING_BASE + PAVING_HEIGHT + 0.22 * CELL_SIZE;
      transform.updateMatrix();
      trunks.setMatrixAt(index, transform.matrix);

      transform.position.y = PAVING_BASE + PAVING_HEIGHT + 0.58 * CELL_SIZE;
      transform.scale.y = 1.15 + variant * 0.16;
      transform.rotation.y = variant * 0.7;
      transform.updateMatrix();
      crowns.setMatrixAt(index, transform.matrix);
      crowns.setColorAt(index, color.setHex(LEAF_COLORS[variant]));
    });
  }

  return group;
}
