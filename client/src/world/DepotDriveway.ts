import * as THREE from 'three';
import {
  BUILDING_DEFS,
  BuildingType,
  CELL_SIZE,
  SERVICE_BUILDING_FLEETS,
  getEffectiveSize,
  type PlacedBuilding,
  type RoadOrientation,
} from '@cityzen/shared';
import type { CityStyle } from './CityStyle.js';
import type { RoadMap } from './RoadSurface.js';

/** Which edge of a depot building its driveway opens onto. */
export type DrivewayFacing = 'N' | 'S' | 'E' | 'W';

/** Direction vectors matching RoadNetwork / RoadSurface: 0=E(+x), 1=S(+z), 2=W(-x), 3=N(-z). */
const SIDE_DX = [1, 0, -1, 0] as const;
const SIDE_DZ = [0, 1, 0, -1] as const;

/** Width of the asphalt driveway lane (in cells). */
export const DRIVEWAY_WIDTH = 0.56;
/** Half-width of the sidewalk curb cut (slightly wider than the asphalt for clean kerbs). */
export const DRIVEWAY_CUT_HALF = 0.30;
/** Height of the open garage portal lintel above ground (clears all service vehicles, max ~0.37). */
export const BAY_PORTAL_HEIGHT = 0.44;

export interface DepotDriveway {
  buildingId: string;
  type: BuildingType;
  /** Which edge of the building the driveway opens onto. */
  facing: DrivewayFacing;
  /** Direction index from road INTO building: 0=E, 1=S, 2=W, 3=N. */
  side: number;
  /** Driveway mouth at the building's outer lot edge (in cell coordinates). */
  mouthX: number;
  mouthZ: number;
  /** Garage bay portal threshold where the vehicle enters under cover (in cell coordinates). */
  portalX: number;
  portalZ: number;
  /** Deep interior point inside the garage bay where vehicles park/emerge (in cell coordinates). */
  bayX: number;
  bayZ: number;
  /** Depth from lot edge to the garage portal (outdoor driveway apron length). */
  apronDepth: number;
  /** Depth from lot edge to the vehicle park/spawn center inside the enclosed bay. */
  bayDepth: number;
  /** Adjacent road tile coordinates (when hasRoad is true). */
  roadX: number;
  roadZ: number;
  hasRoad: boolean;
}

export function isFleetBuilding(type: BuildingType): boolean {
  return Boolean(SERVICE_BUILDING_FLEETS[type]);
}

/** Converts `side` (heading from road INTO building: 0=E,1=S,2=W,3=N) to the building edge facing the road. */
export function sideToFacing(side: number): DrivewayFacing {
  switch (side & 3) {
    case 0: return 'W';
    case 1: return 'N';
    case 2: return 'E';
    default: return 'S';
  }
}

/** Converts building edge facing the road to `side` (heading from road INTO building). */
export function facingToSide(facing: DrivewayFacing): number {
  switch (facing) {
    case 'W': return 0;
    case 'N': return 1;
    case 'E': return 2;
    case 'S': return 3;
  }
}

/**
 * Y-rotation for a model whose driveway is authored facing local +z (South).
 * Rotates local (0, 0, +1) to face `facing`.
 */
export function drivewayFacingToYaw(facing: DrivewayFacing): number {
  switch (facing) {
    case 'S': return 0;
    case 'N': return Math.PI;
    case 'E': return Math.PI / 2;
    case 'W': return -Math.PI / 2;
  }
}

/** Standard apron & bay depths for a building whose depth along the driveway axis is `axisDepth`. */
export function drivewayDepths(axisDepth: number): { apronDepth: number; bayDepth: number; bayBackDepth: number } {
  const apronDepth = axisDepth >= 3 ? 0.60 : 0.52;
  const bayDepth = apronDepth + 0.60;     // 1.12 for 2-deep, 1.20 for 3-deep (longest bus HALF=0.35 -> 0.77..1.47)
  const bayBackDepth = apronDepth + 1.00; // 1.52 for 2-deep, 1.60 for 3-deep
  return { apronDepth, bayDepth, bayBackDepth };
}

/**
 * Computes the exact driveway geometry for a fleet building given an optional road lookup.
 * `isUsableRoad(x, z)` returns true if cell (x, z) is a road that vehicles can pull out onto.
 * When no adjacent road exists, defaults to facing South ('S', side=3).
 */
