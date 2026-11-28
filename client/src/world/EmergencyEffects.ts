import * as THREE from 'three';
import {
  BUILDING_DEFS,
  CELL_SIZE,
  getEffectiveSize,
  getZoneLevelDef,
  isZone,
  type CityEmergency,
  type CityEmergencyKind,
  type CityState,
  type PlacedBuilding,
  type ZoneType,
} from '@cityzen/shared';

interface Puff {
  mesh: THREE.Mesh;
  phase: number;
  speed: number;
  radius: number;
}

interface VisualEntry {
  emergencyId: string;
  kind: CityEmergencyKind;
  group: THREE.Group;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  beacon: THREE.Group;
  puffs: Puff[];
  baseY: number;
}

const KIND_COLOR: Record<CityEmergencyKind, number> = {
  fire: 0xff5722,
  robbery: 0x2979ff,
  medical: 0xff1744,
  sewage_overflow: 0x8bc34a,
};

function buildingTopY(b: PlacedBuilding): number {
  if (isZone(b.type)) {
    const level = b.developmentLevel ?? 0;
    if (level > 0) {
      return getZoneLevelDef(b.type as ZoneType, b.density, level).height * CELL_SIZE;
    }
    return 0.2;
  }
  return (BUILDING_DEFS[b.type]?.height ?? 1.5) * 0.55 * CELL_SIZE;
}

/**
 * 3D markers and effects on buildings experiencing active city emergencies:
 * - Fire: flickering flames + rising smoke plume + orange ground ring
 * - Robbery: pulsing red/blue police alert beacon + ground ring
 * - Medical: pulsing red/white medical cross + ground ring
 * - Sewage overflow: bubbling toxic green puddle + rising vapor puffs
 */
export class EmergencyEffects {
  readonly group = new THREE.Group();
  private entries = new Map<string, VisualEntry>();
  private time = 0;

