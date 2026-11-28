import * as THREE from 'three';
import { BuildingType, type CityEmergencyKind } from '@cityzen/shared';
import { createContactShadow } from './CarManager.js';

/**
 * City service vehicles: what each service building sends out, how many,
 * and what they look like. Models face +x, about half a cell long, like
 * ordinary traffic.
 */

export type ServiceKind = 'police' | 'fire' | 'ambulance' | 'garbage' | 'bus';

export const EMERGENCY_SERVICE_KIND: Record<CityEmergencyKind, ServiceKind> = {
  robbery: 'police',
  fire: 'fire',
  medical: 'ambulance',
  sewage_overflow: 'garbage',
};

export interface ServiceProfile {
  /** Stops per trip before heading back to base. */
  stops: [number, number];
  /** Seconds spent at each stop. */
  dwell: [number, number];
  /** Seconds a returned vehicle rests at base before the next trip. */
  rest: [number, number];
  /** Lights flash on the way out. */
  emergency: boolean;
  /** Speed factor on the way out. */
  speed: number;
}

export const SERVICE_PROFILES: Record<ServiceKind, ServiceProfile> = {
  police: { stops: [1, 3], dwell: [2, 4], rest: [4, 12], emergency: true, speed: 1.15 },
  fire: { stops: [1, 1], dwell: [6, 10], rest: [8, 20], emergency: true, speed: 1.15 },
  ambulance: { stops: [1, 1], dwell: [3, 6], rest: [6, 16], emergency: true, speed: 1.15 },
  garbage: { stops: [3, 5], dwell: [1.2, 2.2], rest: [6, 14], emergency: false, speed: 0.85 },
  bus: { stops: [3, 5], dwell: [1.5, 2.5], rest: [3, 8], emergency: false, speed: 0.95 },
};

/** Which buildings run a fleet, of what, and how many vehicles. */
export const SERVICE_FLEETS: Partial<Record<BuildingType, { kind: ServiceKind; fleet: number }>> = {
  [BuildingType.POLICE_STATION]: { kind: 'police', fleet: 1 },
  [BuildingType.POLICE_HQ]: { kind: 'police', fleet: 2 },
  [BuildingType.FIRE_STATION]: { kind: 'fire', fleet: 1 },
  [BuildingType.FIRE_HQ]: { kind: 'fire', fleet: 2 },
  [BuildingType.HEALTH_CLINIC]: { kind: 'ambulance', fleet: 1 },
  [BuildingType.HEALTH_HOSPITAL]: { kind: 'ambulance', fleet: 2 },
  // No dedicated waste building exists yet; sanitation runs out of the sewage works.
  [BuildingType.WATER_SEWAGE_PLANT]: { kind: 'garbage', fleet: 2 },
  [BuildingType.SEWAGE_PUMP_STATION]: { kind: 'garbage', fleet: 1 },
  [BuildingType.TRANS_BUS_DEPOT]: { kind: 'bus', fleet: 3 },
  [BuildingType.TRANS_TRAIN_STATION]: { kind: 'bus', fleet: 1 },
};

export interface ServiceVehicleMesh {
  group: THREE.Group;
  /** Emissive light-bar materials, toggled while responding. */
  flashers: THREE.MeshStandardMaterial[];
}

const mat = (color: number, metalness = 0.3, roughness = 0.55) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness });

function box(group: THREE.Group, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y + h / 2, z);
  group.add(mesh);
  return mesh;
}

function wheels(group: THREE.Group, xs: number[], halfWidth: number, r = 0.05): void {
  const tyre = mat(0x1a1a1a, 0.1, 0.9);
  const hub = mat(0xbdbdbd, 0.8, 0.3);
  for (const x of xs) {
    for (const side of [1, -1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.04, 12), tyre);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, r, side * halfWidth);
      group.add(wheel);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.01, 8), hub);
      cap.rotation.x = Math.PI / 2;
      cap.position.set(x, r, side * (halfWidth + 0.02));
      group.add(cap);
    }
  }
}