export function computeDepotDriveway(
  b: PlacedBuilding,
  isUsableRoad?: (x: number, z: number) => boolean,
): DepotDriveway {
  const { w, d } = getEffectiveSize(b.type, b.orientation);
  const cx = b.position.x + w / 2;
  const cz = b.position.z + d / 2;

  let bestScore = Infinity;
  let bestX = 0;
  let bestZ = 0;
  let bestSide = 3;
  let hasRoad = false;
  if (isUsableRoad) {
    const visit = (x: number, z: number, side: number) => {
      if (!isUsableRoad(x, z)) return;
      const score = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (score < bestScore) {
        bestScore = score;
        bestX = x;
        bestZ = z;
        bestSide = side;
        hasRoad = true;
      }
    };
    for (let dx = 0; dx < w; dx++) {
      visit(b.position.x + dx, b.position.z - 1, 1);
      visit(b.position.x + dx, b.position.z + d, 3);
    }
    for (let dz = 0; dz < d; dz++) {
      visit(b.position.x - 1, b.position.z + dz, 0);
      visit(b.position.x + w, b.position.z + dz, 2);
    }
  }

  const side = bestSide;
  const facing = sideToFacing(side);
  const axisDepth = (side & 1) === 0 ? w : d;
  const { apronDepth, bayDepth } = drivewayDepths(axisDepth);

  const halfAlong = axisDepth / 2;
  const dx = SIDE_DX[side];
  const dz = SIDE_DZ[side];
  const mouthX = cx - dx * halfAlong;
  const mouthZ = cz - dz * halfAlong;

  return {
    buildingId: b.id,
    type: b.type,
    facing,
    side,
    mouthX,
    mouthZ,
    portalX: mouthX + dx * apronDepth,
    portalZ: mouthZ + dz * apronDepth,
    bayX: mouthX + dx * bayDepth,
    bayZ: mouthZ + dz * bayDepth,
    apronDepth,
    bayDepth,
    roadX: hasRoad ? bestX : Math.floor(mouthX - dx * 0.5),
    roadZ: hasRoad ? bestZ : Math.floor(mouthZ - dz * 0.5),
    hasRoad,
  };
}

/**
 * Convenience wrapper using `RoadMap` (from RoadSurface).
 * Prefers straight road tiles (matching CarManager.findAccess, which skips roundabouts and junctions),
 * falling back to any adjacent non-roundabout road tile so the model always faces a nearby street.
 */
export function findDepotDriveway(b: PlacedBuilding, roads: RoadMap): DepotDriveway {
  const isStraight = (x: number, z: number) => {
    const t = roads.get(`${x},${z}`);
    if (!t || t.type === BuildingType.ROAD_ROUNDABOUT) return false;
    let links = 0;
    for (let d = 0; d < 4; d++) {
      if (roads.has(`${x + SIDE_DX[d]},${z + SIDE_DZ[d]}`)) links++;
    }
    return links > 0 && links <= 2;
  };
  const primary = computeDepotDriveway(b, isStraight);
  if (primary.hasRoad) return primary;
  return computeDepotDriveway(b, (x, z) => {
    const t = roads.get(`${x},${z}`);
    return Boolean(t && t.type !== BuildingType.ROAD_ROUNDABOUT);
  });
}

/** Returns true if world cell point (px, pz) falls inside any depot's driveway apron/curb cut. */
export function isPointInDriveway(px: number, pz: number, driveways: readonly DepotDriveway[], margin = 0.08): boolean {
  const halfW = DRIVEWAY_CUT_HALF + margin;
  for (const dw of driveways) {
    if (!dw.hasRoad) continue;
    const dx = SIDE_DX[dw.side];
    const dz = SIDE_DZ[dw.side];
    const relX = px - dw.mouthX;
    const relZ = pz - dw.mouthZ;
    const along = relX * dx + relZ * dz;
    const across = Math.abs(relX * dz - relZ * dx);
    if (along >= -0.15 && along <= dw.apronDepth + margin && across <= halfW) return true;
  }
  return false;
}

