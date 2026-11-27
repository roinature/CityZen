import * as THREE from 'three';
import {
  BUILDING_DEFS, BuildingType, CELL_SIZE, getEffectiveSize, type PlacedBuilding, type RoadOrientation,
} from '@cityzen/shared';
import type { CityStyle } from './CityStyle.js';

type Build = (kit: Kit, w: number, d: number) => void;

/** Small helper for putting together a model out of plain shapes. */
class Kit {
  readonly group = new THREE.Group();
  readonly style: CityStyle;
  readonly accent: number;

  constructor(style: CityStyle, accent: number) {
    this.style = style;
    this.accent = accent;
  }

  add(geometry: THREE.BufferGeometry, color: number, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true }));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z);
  }

  cylinder(top: number, bottom: number, h: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
    return this.add(new THREE.CylinderGeometry(top, bottom, h, 20), color, x, y + h / 2, z);
  }

  tree(x: number, z: number, scale = 1): void {
    this.cylinder(0.025, 0.035, 0.2 * scale, 0x6b4f35, x, 0.03, z);
    this.add(new THREE.IcosahedronGeometry(0.2 * scale, 1), this.style.leaves[0], x, 0.36 * scale, z);
  }
}

const WHITE = 0xe9eaea;
const METAL = 0x8d949b;

const plant: Build = (kit, w, d) => {
  kit.box(w * 0.5, 0.75, d * 0.42, kit.style.industry[0], -w * 0.18, 0.04, d * 0.2);
  kit.box(w * 0.52, 0.06, d * 0.44, kit.style.flatRoof, -w * 0.18, 0.79, d * 0.2);
  for (const x of [-0.28, -0.1, 0.08]) {
    kit.cylinder(0.11, 0.15, 2.4, 0xc7bdb2, x * w, 0.04, -d * 0.2);
    kit.cylinder(0.12, 0.12, 0.2, 0xb0483c, x * w, 2.1, -d * 0.2);
  }
  kit.cylinder(0.3, 0.3, 0.5, METAL, w * 0.3, 0.04, d * 0.22);
  kit.box(w * 0.2, 0.3, d * 0.2, 0x2c2c2e, w * 0.3, 0.04, -d * 0.2);
};

const makeBasins = (waterColor: number): Build => (kit, w, d) => {
  const r = Math.min(w, d) * 0.19;
  for (const x of [-0.24, 0.24]) {
    for (const z of [-0.24, 0.24]) {
      if (x > 0 && z > 0) continue;
      kit.cylinder(r, r, 0.16, kit.style.concrete, x * w, 0.03, z * d);
      kit.cylinder(r * 0.86, r * 0.86, 0.02, waterColor, x * w, 0.18, z * d);
      kit.box(r * 1.7, 0.03, 0.05, METAL, x * w, 0.2, z * d);
    }
  }
  kit.box(w * 0.34, 0.5, d * 0.34, kit.style.apartments[0], w * 0.24, 0.03, d * 0.24);
  kit.box(w * 0.36, 0.06, d * 0.36, kit.accent, w * 0.24, 0.53, d * 0.24);
};

const gardens: Build = (kit, w, d) => {
  kit.box(w * 0.86, 0.02, d * 0.1, kit.style.walk, 0, 0.04, 0);
  kit.box(w * 0.1, 0.02, d * 0.86, kit.style.walk, 0, 0.04, 0);
  for (const x of [-0.36, 0.36]) for (const z of [-0.36, 0.36]) kit.tree(x * w, z * d);
};

