import * as THREE from 'three';
import {
  BUILDING_DEFS, CELL_SIZE, BuildingType, isRoad, isUtilityConduit, isZone, getEffectiveSize,
  type RoadOrientation, type WaterfrontFacing,
} from '@cityzen/shared';
import { CityBuildings } from './CityBuildings.js';
import { CITY_STYLES, type CityStyle } from './CityStyle.js';
import { buildServiceModelMesh, hasServiceModel } from './ServiceModels.js';

const VALID_BORDER = 0x4ade80;
const VALID_PAD = 0x22c55e;
const INVALID_BORDER = 0xf87171;
const INVALID_PAD = 0xef4444;

function addFootprintFrame(group: THREE.Group, w: number, d: number, valid: boolean): void {
  const padMat = new THREE.MeshBasicMaterial({
    color: valid ? VALID_PAD : INVALID_PAD,
    transparent: true,
    opacity: valid ? 0.18 : 0.34,
    depthWrite: false,
  });
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.98, d * 0.98).rotateX(-Math.PI / 2), padMat);
  pad.position.y = 0.045;
  pad.renderOrder = 12;
  group.add(pad);

  const borderThickness = 0.055;
  const borderMat = new THREE.MeshBasicMaterial({
    color: valid ? VALID_BORDER : INVALID_BORDER,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  const addBar = (bw: number, bd: number, x: number, z: number) => {
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(bw, bd).rotateX(-Math.PI / 2), borderMat.clone());
    bar.position.set(x, 0.05, z);
    bar.renderOrder = 13;
    group.add(bar);
  };
  const hw = (w * 0.98) / 2;
  const hd = (d * 0.98) / 2;
  addBar(w * 0.98, borderThickness, 0, -hd + borderThickness / 2);
  addBar(w * 0.98, borderThickness, 0, hd - borderThickness / 2);
  addBar(borderThickness, d * 0.98 - borderThickness * 2, -hw + borderThickness / 2, 0);
  addBar(borderThickness, d * 0.98 - borderThickness * 2, hw - borderThickness / 2, 0);
  borderMat.dispose();
}

function buildParkPreview(style: CityStyle): THREE.Group {
  const group = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }));
    mesh.position.set(x, y, z);
    group.add(mesh);
  };
  add(new THREE.BoxGeometry(1, 0.03, 1), style.lawn, 0, 0.015, 0);
  add(new THREE.BoxGeometry(0.88, 0.015, 0.1), style.walk, 0, 0.032, 0);
  add(new THREE.BoxGeometry(0.1, 0.015, 0.88), style.walk, 0, 0.032, 0);
  for (const [tx, tz] of [[-0.26, -0.26], [0.26, -0.24], [-0.24, 0.27], [0.27, 0.25]]) {
    add(new THREE.CylinderGeometry(0.024, 0.034, 0.22, 6), 0x6b4f35, tx, 0.14, tz);
    add(new THREE.IcosahedronGeometry(0.19, 1), style.leaves[0], tx, 0.36, tz);
  }
  group.scale.setScalar(CELL_SIZE);
  return group;
}

function buildParkingPreview(style: CityStyle): THREE.Group {
  const group = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true }));
    mesh.position.set(x, y, z);
    group.add(mesh);
  };
  add(new THREE.BoxGeometry(1, 0.03, 1), style.asphalt, 0, 0.015, 0);
  for (const row of [-0.21, 0.21]) {
    for (let i = 0; i <= 3; i++) {
      add(new THREE.BoxGeometry(0.018, 0.008, 0.26), style.paint, -0.22 + i * 0.147, 0.034, row);
    }
  }
  const cars = [[-0.147, -0.21, 0x2f5f9e], [0.147, -0.21, 0xb8352f], [0, 0.21, 0xd8d8d4]] as const;
  for (const [cx, cz, carColor] of cars) {
    add(new THREE.BoxGeometry(0.1, 0.05, 0.22), carColor, cx, 0.065, cz);
    add(new THREE.BoxGeometry(0.085, 0.045, 0.11), 0x20262c, cx, 0.11, cz);
  }
  group.scale.setScalar(CELL_SIZE);
  return group;
}