export interface GarageBayOptions {
  /** Building extent along the driveway axis (in cells). */
  axisDepth: number;
  /** Exterior wall color of the garage bay structure. */
  wallColor: number;
  /** Accent trim / header color (e.g. red for fire, blue for police). */
  accentColor: number;
  /** Asphalt & concrete style. */
  style: CityStyle;
  /** Total height of the garage bay exterior enclosure (must be >= 0.54). */
  bayHeight?: number;
  /** Exterior width of the garage bay structure (must be >= 0.70). */
  bayWidth?: number;
  /** Optional yellow/black hazard threshold striping at the portal. */
  hazardStripe?: boolean;
  /** Whether to draw the rolled-up overhead door panel. */
  rollerDoor?: boolean;
}

/**
 * Adds an asphalt driveway apron + framed dark recessed garage bay in local coordinates,
 * opening onto +z (at z = +axisDepth / 2, x = 0).
 * Vehicles drive from z = +axisDepth/2 inward to z = +axisDepth/2 - bayDepth.
 */
export function addGarageBayToGroup(group: THREE.Group, opts: GarageBayOptions): void {
  const {
    axisDepth,
    wallColor,
    accentColor,
    style,
    bayHeight = 0.58,
    bayWidth = 0.76,
    hazardStripe = false,
    rollerDoor = true,
  } = opts;

  const { apronDepth, bayBackDepth } = drivewayDepths(axisDepth);
  const edgeZ = axisDepth / 2;
  const portalZ = edgeZ - apronDepth;
  const backZ = edgeZ - bayBackDepth;
  const bayLen = bayBackDepth - apronDepth; // ~1.00 cell
  const bayCenterZ = (portalZ + backZ) / 2;

  const addBox = (
    w: number, h: number, d: number, color: number, x: number, y: number, z: number,
    roughness = 0.88, cast = true,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness, flatShading: true }),
    );
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // 1. Continuous asphalt driveway from the street edge all the way into the dark bay floor
  const drivewayLen = bayBackDepth;
  const drivewayCenterZ = edgeZ - drivewayLen / 2;
  addBox(DRIVEWAY_WIDTH, 0.012, drivewayLen, style.asphalt, 0, 0.024, drivewayCenterZ, 0.94, false);

  // Subtle side kerb edges along the outdoor apron
  const kerbW = 0.035;
  const apronCenterZ = edgeZ - apronDepth / 2;
  for (const sign of [-1, 1]) {
    addBox(kerbW, 0.026, apronDepth, style.kerb, sign * (DRIVEWAY_WIDTH / 2 + kerbW / 2), 0.024, apronCenterZ, 0.9, false);
    // Crisp white/paint edge guide lines on the driveway apron
    addBox(0.018, 0.004, apronDepth - 0.04, style.paint, sign * (DRIVEWAY_WIDTH / 2 - 0.035), 0.036, apronCenterZ, 0.85, false);
  }
  // Dashed centre guide mark on the apron
  addBox(0.018, 0.004, Math.min(0.18, apronDepth * 0.4), style.centreLine, 0, 0.036, apronCenterZ + 0.02, 0.85, false);

  // Optional hazard / safety threshold bar at the bay entrance
  if (hazardStripe) {
    addBox(DRIVEWAY_WIDTH - 0.04, 0.005, 0.045, 0xfbc02d, 0, 0.036, portalZ + 0.03, 0.8, false);
  }

  // 2. Dark recessed garage interior (hollow box open toward +z so cars visibly drive inside)
  const darkColor = 0x0c0f14;
  const openW = DRIVEWAY_WIDTH; // 0.56
  const openH = BAY_PORTAL_HEIGHT; // 0.44
  const wallT = Math.max(0.06, (bayWidth - openW) / 2);

  // Dark interior floor inside the bay (covers asphalt with shadow inside the tunnel)
  addBox(openW - 0.01, 0.006, bayLen - 0.02, darkColor, 0, 0.033, bayCenterZ - 0.01, 0.98, false);
  // Dark back wall closing off the rear of the tunnel
  addBox(bayWidth, bayHeight, 0.06, wallColor, 0, 0.03, backZ - 0.03);
  addBox(openW, openH, 0.02, darkColor, 0, 0.03, backZ + 0.01, 0.98, false);

  // Left & right exterior + dark interior side walls
  for (const sign of [-1, 1]) {
    const sideX = sign * (openW / 2 + wallT / 2);
    addBox(wallT, bayHeight, bayLen, wallColor, sideX, 0.03, bayCenterZ);
    // Dark inner lining so the tunnel walls read deeply recessed
    addBox(0.015, openH, bayLen - 0.02, darkColor, sign * (openW / 2 - 0.008), 0.03, bayCenterZ, 0.98, false);
    // Front portal jamb / trim pillar
    addBox(0.045, openH + 0.06, 0.045, accentColor, sign * (openW / 2 + 0.02), 0.03, portalZ + 0.015);
  }

  // 3. Solid opaque garage roof / header above the portal (completely hides vehicles once inside)
  const headerH = Math.max(0.11, bayHeight - openH);
  addBox(bayWidth, headerH, bayLen, wallColor, 0, 0.03 + openH, bayCenterZ);
  // Dark underside ceiling inside the bay
  addBox(openW, 0.015, bayLen - 0.02, darkColor, 0, 0.03 + openH - 0.015, bayCenterZ, 0.98, false);
  // Accent roof coping / trim cap
  addBox(bayWidth + 0.04, 0.04, bayLen + 0.04, accentColor, 0, 0.03 + bayHeight, bayCenterZ);

  // 4. Partially-raised overhead roller door header + slim front canopy lip
  if (rollerDoor) {
    addBox(openW, 0.055, 0.03, 0xb0bec5, 0, 0.03 + openH - 0.035, portalZ + 0.01);
  }
  // Overhanging canopy lip over the portal
  addBox(bayWidth + 0.06, 0.035, 0.14, accentColor, 0, 0.03 + openH + 0.01, portalZ + 0.07);
}