/** Services with a shape of their own. The rest are ordinary buildings with a coloured roof. */
const MODELS: Partial<Record<BuildingType, Build>> = {
  [BuildingType.ENERGY_WIND_TURBINE]: (kit) => {
    kit.cylinder(0.2, 0.24, 0.05, kit.style.concrete, 0, 0.02);
    kit.cylinder(0.025, 0.06, 2.6, WHITE, 0, 0.04);
    kit.box(0.1, 0.1, 0.26, WHITE, 0, 2.6, 0.04);
    const rotor = new THREE.Group();
    rotor.name = 'rotor';
    rotor.position.set(0, 2.65, 0.2);
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 1.15, 0.018).translate(0, 0.575, 0),
        new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.7 }),
      );
      // No shadow: a spinning caster would force the shadow map to redraw every frame.
      blade.rotation.z = (i * Math.PI * 2) / 3;
      rotor.add(blade);
    }
    kit.group.add(rotor);
  },
  [BuildingType.ENERGY_SOLAR_FARM]: (kit, w, d) => {
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 4; i++) {
        const panel = kit.add(new THREE.BoxGeometry(w * 0.2, 0.02, d * 0.17), 0x22426e, (i - 1.5) * w * 0.22, 0.14, (row - 1.5) * d * 0.23);
        panel.rotation.x = 0.5;
        kit.box(0.03, 0.12, 0.03, METAL, (i - 1.5) * w * 0.22, 0.02, (row - 1.5) * d * 0.23);
      }
    }
  },
  [BuildingType.ENERGY_COAL_PLANT]: plant,
  [BuildingType.ENERGY_NUCLEAR_PLANT]: (kit, w, d) => {
    const profile = [[0.62, 0], [0.5, 0.6], [0.42, 1.2], [0.43, 1.6], [0.48, 1.9]].map(([r, y]) => new THREE.Vector2(r, y));
    for (const x of [-0.24, 0.24]) {
      kit.add(new THREE.LatheGeometry(profile, 28), 0xd3d2cc, x * w, 0.04, -d * 0.22).material = new THREE.MeshStandardMaterial({
        color: 0xd3d2cc, roughness: 0.9, side: THREE.DoubleSide,
      });
    }
    kit.box(w * 0.5, 0.7, d * 0.24, kit.style.industry[0], -w * 0.1, 0.04, d * 0.24);
    kit.cylinder(0.4, 0.4, 0.6, WHITE, w * 0.3, 0.04, d * 0.24);
    kit.add(new THREE.SphereGeometry(0.4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), WHITE, w * 0.3, 0.64, d * 0.24);
  },
  [BuildingType.WATER_TOWER]: (kit) => {
    for (const x of [-0.17, 0.17]) for (const z of [-0.17, 0.17]) kit.cylinder(0.02, 0.025, 1.1, METAL, x, 0.02, z);
    kit.cylinder(0.035, 0.035, 1.1, METAL, 0, 0.02);
    kit.cylinder(0.3, 0.24, 0.42, 0xdfe6ea, 0, 1.08);
    kit.cylinder(0.302, 0.302, 0.07, 0x5f9ec4, 0, 1.36);
    kit.add(new THREE.ConeGeometry(0.33, 0.18, 20), 0x9fb4c0, 0, 1.6, 0);
  },
  [BuildingType.WATER_PUMP_STATION]: (kit, w, d) => {
    kit.box(w * 0.42, 0.58, d * 0.56, kit.style.apartments[0], -w * 0.2, 0.03, 0);
    kit.box(w * 0.45, 0.06, d * 0.59, kit.accent, -w * 0.2, 0.61, 0);
    for (const z of [-0.22, 0.22]) {
      kit.box(w * 0.34, 0.08, d * 0.18, kit.style.concrete, w * 0.22, 0.03, z * d);
      kit.add(new THREE.CapsuleGeometry(0.14, w * 0.24, 6, 14).rotateZ(Math.PI / 2), kit.accent, w * 0.22, 0.23, z * d);
      kit.box(w * 0.22, 0.05, 0.05, METAL, 0.02, 0.2, z * d);
    }
  },
  [BuildingType.WATER_TREATMENT]: makeBasins(0x4f8fa8),
  [BuildingType.WATER_SEWAGE_PLANT]: makeBasins(0x6b6a45),
  [BuildingType.FIRE_HELICOPTER]: (kit, w, d) => {
    // Raised helipad deck with yellow circle/corner markings and white 'H'
    kit.box(w * 0.56, 0.08, d * 0.56, kit.style.asphalt, -w * 0.14, 0.03, -d * 0.08);
    kit.add(new THREE.RingGeometry(0.34, 0.39, 28).rotateX(-Math.PI / 2), 0xfbc02d, -w * 0.14, 0.115, -d * 0.08);
    for (const x of [-0.11, 0.11]) kit.box(0.05, 0.01, 0.32, WHITE, -w * 0.14 + x, 0.115, -d * 0.08);
    kit.box(0.22, 0.01, 0.05, WHITE, -w * 0.14, 0.115, -d * 0.08);
    // Rescue helicopter on pad
    kit.add(new THREE.CapsuleGeometry(0.08, 0.18, 4, 10).rotateX(Math.PI / 2), 0xd84315, -w * 0.14, 0.23, -d * 0.1);
    kit.box(0.04, 0.04, 0.28, WHITE, -w * 0.14, 0.24, -d * 0.1 + 0.2);
    for (const s of [-0.07, 0.07]) kit.box(0.02, 0.02, 0.24, METAL, -w * 0.14 + s, 0.13, -d * 0.1);
    const rotor = new THREE.Group();
    rotor.name = 'rotor';
    rotor.position.set(-w * 0.14, 0.34, -d * 0.1);
    for (let i = 0; i < 2; i++) {
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.56, 0.01, 0.035),
        new THREE.MeshStandardMaterial({ color: 0x33383e, roughness: 0.7 }),
      );
      blade.rotation.y = (i * Math.PI) / 2;
      rotor.add(blade);
    }
    kit.group.add(rotor);
    // Dispatch & hangar bay
    kit.box(w * 0.26, 0.44, d * 0.68, kit.style.apartments[0], w * 0.28, 0.03, 0);
    kit.box(w * 0.28, 0.05, d * 0.7, kit.accent, w * 0.28, 0.47, 0);
  },
  [BuildingType.TOUR_LANDMARK]: (kit, w, d) => {
    gardens(kit, w, d);
    kit.cylinder(0.36, 0.46, 0.22, kit.style.concrete, 0, 0.03);
    kit.cylinder(0.1, 0.2, 2.0, WHITE, 0, 0.25);
    kit.cylinder(0.42, 0.28, 0.16, kit.accent, 0, 2.15);
    kit.cylinder(0.44, 0.44, 0.12, 0x263238, 0, 2.31);
    kit.cylinder(0.26, 0.4, 0.12, WHITE, 0, 2.43);
    kit.cylinder(0.015, 0.04, 0.65, METAL, 0, 2.55);
  },
  [BuildingType.TOUR_STADIUM]: (kit, w, d) => {
    const rx = w * 0.46, rz = d * 0.46;
    const ring = kit.add(new THREE.CylinderGeometry(1, 0.9, 0.8, 40, 1, true), 0xd9dcde, 0, 0.44, 0);
    ring.scale.set(rx, 1, rz);
    const bowl = kit.add(new THREE.CylinderGeometry(1, 0.62, 0.74, 40, 1, true), kit.accent, 0, 0.43, 0);
    bowl.scale.set(rx * 0.97, 1, rz * 0.97);
    for (const mesh of [ring, bowl]) (mesh.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    kit.box(w * 0.5, 0.02, d * 0.42, 0x6fa653, 0, 0.06, 0);
    for (const x of [-1, 1]) for (const z of [-1, 1]) kit.cylinder(0.025, 0.035, 1.3, METAL, x * rx * 0.72, 0.04, z * rz * 0.72);
  },
  [BuildingType.TOUR_AMUSEMENT]: (kit, w, d) => {
    gardens(kit, w, d);
    const wheel = kit.add(new THREE.TorusGeometry(Math.min(w, d) * 0.3, 0.03, 6, 32), kit.accent, 0, Math.min(w, d) * 0.36, 0);
    for (let i = 0; i < 4; i++) {
      const spoke = kit.add(new THREE.BoxGeometry(Math.min(w, d) * 0.6, 0.015, 0.015), WHITE, 0, wheel.position.y, 0);
      spoke.rotation.z = (i * Math.PI) / 4;
    }
    for (const x of [-0.14, 0.14]) kit.box(0.04, wheel.position.y, 0.04, METAL, x * w, 0.02, 0.06);
    kit.add(new THREE.ConeGeometry(0.4, 0.5, 8), 0xd9534f, -w * 0.28, 0.55, d * 0.26);
    kit.cylinder(0.32, 0.32, 0.3, 0xf2e3c6, -w * 0.28, 0.03, d * 0.26);
  },
  [BuildingType.GOV_MONUMENT]: (kit, w, d) => {
    gardens(kit, w, d);
    kit.box(0.5, 0.14, 0.5, kit.style.concrete, 0, 0.04);
    kit.add(new THREE.CylinderGeometry(0.06, 0.13, 1.7, 4), 0xe6e0d2, 0, 1.02, 0);
    kit.add(new THREE.ConeGeometry(0.09, 0.16, 4), 0xd8b45a, 0, 1.95, 0);
  },
  [BuildingType.HEALTH_CEMETERY]: (kit, w, d) => {
    gardens(kit, w, d);
    for (let i = 0; i < 24; i++) {
      const x = ((i % 6) - 2.5) * w * 0.14, z = (Math.floor(i / 6) - 1.5) * d * 0.2;
      if (Math.abs(x) > w * 0.06 && Math.abs(z) > d * 0.06) kit.box(0.06, 0.1, 0.025, 0xb9bab6, x, 0.03, z);
    }
  },
  [BuildingType.ART_SCULPTURE_PARK]: (kit, w, d) => {
    gardens(kit, w, d);
    kit.add(new THREE.TorusKnotGeometry(0.18, 0.05, 40, 6), kit.accent, 0, 0.42, 0);
    kit.box(0.14, 0.3, 0.14, 0xd9a43a, -w * 0.2, 0.04, d * 0.2).rotation.y = 0.6;
    kit.add(new THREE.SphereGeometry(0.12, 12, 8), 0xc6cdd2, w * 0.2, 0.16, d * 0.2);
  },
  [BuildingType.TRANS_BUS_DEPOT]: (kit, w, d) => {
    kit.box(w * 0.88, 0.02, d * 0.88, kit.style.asphalt, 0, 0.03, 0);
    // Dispatch office
    kit.box(w * 0.82, 0.42, d * 0.24, kit.style.apartments[0], 0, 0.04, -d * 0.28);
    kit.box(w * 0.84, 0.05, d * 0.26, kit.accent, 0, 0.46, -d * 0.28);
    // Shelter canopy + columns + parked buses
    kit.box(w * 0.82, 0.04, d * 0.44, WHITE, 0, 0.36, d * 0.14);
    for (const x of [-0.36, 0, 0.36]) kit.cylinder(0.025, 0.025, 0.33, METAL, x * w, 0.04, d * 0.14);
    for (const x of [-0.24, 0.04, 0.28]) {
      kit.box(0.16, 0.15, 0.46, kit.accent, x * w, 0.05, d * 0.16);
      kit.box(0.165, 0.05, 0.42, 0x263238, x * w, 0.14, d * 0.16);
    }
  },
  [BuildingType.TRANS_TRAIN_STATION]: (kit, w, d) => {
    // Trackbed, twin rails, island platform canopy & passenger train
    kit.box(w * 0.96, 0.025, d * 0.38, 0x6e6a63, 0, 0.03, -d * 0.26);
    for (const z of [-0.36, -0.31, -0.21, -0.16]) kit.box(w * 0.96, 0.015, 0.018, METAL, 0, 0.055, z * d);
    kit.box(w * 0.9, 0.06, d * 0.16, kit.style.walk, 0, 0.03, -d * 0.02);
    kit.box(w * 0.86, 0.04, d * 0.2, kit.accent, 0, 0.38, -d * 0.02);
    for (const x of [-0.34, 0, 0.34]) kit.cylinder(0.022, 0.022, 0.32, METAL, x * w, 0.08, -d * 0.02);
    for (const x of [-0.27, 0, 0.27]) {
      kit.box(w * 0.24, 0.15, 0.16, WHITE, x * w, 0.07, -d * 0.26);
      kit.box(w * 0.242, 0.04, 0.165, kit.accent, x * w, 0.13, -d * 0.26);
    }
    // Concourse station hall & clock tower
    kit.box(w * 0.72, 0.56, d * 0.32, kit.style.downtown[0], 0, 0.03, d * 0.24);
    kit.box(w * 0.74, 0.06, d * 0.34, kit.accent, 0, 0.59, d * 0.24);
    kit.box(0.28, 0.42, 0.28, kit.style.downtown[0], 0, 0.65, d * 0.24);
    kit.add(new THREE.ConeGeometry(0.22, 0.2, 4).rotateY(Math.PI / 4), kit.accent, 0, 1.17, d * 0.24);
  },
  [BuildingType.TRANS_AIRPORT]: (kit, w, d) => {
    kit.box(w * 0.92, 0.02, d * 0.2, kit.style.asphalt, 0, 0.04, -d * 0.28);
    for (let i = 0; i < 9; i++) kit.box(w * 0.05, 0.005, 0.03, WHITE, (i - 4) * w * 0.1, 0.06, -d * 0.28);
    kit.box(w * 0.6, 0.42, d * 0.18, 0xc9d6dd, -w * 0.08, 0.04, d * 0.24);
    kit.box(w * 0.62, 0.05, d * 0.2, kit.accent, -w * 0.08, 0.46, d * 0.24);
    kit.cylinder(0.09, 0.12, 1.1, 0xdcdcd8, w * 0.34, 0.04, d * 0.24);
    kit.cylinder(0.24, 0.17, 0.2, 0x39566b, w * 0.34, 1.12, d * 0.24);
    for (const x of [-0.24, 0.06]) {
      kit.add(new THREE.CapsuleGeometry(0.07, 0.5, 4, 8).rotateX(Math.PI / 2), WHITE, x * w, 0.15, -d * 0.02);
      kit.box(0.6, 0.02, 0.14, WHITE, x * w, 0.13, -d * 0.02);
      kit.box(0.02, 0.16, 0.1, kit.accent, x * w, 0.18, -d * 0.02 + 0.26);
    }
  },
  [BuildingType.TRANS_HARBOR]: (kit, w, d) => {
    // Water slip basin along quay edge + cargo ship hull
    kit.box(w * 0.94, 0.02, d * 0.32, 0x2f6f8f, 0, 0.035, -d * 0.3);
    kit.box(w * 0.56, 0.16, d * 0.18, 0x37474f, -w * 0.12, 0.04, -d * 0.3);
    kit.box(w * 0.12, 0.22, d * 0.15, WHITE, w * 0.08, 0.2, -d * 0.3);
    // Port gantry cranes
    for (const x of [-0.26, 0.04]) {
      for (const s of [-0.07, 0.07]) kit.box(0.04, 0.85, 0.04, 0xd84315, (x + s) * w, 0.04, -d * 0.08);
      kit.box(0.22 * w, 0.05, 0.75, 0xd84315, x * w, 0.86, -d * 0.16);
    }
    // Container stacks & logistics warehouse
    const containers = [0xc62828, 0x1565c0, 0x2e7d32, 0xef6c00];
    for (let i = 0; i < 6; i++) {
      const cx = (-0.34 + (i % 3) * 0.18) * w;
      const cz = (0.14 + Math.floor(i / 3) * 0.18) * d;
      kit.box(0.42, 0.14, 0.2, containers[i % containers.length], cx, 0.04, cz);
      if (i % 2 === 0) kit.box(0.42, 0.14, 0.2, containers[(i + 1) % containers.length], cx, 0.18, cz);
    }
    kit.box(w * 0.32, 0.48, d * 0.5, kit.style.industry[0], w * 0.3, 0.04, d * 0.18);
    kit.box(w * 0.34, 0.05, d * 0.52, kit.accent, w * 0.3, 0.52, d * 0.18);
  },
};

