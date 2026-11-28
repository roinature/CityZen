import * as THREE from 'three';
import {
  BuildingType,
  type Position,
  type CityState,
  type EdgeDirection,
  type PlacedBuilding,
  type PlaceBuildingsPayload,
  type RoadOrientation,
  type UtilityLayer,
  type ZoneDensity,
  findGridBuildingToDemolish,
  isGeneratorBuilding,
  isPowerConductorBuilding,
  isRoad,
  isSewageFacilityBuilding,
  isUtilityConduit,
  isWaterFacilityBuilding,
  isWaterfront,
  isZone,
  BUILDING_DEFS,
  ZONE_DENSITY_COSTS,
  CELL_SIZE,
  DEFAULT_GRID_SIZE,
  POWER_GENERATOR_RADIUS,
  POWER_LINE_RADIUS,
  POWER_MAX_SPAN,
  POWER_PYLON_STEP,
  POWER_SUBSTATION_RADIUS,
  canPlaceBuilding,
  computePowerCableSpans,
  getEffectiveSize,
  getPlacementCost,
  getWaterfrontFacing,
  replacesRoads,
  resolveWaterfrontOrientation,
} from '@cityzen/shared';
import {
  BuildingFactory,
  type ConduitConnections,
  type ConduitDirection,
} from '../world/BuildingFactory.js';
import type { GridRect } from '../world/CityBuildings.js';
import { CITY_STYLES, type CityStyleId } from '../world/CityStyle.js';
import { GridRaycaster } from './Raycaster.js';
import type { ToolMode } from '../ui/BuildTools.js';

function disposePreviewGroup(group: THREE.Group): void {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (child instanceof THREE.InstancedMesh) child.dispose();
    child.geometry.dispose();
    if (Array.isArray(child.material)) {
      for (const m of child.material) m.dispose();
    } else {
      child.material.dispose();
    }
  });
}

function isLineDragType(type: BuildingType): boolean {
  return (isRoad(type) && !replacesRoads(type)) || isUtilityConduit(type);
}

function isRectDragType(type: BuildingType): boolean {
  return isZone(type);
}

function computeLineDragOrientation(start: Position, end: Position): RoadOrientation {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  return Math.abs(dx) >= Math.abs(dz) ? 'EW' : 'NS';
}

function computeStraightLine(start: Position, end: Position, stepW: number, stepD: number): Position[] {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const positions: Position[] = [];
  const maxX = DEFAULT_GRID_SIZE - stepW;
  const maxZ = DEFAULT_GRID_SIZE - stepD;

  // Clamp the start so the line always begins within valid bounds
  const clampedStart: Position = {
    x: Math.max(0, Math.min(maxX, start.x)),
    z: Math.max(0, Math.min(maxZ, start.z)),
  };

  if (Math.abs(dx) >= Math.abs(dz)) {
    // Horizontal dominant — clamp end x to grid bounds
    const dir = dx >= 0 ? 1 : -1;
    const clampedEndX = Math.max(0, Math.min(maxX, end.x));
    const dist = Math.abs(clampedEndX - clampedStart.x);
    const steps = Math.floor(dist / stepW);
    for (let i = 0; i <= steps; i++) {
      positions.push({ x: clampedStart.x + i * stepW * dir, z: clampedStart.z });
    }
  } else {
    // Vertical dominant — clamp end z to grid bounds
    const dir = dz >= 0 ? 1 : -1;
    const clampedEndZ = Math.max(0, Math.min(maxZ, end.z));
    const dist = Math.abs(clampedEndZ - clampedStart.z);
    const steps = Math.floor(dist / stepD);
    for (let i = 0; i <= steps; i++) {
      positions.push({ x: clampedStart.x, z: clampedStart.z + i * stepD * dir });
    }
  }

  return positions;
}

function getPowerRangeForType(type: BuildingType): number {
  if (type === BuildingType.ENERGY_SUBSTATION) return POWER_SUBSTATION_RADIUS;
  if (isGeneratorBuilding(type)) return POWER_GENERATOR_RADIUS;
  if (type === BuildingType.UTILITY_POWER_LINE) return POWER_LINE_RADIUS;
  return 0;
}

function hasConductorOnCell(state: CityState, x: number, z: number): boolean {
  const cell = state.grid[x]?.[z];
  if (!cell) return false;
  if (cell.powerLineId) return true;
  if (cell.buildingId) {
    const b = state.buildings.find(item => item.id === cell.buildingId);
    return Boolean(b && isPowerConductorBuilding(b.type));
  }
  return false;
}

/**
 * Computes spaced pylon positions along a free-angle line from `start` to `end`
 * (every `POWER_PYLON_STEP = 5` tiles, stretching overhead cables across the gap).
 * If `start` already holds a power plant/substation/pylon and the drag extends away,
 * skips placing a duplicate pylon at `start` so cables stretch cleanly from the existing anchor.
 */