/**
 * Builds a standalone garage bay + driveway group for a civic fleet building
 * (those whose main walls are instanced in CityBuildings), centered at (0, 0, 0) in world units.
 */
export function buildCivicGarageBayMesh(
  type: BuildingType,
  style: CityStyle,
  facing: DrivewayFacing = 'S',
  orientation?: RoadOrientation,
): THREE.Group {
  const def = BUILDING_DEFS[type];
  const { w, d } = getEffectiveSize(type, orientation);
  const axisDepth = facing === 'E' || facing === 'W' ? w : d;
  const accent = new THREE.Color(def.color).lerp(new THREE.Color(0x585c62), 0.15).getHex();

  let wallColor = new THREE.Color(def.color).lerp(new THREE.Color(0xf1ece2), 0.72).getHex();
  let bayHeight = 0.60;
  let hazardStripe = false;
  if (type === BuildingType.FIRE_STATION || type === BuildingType.FIRE_HQ) {
    wallColor = new THREE.Color(def.color).lerp(new THREE.Color(0xf0dfd8), 0.56).getHex();
    bayHeight = type === BuildingType.FIRE_HQ ? 0.66 : 0.60;
    hazardStripe = true;
  } else if (type === BuildingType.POLICE_STATION || type === BuildingType.POLICE_HQ) {
    wallColor = new THREE.Color(def.color).lerp(new THREE.Color(0xe6ecf2), 0.62).getHex();
    bayHeight = type === BuildingType.POLICE_HQ ? 0.64 : 0.58;
  } else if (type === BuildingType.HEALTH_CLINIC || type === BuildingType.HEALTH_HOSPITAL) {
    wallColor = 0xf0f4f5;
    bayHeight = type === BuildingType.HEALTH_HOSPITAL ? 0.64 : 0.58;
    hazardStripe = true;
  }

  const group = new THREE.Group();
  group.name = 'depot-driveway-bay';
  addGarageBayToGroup(group, {
    axisDepth,
    wallColor,
    accentColor: accent,
    style,
    bayHeight,
    bayWidth: axisDepth >= 3 ? 0.84 : 0.74,
    hazardStripe,
    rollerDoor: true,
  });

  // For Health Clinic / Hospital, add a crisp red cross emblem above the ambulance bay canopy
  if (type === BuildingType.HEALTH_CLINIC || type === BuildingType.HEALTH_HOSPITAL) {
    const { apronDepth } = drivewayDepths(axisDepth);
    const portalZ = axisDepth / 2 - apronDepth;
    const redMat = new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.6 });
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.02), redMat);
    crossH.position.set(0, 0.03 + BAY_PORTAL_HEIGHT + 0.095, portalZ + 0.05);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.02), redMat);
    crossV.position.set(0, 0.03 + BAY_PORTAL_HEIGHT + 0.095, portalZ + 0.05);
    group.add(crossH, crossV);
  }

  group.rotation.y = drivewayFacingToYaw(facing);
  group.scale.setScalar(CELL_SIZE);
  return group;
}