function lights(group: THREE.Group, front: number, back: number, y: number, halfWidth: number): void {
  const head = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffaa, emissiveIntensity: 0.5 });
  const tail = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 0.4 });
  for (const side of [1, -1]) {
    box(group, 0.02, 0.03, 0.05, head, front, y, side * (halfWidth - 0.04));
    box(group, 0.02, 0.03, 0.05, tail, back, y, side * (halfWidth - 0.04));
  }
}

function flasher(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.15, roughness: 0.3 });
}

/** Light bar across the roof: alternating flasher materials. */
function lightBar(group: THREE.Group, x: number, y: number, colors: [number, number], width = 0.16): THREE.MeshStandardMaterial[] {
  const a = flasher(colors[0]);
  const b = flasher(colors[1]);
  box(group, 0.05, 0.012, width + 0.02, mat(0x222222), x, y);
  box(group, 0.045, 0.03, width / 2, a, x, y + 0.012, width / 4);
  box(group, 0.045, 0.03, width / 2, b, x, y + 0.012, -width / 4);
  return [a, b];
}

function windows(group: THREE.Group, glass: THREE.Material, x: number, y: number, len: number, h: number, halfWidth: number): void {
  box(group, len, h, 0.005, glass, x, y, halfWidth + 0.003);
  box(group, len, h, 0.005, glass, x, y, -halfWidth - 0.003);
}

function glassMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.8, roughness: 0.15 });
}

function police(group: THREE.Group): THREE.MeshStandardMaterial[] {
  const white = mat(0xf5f5f5, 0.5, 0.4);
  const navy = mat(0x1a237e, 0.5, 0.4);
  const glass = glassMat();
  box(group, 0.54, 0.07, 0.26, navy, 0, 0.04);
  box(group, 0.54, 0.06, 0.262, white, 0, 0.11);
  box(group, 0.24, 0.1, 0.22, white, -0.03, 0.17);
  box(group, 0.012, 0.075, 0.2, glass, 0.092, 0.18);
  box(group, 0.012, 0.07, 0.2, glass, -0.152, 0.18);
  windows(group, glass, -0.03, 0.185, 0.2, 0.065, 0.11);
  wheels(group, [0.16, -0.16], 0.13);
  lights(group, 0.27, -0.27, 0.09, 0.13);
  return lightBar(group, -0.03, 0.27, [0xff1744, 0x2979ff]);
}

function ambulance(group: THREE.Group): THREE.MeshStandardMaterial[] {
  const white = mat(0xfafafa, 0.3, 0.5);
  const red = mat(0xd50000, 0.3, 0.5);
  const glass = glassMat();
  // Cab
  box(group, 0.16, 0.16, 0.25, white, 0.2, 0.04);
  box(group, 0.012, 0.07, 0.21, glass, 0.282, 0.12);
  windows(group, glass, 0.21, 0.13, 0.1, 0.06, 0.125);
  // Patient box
  box(group, 0.38, 0.26, 0.28, white, -0.07, 0.04);
  box(group, 0.382, 0.035, 0.284, red, -0.07, 0.15);
  box(group, 0.005, 0.1, 0.03, red, -0.262, 0.17);
  box(group, 0.005, 0.03, 0.1, red, -0.262, 0.205);
  wheels(group, [0.17, -0.16], 0.135);
  lights(group, 0.282, -0.262, 0.08, 0.13);
  const front = lightBar(group, 0.11, 0.3, [0xff1744, 0xffffff], 0.22);
  const back = lightBar(group, -0.24, 0.3, [0xffffff, 0xff1744], 0.22);
  return [...front, ...back];
}

