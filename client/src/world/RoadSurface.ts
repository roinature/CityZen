import * as THREE from 'three';
import {
  BuildingType, CELL_SIZE, DEFAULT_GRID_SIZE, ZoneDensity, getEffectiveSize, isRoad, isStarterEntranceRoad, isZone,
  type PlacedBuilding,
} from '@cityzen/shared';
import type { CityStyle } from './CityStyle.js';
import { MeshBuilder, arc, type Point } from './MeshBuilder.js';

/** Width of the sidewalk, taken from the lots along a street. */
export const SIDEWALK = 0.26;
const ROAD_Y = 0.02;
const PAINT_Y = 0.026;
export const WALK_Y = 0.06;
const BULB = 0.64;

/** East, south, west, north, as [dx, dz]; right of `d` (as seen travelling) is `d + 1`. */
export const SIDES = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;

export interface RoadTile {
  building: PlacedBuilding;
  type: BuildingType;
  x: number;
  z: number;
}

export type RoadMap = ReadonlyMap<string, RoadTile>;

export function indexRoads(buildings: readonly PlacedBuilding[]): Map<string, RoadTile> {
  const roads = new Map<string, RoadTile>();
  for (const building of buildings) {
    if (!isRoad(building.type)) continue;
    const { w, d } = getEffectiveSize(building.type, building.orientation);
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        const x = building.position.x + dx;
        const z = building.position.z + dz;
        roads.set(`${x},${z}`, { building, type: building.type, x, z });
      }
    }
  }
  return roads;
}

/** Roads with a kerb and a sidewalk beside them. */
export function isPaved(type: BuildingType | undefined): boolean {
  return type === BuildingType.ROAD_STREET || type === BuildingType.ROAD_AVENUE || type === BuildingType.ROAD_ROUNDABOUT;
}

const isWide = (type: BuildingType) => type === BuildingType.ROAD_AVENUE || type === BuildingType.ROAD_HIGHWAY;

interface Axis {
  /** Map (along, across) offsets from a point to grid coordinates. */
  point(along: number, across: number): Point;
}

export interface RoadSurfaceOptions {
  style: CityStyle;
  crossings: boolean;
}

/**
 * The street network as one mesh: carriageways with rounded bends and
 * cul-de-sacs, kerbs and sidewalks with filleted corners, and lane markings.
 */
class RoadSurfaceBuilder {
  readonly mesh = new MeshBuilder();
  private roads: RoadMap;
  private gridSize: number;
  private o: RoadSurfaceOptions;

  constructor(roads: RoadMap, gridSize: number, o: RoadSurfaceOptions) {
    this.roads = roads;
    this.gridSize = gridSize;
    this.o = o;
  }

  private at(x: number, z: number): RoadTile | undefined {
    return this.roads.get(`${x},${z}`);
  }

  private links(tile: RoadTile): boolean[] {
    return SIDES.map(([dx, dz], d) => !!this.at(tile.x + dx, tile.z + dz)
      || (d === 1 && isStarterEntranceRoad(tile.building, DEFAULT_GRID_SIZE))
      // Roads run off the edge of the map.
      || (this.leavesMap(tile, d) && !!this.at(tile.x - dx, tile.z - dz)));
  }

  private leavesMap(tile: RoadTile, d: number): boolean {
    const x = tile.x + SIDES[d][0], z = tile.z + SIDES[d][1];
    return x < 0 || z < 0 || x >= this.gridSize || z >= this.gridSize;
  }

  build(buildings: readonly PlacedBuilding[]): void {
    for (const building of buildings) {
      if (!isRoad(building.type)) continue;
      if (building.type === BuildingType.ROAD_ROUNDABOUT) this.roundabout(building);
      else if (isWide(building.type)) this.wideRoad(building);
      else this.street(this.at(building.position.x, building.position.z)!);
    }
    this.sidewalks();
  }

  // ── Carriageways ──────────────────────────────────────────