function computeSpacedPowerLinePositions(
  state: CityState | null,
  start: Position,
  end: Position,
): Position[] {
  const maxCoord = DEFAULT_GRID_SIZE - 1;
  const s: Position = {
    x: Math.max(0, Math.min(maxCoord, start.x)),
    z: Math.max(0, Math.min(maxCoord, start.z)),
  };
  const e: Position = {
    x: Math.max(0, Math.min(maxCoord, end.x)),
    z: Math.max(0, Math.min(maxCoord, end.z)),
  };

  const dx = e.x - s.x;
  const dz = e.z - s.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.5) return [s];

  const segments = Math.max(1, Math.ceil(dist / POWER_PYLON_STEP));
  const startAnchored = Boolean(state && hasConductorOnCell(state, s.x, s.z));
  const endAnchored = Boolean(state && hasConductorOnCell(state, e.x, e.z));
  const out: Position[] = [];
  let prevAnchor: Position = s;

  for (let i = 0; i <= segments; i++) {
    if (i === 0 && startAnchored && segments >= 1) continue;
    if (i === segments && endAnchored && out.length > 0) continue;

    const t = i / segments;
    let px = Math.round(s.x + dx * t);
    let pz = Math.round(s.z + dz * t);

    // If an intermediate tower lands on water or an unplaceable cell, nudge <= 1 tile onto dry ground
    if (state && i > 0 && i < segments) {
      const ok = canPlaceBuilding(
        state.grid, { x: px, z: pz }, BuildingType.UTILITY_POWER_LINE, state.resources, true, state.buildings,
      ).valid;
      if (!ok) {
        const nextX = s.x + dx * ((i + 1) / segments);
        const nextZ = s.z + dz * ((i + 1) / segments);
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const nx = px + ox;
          const nz = pz + oz;
          if (nx < 0 || nz < 0 || nx > maxCoord || nz > maxCoord) continue;
          if (Math.hypot(nx - prevAnchor.x, nz - prevAnchor.z) > POWER_MAX_SPAN) continue;
          if (Math.hypot(nextX - nx, nextZ - nz) > POWER_MAX_SPAN) continue;
          if (canPlaceBuilding(
            state.grid, { x: nx, z: nz }, BuildingType.UTILITY_POWER_LINE, state.resources, true, state.buildings,
          ).valid) {
            px = nx;
            pz = nz;
            break;
          }
        }
      }
    }

    if (out.length === 0 || out[out.length - 1].x !== px || out[out.length - 1].z !== pz) {
      out.push({ x: px, z: pz });
      prevAnchor = { x: px, z: pz };
    }
  }

  return out.length > 0 ? out : [e];
}

/**
 * Builds golden circular range rings and stretched catenary preview cables
 * for hovered or dragged power infrastructure.
 */
function buildPowerPreviewOverlay(
  state: CityState,
  ghostBuildings: PlacedBuilding[],
  radiusTiles: number,
  showCables: boolean,
): THREE.Group {
  const group = new THREE.Group();
  const rWorld = (radiusTiles + 0.35) * CELL_SIZE;

  if (radiusTiles > 0 && ghostBuildings.length > 0) {
    const discGeo = new THREE.CircleGeometry(rWorld, 36).rotateX(-Math.PI / 2);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0xffd54f,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
    });
    const ringGeo = new THREE.RingGeometry(rWorld - 0.07 * CELL_SIZE, rWorld, 44).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffeb3b,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const discs = new THREE.InstancedMesh(discGeo, discMat, ghostBuildings.length);
    const rings = new THREE.InstancedMesh(ringGeo, ringMat, ghostBuildings.length);
    discs.renderOrder = 4;
    rings.renderOrder = 5;
    const mat = new THREE.Matrix4();

    ghostBuildings.forEach((gb, idx) => {
      const { w, d } = getEffectiveSize(gb.type, gb.orientation);
      const cx = (gb.position.x + w * 0.5) * CELL_SIZE;
      const cz = (gb.position.z + d * 0.5) * CELL_SIZE;
      mat.makeTranslation(cx, 0.032, cz);
      discs.setMatrixAt(idx, mat);
      mat.makeTranslation(cx, 0.036, cz);
      rings.setMatrixAt(idx, mat);
    });
    discs.computeBoundingSphere();
    rings.computeBoundingSphere();
    group.add(discs, rings);
  }

  if (showCables && ghostBuildings.length > 0) {
    const ghostIds = new Set(ghostBuildings.map(g => g.id));
    const existingConductors = state.buildings.filter(b => isPowerConductorBuilding(b.type));
    const activeGhosts = ghostBuildings.filter(
      g => !hasConductorOnCell(state, g.position.x, g.position.z),
    );
    if (activeGhosts.length > 0) {
      const spans = computePowerCableSpans([...existingConductors, ...activeGhosts], POWER_MAX_SPAN)
        .filter(sp => ghostIds.has(sp.fromId) || ghostIds.has(sp.toId));

      if (spans.length > 0) {
        const SEGS = 6;
        const wireY = 1.02 * CELL_SIZE;
        const chordGeo = new THREE.CylinderGeometry(0.022 * CELL_SIZE, 0.022 * CELL_SIZE, 1, 6);
        const chordMat = new THREE.MeshBasicMaterial({
          color: 0xffeb3b,
          transparent: true,
          opacity: 0.9,
        });
        const wires = new THREE.InstancedMesh(chordGeo, chordMat, spans.length * 2 * SEGS);
        const upAxis = new THREE.Vector3(0, 1, 0);
        const p0 = new THREE.Vector3();
        const p1 = new THREE.Vector3();
        const delta = new THREE.Vector3();
        const mid = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scaleVec = new THREE.Vector3();
        const mat = new THREE.Matrix4();

        let wi = 0;
        for (const sp of spans) {
          const ax = sp.ax * CELL_SIZE;
          const az = sp.az * CELL_SIZE;
          const bx = sp.bx * CELL_SIZE;
          const bz = sp.bz * CELL_SIZE;
          const dx = bx - ax;
          const dz = bz - az;
          const len = Math.hypot(dx, dz) || 0.001;
          const perpX = (-dz / len) * 0.18 * CELL_SIZE;
          const perpZ = (dx / len) * 0.18 * CELL_SIZE;
          const sagMax = Math.min(0.32, 0.042 * Math.max(1, sp.distance)) * CELL_SIZE;

          for (const side of [-1, 1]) {
            const ox = side * perpX;
            const oz = side * perpZ;
            for (let s = 0; s < SEGS; s++) {
              const t0 = s / SEGS;
              const t1 = (s + 1) / SEGS;
              p0.set(ax + dx * t0 + ox, wireY - 4 * sagMax * t0 * (1 - t0), az + dz * t0 + oz);
              p1.set(ax + dx * t1 + ox, wireY - 4 * sagMax * t1 * (1 - t1), az + dz * t1 + oz);
              delta.subVectors(p1, p0);
              const segLen = delta.length();
              mid.addVectors(p0, p1).multiplyScalar(0.5);
              quat.setFromUnitVectors(upAxis, delta.normalize());
              scaleVec.set(1, segLen * 1.02, 1);
              mat.compose(mid, quat, scaleVec);
              wires.setMatrixAt(wi++, mat);
            }
          }
        }
        wires.count = wi;
        wires.computeBoundingSphere();
        group.add(wires);
      }
    }
  }

  return group;
}