function buildRoundaboutPreview(style: CityStyle): THREE.Group {
  const group = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }));
    mesh.position.set(x, y, z);
    group.add(mesh);
  };
  add(new THREE.CylinderGeometry(1.46, 1.46, 0.04, 32), style.asphalt, 0, 0.02, 0);
  add(new THREE.CylinderGeometry(0.68, 0.68, 0.07, 24), style.walk, 0, 0.035, 0);
  add(new THREE.CylinderGeometry(0.58, 0.58, 0.08, 24), style.lawn, 0, 0.04, 0);
  add(new THREE.CylinderGeometry(0.03, 0.045, 0.32, 6), 0x6b4f35, 0, 0.22, 0);
  add(new THREE.IcosahedronGeometry(0.28, 1), style.leaves[0], 0, 0.54, 0);
  group.scale.setScalar(CELL_SIZE);
  return group;
}

export type ConduitDirection = 'N' | 'S' | 'E' | 'W';

export interface ConduitConnections {
  n: boolean;
  s: boolean;
  e: boolean;
  w: boolean;
  flowDir?: ConduitDirection;
}

function defaultConduitConnections(orientation?: RoadOrientation): ConduitConnections {
  return orientation === 'NS'
    ? { n: true, s: true, e: false, w: false }
    : { n: false, s: false, e: true, w: true };
}

function buildConduitPreview(
  type: BuildingType,
  orientation?: RoadOrientation,
  connections?: ConduitConnections,
): THREE.Group {
  const conn = connections && (connections.n || connections.s || connections.e || connections.w)
    ? connections
    : defaultConduitConnections(orientation);

  const group = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.28 }));
    mesh.position.set(x, y, z);
    group.add(mesh);
  };

  const hasEW = conn.e || conn.w;
  const hasNS = conn.n || conn.s;

  if (type === BuildingType.UTILITY_POWER_LINE) {
    // Steel transmission pole + directional crossarm(s) + half-span wires matching build direction
    add(new THREE.CylinderGeometry(0.08, 0.11, 0.05, 10), 0x78909c, 0, 0.025, 0);
    add(new THREE.CylinderGeometry(0.024, 0.04, 1.05, 8), 0x90a4ae, 0, 0.55, 0);

    // Crossarm sits perpendicular to wire direction (both arms if forming a corner/junction)
    if (hasEW || (!hasEW && !hasNS)) {
      add(new THREE.BoxGeometry(0.05, 0.035, 0.52), 0xb0bec5, 0, 1.02, 0);
      for (const s of [-0.16, 0.16]) {
        add(new THREE.CylinderGeometry(0.022, 0.022, 0.08, 8), 0xffd54f, 0, 0.97, s);
      }
    }
    if (hasNS) {
      add(new THREE.BoxGeometry(0.52, 0.035, 0.05), 0xb0bec5, 0, 1.02, 0);
      for (const s of [-0.16, 0.16]) {
        add(new THREE.CylinderGeometry(0.022, 0.022, 0.08, 8), 0xffd54f, s, 0.97, 0);
      }
    }

    // Half-span overhead conductor wires extending to connected cell edges
    const wireY = 0.98;
    for (const s of [-0.14, 0.14]) {
      if (conn.e) add(new THREE.BoxGeometry(0.5, 0.024, 0.024), 0xffeb3b, 0.25, wireY, s);
      if (conn.w) add(new THREE.BoxGeometry(0.5, 0.024, 0.024), 0xffeb3b, -0.25, wireY, s);
      if (conn.s) add(new THREE.BoxGeometry(0.024, 0.024, 0.5), 0xffeb3b, s, wireY, 0.25);
      if (conn.n) add(new THREE.BoxGeometry(0.024, 0.024, 0.5), 0xffeb3b, s, wireY, -0.25);
    }
  } else {
    const pipeColor = type === BuildingType.UTILITY_WATER_PIPE ? 0x29b6f6 : 0x26a69a;
    const collarColor = type === BuildingType.UTILITY_WATER_PIPE ? 0x0288d1 : 0x00796b;
    const arrowColor = type === BuildingType.UTILITY_WATER_PIPE ? 0xb3e5fc : 0xa7ffeb;
    const y = 0.14;
    const r = 0.11;

    // Rounded central weld joint + vertical inspection hub so elbows & tees join cleanly
    add(new THREE.SphereGeometry(r * 1.18, 14, 10), collarColor, 0, y, 0);
    add(new THREE.CylinderGeometry(r * 1.28, r * 1.28, 0.11, 14), collarColor, 0, y + 0.02, 0);

    const addArm = (dir: ConduitDirection) => {
      const ns = dir === 'N' || dir === 'S';
      const sign = dir === 'S' || dir === 'E' ? 1 : -1;
      const armGeo = ns
        ? new THREE.CylinderGeometry(r, r, 0.5, 14).rotateX(Math.PI / 2)
        : new THREE.CylinderGeometry(r, r, 0.5, 14).rotateZ(Math.PI / 2);
      add(armGeo, pipeColor, ns ? 0 : sign * 0.25, y, ns ? sign * 0.25 : 0);

      const flangeGeo = ns
        ? new THREE.CylinderGeometry(r * 1.24, r * 1.24, 0.045, 12).rotateX(Math.PI / 2)
        : new THREE.CylinderGeometry(r * 1.24, r * 1.24, 0.045, 12).rotateZ(Math.PI / 2);
      add(flangeGeo, collarColor, ns ? 0 : sign * 0.43, y, ns ? sign * 0.43 : 0);
    };

    if (conn.n) addArm('N');
    if (conn.s) addArm('S');
    if (conn.e) addArm('E');
    if (conn.w) addArm('W');

    // Directional chevron cone on top of the pipe pointing along the active build direction
    if (conn.flowDir) {
      const d = conn.flowDir;
      const cone = new THREE.ConeGeometry(0.085, 0.18, 10);
      if (d === 'E') cone.rotateZ(-Math.PI / 2);
      else if (d === 'W') cone.rotateZ(Math.PI / 2);
      else if (d === 'S') cone.rotateX(Math.PI / 2);
      else cone.rotateX(-Math.PI / 2);
      const offset = 0.2;
      add(
        cone,
        arrowColor,
        d === 'E' ? offset : d === 'W' ? -offset : 0,
        y + r * 1.22,
        d === 'S' ? offset : d === 'N' ? -offset : 0,
      );
    }
  }
  group.scale.setScalar(CELL_SIZE);
  return group;
}