  private street(tile: RoadTile): void {
    const { style } = this.o;
    const { x, z } = tile;
    const dirt = tile.type === BuildingType.ROAD_DIRT;
    const surface = dirt ? style.dirt : style.asphalt;
    const links = this.links(tile);
    const count = links.filter(Boolean).length;
    const cx = x + 0.5, cz = z + 0.5;

    if (count <= 1) {
      const radius = dirt ? 0.5 : BULB;
      this.mesh.sector(cx, cz, radius, 0, Math.PI * 2, ROAD_Y + 0.001, surface);
      if (count === 1) {
        const d = links.indexOf(true);
        const axis = this.axis(cx, cz, d);
        this.mesh.polygon([axis.point(0, -0.5), axis.point(0.5, -0.5), axis.point(0.5, 0.5), axis.point(0, 0.5)], ROAD_Y, surface);
        if (!dirt) this.bulb(cx, cz, d * Math.PI / 2, Math.asin(0.5 / BULB));
      } else if (!dirt) {
        this.bulb(cx, cz, 0, 0);
      }
      return;
    }

    if (count === 2 && links[0] !== links[2]) {
      const a = links[0] ? 1 : -1;
      const b = links[1] ? 1 : -1;
      this.bend(x, z, a, b, dirt);
      return;
    }

    this.mesh.rect(x, z, x + 1, z + 1, ROAD_Y, surface);
    if (dirt || count > 2) return;

    // Straight: a dashed centre line, held back from junctions.
    const d = links[0] ? 0 : 1;
    const axis = this.axis(cx, cz, d);
    const starts = [-0.375, -0.125, 0.125, 0.375];
    const ahead = this.isJunction(tile, d), behind = this.isJunction(tile, d + 2);
    starts.forEach((s, i) => {
      if ((i > 1 && ahead) || (i < 2 && behind) || i % 2) return;
      this.paint(axis, s - 0.07, s + 0.18, -0.012, 0.012, style.centreLine);
    });
    if (ahead) this.approach(axis, 0.5, 0.5, 1);
    if (behind) this.approach(this.axis(cx, cz, d + 2), 0.5, 0.5, 1);
  }

  /** A quarter-circle carriageway about the tile's inner corner. */
  private bend(x: number, z: number, a: number, b: number, dirt: boolean): void {
    const { style } = this.o;
    const px = a > 0 ? x + 1 : x;
    const pz = b > 0 ? z + 1 : z;
    const mid = Math.atan2(-b, -a);
    const from = mid - Math.PI / 4, to = mid + Math.PI / 4;
    this.mesh.sector(px, pz, 1, from, to, ROAD_Y, dirt ? style.dirt : style.asphalt);
    if (dirt) return;
    for (let i = 0; i < 3; i++) {
      const s = from + (Math.PI / 2) * (i / 3 + 0.06);
      this.mesh.ring(px, pz, 0.488, 0.512, s, s + 0.32, PAINT_Y, style.centreLine);
    }
    // A round kerb and sidewalk outside, running into the straight ones.
    const outer = 1 + SIDEWALK;
    this.mesh.polygon([[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1]], 0.004, style.lawn);
    this.mesh.ring(px, pz, 1, outer, from, to, WALK_Y, style.walk);
    this.mesh.walls(arc(px, pz, 1, from, to), 0, WALK_Y, style.kerb);
    this.mesh.walls(arc(px, pz, outer, from, to), 0, WALK_Y, style.kerb);
  }

  /** Sidewalk round a cul-de-sac, open towards `mouth`. */
  private bulb(cx: number, cz: number, mouth: number, half: number): void {
    const { style } = this.o;
    const from = mouth + half, to = mouth + Math.PI * 2 - half;
    this.mesh.ring(cx, cz, BULB, BULB + SIDEWALK * 0.8, from, to, WALK_Y + 0.001, style.walk);
    this.mesh.walls(arc(cx, cz, BULB, from, to), 0, WALK_Y, style.kerb);
    this.mesh.walls(arc(cx, cz, BULB + SIDEWALK * 0.8, from, to), 0, WALK_Y, style.kerb);
  }