  constructor() {
    this.group.name = 'city-emergencies';
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      this.group.remove(entry.group);
      disposeGroup(entry.group);
    }
    this.entries.clear();
  }

  update(deltaTime: number, state: CityState | null): void {
    this.time += deltaTime;
    const emergencies = state?.emergencies ?? [];
    const activeIds = new Set(emergencies.map(e => e.id));

    // Remove finished incidents
    for (const [id, entry] of this.entries) {
      if (!activeIds.has(id)) {
        this.group.remove(entry.group);
        disposeGroup(entry.group);
        this.entries.delete(id);
      }
    }

    if (!state || !emergencies.length) return;

    // Spawn new incident visuals & animate active ones
    for (const em of emergencies) {
      let entry = this.entries.get(em.id);
      if (!entry) {
        const b = state.buildings.find(item => item.id === em.buildingId);
        if (!b) continue;
        entry = this.createVisual(em, b);
        this.entries.set(em.id, entry);
        this.group.add(entry.group);
      }
      this.animateEntry(entry, em, state.tick);
    }
  }

  private createVisual(em: CityEmergency, b: PlacedBuilding): VisualEntry {
    const { w, d } = getEffectiveSize(b.type, b.orientation);
    const cx = (b.position.x + w / 2) * CELL_SIZE;
    const cz = (b.position.z + d / 2) * CELL_SIZE;
    const topY = buildingTopY(b);
    const span = Math.max(w, d) * CELL_SIZE;

    const root = new THREE.Group();
    root.position.set(cx, 0, cz);

    const color = KIND_COLOR[em.kind];

    // Pulsing ground alert ring
    const ringGeom = new THREE.RingGeometry(span * 0.48, span * 0.62, 28);
    ringGeom.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.position.y = 0.05;
    root.add(ring);

    const beacon = new THREE.Group();
    beacon.position.y = topY + 0.45;
    root.add(beacon);

    const puffs: Puff[] = [];

    if (em.kind === 'fire') {
      // Flames + rising dark smoke spheres
      const flameMat = new THREE.MeshStandardMaterial({
        color: 0xff6d00,
        emissive: 0xff3d00,
        emissiveIntensity: 1.6,
        roughness: 0.4,
      });
      const coreMat = new THREE.MeshStandardMaterial({
        color: 0xffea00,
        emissive: 0xffab00,
        emissiveIntensity: 2.0,
        roughness: 0.3,
      });
      for (let i = 0; i < 4; i++) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.14 + (i % 2) * 0.05, 0.42, 7),
          i % 2 === 0 ? flameMat : coreMat,
        );
        const angle = (i / 4) * Math.PI * 2;
        cone.position.set(Math.cos(angle) * 0.14, topY * 0.65 + 0.18, Math.sin(angle) * 0.14);
        root.add(cone);
        puffs.push({ mesh: cone, phase: i * 1.4, speed: 5.5, radius: 0.14 });
      }

      const smokeMat = new THREE.MeshLambertMaterial({
        color: 0x37474f,
        transparent: true,
        opacity: 0.68,
      });
      for (let i = 0; i < 5; i++) {
        const smoke = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18, 0), smokeMat);
        root.add(smoke);
        puffs.push({ mesh: smoke, phase: i / 5, speed: 0.45, radius: topY + 0.15 });
      }
    } else if (em.kind === 'robbery') {
      // Floating exclamation / siren diamond above roof
      const redMat = new THREE.MeshStandardMaterial({
        color: 0xff1744,
        emissive: 0xff1744,
        emissiveIntensity: 1.4,
      });
      const blueMat = new THREE.MeshStandardMaterial({
        color: 0x2979ff,
        emissive: 0x2979ff,
        emissiveIntensity: 1.4,
      });
      const left = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), redMat);
      left.position.x = -0.11;
      const right = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), blueMat);
      right.position.x = 0.11;
      beacon.add(left, right);
    } else if (em.kind === 'medical') {
      // Glowing 3D red/white medical cross
      const crossMat = new THREE.MeshStandardMaterial({
        color: 0xff1744,
        emissive: 0xd50000,
        emissiveIntensity: 1.3,
      });
      const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.38, 0.12), crossMat);
      const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.12), crossMat);
      beacon.add(vBar, hBar);
    } else if (em.kind === 'sewage_overflow') {
      // Bubbling sludge pool around building base + green gas puffs
      const sludgeGeom = new THREE.CircleGeometry(span * 0.56, 20);
      sludgeGeom.rotateX(-Math.PI / 2);
      const sludgeMat = new THREE.MeshStandardMaterial({
        color: 0x558b2f,
        emissive: 0x33691e,
        emissiveIntensity: 0.45,
        roughness: 0.25,
        transparent: true,
        opacity: 0.82,
      });
      const sludge = new THREE.Mesh(sludgeGeom, sludgeMat);
      sludge.position.y = 0.04;
      root.add(sludge);

      const bubbleMat = new THREE.MeshStandardMaterial({
        color: 0x9ccc65,
        emissive: 0x689f38,
        emissiveIntensity: 0.7,
        transparent: true,
        opacity: 0.75,
      });
      for (let i = 0; i < 4; i++) {
        const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), bubbleMat);
        root.add(bubble);
        puffs.push({ mesh: bubble, phase: i / 4, speed: 0.6, radius: span * 0.32 });
      }

      const drop = new THREE.Mesh(
        new THREE.ConeGeometry(0.15, 0.34, 8),
        new THREE.MeshStandardMaterial({ color: 0x7cb342, emissive: 0x558b2f, emissiveIntensity: 1.1 }),
      );
      beacon.add(drop);
    }

    return {
      emergencyId: em.id,
      kind: em.kind,
      group: root,
      ring,
      ringMat,
      beacon,
      puffs,
      baseY: topY,
    };
  }

  private animateEntry(entry: VisualEntry, em: CityEmergency, currentTick: number): void {
    const t = this.time;
    const totalWindow = Math.max(1, em.deadlineTick - em.startedAtTick);
    const elapsed = Math.max(0, currentTick - em.startedAtTick);
    const urgency = em.respondingAtTick ? 0.3 : Math.min(1, elapsed / totalWindow);

    // Pulse faster as deadline approaches
    const pulseRate = 3.5 + urgency * 7;
    const pulse = 0.5 + 0.5 * Math.sin(t * pulseRate);
    entry.ring.scale.setScalar(0.92 + 0.16 * pulse);
    entry.ringMat.opacity = em.respondingAtTick ? 0.35 + 0.2 * pulse : 0.45 + 0.45 * pulse;
    if (em.kind === 'robbery') {
      entry.ringMat.color.setHex(Math.floor(t * 6) % 2 === 0 ? 0xff1744 : 0x2979ff);
    }

    entry.beacon.position.y = entry.baseY + 0.45 + Math.sin(t * 3.2) * 0.1;
    entry.beacon.rotation.y = t * 2.2;

    if (entry.kind === 'fire') {
      for (let i = 0; i < entry.puffs.length; i++) {
        const p = entry.puffs[i];
        if (i < 4) {
          // Flickering flames
          const f = 0.8 + 0.35 * Math.sin(t * p.speed + p.phase);
          p.mesh.scale.set(1, f, 1);
        } else {
          // Rising smoke spheres
          const cycle = (t * p.speed + p.phase) % 1;
          p.mesh.position.set(
            Math.sin(cycle * 5 + p.phase * 6) * 0.12,
            p.radius + cycle * 1.4,
            Math.cos(cycle * 4 + p.phase * 6) * 0.12,
          );
          p.mesh.scale.setScalar(0.6 + cycle * 1.1);
        }
      }
    } else if (entry.kind === 'sewage_overflow') {
      for (const p of entry.puffs) {
        const cycle = (t * p.speed + p.phase) % 1;
        const angle = p.phase * Math.PI * 2;
        p.mesh.position.set(
          Math.cos(angle) * p.radius,
          0.08 + cycle * 0.65,
          Math.sin(angle) * p.radius,
        );
        p.mesh.scale.setScalar(1 - cycle * 0.5);
      }
    }
  }
}

function disposeGroup(group: THREE.Group): void {
  const mats = new Set<THREE.Material>();
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach(m => mats.add(m));
      else mats.add(obj.material);
    }
  });
  for (const m of mats) m.dispose();
}
