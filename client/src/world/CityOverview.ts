import * as THREE from 'three';
import { BUILDING_DEFS, BuildingType, CELL_SIZE, getEffectiveSize, getZoneLevelDef, isRoad, isZone, type PlacedBuilding } from '@cityzen/shared';

interface Instance {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: THREE.ColorRepresentation;
}

function createInstances(geometry: THREE.BufferGeometry, instances: Instance[], opacity = 1): THREE.InstancedMesh | null {
  if (!instances.length) {
    geometry.dispose();
    return null;
  }

  const material = new THREE.MeshLambertMaterial({
    transparent: opacity !== 1,
    opacity,
    depthWrite: opacity === 1,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
  const transform = new THREE.Matrix4();
  const color = new THREE.Color();
  instances.forEach(({ x, y, z, w, h, d, color: tint }, index) => {
    transform.makeScale(w, h, d).setPosition(x, y, z);
    mesh.setMatrixAt(index, transform);
    mesh.setColorAt(index, color.set(tint));
  });
  mesh.receiveShadow = true;
  return mesh;
}

/** Render the plot at map scale without allocating a detailed model for each tile. */
export function createCityOverview(buildings: PlacedBuilding[], zonesHighlighted: boolean): THREE.Group {
  const ground: Instance[] = [];
  const zones: Instance[] = [];
  const structures: Instance[] = [];
  const trees: Instance[] = [];

  for (const building of buildings) {
    const { type, position } = building;
    const def = BUILDING_DEFS[type];
    const size = getEffectiveSize(type, building.orientation);
    const w = size.w * CELL_SIZE;
    const d = size.d * CELL_SIZE;
    const x = (position.x + size.w / 2) * CELL_SIZE;
    const z = (position.z + size.d / 2) * CELL_SIZE;
    if (isRoad(type)) {
      ground.push({ x, y: 0.02, z, w, h: 1, d, color: def.color });
    } else if (type === BuildingType.PARK) {
      ground.push({ x, y: 0.02, z, w: w * 0.95, h: 1, d: d * 0.95, color: def.color });
      trees.push({ x, y: 0.48, z, w: 0.64, h: 0.95, d: 0.64, color: 0x2c6632 });
    } else if (isZone(type)) {
      const level = building.developmentLevel ?? 0;
      zones.push({ x, y: 0.015, z, w: w * 0.98, h: 1, d: d * 0.98, color: def.color });
      if (level > 0) {
        const defLevel = getZoneLevelDef(type, building.density, level);
        const heightScale = building.density === 'high' ? 0.83 : 0.7;
        const h = defLevel.height * heightScale;
        const color = new THREE.Color(def.color).lerp(new THREE.Color(0xd4cec0), 0.67);
        structures.push({ x, y: h / 2, z, w: w * 0.72, h, d: d * 0.72, color });
      }
    } else {
      const h = def.height ?? 1;
      structures.push({ x, y: h / 2, z, w: w * 0.85, h, d: d * 0.85, color: def.color });
    }
  }

  const overview = new THREE.Group();
  const pads = createInstances(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), ground);
  const lots = createInstances(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), zones, zonesHighlighted ? 0.68 : 0.25);
  const boxes = createInstances(new THREE.BoxGeometry(1, 1, 1), structures);
  const canopies = createInstances(new THREE.ConeGeometry(0.5, 1, 6), trees);

  if (pads) overview.add(pads);
  if (lots) {
    lots.name = 'overview-zone-lots';
    overview.add(lots);
  }
  if (boxes) {
    boxes.castShadow = true;
    overview.add(boxes);
  }
  if (canopies) overview.add(canopies);
  return overview;
}