export class BuildMode {
  private scene: THREE.Scene;
  private getCamera: () => THREE.Camera;
  private raycaster: GridRaycaster;
  private factory: BuildingFactory;

  private selectedType: BuildingType | null = null;
  private selectedDensity: ZoneDensity | null = null;
  private preferredOrientation: RoadOrientation = 'EW';
  private styleId: CityStyleId = 'classic';
  private previewMesh: THREE.Group | null = null;
  private previewMeshKey: string | null = null;
  private currentHoverPos: Position | null = null;
  private currentHoverWorld: { x: number; z: number } | null = null;
  private lastMoveAnchorWorld: { x: number; z: number } | null = null;
  private hoverFlowDir: ConduitDirection = 'E';
  private dragStartWorld: { x: number; z: number } | null = null;

  // Tool mode & active utility layer
  private toolMode: ToolMode = 'pointer';
  private activeLayer: UtilityLayer = 'surface';
  private brushSize = 1;

  // Drag state (shared by line and rect drag)
  private isDragging = false;
  private unlimitedMoney = false;

  // Line drag state (for roads)
  private lineDragStart: Position | null = null;
  private lineDragPreviewGroup: THREE.Group | null = null;

  // Rectangle drag state (for zones)
  private rectDragStart: Position | null = null;
  private rectPreviewGroup: THREE.Group | null = null;

  // Bulldoze preview
  private bulldozePreviewGroup: THREE.Group | null = null;

  // Previews are only rebuilt when something relevant changes (see previewKey)
  private lastPreviewKey: string | null = null;

  onPaint: ((stroke: PlaceBuildingsPayload) => void) | null = null;
  onPlace: ((pos: Position, type: BuildingType, density?: ZoneDensity, orientation?: RoadOrientation) => void) | null = null;
  onDemolish: ((pos: Position, layer: UtilityLayer) => void) | null = null;
  onEdgeRoadClick: ((direction: EdgeDirection, position: number) => boolean) | null = null;
  onSelectBuilding: ((building: PlacedBuilding | null) => void) | null = null;
  /** Reports the cost of what is about to be placed (null = nothing), whether affordable, any terrain-leveling fee included, and optional invalid placement hint. */
  onDragCostUpdate: ((cost: number | null, affordable?: boolean, gradingCost?: number, invalidReason?: string) => void) | null = null;
  /** Footprint whose existing zoned buildings should step aside for a valid hover preview. */
  onPreviewClearance: ((rect: GridRect | null) => void) | null = null;

  constructor(scene: THREE.Scene, getCamera: () => THREE.Camera, canvas: HTMLCanvasElement) {
    this.scene = scene;
    this.getCamera = getCamera;
    this.raycaster = new GridRaycaster(canvas);
    this.factory = new BuildingFactory();
  }

  select(type: BuildingType): void {
    this.selectedType = type;
    this.lastPreviewKey = null;
    this.clearPreview();
    this.clearRectPreview();
  }

  setDensity(density: ZoneDensity | null): void {
    this.selectedDensity = density;
    this.lastPreviewKey = null;
  }

  rotateSelection(): void {
    this.preferredOrientation = this.preferredOrientation === 'EW' ? 'NS' : 'EW';
    this.hoverFlowDir = this.preferredOrientation === 'NS' ? 'S' : 'E';
    this.lastPreviewKey = null;
  }

  deselect(): void {
    this.selectedType = null;
    this.selectedDensity = null;
    this.cancelInteraction();
    this.clearHover();
  }

  getSelectedType(): BuildingType | null {
    return this.selectedType;
  }

  setUnlimitedMoney(enabled: boolean): void {
    this.unlimitedMoney = enabled;
  }

  setStyle(style: CityStyleId): void {
    if (this.styleId === style) return;
    this.styleId = style;
    this.lastPreviewKey = null;
  }

  setToolMode(mode: ToolMode): void {
    this.toolMode = mode;
    if (mode !== 'build') {
      this.deselect();
    }
  }

  getToolMode(): ToolMode {
    return this.toolMode;
  }

  setActiveLayer(layer: UtilityLayer): void {
    if (this.activeLayer === layer) return;
    this.activeLayer = layer;
    this.lastPreviewKey = null;
  }

  getActiveLayer(): UtilityLayer {
    return this.activeLayer;
  }

  setBrushSize(size: number): void {
    this.brushSize = Math.max(1, Math.min(3, size));
  }

  /** Cost of one unit of the selected type (zones are priced by density). */
  private getUnitCost(): number {
    if (!this.selectedType) return 0;
    if (isZone(this.selectedType) && this.selectedDensity) {
      return ZONE_DENSITY_COSTS[this.selectedDensity];
    }
    return BUILDING_DEFS[this.selectedType].cost;
  }