  private wideRoad(building: PlacedBuilding): void {
    const { style } = this.o;
    const { x, z } = building.position;
    const { w, d } = getEffectiveSize(building.type, building.orientation);
    const highway = building.type === BuildingType.ROAD_HIGHWAY;
    this.mesh.rect(x, z, x + w, z + d, ROAD_Y, style.asphalt);
    if (this.isWideJunction(building)) return;

    const ew = (building.orientation ?? 'EW') === 'EW';
    const half = (ew ? d : w) / 2;
    const axis = this.axis(x + w / 2, z + d / 2, ew ? 0 : 1);
    for (const side of [-1, 1]) {
      this.paint(axis, -0.5, 0.5, side * 0.035 - 0.012, side * 0.035 + 0.012, style.centreLine);
      const edge = side * (half - 0.07);
      this.paint(axis, -0.5, 0.5, edge - 0.012, edge + 0.012, style.paint);
      for (let lane = 0.5; lane < half - 0.1; lane += 0.5) {
        this.paint(axis, -0.2, 0.2, side * lane - 0.012, side * lane + 0.012, style.paint);
      }
    }

    for (const dir of ew ? [0, 2] : [1, 3]) {
      const [dx, dz] = SIDES[dir];
      const next = this.at(dir === 0 ? x + w : dir === 2 ? x - 1 : x, dir === 1 ? z + d : dir === 3 ? z - 1 : z);
      if (!next || !isWide(next.type)) continue;
      const out = this.axis(x + w / 2, z + d / 2, dir);
      if (this.isWideJunction(next.building)) {
        if (!highway) this.approach(out, 0.5, half, Math.round(half / 0.5));
      } else if (!highway) {
        // One segment back from the junction, lane arrows point the way.
        const beyond = this.at(next.x + dx, next.z + dz);
        if (beyond && isWide(beyond.type) && this.isWideJunction(beyond.building)) {
          this.arrow(out, 0.25, 'left');
          this.arrow(out, 0.75, 'straight');
        }
      }
    }
  }

  /** A wide segment something joins from the side or meets at an angle. */
  private isWideJunction(building: PlacedBuilding): boolean {
    const { x, z } = building.position;
    const { w, d } = getEffectiveSize(building.type, building.orientation);
    const ew = (building.orientation ?? 'EW') === 'EW';
    for (let k = -1; k <= (ew ? d : w); k++) {
      const outside = k === -1 || k === (ew ? d : w);
      if (outside && this.at(ew ? x : x + k, ew ? z + k : z)) return true;
    }
    for (const side of [-1, 1]) {
      const next = this.at(ew ? x + side : x, ew ? z : z + side);
      if (next && isWide(next.type) && (next.building.orientation ?? 'EW') !== (building.orientation ?? 'EW')) return true;
    }
    return false;
  }

  /** Whether leaving a street tile on heading `d` runs into a junction. */
  private isJunction(tile: RoadTile, d: number): boolean {
    const next = this.at(tile.x + SIDES[d & 3][0], tile.z + SIDES[d & 3][1]);
    if (!next || next.type === BuildingType.ROAD_DIRT) return false;
    if (isWide(next.type) || next.type === BuildingType.ROAD_ROUNDABOUT) return true;
    return this.links(next).filter(Boolean).length > 2;
  }

