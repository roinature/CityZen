import * as THREE from 'three';
import {
  BUILDING_DEFS, BuildingType, CELL_SIZE, getEffectiveSize, getWaterfrontFacing, isWaterfront,
  type Grid, type PlacedBuilding, type RoadOrientation, type WaterfrontFacing,
} from '@cityzen/shared';
import type { CityStyle } from './CityStyle.js';
import type { RoadMap } from './RoadSurface.js';
import {
  addGarageBayToGroup,
  drivewayFacingToYaw,
  findDepotDriveway,
  isFleetBuilding,
  type DrivewayFacing,
} from './DepotDriveway.js';

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
  [BuildingType.ENERGY_SUBSTATION]: (kit, w, d) => {
    // Fenced gravel yard, twin step-down transformers, ceramic HV bushings & gantry frame
    kit.box(w * 0.88, 0.03, d * 0.88, 0x7b8085, 0, 0.03, 0);
    for (const sx of [-0.2, 0.18]) {
      kit.box(0.24, 0.34, 0.28, 0x455a64, sx * w, 0.05, -0.08 * d);
      kit.box(0.28, 0.24, 0.04, 0x607d8b, sx * w, 0.09, -0.24 * d);
      for (const bz of [-0.16, -0.02]) {
        kit.cylinder(0.022, 0.028, 0.22, 0xcfd8dc, sx * w, 0.39, bz * d);
        kit.cylinder(0.03, 0.03, 0.025, 0xffb300, sx * w, 0.59, bz * d);
      }
    }
    // Overhead busbar portal gantry
    for (const gx of [-0.34, 0.34]) kit.cylinder(0.02, 0.026, 0.92, METAL, gx * w, 0.04, -0.08 * d);
    kit.box(w * 0.76, 0.035, 0.04, METAL, 0, 0.94, -0.08 * d);
    // Control switchgear kiosk
    kit.box(w * 0.54, 0.28, d * 0.24, WHITE, 0, 0.05, 0.26 * d);
    kit.box(w * 0.58, 0.04, d * 0.27, kit.accent, 0, 0.33, 0.26 * d);
  },
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
  [BuildingType.SEWAGE_PUMP_STATION]: (kit, w, d) => {
    // Circular clarifier tank & lift pump house behind a sanitation truck garage bay + driveway (+z)
    kit.cylinder(w * 0.2, w * 0.21, 0.22, kit.style.concrete, -w * 0.27, 0.03, -d * 0.25);
    kit.cylinder(w * 0.17, w * 0.17, 0.02, 0x5d6b4d, -w * 0.27, 0.24, -d * 0.25);
    kit.box(w * 0.34, 0.03, 0.04, METAL, -w * 0.27, 0.26, -d * 0.25);
    kit.box(w * 0.36, 0.48, d * 0.34, kit.style.industry[0], w * 0.26, 0.03, -d * 0.26);
    kit.box(w * 0.38, 0.05, d * 0.36, kit.accent, w * 0.26, 0.51, -d * 0.26);
    kit.add(new THREE.CapsuleGeometry(0.09, w * 0.16, 6, 12).rotateZ(Math.PI / 2), 0x26a69a, -w * 0.34, 0.14, d * 0.14);
    addGarageBayToGroup(kit.group, {
      axisDepth: d,
      wallColor: kit.style.industry[0],
      accentColor: kit.accent,
      style: kit.style,
      bayHeight: 0.56,
      bayWidth: 0.74,
      hazardStripe: true,
    });
  },
  [BuildingType.WATER_SEWAGE_PLANT]: (kit, w, d) => {
    // Three circular treatment basins around a central sanitation truck garage bay + driveway (+z)
    const r = Math.min(w, d) * 0.175;
    for (const [bx, bz] of [[-0.28, -0.27], [0.28, -0.27], [-0.32, 0.18]] as const) {
      kit.cylinder(r, r, 0.16, kit.style.concrete, bx * w, 0.03, bz * d);
      kit.cylinder(r * 0.86, r * 0.86, 0.02, 0x6b6a45, bx * w, 0.18, bz * d);
      kit.box(r * 1.7, 0.03, 0.05, METAL, bx * w, 0.2, bz * d);
    }
    // Operations hall on the right flank behind the bay
    kit.box(w * 0.28, 0.54, d * 0.38, kit.style.apartments[0], w * 0.32, 0.03, d * 0.14);
    kit.box(w * 0.3, 0.06, d * 0.4, kit.accent, w * 0.32, 0.57, d * 0.14);
    addGarageBayToGroup(kit.group, {
      axisDepth: d,
      wallColor: kit.style.industry[0],
      accentColor: kit.accent,
      style: kit.style,
      bayHeight: 0.60,
      bayWidth: 0.82,
      hazardStripe: true,
    });
  },
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
    kit.box(w * 0.92, 0.016, d * 0.92, kit.style.asphalt, 0, 0.024, 0);
    // Dispatch office along the rear
    kit.box(w * 0.88, 0.48, d * 0.2, kit.style.apartments[0], 0, 0.03, -d * 0.38);
    kit.box(w * 0.9, 0.05, d * 0.22, kit.accent, 0, 0.51, -d * 0.38);
    // Side boarding shelters + parked buses flanking the central bus driveway bay
    for (const side of [-1, 1]) {
      const sx = side * w * 0.35;
      kit.box(w * 0.24, 0.04, d * 0.52, WHITE, sx, 0.36, d * 0.08);
      for (const z of [-0.12, 0.28]) kit.cylinder(0.022, 0.022, 0.33, METAL, sx + side * 0.06, 0.03, z * d);
      kit.box(0.16, 0.15, 0.44, kit.accent, sx, 0.04, d * 0.1);
      kit.box(0.165, 0.05, 0.4, 0x263238, sx, 0.13, d * 0.1);
    }
    // Central recessed bus bay & driveway opening onto +z
    addGarageBayToGroup(kit.group, {
      axisDepth: d,
      wallColor: kit.style.apartments[0],
      accentColor: kit.accent,
      style: kit.style,
      bayHeight: 0.56,
      bayWidth: 0.74,
      hazardStripe: false,
    });
  },
  [BuildingType.TRANS_TRAIN_STATION]: (kit, w, d) => {
    // Trackbed, twin rails, island platform canopy & passenger train along -z
    kit.box(w * 0.96, 0.025, d * 0.34, 0x6e6a63, 0, 0.03, -d * 0.3);
    for (const z of [-0.38, -0.33, -0.25, -0.20]) kit.box(w * 0.96, 0.015, 0.018, METAL, 0, 0.055, z * d);
    kit.box(w * 0.9, 0.06, d * 0.12, kit.style.walk, 0, 0.03, -d * 0.08);
    kit.box(w * 0.86, 0.04, d * 0.16, kit.accent, 0, 0.38, -d * 0.08);
    for (const x of [-0.34, 0, 0.34]) kit.cylinder(0.022, 0.022, 0.32, METAL, x * w, 0.08, -d * 0.08);
    for (const x of [-0.27, 0, 0.27]) {
      kit.box(w * 0.24, 0.15, 0.16, WHITE, x * w, 0.07, -d * 0.3);
      kit.box(w * 0.242, 0.04, 0.165, kit.accent, x * w, 0.13, -d * 0.3);
    }
    // Concourse station wings flanking the shuttle bus bay (+z) & clock tower
    for (const side of [-1, 1]) {
      kit.box(w * 0.28, 0.56, d * 0.38, kit.style.downtown[0], side * w * 0.3, 0.03, d * 0.22);
      kit.box(w * 0.3, 0.06, d * 0.4, kit.accent, side * w * 0.3, 0.59, d * 0.22);
    }
    kit.box(0.28, 0.42, 0.28, kit.style.downtown[0], -w * 0.3, 0.65, d * 0.22);
    kit.add(new THREE.ConeGeometry(0.22, 0.2, 4).rotateY(Math.PI / 4), kit.accent, -w * 0.3, 1.17, d * 0.22);
    // Shuttle bus bay & driveway opening onto +z
    addGarageBayToGroup(kit.group, {
      axisDepth: d,
      wallColor: kit.style.downtown[0],
      accentColor: kit.accent,
      style: kit.style,
      bayHeight: 0.58,
      bayWidth: 0.78,
      hazardStripe: false,
    });
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
  [BuildingType.WATERFRONT_DOCK]: (kit, w, d) => {
    const timber = 0x7c583b;
    const deck = 0x99704d;
    const piling = 0x543b27;
    // Shorefront timber apron (+z) and two finger piers reaching into water (-z)
    kit.box(w * 0.94, 0.06, d * 0.46, deck, 0, 0.01, d * 0.26);
    for (const px of [-0.28, 0.24]) {
      kit.box(w * 0.24, 0.05, d * 0.56, deck, px * w, 0.02, -d * 0.2);
      for (const pz of [-0.44, -0.22, 0]) {
        for (const side of [-0.09, 0.09]) {
          kit.cylinder(0.025, 0.028, 0.14, piling, (px + side) * w, -0.04, pz * d);
        }
      }
    }
    // Mooring bollards & dock lantern
    for (const bx of [-0.36, -0.2, 0.16, 0.32]) {
      kit.cylinder(0.022, 0.028, 0.07, 0x2c3034, bx * w, 0.07, -d * 0.44);
    }
    kit.cylinder(0.018, 0.022, 0.28, METAL, -w * 0.28, 0.07, -d * 0.42);
    kit.add(new THREE.SphereGeometry(0.04, 10, 8), 0xffe082, -w * 0.28, 0.36, -d * 0.42);
    // Cozy clapboard dockhouse with pitched gable roof on shore side
    kit.box(w * 0.44, 0.38, d * 0.34, timber, -w * 0.2, 0.07, d * 0.25);
    kit.add(new THREE.ConeGeometry(0.38, 0.22, 4).rotateY(Math.PI / 4), 0x5d4037, -w * 0.2, 0.56, d * 0.25);
    // Stacked fish crates & supply barrels
    kit.box(0.16, 0.1, 0.14, 0xc59b6d, w * 0.22, 0.07, d * 0.2);
    kit.box(0.14, 0.09, 0.13, 0xb88b5a, w * 0.23, 0.17, d * 0.2);
    kit.cylinder(0.05, 0.05, 0.12, 0x1976d2, w * 0.36, 0.07, d * 0.28);
    kit.cylinder(0.05, 0.05, 0.12, 0xc62828, w * 0.34, 0.07, d * 0.14);
  },
  [BuildingType.WATERFRONT_MARINA]: (kit, w, d) => {
    const pontoon = 0xdadfe3;
    // Shorefront promenade (+z) with trees and yacht club pavilion
    kit.box(w * 0.96, 0.05, d * 0.42, kit.style.walk, 0, 0.01, d * 0.28);
    kit.box(w * 0.42, 0.38, d * 0.28, WHITE, 0, 0.06, d * 0.28);
    kit.box(w * 0.46, 0.05, d * 0.32, kit.accent, 0, 0.44, d * 0.28);
    kit.cylinder(0.018, 0.022, 0.38, METAL, w * 0.16, 0.49, d * 0.28);
    kit.tree(-w * 0.38, d * 0.3, 0.85);
    kit.tree(w * 0.38, d * 0.3, 0.85);
    // Floating main spine & three finger slips reaching toward open water (-z)
    kit.box(w * 0.88, 0.035, d * 0.1, pontoon, 0, 0.025, d * 0.03);
    for (const fx of [-0.4, 0, 0.4]) {
      kit.box(w * 0.07, 0.035, d * 0.52, pontoon, fx * w, 0.025, -d * 0.23);
      kit.cylinder(0.02, 0.02, 0.14, METAL, fx * w, -0.03, -d * 0.45);
    }
    // One resident sloop moored in the west slip (leaving east/outer berths open for visiting boats)
    kit.box(0.2, 0.08, 0.52, WHITE, -w * 0.2, 0.03, -d * 0.24);
    kit.box(0.205, 0.025, 0.48, kit.accent, -w * 0.2, 0.07, -d * 0.24);
    kit.cylinder(0.012, 0.014, 0.68, METAL, -w * 0.2, 0.09, -d * 0.22);
    kit.box(0.012, 0.48, 0.22, 0xfafcff, -w * 0.2, 0.18, -d * 0.12);
  },
  [BuildingType.WATERFRONT_FERRY]: (kit, w, d) => {
    // Shorefront terminal plaza & modern glazed concourse (+z)
    kit.box(w * 0.96, 0.055, d * 0.48, kit.style.concrete, 0, 0.01, d * 0.25);
    kit.box(w * 0.72, 0.44, d * 0.32, 0xe3eaee, -w * 0.06, 0.065, d * 0.26);
    kit.box(w * 0.78, 0.055, d * 0.38, kit.accent, -w * 0.06, 0.505, d * 0.26);
    // Harbor clock tower
    kit.box(0.26, 0.78, 0.26, 0xdce4e8, w * 0.34, 0.065, d * 0.26);
    kit.add(new THREE.ConeGeometry(0.2, 0.18, 4).rotateY(Math.PI / 4), kit.accent, w * 0.34, 0.935, d * 0.26);
    // Covered passenger boarding gangway & twin ferry slip fender dolphins (-z)
    kit.box(w * 0.18, 0.04, d * 0.34, kit.style.walk, 0, 0.05, -d * 0.14);
    kit.box(w * 0.2, 0.035, d * 0.32, kit.accent, 0, 0.28, -d * 0.12);
    for (const sx of [-0.26, 0.26]) {
      kit.box(w * 0.09, 0.07, d * 0.48, 0x546e7a, sx * w, 0.02, -d * 0.24);
      for (const pz of [-0.44, -0.24, -0.06]) {
        kit.cylinder(0.032, 0.036, 0.18, 0x37474f, sx * w, -0.02, pz * d);
        kit.cylinder(0.036, 0.036, 0.04, 0xfbc02d, sx * w, 0.16, pz * d);
      }
    }
  },
  [BuildingType.WATERFRONT_PORT]: (kit, w, d) => {
    // Deep-water reinforced concrete quay deck (leaves -z outer strip open for docking ships)
    kit.box(w * 0.98, 0.08, d * 0.74, kit.style.concrete, 0, -0.01, d * 0.12);
    // Yellow quay safety kerb & cast-iron bollards along the water wall
    kit.box(w * 0.98, 0.02, 0.06, 0xfbc02d, 0, 0.075, -d * 0.23);
    for (let i = -3; i <= 3; i++) {
      kit.cylinder(0.025, 0.032, 0.07, 0x263238, i * w * 0.13, 0.07, -d * 0.21);
    }
    // Twin ship-to-shore gantry cranes with booms extending out over the water berth (-z)
    const craneColor = 0xd84315;
    for (const cx of [-0.24, 0.12]) {
      for (const lx of [-0.06, 0.06]) {
        for (const lz of [-0.18, -0.02]) {
          kit.box(0.045, 0.96, 0.045, craneColor, (cx + lx) * w, 0.07, lz * d);
        }
      }
      kit.box(0.16 * w, 0.055, d * 0.62, craneColor, cx * w, 1.02, -d * 0.19);
      kit.box(0.12 * w, 0.08, 0.14, WHITE, cx * w, 0.94, -d * 0.1);
    }
    // Intermodal container stacks
    const palette = [0xc62828, 0x1565c0, 0x2e7d32, 0xef6c00, 0x00838f];
    for (let i = 0; i < 8; i++) {
      const x = (-0.36 + (i % 4) * 0.16) * w;
      const z = (0.14 + Math.floor(i / 4) * 0.18) * d;
      kit.box(0.44, 0.14, 0.2, palette[i % palette.length], x, 0.07, z);
      if (i % 3 !== 2) kit.box(0.44, 0.14, 0.2, palette[(i + 2) % palette.length], x, 0.21, z);
    }
    // Port authority control tower & logistics warehouse on shore side
    kit.box(w * 0.26, 0.46, d * 0.42, kit.style.industry[0], w * 0.33, 0.07, d * 0.22);
    kit.box(w * 0.28, 0.05, d * 0.44, kit.accent, w * 0.33, 0.53, d * 0.22);
    kit.box(0.22, 0.42, 0.22, 0xcfd8dc, w * 0.36, 0.58, d * 0.08);
    kit.box(0.26, 0.1, 0.26, 0x37474f, w * 0.36, 1.0, d * 0.08);
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

export function facingToYaw(facing: WaterfrontFacing): number {
  switch (facing) {
    case 'N': return 0;
    case 'S': return Math.PI;
    case 'W': return Math.PI / 2;
    case 'E': return -Math.PI / 2;
  }
}

/** Builds a service model centered at (0, 0, 0) in world units. */
export function buildServiceModelMesh(
  type: BuildingType,
  style: CityStyle,
  orientation?: RoadOrientation,
  facing?: WaterfrontFacing,
  drivewayFacing?: DrivewayFacing,
): THREE.Group {
  const waterfront = isWaterfront(type);
  const resolvedFacing: WaterfrontFacing | undefined = facing
    ?? (waterfront ? (orientation === 'NS' ? 'W' : 'N') : undefined);

  const def = BUILDING_DEFS[type];
  const { w, d } = resolvedFacing ? def.size : getEffectiveSize(type, orientation);
  const kit = new Kit(style, new THREE.Color(def.color).getHex());
  if (!waterfront) {
    kit.box(w, 0.03, d, GREEN.has(type) ? style.lawn : style.concrete);
  }
  if (type === BuildingType.TRANS_TRAIN_STATION && (drivewayFacing === 'E' || drivewayFacing === 'W')) {
    // Rectangular 3x2 train station with road on its short E/W end: keep 3x2 footprint and place bus bay on that end.
    kit.box(w * 0.96, 0.025, d * 0.32, 0x6e6a63, 0, 0.03, -d * 0.31);
    for (const z of [-0.39, -0.34, -0.26, -0.21]) kit.box(w * 0.96, 0.015, 0.018, METAL, 0, 0.055, z * d);
    kit.box(w * 0.86, 0.06, d * 0.12, kit.style.walk, 0, 0.03, -d * 0.1);
    for (const x of [-0.27, 0, 0.27]) {
      kit.box(w * 0.24, 0.15, 0.16, WHITE, x * w, 0.07, -d * 0.31);
      kit.box(w * 0.242, 0.04, 0.165, kit.accent, x * w, 0.13, -d * 0.31);
    }
    const hallSign = drivewayFacing === 'E' ? -1 : 1;
    kit.box(w * 0.36, 0.56, d * 0.42, kit.style.downtown[0], hallSign * w * 0.28, 0.03, d * 0.2);
    kit.box(w * 0.38, 0.06, d * 0.44, kit.accent, hallSign * w * 0.28, 0.59, d * 0.2);
    kit.box(0.28, 0.42, 0.28, kit.style.downtown[0], hallSign * w * 0.28, 0.65, d * 0.2);
    kit.add(new THREE.ConeGeometry(0.22, 0.2, 4).rotateY(Math.PI / 4), kit.accent, hallSign * w * 0.28, 1.17, d * 0.2);

    const bayGroup = new THREE.Group();
    addGarageBayToGroup(bayGroup, {
      axisDepth: w,
      wallColor: kit.style.downtown[0],
      accentColor: kit.accent,
      style: kit.style,
      bayHeight: 0.58,
      bayWidth: 0.78,
    });
    bayGroup.rotation.y = drivewayFacingToYaw(drivewayFacing);
    kit.group.add(bayGroup);
  } else {
    MODELS[type]?.(kit, w, d);
    if (resolvedFacing) {
      kit.group.rotation.y = facingToYaw(resolvedFacing);
    } else if (drivewayFacing && isFleetBuilding(type)) {
      // Square fleet buildings rotate freely; 3x2 train station rotates 0 or PI for S/N.
      kit.group.rotation.y = drivewayFacingToYaw(drivewayFacing);
    }
  }
  kit.group.scale.setScalar(CELL_SIZE);
  return kit.group;
}

export function createServiceModel(
  building: PlacedBuilding,
  style: CityStyle,
  grid?: Grid,
  roads?: RoadMap,
): THREE.Group {
  const { w, d } = getEffectiveSize(building.type, building.orientation);
  const facing = grid && (isWaterfront(building.type) || building.type === BuildingType.TRANS_HARBOR)
    ? getWaterfrontFacing(grid, building.position, building.type, building.orientation, true) ?? undefined
    : undefined;
  const drivewayFacing = roads && isFleetBuilding(building.type)
    ? findDepotDriveway(building, roads).facing
    : undefined;
  const group = buildServiceModelMesh(building.type, style, building.orientation, facing, drivewayFacing);
  group.position.set((building.position.x + w / 2) * CELL_SIZE, 0, (building.position.z + d / 2) * CELL_SIZE);
  return group;
}