  /** Everything the preview depends on. Unchanged key → keep the existing preview meshes. */
  private previewKey(state: CityState | null): string {
    const pos = (p: Position | null) => (p ? `${p.x},${p.z}` : '-');
    const lastId = state?.buildings.length ? state.buildings[state.buildings.length - 1].id : '';
    const subDragDir = this.isDragging && this.lineDragStart && this.currentHoverPos
      && this.lineDragStart.x === this.currentHoverPos.x && this.lineDragStart.z === this.currentHoverPos.z
      ? this.computeActiveDragFlowDir()
      : '';
    return [
      this.toolMode, this.activeLayer, this.selectedType, this.selectedDensity,
      this.preferredOrientation, this.hoverFlowDir, subDragDir, this.brushSize, this.styleId,
      pos(this.currentHoverPos), this.isDragging, pos(this.lineDragStart), pos(this.rectDragStart),
      state?.id, state?.buildings.length, lastId, state?.resources.money, this.unlimitedMoney,
    ].join('|');
  }

  private hasMatchingUtilityNeighbor(state: CityState, x: number, z: number, type: BuildingType): boolean {
    const cell = state.grid[x]?.[z];
    if (!cell) return false;
    if (type === BuildingType.UTILITY_WATER_PIPE) {
      if (cell.waterPipeId) return true;
      if (cell.buildingId) {
        const b = state.buildings.find(item => item.id === cell.buildingId);
        return Boolean(b && isWaterFacilityBuilding(b.type));
      }
      return false;
    }
    if (type === BuildingType.UTILITY_SEWAGE_PIPE) {
      if (cell.sewagePipeId) return true;
      if (cell.buildingId) {
        const b = state.buildings.find(item => item.id === cell.buildingId);
        return Boolean(b && isSewageFacilityBuilding(b.type));
      }
      return false;
    }
    if (type === BuildingType.UTILITY_POWER_LINE) {
      if (cell.powerLineId) return true;
      if (cell.buildingId) {
        const b = state.buildings.find(item => item.id === cell.buildingId);
        return Boolean(b && isPowerConductorBuilding(b.type));
      }
      return false;
    }
    return false;
  }

  private computeHoverConduitConnections(
    state: CityState,
    pos: Position,
    type: BuildingType,
    orientation: RoadOrientation,
  ): ConduitConnections {
    const n = this.hasMatchingUtilityNeighbor(state, pos.x, pos.z - 1, type);
    const s = this.hasMatchingUtilityNeighbor(state, pos.x, pos.z + 1, type);
    const w = this.hasMatchingUtilityNeighbor(state, pos.x - 1, pos.z, type);
    const e = this.hasMatchingUtilityNeighbor(state, pos.x + 1, pos.z, type);
    const count = Number(n) + Number(s) + Number(e) + Number(w);

    if (count >= 2) {
      return { n, s, e, w, flowDir: this.hoverFlowDir };
    }
    if (count === 1) {
      // Connect into the adjacent pipe/facility AND extend outward in the build direction
      const outN = n || (orientation === 'NS' && this.hoverFlowDir === 'N') || (!n && !s && orientation === 'NS' && !e && !w);
      const outS = s || (orientation === 'NS' && this.hoverFlowDir === 'S') || (n && orientation === 'NS');
      const outW = w || (orientation === 'EW' && this.hoverFlowDir === 'W');
      const outE = e || (orientation === 'EW' && this.hoverFlowDir === 'E') || (w && orientation === 'EW');
      // If orientation wasn't turned perpendicular, extend straight through opposite the single neighbor
      if (!outN && !outS && !outE && !outW) {
        return { n: n || s, s: n || s, e: e || w, w: e || w };
      }
      const straightThrough =
        (n && orientation === 'NS') ? { n: true, s: true, e: false, w: false, flowDir: 'S' as const }
        : (s && orientation === 'NS') ? { n: true, s: true, e: false, w: false, flowDir: 'N' as const }
        : (w && orientation === 'EW') ? { n: false, s: false, e: true, w: true, flowDir: 'E' as const }
        : (e && orientation === 'EW') ? { n: false, s: false, e: true, w: true, flowDir: 'W' as const }
        : {
            n: n || (orientation === 'NS' && this.hoverFlowDir === 'N'),
            s: s || (orientation === 'NS' && this.hoverFlowDir === 'S'),
            e: e || (orientation === 'EW' && this.hoverFlowDir === 'E'),
            w: w || (orientation === 'EW' && this.hoverFlowDir === 'W'),
            flowDir: this.hoverFlowDir,
          };
      return straightThrough;
    }

    return orientation === 'NS'
      ? { n: true, s: true, e: false, w: false, flowDir: this.hoverFlowDir === 'N' || this.hoverFlowDir === 'S' ? this.hoverFlowDir : 'S' }
      : { n: false, s: false, e: true, w: true, flowDir: this.hoverFlowDir === 'E' || this.hoverFlowDir === 'W' ? this.hoverFlowDir : 'E' };
  }

  private computeActiveDragFlowDir(): ConduitDirection {
    if (this.lineDragStart && this.currentHoverPos) {
      const dx = this.currentHoverPos.x - this.lineDragStart.x;
      const dz = this.currentHoverPos.z - this.lineDragStart.z;
      if (dx !== 0 || dz !== 0) {
        if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 'E' : 'W';
        return dz >= 0 ? 'S' : 'N';
      }
    }
    if (this.dragStartWorld && this.currentHoverWorld) {
      const wx = this.currentHoverWorld.x - this.dragStartWorld.x;
      const wz = this.currentHoverWorld.z - this.dragStartWorld.z;
      if (Math.hypot(wx, wz) >= CELL_SIZE * 0.12) {
        if (Math.abs(wx) >= Math.abs(wz)) return wx >= 0 ? 'E' : 'W';
        return wz >= 0 ? 'S' : 'N';
      }
    }
    return this.hoverFlowDir;
  }

