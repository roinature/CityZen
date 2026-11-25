import * as THREE from 'three';
import {
  BUILDING_DEFS, BuildingType, CELL_SIZE, ZoneDensity, getEffectiveSize, getZoneLevelDef, isRoad, isZone, type PlacedBuilding, type ZoneType,
} from '@cityzen/shared';
import type { CityStyle } from './CityStyle.js';
import { SIDES, SIDEWALK, WALK_Y, isPaved, type RoadMap } from './RoadSurface.js';
import { hasServiceModel } from './ServiceModels.js';

/** Values of the `kind` attribute the facade shader switches on. */
const HOUSE = 0, SHOP = 1, TOWER = 2, WORKS = 3;

const GROW_SECONDS = 0.6;

interface Unit {
  key: string;
  kind: number;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  wall: number;
  seed: number;
  /** Roof colour that tells a public building from the rest. */
  accent?: number;
}

interface Part {
  mesh: THREE.InstancedMesh;
  index: number;
  unit: Unit;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

export interface CityBuildingsOptions {
  style: CityStyle;
  /** Multiplier on building heights. */
  skyline: number;
}

function hash(x: number, z: number, salt = 0): number {
  let h = Math.imul(x + 11, 374761393) ^ Math.imul(z + 7, 668265263) ^ Math.imul(salt + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const pick = (colors: readonly number[], roll: number) => colors[Math.floor(roll * colors.length) % colors.length];

/** Overshoots slightly past 1 before settling, giving new buildings a little bounce. */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Walls with rows of windows sized in world units, whatever the box's scale,
 * after citygen's facade shader (MIT, see THIRD_PARTY_NOTICES.md). Shops get a
 * glazed ground floor, works get strip windows, and windows light up at night.
 */
function createFacadeMaterial(night: { value: number }): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.02 });
  const varyings = `#include <common>
    varying vec3 vFacade;
    varying vec3 vFacadeNormal;
    varying vec3 vFacadeSize;
    varying vec2 vFacadeInfo;`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = night;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `${varyings}\nattribute vec2 facade;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFacadeSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vFacade = position * vFacadeSize;
        vFacadeNormal = normal;
        vFacadeInfo = facade;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `${varyings}
        uniform float uNight;
        float facadeLit;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        facadeLit = 0.0;
        if (abs(vFacadeNormal.y) < 0.5) {
          bool side = abs(vFacadeNormal.x) > 0.5;
          float span = side ? vFacadeSize.z : vFacadeSize.x;
          float along = (side ? vFacade.z : vFacade.x) + span * 0.5;
          float kind = vFacadeInfo.x;
          float pitch = kind > 2.5 ? 0.34 : kind > 1.5 ? 0.2 : 0.22;
          float floorHeight = kind < 0.5 ? 0.34 : kind > 2.5 ? 0.42 : 0.3;
          // Whole windows only: stretch the spacing to fit the wall.
          float columns = max(1.0, floor(span / pitch + 0.25));
          float floors = max(1.0, floor(vFacadeSize.y / floorHeight + 0.2));
          float u = along / span * columns;
          float v = vFacade.y / vFacadeSize.y * floors;
          float fu = fract(u);
          float fv = fract(v);
          bool ground = v < 1.0;
          bool glass = fu > 0.24 && fu < 0.76 && fv > 0.3 && fv < 0.78;
          if (kind > 2.5) glass = fv > 0.5 && fv < 0.74 && fu > 0.06 && fu < 0.94;
          if (kind > 0.5 && kind < 2.5 && ground) glass = fu > 0.08 && fu < 0.92 && fv > 0.08 && fv < 0.68;
          // Glass towers, for some of the tall ones.
          if (kind > 1.5 && kind < 2.5 && vFacadeInfo.y > 0.62 && !ground) glass = fu > 0.08 && fu < 0.92 && fv > 0.16;
          vec3 wall = diffuseColor.rgb;
          if (glass) {
            vec3 pane = mix(vec3(0.10, 0.14, 0.19), vec3(0.22, 0.30, 0.37), fract(v * 0.37 + u * 0.23 + vFacadeInfo.y));
            diffuseColor.rgb = mix(wall, pane, 0.86);
            float roll = fract(sin(dot(vec2(floor(u), floor(v)) + vFacadeInfo.y * 71.0 + (side ? 13.0 : 0.0), vec2(12.9898, 78.233))) * 43758.5453);
            facadeLit = roll < (ground && kind > 0.5 ? 0.8 : 0.42) ? 0.55 + roll : 0.0;
          } else if (kind > 0.5 && kind < 1.5 && ground && fv > 0.74) {
            // Shop fascia.
            diffuseColor.rgb = wall * vec3(0.55, 0.5, 0.5);
          } else if (fv < 0.045 && kind > 0.5) {
            diffuseColor.rgb = wall * 0.86;
          }
          // Darker at the foot, where wall meets ground.
          diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 0.22, vFacade.y));
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += facadeLit * uNight * mix(vec3(1.0, 0.62, 0.26), vec3(0.62, 0.8, 1.0), step(0.88, vFacadeInfo.y)) * 0.75;`);
  };
  return material;
}

/** All zone buildings, instanced, so the whole city keeps its detail at every zoom. */
export class CityBuildings {
  readonly group = new THREE.Group();
  private night = { value: 0 };
  private known: Set<string> | null = null;
  private growing: Array<{ parts: Part[]; age: number }> = [];
  private highlighted = false;
  private transform = new THREE.Matrix4();

  constructor() {
    this.group.name = 'city-buildings';
  }

  setNight(amount: number): void {
    this.night.value = amount;
  }

  rebuild(buildings: readonly PlacedBuilding[], roads: RoadMap, options: CityBuildingsOptions): void {
    this.disposeMeshes();
    const units = this.layOut(buildings, roads, options);
    this.addUnits(units, options.style);
    this.addZoneTints(buildings);
    this.known = new Set(units.map(unit => unit.key));
  }

  update(deltaTime: number): void {
    if (!this.growing.length) return;
    for (const entry of this.growing) {
      entry.age += deltaTime / GROW_SECONDS;
      this.placeParts(entry.parts, entry.age >= 1 ? 1 : easeOutBack(Math.max(0.02, entry.age)));
    }
    this.growing = this.growing.filter(entry => entry.age < 1);
  }

  highlightZones(highlighted: boolean): void {
    this.highlighted = highlighted;
    for (const child of this.group.children) {
      if (child.name === 'zone-tints') child.visible = highlighted;
    }
  }

  clear(): void {
    this.disposeMeshes();
    this.known = null;
  }

  // ── Layout ────────────────────────────────────────────────

  /** Neighbouring dense lots of the same kind and level share one building. */
  private layOut(buildings: readonly PlacedBuilding[], roads: RoadMap, { style, skyline }: CityBuildingsOptions): Unit[] {
    const lots = new Map<string, PlacedBuilding>();
    for (const b of buildings) {
      if (isZone(b.type) && (b.developmentLevel ?? 0) > 0) lots.set(`${b.position.x},${b.position.z}`, b);
    }
    const taken = new Set<string>();
    const units: Unit[] = [];

    for (const [key, lot] of lots) {
      if (taken.has(key)) continue;
      const { x, z } = lot.position;
      const density = lot.density ?? ZoneDensity.MEDIUM;
      const roll = hash(x, z);
      const matches = (w: number, d: number) => {
        for (let dx = 0; dx < w; dx++) {
          for (let dz = 0; dz < d; dz++) {
            const id = `${x + dx},${z + dz}`;
            const other = lots.get(id);
            if (!other || taken.has(id) || other.type !== lot.type || other.density !== lot.density
              || other.developmentLevel !== lot.developmentLevel) return false;
          }
        }
        return true;
      };
      const shapes: Array<[number, number]> = density === ZoneDensity.HIGH ? [[2, 2], [2, 1], [1, 2]]
        : density === ZoneDensity.MEDIUM || lot.type === BuildingType.ZONE_INDUSTRIAL
          ? (roll < 0.5 ? [[2, 1], [1, 2]] : [[1, 2], [2, 1]]) : [];
      const [w, d] = shapes.find(([sw, sd]) => matches(sw, sd)) ?? [1, 1];
      for (let dx = 0; dx < w; dx++) for (let dz = 0; dz < d; dz++) taken.add(`${x + dx},${z + dz}`);
      units.push(this.unit(lot, w, d, density, roll, roads, style, skyline));
    }
    for (const b of buildings) {
      if (isRoad(b.type) || isZone(b.type) || hasServiceModel(b.type)
        || b.type === BuildingType.PARK || b.type === BuildingType.PARKING) continue;
      units.push(...this.service(b));
    }
    return units;
  }

  /** A public building: a main block with a lower entrance wing, in its own colour. */
  private service(b: PlacedBuilding): Unit[] {
    const def = BUILDING_DEFS[b.type];
    const { w, d } = getEffectiveSize(b.type, b.orientation);
    const { x, z } = b.position;
    const color = new THREE.Color(def.color);
    const accent = color.clone().lerp(new THREE.Color(0x6a6a6a), 0.25).getHex();
    const wall = color.clone().lerp(new THREE.Color(0xf1ece2), 0.82).getHex();
    const seed = hash(x, z, 9) * 0.5;
    const h = 0.5 + def.height * 0.2;
    const base = { kind: SHOP, wall, seed, accent };
    const reach = Math.max(0, Math.min(w, d) - 1) * 0.06;
    const block = (id: string, x0: number, z0: number, x1: number, z1: number, height: number): Unit => ({
      ...base, key: `${b.id}:${id}`, x: x + (x0 + x1) / 2, z: z + (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, h: height,
    });
    const i = SIDEWALK + 0.04 + reach;
    if (w === 1 || d === 1) return [block('main', i, i, w - i, d - i, h)];
    const split = d * 0.6;
    return [
      block('main', i, i, w - i, split, h),
      block('wing', i + w * 0.14, split, w - i - w * 0.14, d - i, h * 0.6),
    ];
  }

  private unit(
    lot: PlacedBuilding, w: number, d: number, density: ZoneDensity, roll: number,
    roads: RoadMap, style: CityStyle, skyline: number,
  ): Unit {
    const { x, z } = lot.position;
    const level = lot.developmentLevel!;
    const roll2 = hash(x, z, 5);
    const suburban = lot.type === BuildingType.ZONE_RESIDENTIAL && density === ZoneDensity.LOW;
    // Keep clear of the sidewalk on every side that fronts a street.
    const front = SIDES.map(([dx, dz]) => {
      for (let i = 0; i < w; i++) {
        for (let k = 0; k < d; k++) if (isPaved(roads.get(`${x + i + dx},${z + k + dz}`)?.type)) return true;
      }
      return false;
    });
    const gap = suburban ? 0.14 : density === ZoneDensity.HIGH ? 0.05 : 0.06;
    const inset = front.map(facing => facing ? SIDEWALK + (suburban ? 0.07 : 0.02) : gap);
    const x0 = x + inset[2], x1 = x + w - inset[0];
    const z0 = z + inset[3], z1 = z + d - inset[1];
    let bw = x1 - x0, bd = z1 - z0;
    let cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;

    let kind = TOWER;
    let wall = pick(style.downtown, roll2);
    const base = getZoneLevelDef(lot.type as ZoneType, lot.density, level).height;
    let h: number;
    if (suburban) {
      kind = HOUSE;
      wall = pick(style.houses, roll2);
      h = 0.3 + level * 0.07 + roll * 0.06;
      // Houses vary in size and sit towards the street.
      const sw = Math.min(bw, 0.52 + roll * 0.12), sd = Math.min(bd, 0.46 + roll2 * 0.12);
      cx += (front[0] ? 1 : 0) * (bw - sw) / 2 - (front[2] ? 1 : 0) * (bw - sw) / 2;
      cz += (front[1] ? 1 : 0) * (bd - sd) / 2 - (front[3] ? 1 : 0) * (bd - sd) / 2;
      bw = sw;
      bd = sd;
    } else if (lot.type === BuildingType.ZONE_INDUSTRIAL) {
      kind = WORKS;
      wall = pick(style.industry, roll2);
      h = 0.45 + base * 0.1;
    } else if (lot.type === BuildingType.ZONE_COMMERCIAL && density !== ZoneDensity.HIGH) {
      kind = SHOP;
      wall = pick(style.shops, roll2);
      h = base * (density === ZoneDensity.LOW ? 0.24 : 0.32) * (0.85 + roll * 0.3);
    } else if (density === ZoneDensity.MEDIUM) {
      wall = pick(style.apartments, roll2);
      h = base * 0.36 * (0.85 + roll * 0.3);
    } else {
      // Uneven heights make a skyline; a few landmarks stand above the rest.
      h = base * (w * d > 1 ? 0.5 : 0.36) * (0.7 + roll * 0.45 + (roll2 > 0.9 ? 0.35 : 0));
    }
    if (kind === TOWER || kind === SHOP) h = Math.max(0.45, h * skyline);

    return { key: `${lot.id}:${level}`, kind, x: cx, z: cz, w: bw, d: bd, h, wall, seed: hash(x, z, 9) };
  }

  // ── Meshes ────────────────────────────────────────────────

  private addUnits(units: Unit[], style: CityStyle): void {
    if (!units.length) return;
    type Draft = Omit<Part, 'mesh' | 'index'> & { color: number };
    const walls: Draft[] = [];
    const slabs: Draft[] = [];
    const hips: Draft[] = [];
    const stacks: Draft[] = [];
    const foot = 0.03;

    for (const u of units) {
      const part = (list: Draft[], y: number, w: number, h: number, d: number, color: number, x = u.x, z = u.z) =>
        list.push({ unit: u, x, y, z, w, h, d, color });
      if (u.kind === HOUSE) {
        part(walls, foot, u.w, u.h, u.d, u.wall);
        part(hips, foot + u.h, u.w * 1.14, Math.min(u.w, u.d) * 0.46, u.d * 1.14, pick(style.houseRoofs, u.seed));
        part(stacks, foot + u.h, 0.06, Math.min(u.w, u.d) * 0.42, 0.06, 0x8a6a58, u.x + u.w * 0.24, u.z + u.d * 0.16);
        continue;
      }
      // The tallest step back near the top.
      const stepped = u.kind === TOWER && u.h > 3.2 && u.seed < 0.55;
      const main = stepped ? u.h * 0.72 : u.h;
      const roof = (y: number, w: number, d: number) => {
        part(slabs, y, w + 0.03, 0.045, d + 0.03, style.walk);
        part(slabs, y + 0.045, w - 0.04, 0.012, d - 0.04, u.accent ?? style.flatRoof);
      };
      part(walls, foot, u.w, main, u.d, u.wall);
      roof(foot + main, u.w, u.d);
      let w = u.w, d = u.d;
      if (stepped) {
        w *= 0.72;
        d *= 0.72;
        part(walls, foot + main + 0.04, w, u.h - main, d, u.wall);
        roof(foot + u.h + 0.04, w, d);
      }
      const top = foot + u.h + (stepped ? 0.09 : 0.05);
      if (u.kind === WORKS) {
        // Ridged roof lights and a chimney.
        const bays = Math.max(1, Math.round(w / 0.45));
        for (let i = 0; i < bays; i++) {
          part(slabs, top, w / bays * 0.6, 0.09, d * 0.82, style.industry[0], u.x - w / 2 + (i + 0.5) * w / bays);
        }
        if (u.seed > 0.45) part(stacks, top, 0.1, 0.5 + u.seed * 0.5, 0.1, 0x9b7a66, u.x + w * 0.36, u.z - d * 0.36);
      } else {
        part(slabs, top, w * 0.3, 0.1 + u.seed * 0.08, d * 0.28, style.kerb, u.x + (u.seed - 0.5) * w * 0.4, u.z + (0.5 - u.seed) * d * 0.4);
        if (u.kind === TOWER && u.h > 5 && u.seed > 0.4) part(stacks, top, 0.035, 0.7, 0.035, 0xd8dadc);
      }
    }

    const box = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const hip = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
    const plain = () => new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
    const byUnit = new Map<Unit, Part[]>();
    const color = new THREE.Color();

    const add = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, drafts: Draft[]) => {
      if (!drafts.length) {
        geometry.dispose();
        material.dispose();
        return;
      }
      const mesh = new THREE.InstancedMesh(geometry, material, drafts.length);
      mesh.name = name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      drafts.forEach((draft, index) => {
        mesh.setColorAt(index, color.setHex(draft.color));
        const part: Part = { ...draft, mesh, index };
        const list = byUnit.get(draft.unit);
        if (list) list.push(part);
        else byUnit.set(draft.unit, [part]);
      });
      this.group.add(mesh);
      return mesh;
    };

    const wallGeometry = box();
    const facade = new Float32Array(walls.length * 2);
    walls.forEach(({ unit }, i) => {
      facade[i * 2] = unit.kind;
      facade[i * 2 + 1] = unit.seed;
    });
    wallGeometry.setAttribute('facade', new THREE.InstancedBufferAttribute(facade, 2));
    add('walls', wallGeometry, createFacadeMaterial(this.night), walls);
    add('roofs', box(), plain(), slabs);
    add('house-roofs', hip, plain(), hips);
    add('chimneys', box(), plain(), stacks);

    for (const [unit, parts] of byUnit) {
      this.placeParts(parts, 1);
      if (this.known && !this.known.has(unit.key)) this.growing.push({ parts, age: 0 });
    }
    for (const child of this.group.children) if (child instanceof THREE.InstancedMesh) child.computeBoundingSphere();
    for (const { parts } of this.growing) this.placeParts(parts, 0.02);
  }

  private placeParts(parts: Part[], scale: number): void {
    for (const { mesh, index, x, y, z, w, h, d } of parts) {
      this.transform.makeScale(w * CELL_SIZE, h * scale * CELL_SIZE, d * CELL_SIZE)
        .setPosition(x * CELL_SIZE, y * scale * CELL_SIZE, z * CELL_SIZE);
      mesh.setMatrixAt(index, this.transform);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Zone colours: faint on empty lots, and over every lot while zoning. */
  private addZoneTints(buildings: readonly PlacedBuilding[]): void {
    const colors = {
      [BuildingType.ZONE_RESIDENTIAL]: 0x66bb6a,
      [BuildingType.ZONE_COMMERCIAL]: 0x42a5f5,
      [BuildingType.ZONE_INDUSTRIAL]: 0xffa726,
    } as Record<BuildingType, number>;
    const zones = buildings.filter(b => isZone(b.type));
    const add = (list: PlacedBuilding[], opacity: number, y: number, size: number, name: string) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
        new THREE.MeshLambertMaterial({ transparent: true, opacity, depthWrite: false }),
        list.length,
      );
      mesh.name = name;
      const color = new THREE.Color();
      list.forEach((b, i) => {
        this.transform.makeTranslation((b.position.x + 0.5) * CELL_SIZE, y, (b.position.z + 0.5) * CELL_SIZE);
        mesh.setMatrixAt(i, this.transform);
        mesh.setColorAt(i, color.setHex(colors[b.type]));
      });
      mesh.computeBoundingSphere();
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    add(zones.filter(b => !b.developmentLevel), 0.2, 0.016, 0.96 * CELL_SIZE, 'empty-lots');
    const tints = add(zones, 0.6, WALK_Y + 0.015, 0.98 * CELL_SIZE, 'zone-tints');
    if (tints) tints.visible = this.highlighted;
  }

  private disposeMeshes(): void {
    this.growing = [];
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (!(child instanceof THREE.InstancedMesh)) continue;
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
      child.dispose();
    }
  }
}