/**
 * Turns a real 3D building group into a non-shadow-casting ghost preview:
 * a depth pre-pass prevents internal geometry from bleeding through translucent
 * walls, while keeping authentic materials (or red tint when placement is blocked).
 */
function styleAsGhostPreview(model: THREE.Group, valid: boolean, w: number, d: number): THREE.Group {
  const meshes: THREE.Mesh[] = [];
  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = false;
      child.receiveShadow = false;
      meshes.push(child);
    }
  });

  const invalidTint = new THREE.Color(0xff5252);
  for (const mesh of meshes) {
    const parent = mesh.parent;
    if (parent) {
      const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
      let prepass: THREE.Mesh;
      if (mesh instanceof THREE.InstancedMesh) {
        const inst = new THREE.InstancedMesh(mesh.geometry, depthMat, mesh.count);
        inst.instanceMatrix.copy(mesh.instanceMatrix);
        prepass = inst;
      } else {
        prepass = new THREE.Mesh(mesh.geometry, depthMat);
      }
      prepass.position.copy(mesh.position);
      prepass.rotation.copy(mesh.rotation);
      prepass.scale.copy(mesh.scale);
      prepass.castShadow = false;
      prepass.receiveShadow = false;
      prepass.renderOrder = 10;
      parent.add(prepass);
    }

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      mat.transparent = true;
      mat.opacity = valid ? 0.86 : 0.72;
      mat.depthWrite = false;
      mat.depthFunc = THREE.LessEqualDepth;
      if (mat instanceof THREE.MeshStandardMaterial) {
        if (valid) {
          mat.emissive.setHex(0x1b5e20);
          mat.emissiveIntensity = 0.08;
        } else {
          mat.color.lerp(invalidTint, 0.65);
          mat.emissive.setHex(0xb71c1c);
          mat.emissiveIntensity = 0.45;
        }
      }
    }
    mesh.renderOrder = 11;
  }

  const wrapper = new THREE.Group();
  wrapper.add(model);
  addFootprintFrame(wrapper, w, d, valid);
  return wrapper;
}