export function hasServiceModel(type: BuildingType): boolean {
  return type in MODELS;
}

const GREEN = new Set<BuildingType>([
  BuildingType.GOV_MONUMENT, BuildingType.HEALTH_CEMETERY, BuildingType.ART_SCULPTURE_PARK,
  BuildingType.TOUR_AMUSEMENT, BuildingType.TOUR_LANDMARK, BuildingType.ENERGY_SOLAR_FARM,
  BuildingType.ENERGY_WIND_TURBINE, BuildingType.TRANS_AIRPORT,
]);

/** Builds a service model centered at (0, 0, 0) in world units. */
export function buildServiceModelMesh(type: BuildingType, style: CityStyle, orientation?: RoadOrientation): THREE.Group {
  const { w, d } = getEffectiveSize(type, orientation);
  const kit = new Kit(style, new THREE.Color(BUILDING_DEFS[type].color).getHex());
  kit.box(w, 0.03, d, GREEN.has(type) ? style.lawn : style.concrete);
  MODELS[type]?.(kit, w, d);
  kit.group.scale.setScalar(CELL_SIZE);
  return kit.group;
}

export function createServiceModel(building: PlacedBuilding, style: CityStyle): THREE.Group {
  const { w, d } = getEffectiveSize(building.type, building.orientation);
  const group = buildServiceModelMesh(building.type, style, building.orientation);
  group.position.set((building.position.x + w / 2) * CELL_SIZE, 0, (building.position.z + d / 2) * CELL_SIZE);
  return group;
}
