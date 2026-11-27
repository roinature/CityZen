import * as THREE from 'three';
import {
  BuildingType,
  CELL_FLAG_POWER,
  CELL_FLAG_SEWAGE,
  CELL_FLAG_WATER,
  CELL_FLAG_WATER_SOURCE,
  CELL_SIZE,
  evaluateCityUtilities,
  getEffectiveSize,
  isPowerConductorBuilding,
  isSewageFacilityBuilding,
  isWaterFacilityBuilding,
  type CityState,
  type UtilityGridReport,
  type UtilityLayer,
} from '@cityzen/shared';

function disposeGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    if (child instanceof THREE.InstancedMesh) child.dispose();
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        for (const m of child.material) m.dispose();
      } else {
        child.material.dispose();
      }
    }
  }
}

/**
 * Renders 3D utility infrastructure and dedicated layer editor overlays:
 * - Overhead Power Lines (`UTILITY_POWER_LINE`): steel pylons & catenary spans
 *   visible in both normal city view and highlighted in the Power Layer.
 * - Dedicated Layer Overlays (`'power' | 'water' | 'sewage'`):
 *   - Groundwater aquifers & shoreline water sources (`'water'`)
 *   - Underground pressurized Water Pipes & junction collars (`'water'`)
 *   - Underground draining Sewage Pipes & manholes (`'sewage'`)
 *   - Coverage zones & per-building powered / watered / drained status markers.
 */
export class UtilityOverlay {
  readonly powerLinesGroup = new THREE.Group();
  readonly layerGroup = new THREE.Group();

  private activeLayer: UtilityLayer = 'surface';
  private lastReport: UtilityGridReport | null = null;

  constructor() {
    this.powerLinesGroup.name = 'utility-power-lines';
    this.layerGroup.name = 'utility-layer-overlay';
    this.layerGroup.visible = false;
  }

  getActiveLayer(): UtilityLayer {
    return this.activeLayer;
  }

  getLastReport(): UtilityGridReport | null {
    return this.lastReport;
  }

  setActiveLayer(layer: UtilityLayer, state: CityState | null): UtilityGridReport | null {
    this.activeLayer = layer;
    this.layerGroup.visible = layer !== 'surface';
    if (!state) {
      this.clear();
      return null;
    }
    return this.rebuild(state);
  }

  rebuild(state: CityState): UtilityGridReport {
    const report = evaluateCityUtilities(state);
    this.lastReport = report;

    this.rebuildOverheadPowerLines(state, report);
    disposeGroup(this.layerGroup);
    if (this.activeLayer !== 'surface') {
      this.rebuildActiveLayer(state, report, this.activeLayer);
    }
    return report;
  }

  clear(): void {
    this.lastReport = null;
    disposeGroup(this.powerLinesGroup);
    disposeGroup(this.layerGroup);
  }

  // ── Overhead Power Lines (Always Visible) ──────────────────

