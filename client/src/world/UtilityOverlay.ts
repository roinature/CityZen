import * as THREE from 'three';
import {
  BuildingType,
  CELL_FLAG_POWER,
  CELL_FLAG_SEWAGE,
  CELL_FLAG_WATER,
  CELL_FLAG_WATER_SOURCE,
  CELL_SIZE,
  POWER_MAX_SPAN,
  computePowerCableSpans,
  evaluateCityUtilities,
  getEffectiveSize,
  isGeneratorBuilding,
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

  // ── Overhead Power Lines & Stretched Catenary Spans (Always Visible) ──

  private rebuildOverheadPowerLines(state: CityState, report: UtilityGridReport): void {
    disposeGroup(this.powerLinesGroup);
    const conductors = state.buildings.filter(b => isPowerConductorBuilding(b.type));
    if (!conductors.length) return;

    const lines = conductors.filter(b => b.type === BuildingType.UTILITY_POWER_LINE);
    const spans = computePowerCableSpans(conductors, POWER_MAX_SPAN);
    if (!lines.length && !spans.length) return;

    const powerHighlight = this.activeLayer === 'power';
    const byId = new Map(conductors.map(b => [b.id, b]));

    const conductorState = (id: string): 'energized' | 'overloaded' | 'unenergized' =>
      report.powerLineState.get(id) ?? (byId.has(id) && isGeneratorBuilding(byId.get(id)!.type) ? 'energized' : 'unenergized');

    // Compute average span tangent per pylon so crossarms rotate perpendicular to cable runs
    const tangentX = new Map<string, number>();
    const tangentZ = new Map<string, number>();
    for (const sp of spans) {
      const dx = sp.bx - sp.ax;
      const dz = sp.bz - sp.az;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len;
      const uz = dz / len;
      for (const id of [sp.fromId, sp.toId]) {
        const px = tangentX.get(id);
        const pz = tangentZ.get(id);
        if (px === undefined || pz === undefined) {
          tangentX.set(id, ux);
          tangentZ.set(id, uz);
        } else {
          // Align vector sign before summing so opposing outgoing cables reinforce the line axis
          const sign = px * ux + pz * uz < 0 ? -1 : 1;
          tangentX.set(id, px + sign * ux);
          tangentZ.set(id, pz + sign * uz);
        }
      }
    }

    const pylonHeight = 1.12 * CELL_SIZE;
    const wireY = 1.02 * CELL_SIZE;
    const transform = new THREE.Matrix4();
    const rotMat = new THREE.Matrix4();
    const color = new THREE.Color();

    // 1. Steel Pylons + Oriented Crossarms + Twin Insulator Bells
    if (lines.length > 0) {
      const poleGeo = new THREE.CylinderGeometry(0.022 * CELL_SIZE, 0.042 * CELL_SIZE, pylonHeight, 8);
      const poleMat = new THREE.MeshStandardMaterial({
        color: powerHighlight ? 0xe2e8f0 : 0x7e8a92,
        roughness: 0.55,
        metalness: 0.38,
      });
      const poles = new THREE.InstancedMesh(poleGeo, poleMat, lines.length);

      const armGeo = new THREE.BoxGeometry(0.055 * CELL_SIZE, 0.036 * CELL_SIZE, 0.54 * CELL_SIZE);
      const armMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.3 });
      const arms = new THREE.InstancedMesh(armGeo, armMat, lines.length);

      const insGeo = new THREE.CylinderGeometry(0.022 * CELL_SIZE, 0.028 * CELL_SIZE, 0.075 * CELL_SIZE, 8);
      const insMat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.1 });
      const insulators = new THREE.InstancedMesh(insGeo, insMat, lines.length * 2);

      lines.forEach((line, i) => {
        const wx = (line.position.x + 0.5) * CELL_SIZE;
        const wz = (line.position.z + 0.5) * CELL_SIZE;
        transform.makeTranslation(wx, pylonHeight * 0.5, wz);
        poles.setMatrixAt(i, transform);

        const tx = tangentX.get(line.id) ?? (line.orientation === 'NS' ? 0 : 1);
        const tz = tangentZ.get(line.id) ?? (line.orientation === 'NS' ? 1 : 0);
        // Box local Z is the wide crossarm axis; rotate around Y so local X aligns with cable tangent (tx, tz)
        const yaw = Math.atan2(-tz, tx);
        rotMat.makeRotationY(yaw);
        transform.makeTranslation(wx, wireY + 0.045 * CELL_SIZE, wz).multiply(rotMat);
        arms.setMatrixAt(i, transform);

        const st = report.powerLineState.get(line.id) ?? 'unenergized';
        const armHex = st === 'energized'
          ? (powerHighlight ? 0xffd54f : 0xcfd8dc)
          : st === 'overloaded'
            ? 0xff9800
            : 0x607d8b;
        arms.setColorAt(i, color.setHex(armHex));

        // Perpendicular unit vector in XZ for the twin insulator bells
        const tLen = Math.hypot(tx, tz) || 1;
        const perpX = (-tz / tLen) * 0.18 * CELL_SIZE;
        const perpZ = (tx / tLen) * 0.18 * CELL_SIZE;
        const insHex = st === 'energized' ? 0xffe082 : st === 'overloaded' ? 0xffab40 : 0x90a4ae;
        color.setHex(insHex);
        for (let side = 0; side < 2; side++) {
          const s = side === 0 ? -1 : 1;
          transform.makeTranslation(wx + s * perpX, wireY + 0.01 * CELL_SIZE, wz + s * perpZ);
          insulators.setMatrixAt(i * 2 + side, transform);
          insulators.setColorAt(i * 2 + side, color);
        }
      });

      poles.computeBoundingSphere();
      arms.computeBoundingSphere();
      insulators.computeBoundingSphere();
      this.powerLinesGroup.add(poles, arms, insulators);
    }

    // 2. Stretched Twin Catenary Overhead Cables (drooping gracefully across up to POWER_MAX_SPAN tiles)
    if (spans.length > 0) {
      const CATENARY_SEGS = 6;
      const radius = (powerHighlight ? 0.026 : 0.013) * CELL_SIZE;
      const chordGeo = new THREE.CylinderGeometry(radius, radius, 1, 6);
      const wireMat = new THREE.MeshBasicMaterial({
        transparent: powerHighlight,
        opacity: powerHighlight ? 0.96 : 1.0,
      });
      const totalChords = spans.length * 2 * CATENARY_SEGS;
      const wires = new THREE.InstancedMesh(chordGeo, wireMat, totalChords);

      const upAxis = new THREE.Vector3(0, 1, 0);
      const p0 = new THREE.Vector3();
      const p1 = new THREE.Vector3();
      const delta = new THREE.Vector3();
      const mid = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scaleVec = new THREE.Vector3();

      let wi = 0;
      for (const sp of spans) {
        const stA = conductorState(sp.fromId);
        const stB = conductorState(sp.toId);
        const state = (stA === 'overloaded' || stB === 'overloaded')
          ? 'overloaded'
          : (stA === 'energized' || stB === 'energized')
            ? 'energized'
            : 'unenergized';

        const hex = state === 'energized'
          ? (powerHighlight ? 0xffeb3b : 0x2f3e46)
          : state === 'overloaded'
            ? 0xff7043
            : (powerHighlight ? 0x78909c : 0x546e7a);
        color.setHex(hex);

        const ax = sp.ax * CELL_SIZE;
        const az = sp.az * CELL_SIZE;
        const bx = sp.bx * CELL_SIZE;
        const bz = sp.bz * CELL_SIZE;
        const dx = bx - ax;
        const dz = bz - az;
        const horizLen = Math.hypot(dx, dz) || 0.001;
        const perpX = (-dz / horizLen) * 0.18 * CELL_SIZE;
        const perpZ = (dx / horizLen) * 0.18 * CELL_SIZE;
        const sagMax = Math.min(0.32, 0.042 * Math.max(1, sp.distance)) * CELL_SIZE;

        for (const side of [-1, 1]) {
          const ox = side * perpX;
          const oz = side * perpZ;
          for (let s = 0; s < CATENARY_SEGS; s++) {
            const t0 = s / CATENARY_SEGS;
            const t1 = (s + 1) / CATENARY_SEGS;
            const y0 = wireY - 4 * sagMax * t0 * (1 - t0);
            const y1 = wireY - 4 * sagMax * t1 * (1 - t1);

            p0.set(ax + dx * t0 + ox, y0, az + dz * t0 + oz);
            p1.set(ax + dx * t1 + ox, y1, az + dz * t1 + oz);
            delta.subVectors(p1, p0);
            const segLen = delta.length();
            mid.addVectors(p0, p1).multiplyScalar(0.5);
            quat.setFromUnitVectors(upAxis, delta.normalize());
            scaleVec.set(1, segLen * 1.02, 1);

            transform.compose(mid, quat, scaleVec);
            wires.setMatrixAt(wi, transform);
            wires.setColorAt(wi, color);
            wi++;
          }
        }
      }
      wires.count = wi;
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

    // Cylindrical pipe segments connecting adjacent pipe/facility cells (plus directional barrel for isolated single tiles)
    const segs: Array<{ mx: number; mz: number; ew: boolean; len: number; hex: number }> = [];
    for (const p of pipes) {
      const { x, z } = p.position;
      const hex = colorForPipe(p.id);
      const hasE = x + 1 < size && Boolean(hasNetworkAt[(x + 1) * size + z]);
      const hasW = x - 1 >= 0 && Boolean(hasNetworkAt[(x - 1) * size + z]);
      const hasS = z + 1 < size && Boolean(hasNetworkAt[x * size + (z + 1)]);
      const hasN = z - 1 >= 0 && Boolean(hasNetworkAt[x * size + (z - 1)]);

      if (!hasE && !hasW && !hasS && !hasN) {
        // Standalone single pipe: orient barrel along its placed build direction
        segs.push({
          mx: (x + 0.5) * CELL_SIZE,
          mz: (z + 0.5) * CELL_SIZE,
          ew: p.orientation !== 'NS',
          len: CELL_SIZE * 0.88,
          hex,
        });
        continue;
      }

      if (hasE) {
        segs.push({ mx: (x + 1) * CELL_SIZE, mz: (z + 0.5) * CELL_SIZE, ew: true, len: CELL_SIZE, hex });
      }
      if (hasS) {
        segs.push({ mx: (x + 0.5) * CELL_SIZE, mz: (z + 1) * CELL_SIZE, ew: false, len: CELL_SIZE, hex });
      }
      if (hasW && !pipeAt.has((x - 1) * size + z)) {
        segs.push({ mx: x * CELL_SIZE, mz: (z + 0.5) * CELL_SIZE, ew: true, len: CELL_SIZE, hex });
      }
      if (hasN && !pipeAt.has(x * size + (z - 1))) {
        segs.push({ mx: (x + 0.5) * CELL_SIZE, mz: z * CELL_SIZE, ew: false, len: CELL_SIZE, hex });
      }
    }

    if (segs.length > 0) {
      const cylGeo = new THREE.CylinderGeometry(radius, radius, 1, 12).rotateZ(Math.PI / 2);
      const cylMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.15 });
      const tubes = new THREE.InstancedMesh(cylGeo, cylMat, segs.length);
      tubes.renderOrder = 9;
      const rotY = new THREE.Matrix4().makeRotationY(Math.PI / 2);
      const scaleMat = new THREE.Matrix4();

      segs.forEach((s, i) => {
        transform.makeTranslation(s.mx, pipeY, s.mz);
        if (!s.ew) transform.multiply(rotY);
        transform.multiply(scaleMat.makeScale(s.len, 1, 1));
        tubes.setMatrixAt(i, transform);
        tubes.setColorAt(i, color.setHex(s.hex));
      });
      tubes.computeBoundingSphere();
      this.layerGroup.add(tubes);
    }
  }
}