export class BuildingFactory {
  // Catalogue icons for infrastructure buildings
  public static readonly INFRASTRUCTURE_TEXTURES: Partial<Record<BuildingType, string>> = {
    [BuildingType.ENERGY_WIND_TURBINE]: 'wind_turbine_facade.png',
    [BuildingType.ENERGY_SOLAR_FARM]: 'solar_farm_facade.png',
    [BuildingType.ENERGY_COAL_PLANT]: 'coal_plant_facade.png',
    [BuildingType.ENERGY_NUCLEAR_PLANT]: 'nuclear_plant_facade.png',
    [BuildingType.POLICE_STATION]: 'police_station_facade.png',
    [BuildingType.POLICE_HQ]: 'police_hq_facade.png',
    [BuildingType.POLICE_JAIL]: 'police_jail_facade.png',
    [BuildingType.POLICE_ACADEMY]: 'police_academy_facade.png',
    [BuildingType.HEALTH_CLINIC]: 'clinic_facade.png',
    [BuildingType.HEALTH_HOSPITAL]: 'hospital_facade.png',
    [BuildingType.HEALTH_RESEARCH_CENTER]: 'research_center_facade.png',
    [BuildingType.FIRE_STATION]: 'fire_station_facade.png',
    [BuildingType.FIRE_HQ]: 'fire_hq_facade.png',
    [BuildingType.FIRE_HELICOPTER]: 'fire_helicopter_facade.png',
    [BuildingType.FIRE_TRAINING]: 'fire_training_facade.png',
    [BuildingType.WATER_TOWER]: 'water_tower_facade.png',
    [BuildingType.WATER_PUMP_STATION]: 'water_pump_facade.png',
    [BuildingType.WATER_TREATMENT]: 'water_treatment_facade.png',
    [BuildingType.WATER_SEWAGE_PLANT]: 'sewage_plant_facade.png',
    [BuildingType.EDU_ELEMENTARY]: 'elementary_facade.png',
    [BuildingType.EDU_HIGH_SCHOOL]: 'high_school_facade.png',
    [BuildingType.EDU_UNIVERSITY]: 'university_facade.png',
    [BuildingType.EDU_LIBRARY]: 'library_facade.png',
    [BuildingType.GOV_CITY_HALL]: 'city_hall_facade.png',
    [BuildingType.GOV_COURTHOUSE]: 'courthouse_facade.png',
    [BuildingType.GOV_PARLIAMENT]: 'parliament_facade.png',
    [BuildingType.GOV_MONUMENT]: 'monument_facade.png',
    [BuildingType.TOUR_LANDMARK]: 'landmark_facade.png',
    [BuildingType.TOUR_MUSEUM]: 'museum_facade.png',
    [BuildingType.TOUR_STADIUM]: 'stadium_facade.png',
    [BuildingType.TOUR_AMUSEMENT]: 'amusement_park_facade.png',
    [BuildingType.TRANS_BUS_DEPOT]: 'bus_depot_facade.png',
    [BuildingType.TRANS_TRAIN_STATION]: 'train_station_facade.png',
    [BuildingType.TRANS_AIRPORT]: 'airport_facade.png',
    [BuildingType.TRANS_HARBOR]: 'harbor_facade.png',
    [BuildingType.HEALTH_CEMETERY]: 'cemetery_facade.png',
    [BuildingType.ART_GALLERY]: 'art_gallery_facade.png',
    [BuildingType.ART_THEATER]: 'theater_facade.png',
    [BuildingType.ART_CONCERT_HALL]: 'concert_hall_facade.png',
    [BuildingType.ART_SCULPTURE_PARK]: 'sculpture_park_facade.png',
    [BuildingType.WATERFRONT_DOCK]: 'dock_facade.png',
    [BuildingType.WATERFRONT_MARINA]: 'marina_facade.png',
    [BuildingType.WATERFRONT_FERRY]: 'ferry_terminal_facade.png',
    [BuildingType.WATERFRONT_PORT]: 'cargo_port_facade.png',
  };

  /**
   * Returns a path to an image file representing the building icon/preview.
   */
  public static getBuildingIcon(type: BuildingType): string | null {
    const base = import.meta.env.BASE_URL;

    if (this.INFRASTRUCTURE_TEXTURES[type]) {
      return `${base}textures/buildings/${this.INFRASTRUCTURE_TEXTURES[type]}`;
    }

    if (type === BuildingType.ZONE_RESIDENTIAL) return `${base}textures/buildings/residential_facade.png`;
    if (type === BuildingType.ZONE_COMMERCIAL) return `${base}textures/buildings/commercial_facade.png`;
    if (type === BuildingType.ZONE_INDUSTRIAL) return `${base}textures/buildings/industrial_facade.png`;

    return null;
  }

