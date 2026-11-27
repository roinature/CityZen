import * as THREE from 'three';
import {
  BUILDING_DEFS, CELL_SIZE, BuildingType, isRoad, isZone, getEffectiveSize, type RoadOrientation,
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

    if (type === BuildingType.PARK) {
      return styleAsGhostPreview(buildParkPreview(style), valid, w, d);
    }

    if (type === BuildingType.PARKING) {
      return styleAsGhostPreview(buildParkingPreview(style), valid, w, d);
    }

    const model = hasServiceModel(type)
      ? buildServiceModelMesh(type, style, orientation)
      : CityBuildings.createServiceModelMesh(type, style, orientation);

    return styleAsGhostPreview(model, valid, w, d);
  }

  createBulldozePreview(type: BuildingType, orientation?: RoadOrientation): THREE.Group {
    const def = BUILDING_DEFS[type];
    const group = new THREE.Group();

    const { w: effW, d: effD } = getEffectiveSize(type, orientation);
    const w = effW * CELL_SIZE;
    const d = effD * CELL_SIZE;
    const flat = isZone(type) || isRoad(type) || type === BuildingType.PARK || type === BuildingType.PARKING;
    const h = flat ? 0.14 : 0.55 + (def.height || 1) * 0.24;

    const geometry = new THREE.BoxGeometry(w * 0.92, h, d * 0.92);
    const material = new THREE.MeshLambertMaterial({
      color: 0xff3b30,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = h / 2 + 0.02;
    mesh.renderOrder = 12;
    group.add(mesh);
    addFootprintFrame(group, w, d, false);

    return group;
  }

  createGhostPreview(
    type: BuildingType,
    orientation?: RoadOrientation,
    style: CityStyle = CITY_STYLES.classic,
    valid = true,
  ): THREE.Group {
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