  private computeActiveLineDragOrientation(state?: CityState | null): RoadOrientation {
    if (this.lineDragStart && this.currentHoverPos) {
      const dx = this.currentHoverPos.x - this.lineDragStart.x;
      const dz = this.currentHoverPos.z - this.lineDragStart.z;
      if (dx !== 0 || dz !== 0) {
        return computeLineDragOrientation(this.lineDragStart, this.currentHoverPos);
      }
    }
    if (this.dragStartWorld && this.currentHoverWorld) {
      const wx = this.currentHoverWorld.x - this.dragStartWorld.x;
      const wz = this.currentHoverWorld.z - this.dragStartWorld.z;
      if (Math.hypot(wx, wz) >= CELL_SIZE * 0.12) {
        return Math.abs(wx) >= Math.abs(wz) ? 'EW' : 'NS';
      }
    }
    if (state && this.lineDragStart && this.selectedType) {
      return this.resolveHoverOrientation(state, this.lineDragStart, this.selectedType) ?? this.preferredOrientation;
    }
    return this.preferredOrientation;
  }

  private resolveHoverOrientation(state: CityState, pos: Position, type: BuildingType): RoadOrientation | undefined {
    if (isUtilityConduit(type)) {
      const n = this.hasMatchingUtilityNeighbor(state, pos.x, pos.z - 1, type);
      const s = this.hasMatchingUtilityNeighbor(state, pos.x, pos.z + 1, type);
      const w = this.hasMatchingUtilityNeighbor(state, pos.x - 1, pos.z, type);
      const e = this.hasMatchingUtilityNeighbor(state, pos.x + 1, pos.z, type);
      if ((n || s) && !(e || w)) return 'NS';
      if ((e || w) && !(n || s)) return 'EW';
      // Align with underlying road when hovering along a street without existing pipe neighbors
      const surfaceId = state.grid[pos.x]?.[pos.z]?.buildingId;
      if (surfaceId) {
        const road = state.buildings.find(b => b.id === surfaceId && isRoad(b.type));
        if (road?.orientation) return road.orientation;
      }
      return this.preferredOrientation;
    }
    if (isWaterfront(type)) {
      return resolveWaterfrontOrientation(state.grid, pos, type, state.buildings, this.preferredOrientation);
    }
    if (type === BuildingType.TRANS_HARBOR) {
      const facingPref = getWaterfrontFacing(state.grid, pos, type, this.preferredOrientation);
      if (facingPref) return this.preferredOrientation;
      const alt: RoadOrientation = this.preferredOrientation === 'EW' ? 'NS' : 'EW';
      if (getWaterfrontFacing(state.grid, pos, type, alt)) return alt;
    }
    const def = BUILDING_DEFS[type];
    if (!isZone(type) && !isRoad(type) && def.size.w !== def.size.d) {
      return this.preferredOrientation;
    }
    return undefined;
  }

  private canAfford(state: CityState, cost: number): boolean {
    return this.unlimitedMoney || state.resources.money >= cost;
  }

  updatePreview(state: CityState | null): void {
    // Rebuilding preview meshes every frame is wasteful (a zone drag can be
    // hundreds of cells) — only do it when the inputs actually changed.
    const key = this.previewKey(state);
    if (key === this.lastPreviewKey) return;
    this.lastPreviewKey = key;

    // Bulldoze preview
    if (this.toolMode === 'bulldoze' && this.currentHoverPos && state) {
      this.clearPreview();
      this.clearLineDragPreview();
      this.clearRectPreview();
      this.updateBulldozePreview(state);
      return;
    }
    this.clearBulldozePreview();

    if (!this.selectedType || !this.currentHoverPos || !state) {
      this.clearPreview();
      this.clearLineDragPreview();
      this.clearRectPreview();
      this.onDragCostUpdate?.(null);
      return;
    }

    // Line drag preview for roads
    if (this.isDragging && this.lineDragStart && isLineDragType(this.selectedType)) {
      this.clearPreview();
      this.updateLineDragPreview(state);
      return;
    }

    // Rectangle drag preview for zones
    if (this.isDragging && this.rectDragStart && isRectDragType(this.selectedType)) {
      this.clearPreview();
      this.updateRectPreview(state);
      return;
    }

    // Normal single-cell preview
    this.clearRectPreview();
    this.clearLineDragPreview();

    const orientation = this.resolveHoverOrientation(state, this.currentHoverPos, this.selectedType);
    const facing = (isWaterfront(this.selectedType) || this.selectedType === BuildingType.TRANS_HARBOR)
      ? getWaterfrontFacing(state.grid, this.currentHoverPos, this.selectedType, orientation) ?? undefined
      : undefined;
    const conduitConnections = isUtilityConduit(this.selectedType)
      ? this.computeHoverConduitConnections(state, this.currentHoverPos, this.selectedType, orientation ?? 'EW')
      : undefined;
    const connKey = conduitConnections
      ? `${Number(conduitConnections.n)}${Number(conduitConnections.s)}${Number(conduitConnections.e)}${Number(conduitConnections.w)}${conduitConnections.flowDir ?? ''}`
      : '';

    const result = canPlaceBuilding(
      state.grid, this.currentHoverPos, this.selectedType,
      state.resources, this.unlimitedMoney, state.buildings,
      this.selectedDensity ?? undefined, orientation,
    );

    const meshKey = `${this.selectedType}|${result.valid}|${this.styleId}|${orientation ?? ''}|${facing ?? ''}|${connKey}`;
    if (!this.previewMesh || this.previewMeshKey !== meshKey) {
      this.disposePreviewOnly();
      this.previewMesh = this.factory.createPreview(
        this.selectedType,
        result.valid,
        CITY_STYLES[this.styleId],
        orientation,
        facing,
        conduitConnections,
      );
      this.previewMeshKey = meshKey;
      this.scene.add(this.previewMesh);
    }

    const { w: effW, d: effD } = getEffectiveSize(this.selectedType, orientation);
    const w = effW * CELL_SIZE;
    const d = effD * CELL_SIZE;
    this.previewMesh.position.set(
      this.currentHoverPos.x * CELL_SIZE + w / 2,
      0,
      this.currentHoverPos.z * CELL_SIZE + d / 2,
    );

    // Show circular power range & live stretched snap cables when hovering power infrastructure
    const powerRange = getPowerRangeForType(this.selectedType);
    if (powerRange > 0) {
      this.clearLineDragPreview();
      const ghostEntry: PlacedBuilding = {
        id: '__hover_power__',
        type: this.selectedType,
        position: this.currentHoverPos,
        placedBy: '',
        placedAt: 0,
        orientation,
      };
      this.lineDragPreviewGroup = buildPowerPreviewOverlay(
        state,
        [ghostEntry],
        powerRange,
        this.selectedType === BuildingType.UTILITY_POWER_LINE && result.valid,
      );
      this.scene.add(this.lineDragPreviewGroup);
    }

    if (result.valid && !isZone(this.selectedType) && !isUtilityConduit(this.selectedType)) {
      this.onPreviewClearance?.({
        x: this.currentHoverPos.x,
        z: this.currentHoverPos.z,
        w: effW,
        d: effD,
      });
    } else {
      this.onPreviewClearance?.(null);
    }

    const { totalCost, gradingCost } = getPlacementCost(
      state.grid,
      this.currentHoverPos,
      this.selectedType,
      this.selectedDensity ?? undefined,
      orientation,
    );
    const invalidHint = !result.valid && result.reason && result.reason !== 'Cell occupied' && result.reason !== 'Not enough money'
      ? result.reason
      : undefined;
    this.onDragCostUpdate?.(totalCost, this.canAfford(state, totalCost), gradingCost, invalidHint);
  }