  createPreview(
    type: BuildingType,
    valid: boolean,
    style: CityStyle = CITY_STYLES.classic,
    orientation?: RoadOrientation,
    facing?: WaterfrontFacing,
    conduitConnections?: ConduitConnections,
  ): THREE.Group {
    const def = BUILDING_DEFS[type];
    const { w: effW, d: effD } = getEffectiveSize(type, orientation);
    const w = effW * CELL_SIZE;
    const d = effD * CELL_SIZE;

    if (isZone(type)) {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.9, 0.08, d * 0.9),
        new THREE.MeshLambertMaterial({
          color: valid ? new THREE.Color(def.color).getHex() : INVALID_PAD,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
        }),
      );
      mesh.position.y = 0.05;
      group.add(mesh);
      addFootprintFrame(group, w, d, valid);
      return group;
    }

    if (type === BuildingType.ROAD_ROUNDABOUT) {
      return styleAsGhostPreview(buildRoundaboutPreview(style), valid, w, d);
    }

    if (isRoad(type)) {
      const group = new THREE.Group();
      const dirt = type === BuildingType.ROAD_DIRT;
      const roadColor = valid ? (dirt ? style.dirt : style.asphalt) : INVALID_PAD;
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.96, 0.04, d * 0.96),
        new THREE.MeshLambertMaterial({ color: roadColor, transparent: true, opacity: 0.72, depthWrite: false }),
      );
      slab.position.y = 0.03;
      slab.renderOrder = 11;
      group.add(slab);
      addFootprintFrame(group, w, d, valid);
      return group;
    }

    if (isUtilityConduit(type)) {
      return styleAsGhostPreview(buildConduitPreview(type, orientation, conduitConnections), valid, w, d);
    }

    if (type === BuildingType.PARK) {
      return styleAsGhostPreview(buildParkPreview(style), valid, w, d);
    }

    if (type === BuildingType.PARKING) {
      return styleAsGhostPreview(buildParkingPreview(style), valid, w, d);
    }

    const model = hasServiceModel(type)
      ? buildServiceModelMesh(type, style, orientation, facing)
      : CityBuildings.createServiceModelMesh(type, style, orientation);

    return styleAsGhostPreview(model, valid, w, d);
  }

  createBulldozePreview(type: BuildingType, orientation?: RoadOrientation): THREE.Group {
    const def = BUILDING_DEFS[type];
    const group = new THREE.Group();

    const { w: effW, d: effD } = getEffectiveSize(type, orientation);
    const w = effW * CELL_SIZE;
    const d = effD * CELL_SIZE;
    const flat = isZone(type) || isRoad(type) || isUtilityConduit(type)
      || type === BuildingType.PARK || type === BuildingType.PARKING;
    const h = flat ? 0.18 : 0.55 + (def.height || 1) * 0.24;

    const geometry = new THREE.BoxGeometry(w * 0.92, h, d * 0.92);
    const material = new THREE.MeshLambertMaterial({
      color: 0xff3b30,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = h / 2 + 0.02;
    mesh.renderOrder = 22;
    group.add(mesh);
    addFootprintFrame(group, w, d, false);

    return group;
  }

  createGhostPreview(
    type: BuildingType,
    orientation?: RoadOrientation,
    style: CityStyle = CITY_STYLES.classic,
    valid = true,
    conduitConnections?: ConduitConnections,
  ): THREE.Group {
    if (isUtilityConduit(type)) {
      const { w: effW, d: effD } = getEffectiveSize(type, orientation);
      return styleAsGhostPreview(
        buildConduitPreview(type, orientation, conduitConnections),
        valid,
        effW * CELL_SIZE,
        effD * CELL_SIZE,
      );
    }

    const group = new THREE.Group();

    const { w: effW, d: effD } = getEffectiveSize(type, orientation);
    const w = effW * CELL_SIZE;
    const d = effD * CELL_SIZE;
    const dirt = type === BuildingType.ROAD_DIRT;

    const geometry = new THREE.BoxGeometry(w * 0.96, 0.05, d * 0.96);
    const material = new THREE.MeshLambertMaterial({
      color: valid ? (dirt ? style.dirt : style.asphalt) : INVALID_PAD,
      transparent: true,
      opacity: valid ? 0.65 : 0.5,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.035;
    mesh.renderOrder = 11;
    group.add(mesh);

    return group;
  }
}