  private rebuildOverheadPowerLines(state: CityState, report: UtilityGridReport): void {
    disposeGroup(this.powerLinesGroup);
    const size = report.gridSize;
    const lines = state.buildings.filter(b => b.type === BuildingType.UTILITY_POWER_LINE);
    if (!lines.length) return;

    const powerHighlight = this.activeLayer === 'power';
    const hasConductorAt = new Uint8Array(size * size);
    const lineStateAt = new Map<number, 'energized' | 'overloaded' | 'unenergized'>();

    for (const b of state.buildings) {
      if (!isPowerConductorBuilding(b.type)) continue;
      const { w, d } = getEffectiveSize(b.type, b.orientation);
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < d; dz++) {
          const cx = b.position.x + dx, cz = b.position.z + dz;
          if (cx >= 0 && cx < size && cz >= 0 && cz < size) {
            hasConductorAt[cx * size + cz] = 1;
          }
        }
      }
      if (b.type === BuildingType.UTILITY_POWER_LINE) {
        const st = report.powerLineState.get(b.id) ?? 'unenergized';
        lineStateAt.set(b.position.x * size + b.position.z, st);
      }
    }

    const pylonHeight = 1.05 * CELL_SIZE;
    const wireY = 0.98 * CELL_SIZE;
    const transform = new THREE.Matrix4();
    const color = new THREE.Color();

    // 1. Steel Pylons + Crossarms
    const poleGeo = new THREE.CylinderGeometry(0.022 * CELL_SIZE, 0.038 * CELL_SIZE, pylonHeight, 7);
    const poleMat = new THREE.MeshStandardMaterial({
      color: powerHighlight ? 0xdbe4ea : 0x7e8a92,
      roughness: 0.6,
      metalness: 0.35,
    });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, lines.length);

    const armGeo = new THREE.BoxGeometry(0.38 * CELL_SIZE, 0.03 * CELL_SIZE, 0.38 * CELL_SIZE);
    const armMat = new THREE.MeshStandardMaterial({ roughness: 0.5 });
    const arms = new THREE.InstancedMesh(armGeo, armMat, lines.length);

    lines.forEach((line, i) => {
      const wx = (line.position.x + 0.5) * CELL_SIZE;
      const wz = (line.position.z + 0.5) * CELL_SIZE;
      transform.makeTranslation(wx, pylonHeight * 0.5, wz);
      poles.setMatrixAt(i, transform);

      transform.makeTranslation(wx, wireY + 0.02 * CELL_SIZE, wz);
      arms.setMatrixAt(i, transform);
      const st = report.powerLineState.get(line.id) ?? 'unenergized';
      const armHex = st === 'energized'
        ? (powerHighlight ? 0xffd54f : 0xcfd8dc)
        : st === 'overloaded'
          ? 0xff9800
          : 0x607d8b;
      arms.setColorAt(i, color.setHex(armHex));
    });
    poles.computeBoundingSphere();
    arms.computeBoundingSphere();
    this.powerLinesGroup.add(poles, arms);

    // 2. Wire Spans connecting orthogonally adjacent conductor cells
    const spans: Array<{ mx: number; mz: number; ew: boolean; state: 'energized' | 'overloaded' | 'unenergized' }> = [];
    for (const line of lines) {
      const { x, z } = line.position;
      const st = lineStateAt.get(x * size + z) ?? 'unenergized';
      // East neighbor
      if (x + 1 < size && hasConductorAt[(x + 1) * size + z]) {
        if (!lineStateAt.has((x + 1) * size + z) || x < x + 1) {
          spans.push({ mx: (x + 1) * CELL_SIZE, mz: (z + 0.5) * CELL_SIZE, ew: true, state: st });
        }
      }
      // South neighbor
      if (z + 1 < size && hasConductorAt[x * size + (z + 1)]) {
        if (!lineStateAt.has(x * size + (z + 1)) || z < z + 1) {
          spans.push({ mx: (x + 0.5) * CELL_SIZE, mz: (z + 1) * CELL_SIZE, ew: false, state: st });
        }
      }
      // West/North tie-ins ONLY if neighbor is a generator/substation (not another power line, to avoid duplicate spans)
      if (x - 1 >= 0 && hasConductorAt[(x - 1) * size + z] && !lineStateAt.has((x - 1) * size + z)) {
        spans.push({ mx: x * CELL_SIZE, mz: (z + 0.5) * CELL_SIZE, ew: true, state: st });
      }
      if (z - 1 >= 0 && hasConductorAt[x * size + (z - 1)] && !lineStateAt.has(x * size + (z - 1))) {
        spans.push({ mx: (x + 0.5) * CELL_SIZE, mz: z * CELL_SIZE, ew: false, state: st });
      }
    }

    if (spans.length > 0) {
      const thickness = (powerHighlight ? 0.055 : 0.022) * CELL_SIZE;
      const wireGeo = new THREE.BoxGeometry(1, thickness, thickness);
      const wireMat = new THREE.MeshBasicMaterial({
        transparent: powerHighlight,
        opacity: powerHighlight ? 0.95 : 1.0,
      });
      const wires = new THREE.InstancedMesh(wireGeo, wireMat, spans.length * 2);
      const rotY = new THREE.Matrix4().makeRotationY(Math.PI / 2);
      const scaleMat = new THREE.Matrix4().makeScale(CELL_SIZE, 1, 1);

      let wi = 0;
      for (const s of spans) {
        const hex = s.state === 'energized'
          ? (powerHighlight ? 0xffeb3b : 0x37474f)
          : s.state === 'overloaded'
            ? 0xff7043
            : (powerHighlight ? 0x78909c : 0x546e7a);
        color.setHex(hex);
        for (const offset of [-0.14 * CELL_SIZE, 0.14 * CELL_SIZE]) {
          const tx = s.ew ? s.mx : s.mx + offset;
          const tz = s.ew ? s.mz + offset : s.mz;
          transform.makeTranslation(tx, wireY, tz);
          if (!s.ew) transform.multiply(rotY);
          transform.multiply(scaleMat);
          wires.setMatrixAt(wi, transform);
          wires.setColorAt(wi, color);
          wi++;
        }
      }
      wires.computeBoundingSphere();
      this.powerLinesGroup.add(wires);
    }
  }

  // ── Dedicated Layer Overlays (Power / Water / Sewage) ──────

  private rebuildActiveLayer(state: CityState, report: UtilityGridReport, layer: Exclude<UtilityLayer, 'surface'>): void {
    const size = report.gridSize;
    const transform = new THREE.Matrix4();
    const color = new THREE.Color();

    // 1. Hydrology Water Source Tiles (in Water Layer)
    if (layer === 'water') {
      const sourceCells: Array<{ x: number; z: number; richness: number; openWater: boolean }> = [];
      for (let x = 0; x < size; x++) {
        for (let z = 0; z < size; z++) {
          const idx = x * size + z;
          if ((report.cellFlags[idx] & CELL_FLAG_WATER_SOURCE) !== 0) {
            sourceCells.push({
              x,
              z,
              richness: report.waterRichness[idx] / 100,
              openWater: state.grid[x]?.[z]?.terrain === 'water',
            });
          }
        }
      }
      if (sourceCells.length > 0) {
        const srcGeo = new THREE.PlaneGeometry(CELL_SIZE * 0.96, CELL_SIZE * 0.96).rotateX(-Math.PI / 2);
        const srcMat = new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0.34,
          depthWrite: false,
        });
        const srcMesh = new THREE.InstancedMesh(srcGeo, srcMat, sourceCells.length);
        srcMesh.renderOrder = 5;
        sourceCells.forEach((c, i) => {
          transform.makeTranslation((c.x + 0.5) * CELL_SIZE, 0.022, (c.z + 0.5) * CELL_SIZE);
          srcMesh.setMatrixAt(i, transform);
          srcMesh.setColorAt(i, color.setHex(c.openWater ? 0x0277bd : c.richness >= 0.8 ? 0x00b0ff : 0x29b6f6));
        });
        srcMesh.computeBoundingSphere();
        this.layerGroup.add(srcMesh);
      }
    }

    // 2. Service Coverage Carpet
    const covMask = layer === 'power' ? CELL_FLAG_POWER : layer === 'water' ? CELL_FLAG_WATER : CELL_FLAG_SEWAGE;
    const covHex = layer === 'power' ? 0xffd54f : layer === 'water' ? 0x4fc3f7 : 0x26a69a;
    const coveredCells: Array<[number, number]> = [];
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        if ((report.cellFlags[x * size + z] & covMask) !== 0) {
          coveredCells.push([x, z]);
        }
      }
    }
    if (coveredCells.length > 0) {
      const covGeo = new THREE.PlaneGeometry(CELL_SIZE * 0.98, CELL_SIZE * 0.98).rotateX(-Math.PI / 2);
      const covMat = new THREE.MeshBasicMaterial({
        color: covHex,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      });
      const covMesh = new THREE.InstancedMesh(covGeo, covMat, coveredCells.length);
      covMesh.renderOrder = 6;
      coveredCells.forEach(([x, z], i) => {
        transform.makeTranslation((x + 0.5) * CELL_SIZE, 0.028, (z + 0.5) * CELL_SIZE);
        covMesh.setMatrixAt(i, transform);
      });
      covMesh.computeBoundingSphere();
      this.layerGroup.add(covMesh);
    }

    // 3. Underground Water / Sewage Pipe Network Meshes
    if (layer === 'water' || layer === 'sewage') {
      this.buildPipeNetworkMesh(state, report, layer);
    }

    // 4. Per-Building Status Indicators (Green/Cyan/Gold = Served, Amber = Partial, Red = Unserved)
    const statusPads: Array<{ x: number; z: number; w: number; d: number; hex: number }> = [];
    for (const b of state.buildings) {
      const st = report.buildings.get(b.id);
      if (!st) continue;
      let hex: number | null = null;

      if (layer === 'power' && st.powerDemandMW > 0 && !b.type.startsWith('road_')) {
        hex = st.powerState === 'powered' ? 0x69f0ae
          : st.powerState === 'brownout' ? 0xffab40
          : 0xff5252;
      } else if (layer === 'water' && st.waterDemandM3 > 0) {
        hex = st.waterState === 'supplied' ? 0x40c4ff
          : st.waterState === 'low_pressure' ? 0xffab40
          : 0xff5252;
      } else if (layer === 'sewage' && st.sewageOutputM3 > 0) {
        hex = st.sewageState === 'drained' ? 0x64ffda
          : st.sewageState === 'backed_up' ? 0xff6e40
          : 0xff5252;
      }

      if (hex !== null) {
        const { w, d } = getEffectiveSize(b.type, b.orientation);
        statusPads.push({ x: b.position.x, z: b.position.z, w, d, hex });
      }
    }

    if (statusPads.length > 0) {
      const padGeo = new THREE.BoxGeometry(1, 0.06 * CELL_SIZE, 1);
      const padMat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      });
      const pads = new THREE.InstancedMesh(padGeo, padMat, statusPads.length);
      pads.renderOrder = 8;
      statusPads.forEach((p, i) => {
        transform
          .makeScale(p.w * CELL_SIZE * 0.86, 1, p.d * CELL_SIZE * 0.86)
          .setPosition((p.x + p.w / 2) * CELL_SIZE, 0.06 * CELL_SIZE, (p.z + p.d / 2) * CELL_SIZE);
        pads.setMatrixAt(i, transform);
        pads.setColorAt(i, color.setHex(p.hex));
      });
      pads.computeBoundingSphere();
      this.layerGroup.add(pads);
    }
  }

  private buildPipeNetworkMesh(
    state: CityState,
    report: UtilityGridReport,
    layer: 'water' | 'sewage',
  ): void {
    const size = report.gridSize;
    const isWater = layer === 'water';
    const pipeType = isWater ? BuildingType.UTILITY_WATER_PIPE : BuildingType.UTILITY_SEWAGE_PIPE;
    const pipes = state.buildings.filter(b => b.type === pipeType);
    if (!pipes.length) return;

    const hasNetworkAt = new Uint8Array(size * size);
    const pipeAt = new Map<number, string>();

    for (const b of state.buildings) {
      const inLayer = b.type === pipeType
        || (isWater ? isWaterFacilityBuilding(b.type) : isSewageFacilityBuilding(b.type));
      if (!inLayer) continue;
      const { w, d } = getEffectiveSize(b.type, b.orientation);
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < d; dz++) {
          const cx = b.position.x + dx, cz = b.position.z + dz;
          if (cx >= 0 && cx < size && cz >= 0 && cz < size) {
            hasNetworkAt[cx * size + cz] = 1;
          }
        }
      }
      if (b.type === pipeType) {
        pipeAt.set(b.position.x * size + b.position.z, b.id);
      }
    }

    const colorForPipe = (id: string): number => {
      if (isWater) {
        const st = report.waterPipeState.get(id) ?? 'dry';
        return st === 'pressurized' ? 0x00b0ff : st === 'low_pressure' ? 0xffa726 : 0x78909c;
      }
      const st = report.sewagePipeState.get(id) ?? 'disconnected';
      return st === 'draining' ? 0x26a69a : st === 'backed_up' ? 0xff7043 : 0x8d6e63;
    };

    const pipeY = 0.14 * CELL_SIZE;
    const radius = 0.105 * CELL_SIZE;
    const transform = new THREE.Matrix4();
    const color = new THREE.Color();

    // Junction hubs on each pipe cell
    const hubGeo = new THREE.CylinderGeometry(radius * 1.28, radius * 1.28, radius * 1.6, 12);
    const hubMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.2 });
    const hubs = new THREE.InstancedMesh(hubGeo, hubMat, pipes.length);
    hubs.renderOrder = 9;

    pipes.forEach((p, i) => {
      transform.makeTranslation((p.position.x + 0.5) * CELL_SIZE, pipeY, (p.position.z + 0.5) * CELL_SIZE);
      hubs.setMatrixAt(i, transform);
      hubs.setColorAt(i, color.setHex(colorForPipe(p.id)));
    });
    hubs.computeBoundingSphere();
    this.layerGroup.add(hubs);

    // Cylindrical pipe segments connecting adjacent pipe/facility cells
    const segs: Array<{ mx: number; mz: number; ew: boolean; hex: number }> = [];
    for (const p of pipes) {
      const { x, z } = p.position;
      const hex = colorForPipe(p.id);
      if (x + 1 < size && hasNetworkAt[(x + 1) * size + z]) {
        segs.push({ mx: (x + 1) * CELL_SIZE, mz: (z + 0.5) * CELL_SIZE, ew: true, hex });
      }
      if (z + 1 < size && hasNetworkAt[x * size + (z + 1)]) {
        segs.push({ mx: (x + 0.5) * CELL_SIZE, mz: (z + 1) * CELL_SIZE, ew: false, hex });
      }
      if (x - 1 >= 0 && hasNetworkAt[(x - 1) * size + z] && !pipeAt.has((x - 1) * size + z)) {
        segs.push({ mx: x * CELL_SIZE, mz: (z + 0.5) * CELL_SIZE, ew: true, hex });
      }
      if (z - 1 >= 0 && hasNetworkAt[x * size + (z - 1)] && !pipeAt.has(x * size + (z - 1))) {
        segs.push({ mx: (x + 0.5) * CELL_SIZE, mz: z * CELL_SIZE, ew: false, hex });
      }
    }

    if (segs.length > 0) {
      const cylGeo = new THREE.CylinderGeometry(radius, radius, CELL_SIZE, 12).rotateZ(Math.PI / 2);
      const cylMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.15 });
      const tubes = new THREE.InstancedMesh(cylGeo, cylMat, segs.length);
      tubes.renderOrder = 9;
      const rotY = new THREE.Matrix4().makeRotationY(Math.PI / 2);

      segs.forEach((s, i) => {
        transform.makeTranslation(s.mx, pipeY, s.mz);
        if (!s.ew) transform.multiply(rotY);
        tubes.setMatrixAt(i, transform);
        tubes.setColorAt(i, color.setHex(s.hex));
      });
      tubes.computeBoundingSphere();
      this.layerGroup.add(tubes);
    }
  }
}