  private getRectanglePositions(start: Position, end: Position): Position[] {
    const positions: Position[] = [];
    for (let x = Math.min(start.x, end.x); x <= Math.max(start.x, end.x); x++) {
      for (let z = Math.min(start.z, end.z); z <= Math.max(start.z, end.z); z++) {
        positions.push({ x, z });
      }
    }
    return positions;
  }

  private updateRectPreview(state: CityState): void {
    this.clearRectPreview();
    if (!this.rectDragStart || !this.currentHoverPos || !this.selectedType) return;

    const placeable: Position[] = [];
    const blocked: Position[] = [];
    const unitCost = this.getUnitCost();
    let cost = 0;
    let outOfMoney = false;
    for (const position of this.getRectanglePositions(this.rectDragStart, this.currentHoverPos)) {
      const free = canPlaceBuilding(state.grid, position, this.selectedType, state.resources, true).valid;
      if (free && this.canAfford(state, cost + unitCost)) {
        placeable.push(position);
        cost += unitCost;
      } else {
        blocked.push(position);
        outOfMoney ||= free;
      }
    }
    this.rectPreviewGroup = new THREE.Group();
    for (const [positions, valid] of [[placeable, true], [blocked, false]] as const) {
      if (!positions.length) continue;
      const geometry = new THREE.BoxGeometry(CELL_SIZE * 0.85, 0.3, CELL_SIZE * 0.85);
      const material = new THREE.MeshLambertMaterial({
        color: valid ? 0x00ff00 : 0xff0000,
        transparent: true,
        opacity: 0.5,
      });
      const tiles = new THREE.InstancedMesh(geometry, material, positions.length);
      const transform = new THREE.Matrix4();
      positions.forEach(({ x, z }, index) => {
        transform.makeTranslation((x + 0.5) * CELL_SIZE, 0.15, (z + 0.5) * CELL_SIZE);
        tiles.setMatrixAt(index, transform);
      });
      tiles.instanceMatrix.needsUpdate = true;
      this.rectPreviewGroup.add(tiles);
    }

    this.scene.add(this.rectPreviewGroup);

    this.onDragCostUpdate?.(cost, !outOfMoney);
  }

  canDraw(): boolean {
    return this.toolMode === 'build' && this.selectedType !== null &&
      (isLineDragType(this.selectedType) || isRectDragType(this.selectedType));
  }

  hover(x: number, y: number): void {
    const cam = this.getCamera();
    const world = this.raycaster.getWorldPosition(x, y, cam);
    this.currentHoverWorld = world;
    if (world && !this.isDragging) {
      if (!this.lastMoveAnchorWorld) {
        this.lastMoveAnchorWorld = world;
      } else {
        const dx = world.x - this.lastMoveAnchorWorld.x;
        const dz = world.z - this.lastMoveAnchorWorld.z;
        if (Math.hypot(dx, dz) >= CELL_SIZE * 0.55) {
          if (Math.abs(dx) > Math.abs(dz) * 1.2) {
            this.preferredOrientation = 'EW';
            this.hoverFlowDir = dx >= 0 ? 'E' : 'W';
            this.lastMoveAnchorWorld = world;
          } else if (Math.abs(dz) > Math.abs(dx) * 1.2) {
            this.preferredOrientation = 'NS';
            this.hoverFlowDir = dz >= 0 ? 'S' : 'N';
            this.lastMoveAnchorWorld = world;
          }
        }
      }
    }
    this.currentHoverPos = this.raycaster.getGridPosition(x, y, cam, this.isDragging);
  }

  clearHover(): void {
    this.currentHoverPos = null;
    this.currentHoverWorld = null;
    this.lastMoveAnchorWorld = null;
    this.clearPreview();
    this.clearBulldozePreview();
    this.lastPreviewKey = null;
    this.onDragCostUpdate?.(null);
  }