function fireTruck(group: THREE.Group): THREE.MeshStandardMaterial[] {
  const red = mat(0xc62828, 0.4, 0.45);
  const chrome = mat(0xcfd8dc, 0.9, 0.25);
  const glass = glassMat();
  // Cab
  box(group, 0.17, 0.19, 0.27, red, 0.21, 0.04);
  box(group, 0.012, 0.08, 0.23, glass, 0.297, 0.14);
  windows(group, glass, 0.22, 0.15, 0.11, 0.07, 0.135);
  box(group, 0.012, 0.04, 0.2, chrome, 0.3, 0.05);
  // Body with lockers
  box(group, 0.44, 0.17, 0.28, red, -0.1, 0.04);
  box(group, 0.4, 0.012, 0.284, chrome, -0.1, 0.12);
  // Ladder
  const ladder = mat(0xe0e0e0, 0.7, 0.3);
  for (const z of [0.05, -0.05]) box(group, 0.5, 0.015, 0.012, ladder, -0.06, 0.225, z);
  for (let x = -0.29; x <= 0.17; x += 0.06) box(group, 0.01, 0.012, 0.1, ladder, x, 0.225);
  wheels(group, [0.2, -0.12, -0.24], 0.14, 0.055);
  lights(group, 0.297, -0.322, 0.08, 0.14);
  return lightBar(group, 0.2, 0.23, [0xff1744, 0xff6d00], 0.22);
}

function garbageTruck(group: THREE.Group): THREE.MeshStandardMaterial[] {
  const cab = mat(0xeeeeee, 0.3, 0.5);
  const green = mat(0x2e7d32, 0.2, 0.6);
  const dark = mat(0x37474f, 0.4, 0.6);
  const glass = glassMat();
  box(group, 0.16, 0.18, 0.26, cab, 0.21, 0.04);
  box(group, 0.012, 0.08, 0.22, glass, 0.292, 0.13);
  windows(group, glass, 0.22, 0.14, 0.1, 0.07, 0.13);
  // Compactor body, tapering hopper at the back
  box(group, 0.38, 0.24, 0.28, green, -0.07, 0.04);
  box(group, 0.08, 0.2, 0.27, dark, -0.29, 0.05);
  box(group, 0.382, 0.02, 0.284, mat(0xfdd835), -0.07, 0.12);
  wheels(group, [0.2, -0.12, -0.22], 0.135, 0.055);
  lights(group, 0.292, -0.332, 0.08, 0.13);
  // Amber work beacon: blinks slowly whenever the truck is out.
  const amber = flasher(0xffab00);
  box(group, 0.04, 0.03, 0.04, amber, 0.2, 0.22);
  return [amber];
}

function bus(group: THREE.Group): THREE.MeshStandardMaterial[] {
  const body = mat(0x1e88e5, 0.4, 0.45);
  const roof = mat(0xeceff1, 0.3, 0.5);
  const glass = glassMat();
  box(group, 0.7, 0.2, 0.27, body, 0, 0.045);
  box(group, 0.68, 0.035, 0.25, roof, 0, 0.245);
  // Window band along both sides and front/back screens
  windows(group, glass, 0.01, 0.15, 0.62, 0.075, 0.135);
  box(group, 0.012, 0.11, 0.23, glass, 0.352, 0.12);
  box(group, 0.012, 0.07, 0.2, glass, -0.352, 0.16);
  // Destination sign
  box(group, 0.008, 0.025, 0.14, new THREE.MeshStandardMaterial({ color: 0xffa000, emissive: 0xff8f00, emissiveIntensity: 0.6 }), 0.356, 0.21);
  wheels(group, [0.22, -0.22], 0.135, 0.05);
  lights(group, 0.352, -0.352, 0.075, 0.135);
  return [];
}

const BUILDERS: Record<ServiceKind, (g: THREE.Group) => THREE.MeshStandardMaterial[]> = {
  police, ambulance, fire: fireTruck, garbage: garbageTruck, bus,
};

export function createServiceVehicleMesh(kind: ServiceKind): ServiceVehicleMesh {
  const group = new THREE.Group();
  const shadow = createContactShadow();
  // Longer vehicles get a longer shadow.
  if (kind === 'bus' || kind === 'fire') shadow.scale.x = 1.3;
  else if (kind !== 'police') shadow.scale.x = 1.12;
  group.add(shadow);
  const flashers = BUILDERS[kind](group);
  group.scale.setScalar(0.9);
  return { group, flashers };
}
