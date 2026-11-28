import * as THREE from 'three';
import {
  BUILDING_DEFS, BuildingType, CELL_SIZE, ZoneDensity, getEffectiveSize, getZoneLevelDef,
  isRoad, isUtilityConduit, isZone,
  type PlacedBuilding, type RoadOrientation, type ZoneType,
} from '@cityzen/shared';
import type { CityStyle } from './CityStyle.js';
import { SIDES, SIDEWALK, WALK_Y, isPaved, type RoadMap } from './RoadSurface.js';
import { hasServiceModel } from './ServiceModels.js';
import {
  buildCivicGarageBayMesh,
  findDepotDriveway,
  isFleetBuilding,
  type DrivewayFacing,
} from './DepotDriveway.js';
import type { Obstacle } from './explore/ObstacleMap.js';

/** Values of the `kind` attribute the facade shader switches on. */
const HOUSE = 0, SHOP = 1, TOWER = 2, WORKS = 3;

const GROW_SECONDS = 0.6;

export interface GridRect {
  x: number;
  z: number;
  w: number;
  d: number;
}

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
  /** Grid footprint for zone units so placement hover can temporarily clear them. */
  cells?: GridRect;
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

type RoofDraft = Omit<Part, 'mesh' | 'index'> & { color: number };
interface RoofLists {
  part: (list: RoofDraft[], y: number, w: number, h: number, d: number, color: number, x?: number, z?: number) => void;
  slabs: RoofDraft[];
  stacks: RoofDraft[];
  kit: RoofDraft[];
  drums: RoofDraft[];
  caps: RoofDraft[];
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
 *
 * Glass is smooth and mirrors a made-up surrounding: sky, a ragged skyline of
 * neighbouring buildings (their windows lit at night) and the street. No two
 * panes sit quite in one plane, so each mirrors a slightly different piece of
 * it. The reflection goes in as three's environment light, so fresnel and the
 * sun's (shadowed) glint come out of the standard lighting. After
 * manhattan-free-roam (MIT, see THIRD_PARTY_NOTICES.md).
 */
function createFacadeMaterial(night: { value: number }): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.04 });
  material.customProgramCacheKey = () => 'cityzen-facade-v2';
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
        float facadeLit;
        float facadeGlass;
        vec2 facadePane;
        vec3 facadeBillboard;
        float facadeHash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        vec3 billboardPalette(float idx) {
          float m = mod(floor(idx), 6.0);
          if (m < 0.5) return vec3(0.06, 0.72, 1.0);   // electric cyan
          if (m < 1.5) return vec3(1.0, 0.16, 0.48);   // Times Square magenta
          if (m < 2.5) return vec3(1.0, 0.45, 0.05);   // vibrant orange
          if (m < 3.5) return vec3(0.16, 0.36, 1.0);   // cobalt blue
          if (m < 4.5) return vec3(0.98, 0.82, 0.12);  // bright gold
          return vec3(0.62, 0.24, 1.0);                // neon violet
        }
        // What glass mirrors in world direction r (linear colour). seed: the building's own number.
        vec3 facadeReflection(vec3 r, float seed) {
          float level = max(length(r.xz), 1e-3);
          float elev = r.y / level;
          vec3 horizon = mix(vec3(0.76, 0.85, 0.96), vec3(0.018, 0.024, 0.055), uNight);
          vec3 zenith = mix(vec3(0.14, 0.40, 0.86), vec3(0.004, 0.008, 0.022), uNight);
          vec3 c = mix(horizon, zenith, smoothstep(0.0, 1.05, elev));
          // soft reflected clouds in the upper sky
          float cloudBand = smoothstep(0.18, 0.65, elev) * (1.0 - uNight);
          float cl = sin(r.x * 5.0 + seed * 12.0) * cos(r.z * 4.5 - seed * 7.0);
          c = mix(c, vec3(0.96, 0.97, 1.0), smoothstep(0.25, 0.85, cl) * cloudBand * 0.45);
          // the buildings across the street: a ragged skyline, filling everything below it
          float az = atan(r.z, r.x) * 6.0 + seed * 40.0;
          float block = floor(az);
          float tall = 0.05 + 0.52 * pow(facadeHash(vec2(block, floor(seed * 9.0))), 2.0);
          float there = (1.0 - smoothstep(tall - 0.015, tall + 0.015, elev)) * step(0.08, fract(az));
          float shade = facadeHash(vec2(block, 11.0));
          vec3 wall = mix(vec3(0.12, 0.14, 0.18), vec3(0.38, 0.36, 0.33), shade) * mix(1.0, 0.08, uNight);
          vec2 g = vec2(az * 8.0, elev * 40.0);
          // their windows, faded out once smaller than a pixel so the far city does not shimmer
          float fine = 1.0 - smoothstep(0.25, 0.5, max(fwidth(g.x), fwidth(g.y)));
          float pane = step(0.35, fract(g.x)) * step(0.4, fract(g.y)) * fine;
          wall *= 1.0 - 0.32 * pane * (1.0 - uNight);
          wall += vec3(1.0, 0.65, 0.32) * pane * step(0.68, facadeHash(floor(g) + block)) * uNight * 0.85;
          c = mix(c, wall, there);
          // and, looking steeply down, the street
          vec3 street = mix(vec3(0.09, 0.10, 0.12), vec3(0.008, 0.01, 0.016), uNight);
          return mix(c, street, smoothstep(-0.5, -1.4, elev));
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        facadeLit = 0.0;
        facadeGlass = 0.0;
        facadePane = vec2(0.0);
        facadeBillboard = vec3(0.0);
        if (abs(vFacadeNormal.y) < 0.5) {
          bool side = abs(vFacadeNormal.x) > 0.5;
          float span = side ? vFacadeSize.z : vFacadeSize.x;
          float along = (side ? vFacade.z : vFacade.x) + span * 0.5;
          float kind = vFacadeInfo.x;
          float seed = vFacadeInfo.y;
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

          // Times Square-style glowing LED billboards on select commercial / downtown facades
          float faceSignSeed = facadeHash(vec2(floor(seed * 97.0), side ? 3.0 : 7.0));
          bool hasBillboard = (kind > 0.5 && kind < 2.5) && floors >= 2.5 && span >= 0.48
            && faceSignSeed > 0.62 && v >= 1.05 && v < min(floors - 0.35, kind > 1.5 ? 6.5 : 3.6)
            && along > 0.04 && along < span - 0.04;

          if (hasBillboard) {
            // Split billboard zone into 1..3 bold adjacent LED screen panels
            float panelCols = span > 1.1 ? 3.0 : (span > 0.7 ? 2.0 : 1.0);
            float pu = (along - 0.04) / max(span - 0.08, 0.01) * panelCols;
            float pv = (v - 1.05) / max(min(floors - 0.35, kind > 1.5 ? 6.5 : 3.6) - 1.05, 0.5);
            float pfu = fract(pu);
            float pfv = fract(pv * (kind > 1.5 ? 2.0 : 1.0));
            vec2 panelId = vec2(floor(pu) + floor(seed * 53.0), floor(pv * (kind > 1.5 ? 2.0 : 1.0)) + (side ? 11.0 : 0.0));
            bool bezel = pfu < 0.045 || pfu > 0.955 || pfv < 0.055 || pfv > 0.945;
            if (bezel) {
              diffuseColor.rgb = vec3(0.05, 0.06, 0.08);
            } else {
              float style = facadeHash(panelId);
              vec3 c1 = billboardPalette(style * 6.0);
              vec3 c2 = billboardPalette(style * 6.0 + 2.0 + floor(facadeHash(panelId + 4.1) * 3.0));
              vec3 c3 = vec3(0.98, 0.99, 1.0);
              vec3 graphic = c1;
              if (style < 0.33) {
                // Bold horizontal neon stripes + bright headline band
                float stripe = step(0.5, fract(pfv * 6.0));
                graphic = mix(c1, c2, stripe);
                if (pfv > 0.28 && pfv < 0.62 && pfu > 0.14 && pfu < 0.86) graphic = mix(c3, c2, 0.25);
              } else if (style < 0.66) {
                // Framed poster with bold geometric centre block and accent border
                bool inner = pfu > 0.14 && pfu < 0.86 && pfv > 0.18 && pfv < 0.82;
                bool banner = pfv < 0.30 && pfu > 0.12 && pfu < 0.88;
                graphic = banner ? c2 : (inner ? c1 : mix(c2, c3, 0.35));
                if (inner && pfv > 0.42 && pfv < 0.58) graphic = c3;
              } else {
                // Diagonal color-block graphic
                float diag = step(0.0, (pfu - 0.5) + (pfv - 0.5) * 0.85);
                graphic = mix(c1, c2, diag);
                if (length(vec2(pfu - 0.5, (pfv - 0.5) * 1.2)) < 0.24) graphic = c3;
              }
              // Subtle LED pixel matrix scanlines
              float led = 0.90 + 0.10 * step(0.18, fract(pfu * 24.0)) * step(0.18, fract(pfv * 18.0));
              diffuseColor.rgb = graphic * 0.22;
              facadeBillboard = graphic * led * mix(1.05, 1.55, uNight);
              facadeGlass = 0.25;
            }
          } else {
            bool glass = fu > 0.22 && fu < 0.78 && fv > 0.28 && fv < 0.80;
            bool frame = !glass && fu > 0.17 && fu < 0.83 && fv > 0.23 && fv < 0.85;
            if (kind > 2.5) {
              glass = fv > 0.48 && fv < 0.76 && fu > 0.06 && fu < 0.94;
              frame = false;
            }
            if (kind > 0.5 && kind < 2.5 && ground) {
              glass = fu > 0.07 && fu < 0.93 && fv > 0.06 && fv < 0.70;
              frame = false;
            }
            // Glass curtain-wall towers for tall modern skyscrapers
            bool curtain = kind > 1.5 && kind < 2.5 && seed > 0.52 && !ground;
            if (curtain) {
              glass = fu > 0.07 && fu < 0.93 && fv > 0.14 && fv < 0.94;
              frame = !glass;
            }
            vec3 wall = diffuseColor.rgb;
            if (glass) {
              facadeGlass = curtain ? 1.0 : 0.78;
              facadePane = vec2(floor(u), floor(v)) + (side ? vec2(0.5, 0.0) : vec2(0.0));
              float paneVar = facadeHash(facadePane + seed * 19.0);
              vec3 pane = mix(vec3(0.06, 0.11, 0.18), vec3(0.18, 0.28, 0.38), paneVar);
              // Subtle interior blind / top shadow inside each window recess
              float recess = mix(0.68, 1.0, smoothstep(0.80, 0.55, fv));
              diffuseColor.rgb = mix(wall, pane * recess, curtain ? 0.92 : 0.88);
              float roll = fract(sin(dot(vec2(floor(u), floor(v)) + seed * 71.0 + (side ? 13.0 : 0.0), vec2(12.9898, 78.233))) * 43758.5453);
              facadeLit = roll < (ground && kind > 0.5 ? 0.84 : 0.45) ? 0.6 + roll : 0.0;
            } else {
              // Subtle masonry / architectural paneling grain
              float brick = facadeHash(floor(vec2(along * 18.0, vFacade.y * 28.0)));
              wall *= 0.94 + brick * 0.12;
              if (curtain && frame) {
                // Dark metallic curtain-wall mullions & spandrel bands
                wall = wall * 0.42 + vec3(0.05, 0.07, 0.10);
              } else if (frame && kind < 2.5) {
                // Recessed window frame + lighter stone sill
                wall *= fv < 0.28 ? 1.12 : 0.66;
              } else if (kind > 0.5 && kind < 2.5 && ground && fv > 0.72) {
                // Dark storefront canopy / cornice separating ground retail from upper floors
                wall = wall * vec3(0.32, 0.33, 0.38);
              } else if (fv < 0.06 && kind > 0.5) {
                // Horizontal architectural belt course / cornice shadow
                wall *= 0.80;
              }
              diffuseColor.rgb = wall;
            }
          }
          // Darker at the foot, where wall meets sidewalk (ambient occlusion).
          diffuseColor.rgb *= mix(0.66, 1.0, smoothstep(0.0, 0.26, vFacade.y));
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += facadeBillboard;
        totalEmissiveRadiance += facadeLit * uNight * mix(vec3(1.0, 0.65, 0.28), vec3(0.62, 0.82, 1.0), step(0.85, vFacadeInfo.y)) * 0.9;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        if (facadeGlass > 0.0) roughnessFactor = mix(0.22, 0.05, facadeGlass);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (facadeGlass > 0.5) {
          // each pane tilted a hair, sideways and up or down
          vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
          vec3 along = normalize(cross(vec3(0.0, 1.0, 0.0), worldNormal));
          float a = facadeHash(facadePane + vFacadeInfo.y * 31.0) - 0.5;
          float b = facadeHash(facadePane.yx + vFacadeInfo.y * 17.0 + 5.0) - 0.5;
          vec3 tilted = normalize(worldNormal + along * a * 0.08 + vec3(0.0, b * 0.06, 0.0));
          normal = normalize((viewMatrix * vec4(tilted, 0.0)).xyz);
        }`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        if (facadeGlass > 0.0) material.specularColor = mix(material.specularColor, vec3(0.09, 0.11, 0.13), facadeGlass);`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        if (facadeGlass > 0.5) {
          vec3 mirrored = inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix);
          radiance += facadeReflection(mirrored, vFacadeInfo.y) * facadeGlass * 2.3;
        }`);
  };
  return material;
}

/** All zone buildings, instanced, so the whole city keeps its detail at every zoom. */
export class CityBuildings {
  readonly group = new THREE.Group();
  private night = { value: 0 };
  private known: Set<string> | null = null;
  private growing: Array<{ unit: Unit; parts: Part[]; age: number }> = [];
  private zoneUnitParts: Array<{ cells: GridRect; unit: Unit; parts: Part[] }> = [];
  private hiddenUnits = new Set<Unit>();
  private clearedRect: GridRect | null = null;
  private highlighted = false;
  private layerOpacity = 1;
  private transform = new THREE.Matrix4();
  private footprints: Obstacle[] = [];

  constructor() {
    this.group.name = 'city-buildings';
  }

  /** Ground footprint and height of every building, in cells. */
  getFootprints(): readonly Obstacle[] {
    return this.footprints;
  }

  setNight(amount: number): void {
    this.night.value = amount;
  }

  rebuild(buildings: readonly PlacedBuilding[], roads: RoadMap, options: CityBuildingsOptions): void {
    this.disposeMeshes();
    const units = this.layOut(buildings, roads, options);
    this.footprints = units.map(u => {
      // Hipped roofs overhang the walls; flat roofs carry plant.
      const roof = u.kind === HOUSE ? Math.min(u.w, u.d) * 0.46 : 0.12;
      const grow = u.kind === HOUSE ? 1.14 : 1;
      return {
        x0: u.x - u.w * grow / 2, x1: u.x + u.w * grow / 2,
        z0: u.z - u.d * grow / 2, z1: u.z + u.d * grow / 2,
        top: 0.03 + u.h + roof,
      };
    });
    this.addUnits(units, options.style, this.group, true);
    this.addZoneTints(buildings);
    this.known = new Set(units.map(unit => unit.key));
    if (this.clearedRect) this.applyPreviewClearance(this.clearedRect);
    if (this.layerOpacity < 1) this.applyLayerOpacity();
  }

  /** Fades surface buildings into translucent silhouettes during underground utility editing. */
  setLayerOpacity(opacity: number): void {
    if (this.layerOpacity === opacity) return;
    this.layerOpacity = opacity;
    this.applyLayerOpacity();
  }

  private applyLayerOpacity(): void {
    const translucent = this.layerOpacity < 0.99;
    for (const child of this.group.children) {
      if (!(child instanceof THREE.InstancedMesh)) continue;
      if (child.name === 'empty-lots' || child.name === 'zone-tints') continue;
      const mat = child.material as THREE.Material;
      mat.transparent = translucent;
      mat.opacity = this.layerOpacity;
      mat.depthWrite = !translucent;
      mat.needsUpdate = true;
    }
  }

  update(deltaTime: number): void {
    if (!this.growing.length) return;
    for (const entry of this.growing) {
      entry.age += deltaTime / GROW_SECONDS;
      if (!this.hiddenUnits.has(entry.unit)) {
        this.placeParts(entry.parts, entry.age >= 1 ? 1 : easeOutBack(Math.max(0.02, entry.age)));
      }
    }
    this.growing = this.growing.filter(entry => entry.age < 1);
  }

  /** Temporarily hides developed zone buildings overlapping a valid build preview footprint. */
  setPreviewClearance(rect: GridRect | null): void {
    this.clearedRect = rect;
    this.applyPreviewClearance(rect);
  }

  private applyPreviewClearance(rect: GridRect | null): void {
    const nextHidden = new Set<Unit>();
    if (rect) {
      for (const { cells, unit } of this.zoneUnitParts) {
        if (cells.x < rect.x + rect.w && cells.x + cells.w > rect.x
          && cells.z < rect.z + rect.d && cells.z + cells.d > rect.z) {
          nextHidden.add(unit);
        }
      }
    }
    for (const { unit, parts } of this.zoneUnitParts) {
      const wasHidden = this.hiddenUnits.has(unit);
      const isHidden = nextHidden.has(unit);
      if (wasHidden && !isHidden) this.placeParts(parts, 1);
      else if (!wasHidden && isHidden) this.placeParts(parts, 0);
    }
    this.hiddenUnits = nextHidden;
  }

  highlightZones(highlighted: boolean): void {
    this.highlighted = highlighted;
    for (const child of this.group.children) {
      if (child.name === 'zone-tints') child.visible = highlighted;
    }
  }

  clear(): void {
    this.disposeMeshes();
    this.footprints = [];
    this.known = null;
  }

  /** Builds a standalone 3D model for a civic service building centered at (0, 0, 0). */
  static createServiceModelMesh(
    type: BuildingType,
    style: CityStyle,
    orientation?: RoadOrientation,
    drivewayFacing: DrivewayFacing = 'S',
  ): THREE.Group {
    const { w, d } = getEffectiveSize(type, orientation);
    const builder = new CityBuildings();
    const units = CityBuildings.layoutServiceUnits(type, -w / 2, -d / 2, 'preview', orientation, drivewayFacing);
    const group = new THREE.Group();
    const plaza = new THREE.Mesh(
      new THREE.BoxGeometry(w * CELL_SIZE, 0.028 * CELL_SIZE, d * CELL_SIZE),
      new THREE.MeshStandardMaterial({ color: style.concrete, roughness: 0.95 }),
    );
    plaza.position.y = 0.014 * CELL_SIZE;
    group.add(plaza);
    builder.addUnits(units, style, group, false);
    if (isFleetBuilding(type)) {
      group.add(buildCivicGarageBayMesh(type, style, drivewayFacing, orientation));
    }
    return group;
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
      if (isRoad(b.type) || isZone(b.type) || isUtilityConduit(b.type) || hasServiceModel(b.type)
        || b.type === BuildingType.PARK || b.type === BuildingType.PARKING) continue;
      const facing = isFleetBuilding(b.type) ? findDepotDriveway(b, roads).facing : 'S';
      units.push(...CityBuildings.layoutServiceUnits(b.type, b.position.x, b.position.z, b.id, b.orientation, facing));
    }
    return units;
  }

  /** Distinct architectural massing for public & civic buildings, with lit windows and coloured roofs. */
  private static layoutServiceUnits(
    type: BuildingType, x: number, z: number, id: string, orientation?: RoadOrientation,
    drivewayFacing: DrivewayFacing = 'S',
  ): Unit[] {
    const def = BUILDING_DEFS[type];
    const { w, d } = getEffectiveSize(type, orientation);
    const color = new THREE.Color(def.color);
    const accent = color.clone().lerp(new THREE.Color(0x585c62), 0.2).getHex();
    const seed = hash(Math.round(x) + 31, Math.round(z) + 17, 9) * 0.5;
    const h = 0.5 + def.height * 0.2;
    const pad = Math.min(w, d) === 1 ? 0.18 : 0.24;
    const bw = w - 2 * pad;
    const bd = d - 2 * pad;
    const defaultWall = color.clone().lerp(new THREE.Color(0xf1ece2), 0.78).getHex();
    const cx = x + w / 2;
    const cz = z + d / 2;

    const box = (
      partId: string, u0: number, v0: number, u1: number, v1: number, height: number,
      opts?: { kind?: number; wall?: number; seedOffset?: number },
    ): Unit => {
      const x0 = pad + u0 * bw, x1 = pad + u1 * bw;
      const z0 = pad + v0 * bd, z1 = pad + v1 * bd;
      let rx = (x0 + x1) / 2 - w / 2;
      let rz = (z0 + z1) / 2 - d / 2;
      let rw = x1 - x0;
      let rd = z1 - z0;
      if (w === d && drivewayFacing !== 'S') {
        if (drivewayFacing === 'N') {
          rx = -rx; rz = -rz;
        } else if (drivewayFacing === 'E') {
          const ox = rx; rx = rz; rz = -ox;
          const ow = rw; rw = rd; rd = ow;
        } else {
          const ox = rx; rx = -rz; rz = ox;
          const ow = rw; rw = rd; rd = ow;
        }
      }
      return {
        key: `${id}:${partId}`,
        kind: opts?.kind ?? SHOP,
        wall: opts?.wall ?? defaultWall,
        seed: (seed + (opts?.seedOffset ?? 0)) % 1,
        accent,
        x: cx + rx,
        z: cz + rz,
        w: rw,
        d: rd,
        h: height,
      };
    };

    switch (type) {
      case BuildingType.EDU_LIBRARY:
        return [
          box('hall', 0.04, 0.04, 0.96, 0.76, h, { wall: 0xeadbc5 }),
          box('portico', 0.2, 0.76, 0.8, 0.98, h * 0.56, { wall: 0xf2e8d8 }),
        ];

      case BuildingType.POLICE_HQ: {
        const wall = color.clone().lerp(new THREE.Color(0xe6ecf2), 0.58).getHex();
        // Central HQ tower behind the sally-port garage bay (v <= 0.44), with flanking east/west wings
        return [
          box('tower', 0.2, 0.02, 0.8, 0.44, h * 1.38, { kind: TOWER, wall }),
          box('west', 0.0, 0.14, 0.32, 0.86, h * 0.72, { kind: TOWER, wall, seedOffset: 0.13 }),
          box('east', 0.68, 0.14, 1.0, 0.86, h * 0.72, { kind: TOWER, wall, seedOffset: 0.27 }),
        ];
      }

      case BuildingType.HEALTH_RESEARCH_CENTER: {
        const wall = color.clone().lerp(new THREE.Color(0xe6ecf2), 0.58).getHex();
        return [
          box('tower', 0.26, 0.12, 0.74, 0.66, h * 1.38, { kind: TOWER, wall }),
          box('west', 0.0, 0.2, 0.26, 0.76, h * 0.68, { kind: TOWER, wall, seedOffset: 0.13 }),
          box('east', 0.74, 0.2, 1.0, 0.76, h * 0.68, { kind: TOWER, wall, seedOffset: 0.27 }),
          box('lobby', 0.2, 0.66, 0.8, 0.96, h * 0.44, { kind: SHOP, wall }),
        ];
      }

      case BuildingType.POLICE_STATION: {
        const wall = color.clone().lerp(new THREE.Color(0xe6ecf2), 0.65).getHex();
        // Precinct hall along rear + west/east wings cleanly framing the central cruiser garage bay
        return [
          box('precinct', -0.06, -0.08, 1.06, 0.14, h * 1.08, { kind: TOWER, wall }),
          box('west-wing', -0.06, 0.14, 0.24, 0.82, h * 0.78, { kind: SHOP, wall, seedOffset: 0.19 }),
          box('east-wing', 0.76, 0.14, 1.06, 0.82, h * 0.62, { kind: SHOP, wall }),
        ];
      }

      case BuildingType.POLICE_ACADEMY: {
        const wall = color.clone().lerp(new THREE.Color(0xe6ecf2), 0.65).getHex();
        return [
          box('precinct', 0.04, 0.06, 0.66, 0.76, h * 1.08, { kind: TOWER, wall }),
          box('garage', 0.66, 0.18, 0.98, 0.82, h * 0.52, { kind: SHOP, wall, seedOffset: 0.19 }),
          box('entry', 0.14, 0.76, 0.58, 0.96, h * 0.46, { kind: SHOP, wall }),
        ];
      }

      case BuildingType.POLICE_JAIL: {
        const wall = 0xb5bcc2;
        return [
          box('north', 0.02, 0.02, 0.74, 0.26, h * 0.84, { kind: WORKS, wall }),
          box('south', 0.16, 0.76, 0.84, 0.98, h * 0.66, { kind: WORKS, wall }),
          box('west', 0.02, 0.26, 0.28, 0.76, h * 0.84, { kind: WORKS, wall }),
          box('east', 0.72, 0.26, 0.98, 0.76, h * 0.84, { kind: WORKS, wall }),
          box('watchtower', 0.74, 0.0, 1.0, 0.24, h * 1.32, { kind: TOWER, wall: 0x9ea7ae }),
        ];
      }

      case BuildingType.FIRE_STATION: {
        const wall = color.clone().lerp(new THREE.Color(0xf0dfd8), 0.56).getHex();
        // Firehouse rear + drill tower + flanking apparatus wings framing the central engine bay
        return [
          box('house', -0.06, -0.08, 0.74, 0.14, h * 0.98, { kind: TOWER, wall }),
          box('drill-tower', 0.76, -0.08, 1.06, 0.26, h * 1.52, { kind: TOWER, wall, seedOffset: 0.21 }),
          box('west-bay', -0.06, 0.14, 0.24, 0.82, h * 0.64, { kind: SHOP, wall }),
          box('east-bay', 0.76, 0.26, 1.06, 0.82, h * 0.64, { kind: SHOP, wall, seedOffset: 0.12 }),
        ];
      }

      case BuildingType.FIRE_HQ: {
        const wall = color.clone().lerp(new THREE.Color(0xf0dfd8), 0.56).getHex();
        // Large Fire HQ main house behind the apparatus bay, drill tower on corner, flanking bay wings
        return [
          box('house', 0.02, 0.02, 0.72, 0.44, h * 1.02, { kind: TOWER, wall }),
          box('drill-tower', 0.72, 0.02, 0.98, 0.34, h * 1.54, { kind: TOWER, wall, seedOffset: 0.21 }),
          box('west-wing', 0.02, 0.44, 0.32, 0.86, h * 0.64, { kind: SHOP, wall }),
          box('east-wing', 0.68, 0.34, 0.98, 0.86, h * 0.64, { kind: SHOP, wall, seedOffset: 0.14 }),
        ];
      }

      case BuildingType.FIRE_TRAINING: {
        const wall = color.clone().lerp(new THREE.Color(0xf0dfd8), 0.56).getHex();
        return [
          box('house', 0.04, 0.06, 0.72, 0.56, h * 0.96, { kind: TOWER, wall }),
          box('bays', 0.04, 0.56, 0.86, 0.96, h * 0.54, { kind: SHOP, wall }),
          box('drill-tower', 0.74, 0.04, 0.98, 0.34, h * 1.52, { kind: TOWER, wall, seedOffset: 0.21 }),
        ];
      }

      case BuildingType.HEALTH_CLINIC: {
        const wall = 0xf0f4f5;
        return [
          box('spine', -0.06, -0.08, 1.06, 0.14, h * 1.15, { kind: TOWER, wall }),
          box('west-ward', -0.06, 0.14, 0.24, 0.82, h * 0.78, { kind: SHOP, wall, seedOffset: 0.11 }),
          box('east-ward', 0.76, 0.14, 1.06, 0.82, h * 0.78, { kind: SHOP, wall, seedOffset: 0.23 }),
        ];
      }

      case BuildingType.HEALTH_HOSPITAL: {
        const wall = 0xf0f4f5;
        return [
          box('spine', 0.22, 0.02, 0.78, 0.44, h * 1.24, { kind: TOWER, wall }),
          box('west-ward', 0.0, 0.14, 0.32, 0.86, h * 0.82, { kind: TOWER, wall, seedOffset: 0.11 }),
          box('east-ward', 0.68, 0.14, 1.0, 0.86, h * 0.82, { kind: TOWER, wall, seedOffset: 0.23 }),
        ];
      }

      case BuildingType.EDU_ELEMENTARY:
      case BuildingType.EDU_HIGH_SCHOOL:
      case BuildingType.EDU_UNIVERSITY: {
        const wall = 0xe8d9c3;
        const blocks = [
          box('main-hall', 0.04, 0.04, 0.96, 0.42, h * 0.95, { kind: SHOP, wall }),
          box('west-wing', 0.04, 0.42, 0.32, 0.94, h * 0.74, { kind: SHOP, wall, seedOffset: 0.15 }),
          box('east-wing', 0.68, 0.42, 0.96, 0.94, h * 0.74, { kind: SHOP, wall, seedOffset: 0.29 }),
        ];
        if (type === BuildingType.EDU_UNIVERSITY) {
          blocks.push(box('bell-tower', 0.41, 0.12, 0.59, 0.36, h * 1.62, { kind: TOWER, wall: 0xdfd0b8 }));
        }
        return blocks;
      }

      case BuildingType.GOV_CITY_HALL:
      case BuildingType.GOV_COURTHOUSE:
      case BuildingType.GOV_PARLIAMENT: {
        const wall = 0xece7dc;
        return [
          box('colonnade', 0.08, 0.58, 0.92, 0.94, h * 0.7, { kind: SHOP, wall }),
          box('west-chamber', 0.04, 0.12, 0.34, 0.58, h * 0.86, { kind: TOWER, wall, seedOffset: 0.14 }),
          box('east-chamber', 0.66, 0.12, 0.96, 0.58, h * 0.86, { kind: TOWER, wall, seedOffset: 0.28 }),
          box('cupola', 0.34, 0.16, 0.66, 0.58, h * 1.38, { kind: TOWER, wall: 0xf4f0e6 }),
        ];
      }

      case BuildingType.ART_THEATER:
      case BuildingType.ART_CONCERT_HALL: {
        const wall = color.clone().lerp(new THREE.Color(0xf2ece6), 0.72).getHex();
        return [
          box('fly-tower', 0.14, 0.04, 0.86, 0.38, h * 1.24, { kind: TOWER, wall }),
          box('auditorium', 0.06, 0.38, 0.94, 0.74, h * 0.88, { kind: SHOP, wall, seedOffset: 0.17 }),
          box('foyer', 0.16, 0.74, 0.84, 0.96, h * 0.5, { kind: SHOP, wall }),
        ];
      }

      case BuildingType.TOUR_MUSEUM:
      case BuildingType.ART_GALLERY:
      default: {
        if (w === 1 || d === 1) return [box('main', 0.06, 0.06, 0.94, 0.94, h)];
        return [
          box('west-gallery', 0.02, 0.08, 0.36, 0.9, h * 0.88),
          box('east-gallery', 0.64, 0.08, 0.98, 0.9, h * 0.88, { seedOffset: 0.21 }),
          box('atrium', 0.36, 0.16, 0.64, 0.82, h * 1.06, { kind: TOWER }),
        ];
      }
    }
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

    return {
      key: `${lot.id}:${level}`, kind, x: cx, z: cz, w: bw, d: bd, h, wall,
      seed: hash(x, z, 9), cells: { x, z, w, d },
    };
  }

  // ── Meshes ────────────────────────────────────────────────

  private addUnits(units: Unit[], style: CityStyle, targetGroup: THREE.Group, trackZones: boolean): void {
    if (!units.length) return;
    type Draft = Omit<Part, 'mesh' | 'index'> & { color: number };
    const walls: Draft[] = [];
    const slabs: Draft[] = [];
    const hips: Draft[] = [];
    const stacks: Draft[] = [];
    /** Rooftop plant: boxes, then round things (fans, tanks, vents), then the caps on water towers. */
    const kit: Draft[] = [];
    const drums: Draft[] = [];
    const caps: Draft[] = [];
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
      this.roofPlant(u, top, w, d, { part, slabs, stacks, kit, drums, caps });
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
      targetGroup.add(mesh);
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
    add('roof-kit', box(), plain(), kit);
    add('roof-drums', new THREE.CylinderGeometry(0.5, 0.5, 1, 12).translate(0, 0.5, 0), plain(), drums);
    add('roof-caps', new THREE.ConeGeometry(0.5, 1, 12).translate(0, 0.5, 0), plain(), caps);

    for (const [unit, parts] of byUnit) {
      this.placeParts(parts, 1);
      if (trackZones) {
        if (unit.cells) this.zoneUnitParts.push({ cells: unit.cells, unit, parts });
        if (this.known && !this.known.has(unit.key)) this.growing.push({ unit, parts, age: 0 });
      }
    }
    for (const child of targetGroup.children) if (child instanceof THREE.InstancedMesh) child.computeBoundingSphere();
    if (trackZones) {
      for (const { parts } of this.growing) this.placeParts(parts, 0.02);
    }
  }

  /**
   * Clutter on a flat roof whose top tier is w × d and stands at height top:
   * air-conditioning units, water towers on mid-rise blocks, cooling plant on
   * the tallest towers and extractor vents on works. Laid out from the
   * building's seed, so a roof looks the same every time, and nothing overlaps
   * the plant room or each other.
   */
  private roofPlant(u: Unit, top: number, w: number, d: number, lists: RoofLists): void {
    const { part, kit, drums, caps, stacks } = lists;
    const margin = 0.05, spacing = 0.025;
    const taken: Array<[number, number, number, number]> = [];
    let draws = 0;
    const rand = () => hash(Math.floor(u.seed * 1e6), draws++, 21);
    const free = (x: number, z: number, hw: number, hd: number) =>
      Math.abs(x - u.x) + hw <= w / 2 - margin && Math.abs(z - u.z) + hd <= d / 2 - margin
      && taken.every(([x0, z0, x1, z1]) =>
        x + hw + spacing <= x0 || x - hw - spacing >= x1 || z + hd + spacing <= z0 || z - hd - spacing >= z1);
    const claim = (x: number, z: number, hw: number, hd: number) => taken.push([x - hw, z - hd, x + hw, z + hd]);
    /** A free spot for something hw × hd (half sizes), or null when the roof is full. */
    const spot = (hw: number, hd: number): [number, number] | null => {
      for (let i = 0; i < 14; i++) {
        const x = u.x + (rand() - 0.5) * Math.max(0, w - 2 * hw - 2 * margin);
        const z = u.z + (rand() - 0.5) * Math.max(0, d - 2 * hd - 2 * margin);
        if (free(x, z, hw, hd)) {
          claim(x, z, hw, hd);
          return [x, z];
        }
      }
      return null;
    };
    const metal = [0xc9ccce, 0xb3b8bc, 0xdedfdb, 0x9ea4a9];
    const fan = 0x2c3034;

    if (u.kind === WORKS) {
      const vents = 2 + Math.floor(rand() * 3);
      for (let i = 0; i < vents; i++) {
        const at = spot(0.035, 0.035);
        if (!at) break;
        part(drums, top, 0.06, 0.12 + rand() * 0.06, 0.06, pick(metal, rand()), at[0], at[1]);
        part(drums, top + 0.12, 0.075, 0.02, 0.075, 0x6d7276, at[0], at[1]);
      }
      return;
    }

    // The plant room laid down in addUnits.
    claim(u.x + (u.seed - 0.5) * w * 0.4, u.z + (0.5 - u.seed) * d * 0.4, w * 0.15, d * 0.14);

    if (u.kind === TOWER && u.h > 3.2) {
      // Cooling plant: big louvred boxes with fans on top.
      const units = 1 + Math.floor(rand() * 2);
      for (let i = 0; i < units; i++) {
        const along = rand() < 0.5;
        const hw = along ? 0.13 : 0.07, hd = along ? 0.07 : 0.13;
        const at = spot(hw, hd);
        if (!at) break;
        part(kit, top, hw * 2, 0.11, hd * 2, pick(metal, rand()), at[0], at[1]);
        for (const side of [-1, 1]) {
          part(drums, top + 0.11, 0.08, 0.012, 0.08, fan, at[0] + (along ? side * hw * 0.5 : 0), at[1] + (along ? 0 : side * hd * 0.5));
        }
      }
    } else if ((u.kind === TOWER || u.kind === SHOP) && !u.accent && Math.min(w, d) > 0.45 && rand() < 0.45) {
      // A timber water tower on legs.
      const at = spot(0.1, 0.1);
      if (at) {
        const legs = 0.09, tank = 0.15;
        for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          part(stacks, top, 0.014, legs, 0.014, 0x4a4643, at[0] + lx * 0.055, at[1] + lz * 0.055);
        }
        part(drums, top + legs, 0.16, tank, 0.16, rand() < 0.5 ? 0x8b6a4e : 0x9a7a5a, at[0], at[1]);
        part(caps, top + legs + tank, 0.18, 0.07, 0.18, 0x5a4a3e, at[0], at[1]);
      }
    }

    // Air-conditioning units, more on bigger roofs.
    const units = 1 + Math.floor(rand() * Math.min(6, w * d * 5));
    for (let i = 0; i < units; i++) {
      const along = rand() < 0.5;
      const hw = along ? 0.045 : 0.035, hd = along ? 0.035 : 0.045;
      const at = spot(hw, hd);
      if (!at) break;
      const height = 0.05 + rand() * 0.02;
      part(kit, top, hw * 2, height, hd * 2, pick(metal, rand()), at[0], at[1]);
      part(drums, top + height, 0.05, 0.008, 0.05, fan, at[0], at[1]);
    }
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
    this.zoneUnitParts = [];
    this.hiddenUnits.clear();
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (!(child instanceof THREE.InstancedMesh)) continue;
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
      child.dispose();
    }
  }
}