  private roundabout(building: PlacedBuilding): void {
    const { style } = this.o;
    const { x, z } = building.position;
    const { w, d } = getEffectiveSize(building.type);
    const cx = x + w / 2, cz = z + d / 2;
    const radius = Math.min(w, d) / 2;
    // Corners are cut back to a round kerb.
    for (let q = 0; q < 4; q++) {
      const sx = q === 0 || q === 3 ? 1 : -1;
      const sz = q < 2 ? 1 : -1;
      const ox = cx + sx * radius, oz = cz + sz * radius;
      const inner: Point[] = arc(cx, cz, radius * 1.06, Math.atan2(sz, sx) - 0.42, Math.atan2(sz, sx) + 0.42);
      for (let i = 0; i + 1 < inner.length; i++) this.mesh.polygon([[ox, oz], inner[i], inner[i + 1]], WALK_Y, style.walk);
      this.mesh.walls(inner, 0, WALK_Y, style.kerb);
    }
    this.mesh.rect(x, z, x + w, z + d, ROAD_Y, style.asphalt);
    const island = radius * 0.45;
    this.mesh.ring(cx, cz, island - 0.07, island, 0, Math.PI * 2, WALK_Y + 0.01, style.walk);
    this.mesh.walls(arc(cx, cz, island, 0, Math.PI * 2), 0, WALK_Y + 0.01, style.kerb);
    this.mesh.sector(cx, cz, island - 0.06, 0, Math.PI * 2, WALK_Y + 0.005, style.lawn);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      this.mesh.ring(cx, cz, radius * 0.95, radius * 0.95 + 0.025, a, a + 0.14, PAINT_Y, style.paint);
    }
  }

  // ── Markings ──────────────────────────────────────────────

  private axis(x: number, z: number, d: number): Axis {
    const [dx, dz] = SIDES[d & 3];
    const [rx, rz] = SIDES[(d + 1) & 3];
    return { point: (along, across) => [x + dx * along + rx * across, z + dz * along + rz * across] };
  }

  private paint(axis: Axis, a0: number, a1: number, c0: number, c1: number, color: number): void {
    this.mesh.polygon([axis.point(a0, c0), axis.point(a1, c0), axis.point(a1, c1), axis.point(a0, c1)], PAINT_Y, color);
  }

  /** Zebra crossing and stop bar at the end (`end` along the axis) of a road facing a junction. */
  private approach(axis: Axis, end: number, half: number, lanes: number): void {
    const { style, crossings } = this.o;
    if (crossings) {
      const stripes = lanes * 6;
      const pitch = (half * 2 - 0.12) / stripes;
      for (let i = 0; i < stripes; i++) {
        const c = -half + 0.06 + pitch * (i + 0.25);
        this.paint(axis, end - 0.24, end - 0.05, c, c + pitch * 0.5, style.paint);
      }
    }
    const bar = end - (crossings ? 0.33 : 0.12);
    this.paint(axis, bar - 0.035, bar, 0.05, half - 0.06, style.paint);
  }

  private arrow(axis: Axis, across: number, kind: 'straight' | 'left'): void {
    const { paint } = this.o.style;
    this.paint(axis, -0.2, 0.08, across - 0.018, across + 0.018, paint);
    if (kind === 'straight') {
      this.mesh.polygon([axis.point(0.24, across), axis.point(0.06, across - 0.07), axis.point(0.06, across + 0.07)], PAINT_Y, paint);
    } else {
      this.paint(axis, 0.05, 0.086, across - 0.1, across, paint);
      this.mesh.polygon([axis.point(0.068, across - 0.2), axis.point(-0.005, across - 0.08), axis.point(0.14, across - 0.08)], PAINT_Y, paint);
    }
  }

  // ── Sidewalks ─────────────────────────────────────────────

  private sidewalks(): void {
    const { style } = this.o;
    const cells = new Set<string>();
    for (const { x, z, type } of this.roads.values()) {
      if (!isPaved(type)) continue;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) cells.add(`${x + dx},${z + dz}`);
    }
    const paved = (x: number, z: number) => isPaved(this.at(x, z)?.type);
    const bends = new Set<string>();
    for (const [key, tile] of this.roads) {
      if (tile.type !== BuildingType.ROAD_STREET) continue;
      const links = this.links(tile);
      if (links.filter(Boolean).length === 2 && links[0] !== links[2]) bends.add(key);
    }
    const W = SIDEWALK;

    for (const key of cells) {
      const [x, z] = key.split(',').map(Number);
      if (x < 0 || z < 0 || x >= this.gridSize || z >= this.gridSize || this.roads.has(key)) continue;
      // Bends bring their own sidewalk; a lot only ever touches the outside of one.
      const side = SIDES.map(([dx, dz]) => paved(x + dx, z + dz) && !bends.has(`${x + dx},${z + dz}`));
      const cx = x + 0.5, cz = z + 0.5;
      const top = WALK_Y;

      for (let d = 0; d < 4; d++) {
        if (!side[d]) continue;
        // Strip along this side; corners are added below.
        const axis = this.axis(cx, cz, d);
        this.mesh.polygon([axis.point(0.5 - W, -0.5 + W), axis.point(0.5, -0.5 + W), axis.point(0.5, 0.5 - W), axis.point(0.5 - W, 0.5 - W)], top, style.walk);
        this.mesh.wall(axis.point(0.5, -0.5 + W), axis.point(0.5, 0.5 - W), 0, top, style.kerb);
        this.mesh.wall(axis.point(0.5 - W, -0.5 + W), axis.point(0.5 - W, 0.5 - W), 0, top, style.walk);
      }

      for (let d = 0; d < 4; d++) {
        const e = (d + 1) & 3;
        const diagonal = paved(x + SIDES[d][0] + SIDES[e][0], z + SIDES[d][1] + SIDES[e][1]);
        // Streets only leave a bare diagonal at bends and dead ends, which have rings.
        const across = this.at(x + SIDES[d][0] + SIDES[e][0], z + SIDES[d][1] + SIDES[e][1])?.type;
        if (!side[d] && !side[e] && (!diagonal || across === BuildingType.ROAD_STREET)) continue;
        const axis = this.axis(cx, cz, d);
        if (side[d] && side[e] && diagonal) {
          // Street corner: a filleted kerb with asphalt in the cut.
          const [ix, iz] = axis.point(0.5 - W, 0.5 - W);
          const start = d * Math.PI / 2;
          const kerb = arc(ix, iz, W, start, start + Math.PI / 2);
          this.mesh.polygon([[ix, iz], ...kerb], top, style.walk);
          this.mesh.walls(kerb, 0, top, style.kerb);
          this.mesh.polygon([axis.point(0.5 - W, 0.5 - W), axis.point(0.5, 0.5 - W), axis.point(0.5, 0.5), axis.point(0.5 - W, 0.5)], ROAD_Y, style.asphalt);
        } else {
          this.mesh.polygon([axis.point(0.5 - W, 0.5 - W), axis.point(0.5, 0.5 - W), axis.point(0.5, 0.5), axis.point(0.5 - W, 0.5)], top, style.walk);
          if (side[d]) this.mesh.wall(axis.point(0.5, 0.5 - W), axis.point(0.5, 0.5), 0, top, style.kerb);
          if (side[e]) this.mesh.wall(axis.point(0.5 - W, 0.5), axis.point(0.5, 0.5), 0, top, style.kerb);
        }
      }
    }
  }
}

