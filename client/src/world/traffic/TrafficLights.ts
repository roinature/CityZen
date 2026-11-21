import * as THREE from 'three';
import { CELL_SIZE } from '@cityzen/shared';
import { DX, DZ, isXAxis, rightOf, type Junction } from './RoadNetwork.js';

export type Light = 'green' | 'yellow' | 'red';

const MIN_GREEN = 4;
const MAX_GREEN = 10;
const YELLOW = 1.6;
const ALL_RED = 0.9;

const POLE_HEIGHT = 0.95;
const LAMP_COLORS: Record<Light, THREE.Color> = {
  red: new THREE.Color(0xff3b30),
  yellow: new THREE.Color(0xffc400),
  green: new THREE.Color(0x30d158),
};
const LAMP_OFF = new THREE.Color(0x2b2b2b);
const LAMP_ORDER: Light[] = ['red', 'yellow', 'green'];

/** Light shown to traffic entering a signalled junction on the given heading. */
export function signalFor(j: Junction, heading: number): Light {
  const axis = isXAxis(heading) ? 0 : 3;
  if (j.phase === axis) return 'green';
  if (j.phase === axis + 1) return 'yellow';
  return 'red';
}

/** Advance a signal's phase; extends green while traffic keeps coming and nobody waits across. */
function stepSignal(j: Junction, dt: number): boolean {
  j.timer += dt;
  const phase = j.phase;
  if (phase === 0 || phase === 3) {
    const here = j.queued[phase === 0 ? 0 : 1];
    const across = j.queued[phase === 0 ? 1 : 0];
    if (j.timer >= MIN_GREEN && across > 0 && (here === 0 || j.timer >= MAX_GREEN)) {
      j.phase++;
      j.timer = 0;
    }
  } else if (phase === 1 || phase === 4) {
    if (j.timer >= YELLOW) { j.phase++; j.timer = 0; }
  } else if (j.timer >= ALL_RED) {
    j.phase = (j.phase + 1) % 6;
    j.timer = 0;
  }
  return j.phase !== phase;
}

interface Head {
  junction: Junction;
  heading: number;
  lampIndex: number;
}

/** Signal timing plus the poles and lamps drawn at signalled junctions. */
export class TrafficLights {
  private group = new THREE.Group();
  private heads: Head[] = [];
  private lamps: THREE.InstancedMesh | null = null;
  private signals: Junction[] = [];

  constructor(private scene: THREE.Scene) {
    this.group.name = 'traffic-lights';
    scene.add(this.group);
  }

  rebuild(junctions: readonly Junction[]): void {
    this.clear();
    this.signals = junctions.filter(j => j.control === 'signal');
    for (const j of this.signals) {
      for (let d = 0; d < 4; d++) {
        if (j.approaches & (1 << d)) this.heads.push({ junction: j, heading: d, lampIndex: this.heads.length * 3 });
      }
    }
    if (!this.heads.length) return;

    const count = this.heads.length;
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x3d4247 });
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.022, 0.03, POLE_HEIGHT, 6), poleMat, count);
    const housings = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), poleMat, count);
    const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.042, 8, 6), new THREE.MeshBasicMaterial(), count * 3);
    poles.castShadow = true;
    housings.castShadow = true;

    const m = new THREE.Object3D();
    this.heads.forEach(({ junction: j, heading: d }, i) => {
      // The near-right corner of the junction as seen by approaching traffic.
      const r = rightOf(d);
      const entry = d === 0 ? j.minX : d === 2 ? j.maxX + 1 : d === 1 ? j.minZ : j.maxZ + 1;
      const side = r === 0 ? j.maxX + 1 : r === 2 ? j.minX : r === 1 ? j.maxZ + 1 : j.minZ;
      const cx = isXAxis(d) ? entry : side;
      const cz = isXAxis(d) ? side : entry;
      const px = (cx - DX[d] * 0.12 + DX[r] * 0.16) * CELL_SIZE;
      const pz = (cz - DZ[d] * 0.12 + DZ[r] * 0.16) * CELL_SIZE;

      m.rotation.set(0, 0, 0);
      m.position.set(px, POLE_HEIGHT / 2, pz);
      m.updateMatrix();
      poles.setMatrixAt(i, m.matrix);

      m.position.set(px, POLE_HEIGHT - 0.12, pz);
      m.updateMatrix();
      housings.setMatrixAt(i, m.matrix);

      // Lamps face the oncoming cars.
      for (let k = 0; k < 3; k++) {
        m.position.set(px - DX[d] * 0.055, POLE_HEIGHT - 0.03 - k * 0.09, pz - DZ[d] * 0.055);
        m.updateMatrix();
        lamps.setMatrixAt(i * 3 + k, m.matrix);
      }
    });

    this.group.add(poles, housings, lamps);
    this.lamps = lamps;
    this.paint();
  }

  update(dt: number): void {
    let changed = false;
    for (const j of this.signals) if (stepSignal(j, dt)) changed = true;
    if (changed) this.paint();
  }

  private paint(): void {
    const lamps = this.lamps;
    if (!lamps) return;
    for (const head of this.heads) {
      const light = signalFor(head.junction, head.heading);
      LAMP_ORDER.forEach((color, k) => {
        lamps.setColorAt(head.lampIndex + k, color === light ? LAMP_COLORS[color] : LAMP_OFF);
      });
    }
    if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
  }

  clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof THREE.InstancedMesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
        child.dispose();
      }
    }
    this.heads = [];
    this.signals = [];
    this.lamps = null;
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.group);
  }
}