  startDraw(x: number, y: number): void {
    this.hover(x, y);
    if (!this.currentHoverPos || !this.selectedType) return;
    this.isDragging = true;
    this.dragStartWorld = this.currentHoverWorld ? { ...this.currentHoverWorld } : null;
    if (isRectDragType(this.selectedType)) {
      this.rectDragStart = this.currentHoverPos;
    } else {
      this.lineDragStart = this.currentHoverPos;
    }
  }

  finishDraw(x: number, y: number): void {
    this.hover(x, y);
    if (this.isDragging && this.selectedType && this.currentHoverPos) {
      const type = this.selectedType;
      if (this.lineDragStart && isLineDragType(type)) {
        const orientation = this.computeActiveLineDragOrientation(this.currentCityState);
        const { w, d } = getEffectiveSize(type, orientation);
        const positions = type === BuildingType.UTILITY_POWER_LINE
          ? computeSpacedPowerLinePositions(this.currentCityState, this.lineDragStart, this.currentHoverPos)
          : computeStraightLine(this.lineDragStart, this.currentHoverPos, w, d);
        this.onPaint?.({ positions, type, orientation });
      } else if (this.rectDragStart && isRectDragType(type)) {
        const positions = this.getRectanglePositions(this.rectDragStart, this.currentHoverPos);
        this.onPaint?.({ positions, type, density: this.selectedDensity ?? undefined });
      }
    }

    this.cancelInteraction();
  }

  cancelInteraction(): void {
    this.isDragging = false;
    this.lineDragStart = null;
    this.dragStartWorld = null;
    this.rectDragStart = null;
    this.lastPreviewKey = null;
    this.clearLineDragPreview();
    this.clearRectPreview();
  }

  tap(x: number, y: number): void {
    const cam = this.getCamera();
    const pos = this.raycaster.getGridPosition(x, y, cam);
    if (this.toolMode === 'pointer') {
      if (pos && this.checkEdgeRoadClick(pos)) return;
      const picked = this.currentCityState
        ? this.raycaster.pickBuilding(x, y, cam, this.currentCityState)
        : null;
      this.onSelectBuilding?.(picked);
      return;
    }
    if (!pos) return;
    if (this.toolMode === 'bulldoze') {
      this.demolishArea(pos);
    } else if (this.selectedType && !this.canDraw()) {
      const orientation = this.currentCityState
        ? this.resolveHoverOrientation(this.currentCityState, pos, this.selectedType)
        : undefined;
      this.onPlace?.(pos, this.selectedType, this.selectedDensity ?? undefined, orientation);
    }
  }

  private demolishArea(center: Position): void {
    if (!this.onDemolish) return;
    const half = Math.floor(this.brushSize / 2);
    for (let dx = -half; dx < this.brushSize - half; dx++) {
      for (let dz = -half; dz < this.brushSize - half; dz++) {
        this.onDemolish({ x: center.x + dx, z: center.z + dz }, this.activeLayer);
      }
    }
  }

  demolishAt(x: number, y: number): void {
    const pos = this.raycaster.getGridPosition(x, y, this.getCamera());
    if (pos) this.onDemolish?.(pos, this.activeLayer);
  }

  /**
   * Check if clicked position is an edge road and emit callback for cross-city navigation.
   */
  private checkEdgeRoadClick(pos: Position): boolean {
    if (!this.currentCityState || !this.onEdgeRoadClick) return false;

    // Find building at this position
    const cell = this.currentCityState.grid[pos.x]?.[pos.z];
    if (!cell?.buildingId) return false;

    const building = this.currentCityState.buildings.find((b: PlacedBuilding) => b.id === cell.buildingId);
    if (!building || !isRoad(building.type)) return false;

    // Check if this road is at an edge
    const maxCoord = DEFAULT_GRID_SIZE - 1;
    let direction: EdgeDirection | null = null;
    let edgePosition: number | null = null;

    if (pos.x === 0) {
      direction = 'west';
      edgePosition = pos.z;
    } else if (pos.x === maxCoord) {
      direction = 'east';
      edgePosition = pos.z;
    } else if (pos.z === 0) {
      direction = 'north';
      edgePosition = pos.x;
    } else if (pos.z === maxCoord) {
      direction = 'south';
      edgePosition = pos.x;
    }

    if (direction && edgePosition !== null) {
      return this.onEdgeRoadClick(direction, edgePosition);
    }
    return false;
  }

  private currentCityState: CityState | null = null;

  setCityState(state: CityState | null): void {
    this.currentCityState = state;
  }