/** Ground cover of the lots themselves: plazas, lawns, yards, parks and parking bays. */
function addLots(mesh: MeshBuilder, buildings: readonly PlacedBuilding[], roads: RoadMap, style: CityStyle): void {
  const frontage = (x: number, z: number, d: number) => isPaved(roads.get(`${x + SIDES[d][0]},${z + SIDES[d][1]}`)?.type);
  for (const b of buildings) {
    const { x, z } = b.position;
    const built = (b.developmentLevel ?? 0) > 0;
    const urban = b.type === BuildingType.ZONE_COMMERCIAL
      || (b.type === BuildingType.ZONE_RESIDENTIAL && b.density === ZoneDensity.HIGH);
    if (b.type === BuildingType.PARK) {
      mesh.rect(x, z, x + 1, z + 1, 0.024, style.lawn);
      const path = [0, 1, 2, 3].map(d => frontage(x, z, d));
      for (let d = 0; d < 4; d++) {
        if (!path[d]) continue;
        const [dx, dz] = SIDES[d];
        mesh.rect(x + 0.5 + Math.min(0, dx) * 0.3 - 0.05, z + 0.5 + Math.min(0, dz) * 0.3 - 0.05,
          x + 0.5 + Math.max(0, dx) * 0.3 + 0.05, z + 0.5 + Math.max(0, dz) * 0.3 + 0.05, 0.03, style.walk);
      }
    } else if (b.type === BuildingType.PARKING) {
      mesh.rect(x, z, x + 1, z + 1, 0.03, style.asphalt);
      for (const row of [0.29, 0.71]) {
        for (let i = 0; i <= 3; i++) {
          const px = x + 0.28 + i * 0.147;
          mesh.rect(px - 0.009, z + row - 0.13, px + 0.009, z + row + 0.13, 0.034, style.paint);
        }
      }
    } else if (!isRoad(b.type) && !isZone(b.type)) {
      const { w, d } = getEffectiveSize(b.type, b.orientation);
      mesh.rect(x, z, x + w, z + d, 0.028, style.concrete);
    } else if (built && urban) {
      mesh.rect(x, z, x + 1, z + 1, 0.05, style.concrete);
    } else if (built && b.type === BuildingType.ZONE_INDUSTRIAL) {
      mesh.rect(x, z, x + 1, z + 1, 0.04, style.concrete);
    } else if (built) {
      mesh.rect(x, z, x + 1, z + 1, 0.022, style.lawn);
    }
  }
}

export function createRoadSurface(
  buildings: readonly PlacedBuilding[], roads: RoadMap, gridSize: number, options: RoadSurfaceOptions,
): THREE.Mesh {
  const builder = new RoadSurfaceBuilder(roads, gridSize, options);
  addLots(builder.mesh, buildings, roads, options.style);
  builder.build(buildings);
  const geometry = builder.mesh.build();
  geometry.scale(CELL_SIZE, CELL_SIZE, CELL_SIZE);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
  mesh.name = 'road-surface';
  mesh.receiveShadow = true;
  return mesh;
}