  private updateLineDragPreview(state: CityState): void {
    this.clearLineDragPreview();
    if (!this.lineDragStart || !this.currentHoverPos || !this.selectedType) return;

    const type = this.selectedType;
    const isPowerLine = type === BuildingType.UTILITY_POWER_LINE;
    const orientation = this.computeActiveLineDragOrientation(state);
    const flowDir = this.computeActiveDragFlowDir();
    const { w: effW, d: effD } = getEffectiveSize(type, orientation);
    const positions = isPowerLine
      ? computeSpacedPowerLinePositions(state, this.lineDragStart, this.currentHoverPos)
      : computeStraightLine(this.lineDragStart, this.currentHoverPos, effW, effD);
    const strokeCells = new Set(positions.map(p => `${p.x},${p.z}`));
    const conduit = isUtilityConduit(type);

    this.lineDragPreviewGroup = new THREE.Group();
    const w = effW * CELL_SIZE;
    const d = effD * CELL_SIZE;
    const leveled = new Set<string>();
    const validPowerGhosts: PlacedBuilding[] = [];
    let totalCost = 0;
    let gradingCost = 0;

    for (let idx = 0; idx < positions.length; idx++) {
      const pos = positions[idx];
      const placeable = canPlaceBuilding(
        state.grid, pos, type, state.resources, true, state.buildings, undefined, orientation,
      ).valid;
      let segValid = false;
      if (placeable) {
        const quote = getPlacementCost(state.grid, pos, type, undefined, orientation, leveled);
        const nextTotal = totalCost + quote.totalCost;
        segValid = this.canAfford(state, nextTotal);
        totalCost = nextTotal;
        gradingCost += quote.gradingCost;
        for (const cell of quote.gradedCells) {
          leveled.add(`${cell.x},${cell.z}`);
        }
      }

      if (isPowerLine) {
        validPowerGhosts.push({
          id: `__drag_power_${idx}__`,
          type,
          position: pos,
          placedBy: '',
          placedAt: 0,
          orientation,
        });
      }

      let conduitConnections: ConduitConnections | undefined;
      if (conduit && !isPowerLine) {
        if (positions.length === 1) {
          conduitConnections = {
            ...this.computeHoverConduitConnections(state, pos, type, orientation),
            flowDir,
          };
        } else {
          const isLast = idx === positions.length - 1;
          const isFirst = idx === 0;
          const hasAt = (nx: number, nz: number) =>
            strokeCells.has(`${nx},${nz}`) || this.hasMatchingUtilityNeighbor(state, nx, nz, type);
          conduitConnections = {
            n: hasAt(pos.x, pos.z - 1) || (isLast && flowDir === 'N') || (isFirst && flowDir === 'S' && !hasAt(pos.x, pos.z - 1)),
            s: hasAt(pos.x, pos.z + 1) || (isLast && flowDir === 'S') || (isFirst && flowDir === 'N' && !hasAt(pos.x, pos.z + 1)),
            w: hasAt(pos.x - 1, pos.z) || (isLast && flowDir === 'W') || (isFirst && flowDir === 'E' && !hasAt(pos.x - 1, pos.z)),
            e: hasAt(pos.x + 1, pos.z) || (isLast && flowDir === 'E') || (isFirst && flowDir === 'W' && !hasAt(pos.x + 1, pos.z)),
            flowDir,
          };
        }
      }

      const ghost = this.factory.createGhostPreview(
        type, orientation, CITY_STYLES[this.styleId], segValid, conduitConnections,
      );
      // Orient power pylon crossarm perpendicular to the free-angle drag vector
      if (isPowerLine && this.lineDragStart) {
        const sdx = this.currentHoverPos.x - this.lineDragStart.x;
        const sdz = this.currentHoverPos.z - this.lineDragStart.z;
        if (Math.hypot(sdx, sdz) >= 0.5) {
          ghost.rotation.y = Math.atan2(-sdz, sdx);
          if (orientation === 'NS') {
            ghost.rotation.y -= Math.PI / 2;
          }
        }
      }
      ghost.position.set(
        pos.x * CELL_SIZE + w / 2,
        0,
        pos.z * CELL_SIZE + d / 2,
      );
      this.lineDragPreviewGroup.add(ghost);
    }

    if (isPowerLine && validPowerGhosts.length > 0) {
      this.lineDragPreviewGroup.add(
        buildPowerPreviewOverlay(state, validPowerGhosts, POWER_LINE_RADIUS, true),
      );
    }

    this.scene.add(this.lineDragPreviewGroup);

    // Update cost indicator (includes deduplicated terrain-leveling fee)
    this.onDragCostUpdate?.(totalCost, this.canAfford(state, totalCost), gradingCost);
  }

  private clearLineDragPreview(): void {
    if (this.lineDragPreviewGroup) {
      this.scene.remove(this.lineDragPreviewGroup);
      disposePreviewGroup(this.lineDragPreviewGroup);
      this.lineDragPreviewGroup = null;
    }
  }

  private disposePreviewOnly(): void {
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      disposePreviewGroup(this.previewMesh);
      this.previewMesh = null;
      this.previewMeshKey = null;
    }
  }

  private clearPreview(): void {
    this.disposePreviewOnly();
    this.onPreviewClearance?.(null);
  }

  private updateBulldozePreview(state: CityState): void {
    this.clearBulldozePreview();
    if (!this.currentHoverPos) return;

    this.bulldozePreviewGroup = new THREE.Group();
    const half = Math.floor(this.brushSize / 2);
    const seen = new Set<string>();

    for (let dx = -half; dx < this.brushSize - half; dx++) {
      for (let dz = -half; dz < this.brushSize - half; dz++) {
        const x = this.currentHoverPos.x + dx;
        const z = this.currentHoverPos.z + dz;
        if (x < 0 || z < 0 || x >= DEFAULT_GRID_SIZE || z >= DEFAULT_GRID_SIZE) continue;

        const building = findGridBuildingToDemolish(state.grid, state.buildings, { x, z }, this.activeLayer);
        if (!building || seen.has(building.id)) continue;
        seen.add(building.id);

        const { w: effW, d: effD } = getEffectiveSize(building.type, building.orientation);
        const w = effW * CELL_SIZE;
        const d = effD * CELL_SIZE;

        const preview = this.factory.createBulldozePreview(building.type, building.orientation);
        preview.position.set(
          building.position.x * CELL_SIZE + w / 2,
          0,
          building.position.z * CELL_SIZE + d / 2,
        );
        this.bulldozePreviewGroup.add(preview);
      }
    }

    this.scene.add(this.bulldozePreviewGroup);
  }

  private clearBulldozePreview(): void {
    if (this.bulldozePreviewGroup) {
      this.scene.remove(this.bulldozePreviewGroup);
      disposePreviewGroup(this.bulldozePreviewGroup);
      this.bulldozePreviewGroup = null;
    }
  }

  private clearRectPreview(): void {
    if (this.rectPreviewGroup) {
      this.scene.remove(this.rectPreviewGroup);
      disposePreviewGroup(this.rectPreviewGroup);
      this.rectPreviewGroup = null;
    }
  }
}
