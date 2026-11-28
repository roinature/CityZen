import * as THREE from 'three';
import {
  type CityEmergency,
  type CityState,
  type PlacedBuilding,
  CELL_SIZE,
  SERVICE_BUILDING_FLEETS,
  getEffectiveFleetSize,
  getEffectiveSize,
  isRoad,
} from '@cityzen/shared';
import {
  DX,
  DZ,
  RoadNetwork,
  TURN_SPEED,
  isXAxis,
  movementsConflict,
  positionAt,
  type Junction,
  type Movement,
  type Path,
  type PathEvent,
  type Tile,
} from './traffic/RoadNetwork.js';
import { TrafficLights, signalFor } from './traffic/TrafficLights.js';
import {
  EMERGENCY_SERVICE_KIND,
  SERVICE_FLEETS,
  SERVICE_PROFILES,
  createServiceVehicleMesh,
  type ServiceKind,
} from './ServiceVehicles.js';

const CAR_COLORS = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0xff8f00, 0x8e24aa, 0xeceff1, 0x37474f];
const CARS_PER_ROAD = 0.15; // one car per ~7 road tiles
const CAR_Y = 0.03; // wheels sit just above the road surface (road at 0.02)

// All distances in cells, speeds in cells per second.
const CAR_LEN = 0.5;
const HALF = CAR_LEN / 2;
const MIN_GAP = 0.12;
const LANE_TOL = 0.2;
const CROSS_TOL = 0.2;
const ACCEL = 2.2;
const BRAKE = 4;
const BRAKE_MAX = 10;
const APPROACH = 3;
/** Yield and roundabout entries are decided this close to the line. */
const DECIDE = 1.0;
const SPAWN_CLEARANCE = 0.8;
const FADE = 0.35;
/** A car blocked this long by something other than a light or a give-way is in a deadlock. */
const DEADLOCK_SECONDS = 4;
const GHOST_SECONDS = 1.2;
const GIVE_UP_SECONDS = 30;

interface Car {
  id: number;
  mesh: THREE.Group;
  tiles: (Tile | null)[];
  dirs: number[];
  finalDir: number;
  exiting: boolean;
  entering: boolean;
  path: Path;
  s: number;
  v: number;
  seg: number;
  x: number;
  z: number;
  yaw: number;
  /** Index of the next junction/roundabout event on the path. */
  ev: number;
  /** Cleared to enter the junction of event `ev`. */
  permitted: boolean;
  movement: Movement | null;
  leader: Car | null;
  leaderGap: number;
  controlGap: number;
  ignoreLeader: boolean;
  waitMemo: number;
  stuck: number;
  stuckTotal: number;
  ghost: number;
  age: number;
  /** ≥ 0 while shrinking away. */
  leaving: number;
  /** Set on vehicles sent out by a service building. */
  service?: ServiceTrip;
}

interface ServiceTrip {
  kind: ServiceKind;
  /** Building id of the depot it returns to. */
  home: string;
  stopsLeft: number;
  returning: boolean;
  /** Seconds left parked at the current stop (≤ 0 when driving). */
  dwell: number;
  flashers: THREE.MeshStandardMaterial[];
  /** Active city emergency this vehicle is responding to, if any. */
  emergencyId?: string;
}

/** A service building and the road cell its vehicles pull out onto. */
interface Depot {
  id: string;
  kind: ServiceKind;
  fleet: number;
  tile: Tile;
  /** Heading from the road cell into the building. */
  side: number;
  /** Earliest time the next vehicle may leave. */
  next: number;
}

const MAX_SERVICE_VEHICLES = 40;
const DRIVEWAY_SPEED = 0.9;
const MIN_TRIP = 6;

const rand = ([a, b]: readonly [number, number]): number => a + Math.random() * (b - a);

/** Adds points before the start of a path (they lead into its first point). */
function prependPoints(path: Path, pts: [number, number][], speed: number): void {
  const xs: number[] = [], zs: number[] = [], ss: number[] = [], sp: number[] = [];
  let s = 0;
  const all: [number, number][] = [...pts, [path.xs[0], path.zs[0]]];
  for (let i = 0; i < all.length - 1; i++) {
    const len = Math.hypot(all[i + 1][0] - all[i][0], all[i + 1][1] - all[i][1]);
    if (len < 1e-4) continue;
    xs.push(all[i][0]); zs.push(all[i][1]); ss.push(s); sp.push(speed);
    s += len;
  }
  if (!xs.length) return;
  path.xs = [...xs, ...path.xs];
  path.zs = [...zs, ...path.zs];
  path.ss = [...ss, ...path.ss.map(v => v + s)];
  path.speed = [...sp, ...path.speed];
  path.stepS = path.stepS.map(v => v + s);
  path.length += s;
  for (const e of path.events) {
    e.sEntry += s;
    e.sExit += s;
  }
}

/** Adds points after the end of a path. */
function appendPoints(path: Path, pts: [number, number][], speed: number): void {
  for (const [x, z] of pts) {
    const k = path.xs.length - 1;
    const len = Math.hypot(x - path.xs[k], z - path.zs[k]);
    if (len < 1e-4) continue;
    path.speed[k] = speed;
    path.xs.push(x);
    path.zs.push(z);
    path.ss.push(path.ss[k] + len);
    path.speed.push(speed);
    path.length = path.ss[k] + len;
  }
}

/** The car the player drives, as other traffic sees it. */
export interface PlayerCar {
  x: number;
  z: number;
  yaw: number;
  v: number;
}

/** A traffic vehicle the player can ride along in. */
export interface Rideable {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly v: number;
  readonly mesh: THREE.Group;
}

export interface DepotVehicleStatus {
  id: number;
  kind: ServiceKind;
  state: 'responding' | 'on_scene' | 'patrolling' | 'at_stop' | 'returning';
  emergencyId?: string;
  x: number;
  z: number;
  stopsLeft: number;
}

export interface DepotFleetStatus {
  hasRoadAccess: boolean;
  configuredFleet: number;
  standbyCount: number;
  nextDispatchInSec: number;
  vehicles: DepotVehicleStatus[];
}

function fleetSignature(buildings: readonly PlacedBuilding[]): string {
  let sig = '';
  for (const b of buildings) {
    if (SERVICE_BUILDING_FLEETS[b.type]) {
      sig += `${b.id}:${getEffectiveFleetSize(b)};`;
    }
  }
  return sig;
}

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function roadSignature(buildings: readonly PlacedBuilding[]): string {
  let sig = '';
  for (const b of buildings) {
    if (isRoad(b.type)) sig += `${b.id}@${b.position.x},${b.position.z}${b.orientation ?? ''};`;
  }
  return sig;
}

/**
 * Traffic. Cars plan a route between lots (or the map edges), follow lanes,
 * keep their distance, and take turns at junctions: lights at big crossings,
 * all-way give-way at small ones, and yield-on-entry at roundabouts.
 */
export class CarManager {
  private scene: THREE.Scene;
  private cars: Car[] = [];
  private network: RoadNetwork | null = null;
  private lights: TrafficLights;
  private roadSig = '';
  private fleetSig = '';
  private lastBuildings: readonly PlacedBuilding[] | null = null;
  private lastBuildingCount = -1;
  private endpointAge = 0;
  private enabled = true;
  private maxCarLimit = 20;
  private nextId = 1;
  private time = 0;
  private frame = 0;
  private spawnCooldown = 0;
  private hash = new Map<number, Car[]>();
  private nearby: Car[] = [];
  /** Stand-in for the player's car: an obstacle that is always "waiting legitimately". */
  private player: Car | null = null;
  /** The car the player is riding in: kept on the road with a new trip whenever it arrives. */
  private riding: Car | null = null;
  private depots = new Map<string, Depot>();
  private reportedResponding = new Set<string>();
  private reportedResolved = new Set<string>();

  /** Fired once when a service vehicle arrives at an active city emergency. */
  onEmergencyArrived?: (emergencyId: string) => void;
  /** Fired once when a service vehicle finishes working on an emergency and resolves it. */
  onEmergencyResolved?: (emergencyId: string) => void;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.lights = new TrafficLights(scene);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      for (let i = this.cars.length - 1; i >= 0; i--) {
        if (!this.cars[i].service?.emergencyId && this.cars[i] !== this.riding) {
          this.removeMesh(this.cars[i]);
          this.cars.splice(i, 1);
        }
      }
    }
  }

  /** Make traffic queue behind (and not spawn on top of) the player's car. Null removes it. */
  setPlayer(p: PlayerCar | null): void {
    if (!p) {
      this.player = null;
      return;
    }
    this.player ??= { id: -1, leader: null, waitMemo: 1 } as Car;
    this.player.x = p.x;
    this.player.z = p.z;
    this.player.yaw = p.yaw;
    this.player.v = p.v;
    // Shared with waitingLegitimately(), which caches per frame on real cars only.
    this.player.waitMemo = 1;
  }

  /** The nearest car (service vehicles included) within `radius` cells, or null. */
  nearestRideable(x: number, z: number, radius: number, except?: Rideable | null): Rideable | null {
    let best: Car | null = null;
    let bestD = radius * radius;
    for (const car of this.cars) {
      if (car === except || car.leaving >= 0 || car.age < FADE) continue;
      const d = (car.x - x) ** 2 + (car.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    return best;
  }

  /** Marks the car the player rides in (null when they get out). */
  setRiding(car: Rideable | null): void {
    this.riding = car && this.cars.includes(car as Car) ? car as Car : null;
  }

  /** The car being ridden, or null once it has left the road. */
  getRiding(): Rideable | null {
    return this.riding;
  }

  /** Positions of the traffic cars, in cells. */
  getCars(): readonly { x: number; z: number; yaw: number; v: number; leaving: number }[] {
    return this.cars;
  }

  setMaxCars(max: number): void {
    this.maxCarLimit = max;
  }

  clear(): void {
    for (const car of this.cars) this.removeMesh(car);
    this.cars = [];
    this.riding = null;
    this.depots.clear();
    this.reportedResponding.clear();
    this.reportedResolved.clear();
    this.network = null;
    this.roadSig = '';
    this.fleetSig = '';
    this.lastBuildings = null;
    this.lastBuildingCount = -1;
    this.lights.clear();
  }

  update(deltaTime: number, state: CityState | null): void {
    // Even if ambient traffic is toggled off, emergency vehicles must still respond when incidents happen!
    const hasEmergencies = (state?.emergencies?.length ?? 0) > 0;
    if (!state || (!this.enabled && !hasEmergencies && !this.cars.some(c => c.service?.emergencyId))) return;
    const dt = Math.min(deltaTime, 0.05);
    this.time += dt;
    this.frame++;

    this.syncNetwork(state, dt);
    const net = this.network;
    if (!net) return;

    this.lights.update(dt);
    for (const j of net.junctions) {
      j.queued = j.counting;
      j.counting = [0, 0];
      j.occupants.length = 0;
      for (const [car, w] of j.waiting) if (w.frame < this.frame - 2) j.waiting.delete(car);
    }

    if (this.enabled) this.adjustCarCount(net, dt);
    this.dispatchEmergencies(net, state);
    if (this.enabled) this.dispatchServices(net);
    this.buildHash();

    // Who is in (or cleared into) which junction.
    for (const car of this.cars) {
      const events = car.path.events;
      while (car.ev < events.length && car.s - HALF > events[car.ev].sExit) {
        car.ev++;
        car.permitted = false;
        car.movement = null;
      }
      const e = events[car.ev];
      if (e?.junction && (car.permitted || car.s + HALF >= e.sEntry)) {
        car.movement ??= this.movementFor(car, e);
        e.junction.occupants.push(car.movement);
      }
    }

    for (const car of this.cars) {
      car.leader = null;
      car.leaderGap = Infinity;
      car.controlGap = Infinity;
      car.ignoreLeader = false;
      car.waitMemo = 0;
      if (car.ghost <= 0) this.scanLeader(car);
      this.control(car);
    }

    // Two cars each waiting on the other: the one with more room goes first.
    for (const car of this.cars) {
      const other = car.leader;
      if (other && other.leader === car) {
        car.ignoreLeader = car.leaderGap > other.leaderGap
          || (car.leaderGap === other.leaderGap && car.id < other.id);
      }
    }

    for (let i = this.cars.length - 1; i >= 0; i--) {
      if (!this.move(this.cars[i], dt)) {
        if (this.cars[i] === this.riding) this.riding = null;
        this.removeMesh(this.cars[i]);
        this.cars.splice(i, 1);
      }
    }

    // Light bars: sirens flash on the way out (or when rushing to an emergency), work beacons whenever out.
    for (const car of this.cars) {
      const sv = car.service;
      if (!sv || !sv.flashers.length) continue;
      const emergency = SERVICE_PROFILES[sv.kind].emergency || Boolean(sv.emergencyId);
      const on = emergency ? !sv.returning : true;
      const tick = Math.floor(this.time * (emergency ? 7 : 2.5) + car.id);
      sv.flashers.forEach((m, i) => {
        m.emissiveIntensity = on && (tick + i) % 2 === 0 ? 2.2 : 0.15;
      });
    }
  }

  // ── Network ───────────────────────────────────────────────

  private syncNetwork(state: CityState, dt: number): void {
    this.endpointAge += dt;
    const buildings = state.buildings;
    const nextFleetSig = fleetSignature(buildings);
    const fleetChanged = nextFleetSig !== this.fleetSig;
    const changed = buildings !== this.lastBuildings || buildings.length !== this.lastBuildingCount || fleetChanged;
    if (!changed && this.network && this.endpointAge < 5) return;
    this.lastBuildings = buildings;
    this.lastBuildingCount = buildings.length;
    this.fleetSig = nextFleetSig;
    this.endpointAge = 0;

    const sig = roadSignature(buildings);
    if (sig === this.roadSig && this.network) {
      // Lots changed (zones grew, buildings placed): refresh trip ends only.
      this.network.setEndpoints(buildings);
      this.refreshDepots(this.network, buildings);
      return;
    }
    this.roadSig = sig;
    const net = new RoadNetwork(buildings, state.grid.length);
    this.network = net;
    this.lights.rebuild(net.junctions);
    this.refreshDepots(net, buildings);

    // Keep cars whose remaining route still exists; the rest pull away.
    for (const car of this.cars) {
      const current = this.currentStep(car);
      const tiles = car.tiles.map(t => {
        if (!t) return null;
        const nt = net.tileAt(t.x, t.z);
        return nt && nt.building === t.building ? nt : null;
      });
      car.tiles = tiles;
      car.ev = 0;
      car.permitted = false;
      car.movement = null;
      if (tiles.some((t, i) => i >= current && !t)) {
        car.path.events = [];
        if (car.leaving < 0) car.leaving = 0;
        continue;
      }
      car.path.events = net.computeEvents(car.path, tiles, car.dirs, car.finalDir);
    }
  }

  private currentStep(car: Car): number {
    const { stepS } = car.path;
    let i = 0;
    while (i + 1 < stepS.length && stepS[i + 1] <= car.s) i++;
    return i;
  }

  // ── Population ────────────────────────────────────────────

  private adjustCarCount(net: RoadNetwork, dt: number): void {
    const desired = Math.min(this.maxCarLimit, Math.floor(net.tiles.length * CARS_PER_ROAD));
    let active = 0;
    for (const car of this.cars) if (car.leaving < 0 && !car.service) active++;

    for (let i = this.cars.length - 1; i >= 0 && active > desired; i--) {
      if (this.cars[i].leaving < 0 && !this.cars[i].service && this.cars[i] !== this.riding) {
        this.cars[i].leaving = 0;
        active--;
      }
    }

    this.spawnCooldown -= dt;
    if (active >= desired || this.spawnCooldown > 0) return;
    this.spawnCooldown = 0.1;
    const car = this.spawnCar(net);
    if (car) this.cars.push(car);
  }

  private spawnCar(net: RoadNetwork): Car | null {
    if (!net.endpoints.length && !net.entries.length) return null;

    let start: Tile;
    let startDirs: number[];
    const entering = net.entries.length > 0 && (net.endpoints.length === 0 || Math.random() < 0.3);
    if (entering) {
      const gate = pick(net.entries);
      start = gate.tile;
      startDirs = [gate.dir];
    } else {
      start = pick(net.endpoints);
      startDirs = [0, 1, 2, 3];
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      let goal: { tile: Tile; exitDir: number };
      const leaveMap = net.exits.length > 0 && (net.endpoints.length === 0 || Math.random() < (entering ? 0.35 : 0.2));
      if (leaveMap) {
        const gate = pick(net.exits);
        if (gate.tile === start) continue;
        goal = { tile: gate.tile, exitDir: gate.dir };
      } else {
        const tile = pick(net.endpoints);
        if (tile === start) continue;
        if (attempt < 3 && Math.abs(tile.x - start.x) + Math.abs(tile.z - start.z) < 5) continue;
        goal = { tile, exitDir: -1 };
      }

      const steps = net.findRoute(start, startDirs, goal);
      if (!steps || steps.length < 2) continue;
      // Pull out in the direction of travel.
      if (!entering) steps[0] = { tile: steps[0].tile, dir: steps[1].dir };

      const route = { steps, entering, exitDir: goal.exitDir };
      const path = net.buildPath(route, Math.random() < 0.5 ? 0 : 1);
      if (path.xs.length < 2) continue;
      if (this.isOccupied(path.xs[0], path.zs[0], SPAWN_CLEARANCE)) return null;

      const mesh = createCarMesh(pick(CAR_COLORS));
      this.scene.add(mesh);
      const car: Car = {
        id: this.nextId++,
        mesh,
        tiles: steps.map(st => st.tile),
        dirs: steps.map(st => st.dir),
        finalDir: goal.exitDir >= 0 ? goal.exitDir : steps[steps.length - 1].dir,
        exiting: goal.exitDir >= 0,
        entering,
        path,
        s: 0,
        v: entering ? path.speed[0] : 0,
        seg: 0,
        x: path.xs[0],
        z: path.zs[0],
        yaw: Math.atan2(-(path.zs[1] - path.zs[0]), path.xs[1] - path.xs[0]),
        ev: 0,
        permitted: false,
        movement: null,
        leader: null,
        leaderGap: Infinity,
        controlGap: Infinity,
        ignoreLeader: false,
        waitMemo: 0,
        stuck: 0,
        stuckTotal: 0,
        ghost: 0,
        age: 0,
        leaving: -1,
      };
      this.place(car);
      return car;
    }
    return null;
  }

  private isOccupied(x: number, z: number, radius: number): boolean {
    const p = this.player;
    if (p && (p.x - x) ** 2 + (p.z - z) ** 2 < radius * radius) return true;
    for (const car of this.cars) {
      if ((car.x - x) ** 2 + (car.z - z) ** 2 < radius * radius) return true;
    }
    return false;
  }

  // ── Service vehicles ──────────────────────────────────────

  /** Finds every service building and the road cell its vehicles use. */
  private refreshDepots(net: RoadNetwork, buildings: readonly PlacedBuilding[]): void {
    const next = new Map<string, Depot>();
    for (const b of buildings) {
      const cfg = SERVICE_FLEETS[b.type];
      if (!cfg) continue;
      const access = this.findAccess(net, b);
      if (!access) continue;
      const old = this.depots.get(b.id);
      const fleet = getEffectiveFleetSize(b);
      next.set(b.id, {
        id: b.id, kind: cfg.kind, fleet,
        tile: access.tile, side: access.side,
        next: old?.next ?? this.time + 1 + Math.random() * 6,
      });
    }
    this.depots = next;

    // If a depot's fleet size was lowered, recall excess non-emergency vehicles cleanly.
    const activeByDepot = new Map<string, Car[]>();
    for (const car of this.cars) {
      if (!car.service || car.leaving >= 0) continue;
      const list = activeByDepot.get(car.service.home) ?? [];
      list.push(car);
      activeByDepot.set(car.service.home, list);
    }
    for (const [depotId, list] of activeByDepot) {
      const limit = next.get(depotId)?.fleet ?? 0;
      let over = list.length - limit;
      for (let i = list.length - 1; i >= 0 && over > 0; i--) {
        const car = list[i];
        const sv = car.service!;
        if (sv.emergencyId || sv.returning) continue;
        this.sendVehicleHome(car);
        over--;
      }
    }
  }

  /** Live telemetry for a service depot building, used by the building inspector card. */
  getDepotFleetStatus(buildingId: string, state?: CityState | null): DepotFleetStatus {
    if (state) this.syncNetwork(state, 0);
    const depot = this.depots.get(buildingId);
    const vehicles: DepotVehicleStatus[] = [];
    for (const car of this.cars) {
      const sv = car.service;
      if (!sv || sv.home !== buildingId || car.leaving >= 0) continue;
      const state: DepotVehicleStatus['state'] = sv.emergencyId
        ? (sv.dwell > 0 ? 'on_scene' : 'responding')
        : sv.returning
          ? 'returning'
          : sv.dwell > 0
            ? 'at_stop'
            : 'patrolling';
      vehicles.push({
        id: car.id,
        kind: sv.kind,
        state,
        emergencyId: sv.emergencyId,
        x: car.x,
        z: car.z,
        stopsLeft: sv.stopsLeft,
      });
    }
    const configuredFleet = depot?.fleet ?? 0;
    return {
      hasRoadAccess: Boolean(depot),
      configuredFleet,
      standbyCount: Math.max(0, configuredFleet - vehicles.length),
      nextDispatchInSec: depot ? Math.max(0, depot.next - this.time) : 0,
      vehicles,
    };
  }

  /** Manually dispatches a standby service vehicle from `buildingId` right away. */
  dispatchDepotVehicle(buildingId: string, state?: CityState | null): boolean {
    if (state) this.syncNetwork(state, 0);
    const net = this.network;
    const depot = this.depots.get(buildingId);
    if (!net || !depot || depot.fleet <= 0) return false;
    let outCount = 0;
    let totalService = 0;
    for (const car of this.cars) {
      if (!car.service || car.leaving >= 0) continue;
      totalService++;
      if (car.service.home === buildingId) outCount++;
    }
    if (outCount >= depot.fleet || totalService >= MAX_SERVICE_VEHICLES) return false;
    const car = this.spawnService(net, depot);
    if (!car) return false;
    this.cars.push(car);
    depot.next = this.time + 3 + Math.random() * 5;
    return true;
  }

  /** Recalls all non-emergency patrolling vehicles belonging to `buildingId` back to base. */
  recallDepotVehicles(buildingId: string): number {
    let recalled = 0;
    for (const car of this.cars) {
      const sv = car.service;
      if (!sv || sv.home !== buildingId || car.leaving >= 0) continue;
      if (sv.emergencyId || sv.returning) continue;
      if (this.sendVehicleHome(car)) recalled++;
    }
    return recalled;
  }

  private sendVehicleHome(car: Car): boolean {
    const sv = car.service;
    if (!sv || sv.emergencyId || sv.returning) return false;
    if (sv.dwell > 0) {
      sv.stopsLeft = 1;
      sv.dwell = 0.01;
      return true;
    }
    const net = this.network;
    const depot = this.depots.get(sv.home);
    if (!net || !depot) {
      car.leaving = 0;
      return true;
    }
    const stepIdx = this.currentStep(car);
    const curTile = car.tiles[stepIdx] ?? net.tileAt(Math.floor(car.x), Math.floor(car.z));
    const curDir = car.dirs[stepIdx] ?? 0;
    if (!curTile) {
      car.leaving = 0;
      return true;
    }
    if (curTile === depot.tile) {
      sv.returning = true;
      sv.stopsLeft = 0;
      const path: Path = {
        xs: [car.x], zs: [car.z], ss: [0], speed: [DRIVEWAY_SPEED],
        stepS: [0], length: 0, events: [],
      };
      appendPoints(path, this.driveway(depot, true, curDir), DRIVEWAY_SPEED);
      if (path.xs.length >= 2) {
        const prevEv = car.path.events[car.ev];
        prevEv?.junction?.waiting.delete(car);
        this.setPath(car, path, [curTile], [curDir]);
      } else {
        car.leaving = 0;
      }
      return true;
    }
    const trip = this.planTrip(net, curTile, [curDir], depot.tile);
    if (!trip) {
      sv.stopsLeft = 1;
      return true;
    }
    if (Math.hypot(trip.path.xs[0] - car.x, trip.path.zs[0] - car.z) > 1e-3) {
      prependPoints(trip.path, [[car.x, car.z]], Math.min(TURN_SPEED, trip.path.speed[0]));
    }
    appendPoints(trip.path, this.driveway(depot, true, trip.steps[trip.steps.length - 1].dir), DRIVEWAY_SPEED);
    const prevEv = car.path.events[car.ev];
    prevEv?.junction?.waiting.delete(car);
    sv.returning = true;
    sv.stopsLeft = 0;
    this.setPath(car, trip.path, trip.steps.map(st => st.tile), trip.steps.map(st => st.dir));
    return true;
  }

  /** The road cell fronting a building closest to its middle, with the heading into the building. */
  private findAccess(net: RoadNetwork, b: PlacedBuilding): { tile: Tile; side: number } | null {
    const { w, d } = getEffectiveSize(b.type, b.orientation);
    const cx = b.position.x + w / 2, cz = b.position.z + d / 2;
    let best: { tile: Tile; side: number } | null = null;
    let bestScore = Infinity;
    const visit = (x: number, z: number, side: number) => {
      const t = net.tileAt(x, z);
      if (!t || t.roundabout || t.junction || !t.links) return;
      const score = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (score < bestScore) {
        bestScore = score;
        best = { tile: t, side };
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
    return best;
  }

  /** Short drive between the road lane and the inside of the depot. */
  private driveway(depot: Depot, inbound: boolean, travelDir: number): [number, number][] {
    const { tile, side } = depot;
    const cx = tile.x + 0.5, cz = tile.z + 0.5;
    // Angle the drive towards the direction of travel so it reads as a turn.
    const lead = inbound ? 0.18 : -0.18;
    const edge: [number, number] = [
      cx + DX[side] * 0.5 + DX[travelDir] * lead,
      cz + DZ[side] * 0.5 + DZ[travelDir] * lead,
    ];
    const inside: [number, number] = [cx + DX[side] * 0.95, cz + DZ[side] * 0.95];
    return inbound ? [edge, inside] : [inside, edge];
  }

  private pickStop(net: RoadNetwork, from: Tile): Tile | null {
    const candidates = net.endpoints;
    if (!candidates.length) return null;
    let fallback: Tile | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const t = pick(candidates);
      if (t === from) continue;
      fallback ??= t;
      if (Math.abs(t.x - from.x) + Math.abs(t.z - from.z) >= MIN_TRIP) return t;
    }
    return fallback;
  }

  /** Urgent dispatch to active city emergencies (fire, robbery, medical, sewage overflow). */
  private dispatchEmergencies(net: RoadNetwork, state: CityState): void {
    const emergencies = state.emergencies ?? [];
    const activeIds = new Set(emergencies.map(e => e.id));

    // Clean up tracking sets and release responders whose incident already ended
    for (const id of this.reportedResponding) if (!activeIds.has(id)) this.reportedResponding.delete(id);
    for (const id of this.reportedResolved) if (!activeIds.has(id)) this.reportedResolved.delete(id);

    const assigned = new Set<string>();
    const outByDepot = new Map<string, number>();

    for (const car of this.cars) {
      const sv = car.service;
      if (!sv) continue;
      outByDepot.set(sv.home, (outByDepot.get(sv.home) ?? 0) + 1);
      if (sv.emergencyId) {
        if (!activeIds.has(sv.emergencyId)) {
          // Incident already concluded (e.g. timed out or bulldozed): head home
          sv.emergencyId = undefined;
          sv.stopsLeft = 0;
          if (sv.dwell > 0) sv.dwell = 0.01;
        } else {
          assigned.add(sv.emergencyId);
        }
      }
    }

    if (!emergencies.length) return;

    for (const em of emergencies) {
      if (assigned.has(em.id)) continue;
      const targetBuilding = state.buildings.find(b => b.id === em.buildingId);
      if (!targetBuilding) continue;
      const access = this.findAccess(net, targetBuilding);
      if (!access) continue;

      const neededKind = EMERGENCY_SERVICE_KIND[em.kind];

      // 1. Try spawning immediately from the nearest depot of that kind with spare fleet
      const candidateDepots = Array.from(this.depots.values())
        .filter(d => d.kind === neededKind && (outByDepot.get(d.id) ?? 0) < d.fleet)
        .sort((a, b) =>
          (Math.abs(a.tile.x - access.tile.x) + Math.abs(a.tile.z - access.tile.z)) -
          (Math.abs(b.tile.x - access.tile.x) + Math.abs(b.tile.z - access.tile.z))
        );

      let dispatched = false;
      for (const depot of candidateDepots) {
        const car = this.spawnEmergencyVehicle(net, depot, access.tile, em);
        if (car) {
          this.cars.push(car);
          outByDepot.set(depot.id, (outByDepot.get(depot.id) ?? 0) + 1);
          assigned.add(em.id);
          dispatched = true;
          break;
        }
      }
      if (dispatched) continue;

      // 2. Otherwise divert an already-out non-emergency vehicle of the right kind!
      const freeCars = this.cars
        .filter(c => c.leaving < 0 && c.service && c.service.kind === neededKind && !c.service.emergencyId)
        .sort((a, b) =>
          (Math.abs(a.x - access.tile.x) + Math.abs(a.z - access.tile.z)) -
          (Math.abs(b.x - access.tile.x) + Math.abs(b.z - access.tile.z))
        );

      for (const car of freeCars) {
        if (this.divertVehicleToEmergency(net, car, access.tile, em)) {
          assigned.add(em.id);
          break;
        }
      }
    }
  }

  private spawnEmergencyVehicle(
    net: RoadNetwork,
    depot: Depot,
    goalTile: Tile,
    em: CityEmergency,
  ): Car | null {
    const profile = SERVICE_PROFILES[depot.kind];
    const emergencyBoost = Math.max(profile.speed, 1.3);

    let steps: { tile: Tile; dir: number }[];
    let path: Path;

    if (depot.tile === goalTile) {
      const dir = (depot.side + 1) & 3;
      steps = [{ tile: goalTile, dir }];
      path = net.buildPath({ steps, entering: false, exitDir: -1 }, 0);
      if (path.xs.length < 2) {
        appendPoints(path, [[goalTile.x + 0.5, goalTile.z + 0.5]], DRIVEWAY_SPEED);
      }
    } else {
      const trip = this.planTrip(net, depot.tile, [0, 1, 2, 3], goalTile);
      if (!trip) return null;
      steps = trip.steps;
      path = trip.path;
    }

    if (this.isOccupied(path.xs[0], path.zs[0], SPAWN_CLEARANCE * 0.65)) return null;
    for (let k = 0; k < path.speed.length; k++) path.speed[k] *= emergencyBoost;
    prependPoints(path, this.driveway(depot, false, steps[0].dir), DRIVEWAY_SPEED * 1.25);

    const { group, flashers } = createServiceVehicleMesh(depot.kind);
    this.scene.add(group);
    const car: Car = {
      id: this.nextId++,
      mesh: group,
      tiles: steps.map(st => st.tile),
      dirs: steps.map(st => st.dir),
      finalDir: steps[steps.length - 1].dir,
      exiting: false,
      entering: true,
      path,
      s: 0,
      v: 0,
      seg: 0,
      x: path.xs[0],
      z: path.zs[0],
      yaw: 0,
      ev: 0,
      permitted: false,
      movement: null,
      leader: null,
      leaderGap: Infinity,
      controlGap: Infinity,
      ignoreLeader: false,
      waitMemo: 0,
      stuck: 0,
      stuckTotal: 0,
      ghost: 0,
      age: 0,
      leaving: -1,
      service: {
        kind: depot.kind,
        home: depot.id,
        stopsLeft: 1,
        returning: false,
        dwell: 0,
        flashers,
        emergencyId: em.id,
      },
    };
    this.place(car);
    return car;
  }

  private divertVehicleToEmergency(
    net: RoadNetwork,
    car: Car,
    goalTile: Tile,
    em: CityEmergency,
  ): boolean {
    const sv = car.service!;
    const stepIdx = this.currentStep(car);
    const curTile = car.tiles[stepIdx] ?? net.tileAt(Math.floor(car.x), Math.floor(car.z));
    if (!curTile) return false;
    const curDir = car.dirs[stepIdx] ?? 0;

    if (curTile === goalTile) {
      sv.emergencyId = em.id;
      sv.returning = false;
      sv.stopsLeft = 1;
      sv.dwell = rand(SERVICE_PROFILES[sv.kind].dwell);
      car.v = 0;
      this.notifyEmergencyArrived(em.id);
      return true;
    }

    const trip = this.planTrip(net, curTile, [curDir], goalTile);
    if (!trip) return false;

    const emergencyBoost = Math.max(SERVICE_PROFILES[sv.kind].speed, 1.3);
    for (let k = 0; k < trip.path.speed.length; k++) trip.path.speed[k] *= emergencyBoost;
    if (Math.hypot(trip.path.xs[0] - car.x, trip.path.zs[0] - car.z) > 1e-3) {
      prependPoints(trip.path, [[car.x, car.z]], Math.min(TURN_SPEED, trip.path.speed[0]));
    }

    // Remove from any junction wait list before switching routes
    const prevEv = car.path.events[car.ev];
    prevEv?.junction?.waiting.delete(car);

    this.setPath(car, trip.path, trip.steps.map(st => st.tile), trip.steps.map(st => st.dir));
    sv.emergencyId = em.id;
    sv.returning = false;
    sv.stopsLeft = 1;
    sv.dwell = 0;
    return true;
  }

  private notifyEmergencyArrived(emergencyId: string): void {
    if (this.reportedResponding.has(emergencyId)) return;
    this.reportedResponding.add(emergencyId);
    this.onEmergencyArrived?.(emergencyId);
  }

  private notifyEmergencyResolved(emergencyId: string): void {
    if (this.reportedResolved.has(emergencyId)) return;
    this.reportedResolved.add(emergencyId);
    this.onEmergencyResolved?.(emergencyId);
  }

  private dispatchServices(net: RoadNetwork): void {
    if (!this.depots.size) return;
    const out = new Map<string, number>();
    let total = 0;
    for (const car of this.cars) {
      if (!car.service) continue;
      out.set(car.service.home, (out.get(car.service.home) ?? 0) + 1);
      total++;
    }
    for (const depot of this.depots.values()) {
      if (total >= MAX_SERVICE_VEHICLES) return;
      if (this.time < depot.next || (out.get(depot.id) ?? 0) >= depot.fleet) continue;
      const car = this.spawnService(net, depot);
      if (!car) {
        depot.next = this.time + 2;
        continue;
      }
      this.cars.push(car);
      total++;
      // Stagger the rest of the fleet.
      depot.next = this.time + 3 + Math.random() * 6;
    }
  }

  /** Plans a route from `start` and builds its path, or null when unreachable. */
  private planTrip(
    net: RoadNetwork, start: Tile, startDirs: readonly number[], goal: Tile,
  ): { steps: { tile: Tile; dir: number }[]; path: Path } | null {
    let steps = net.findRoute(start, startDirs, { tile: goal, exitDir: -1 });
    if ((!steps || steps.length < 2) && startDirs.length < 4) {
      steps = net.findRoute(start, [0, 1, 2, 3], { tile: goal, exitDir: -1 });
    }
    if (!steps || steps.length < 2) return null;
    steps[0] = { tile: steps[0].tile, dir: steps[1].dir };
    const path = net.buildPath({ steps, entering: false, exitDir: -1 }, Math.random() < 0.5 ? 0 : 1);
    if (path.xs.length < 2) return null;
    return { steps, path };
  }

  private spawnService(net: RoadNetwork, depot: Depot): Car | null {
    const profile = SERVICE_PROFILES[depot.kind];
    const goal = this.pickStop(net, depot.tile);
    if (!goal) return null;
    const trip = this.planTrip(net, depot.tile, [0, 1, 2, 3], goal);
    if (!trip) return null;
    const { steps, path } = trip;
    if (this.isOccupied(path.xs[0], path.zs[0], SPAWN_CLEARANCE)) return null;
    for (let k = 0; k < path.speed.length; k++) path.speed[k] *= profile.speed;
    prependPoints(path, this.driveway(depot, false, steps[0].dir), DRIVEWAY_SPEED);

    const { group, flashers } = createServiceVehicleMesh(depot.kind);
    this.scene.add(group);
    const car: Car = {
      id: this.nextId++,
      mesh: group,
      tiles: steps.map(st => st.tile),
      dirs: steps.map(st => st.dir),
      finalDir: steps[steps.length - 1].dir,
      exiting: false,
      // Emerges from the building at full size rather than popping in.
      entering: true,
      path,
      s: 0,
      v: 0,
      seg: 0,
      x: path.xs[0],
      z: path.zs[0],
      yaw: 0,
      ev: 0,
      permitted: false,
      movement: null,
      leader: null,
      leaderGap: Infinity,
      controlGap: Infinity,
      ignoreLeader: false,
      waitMemo: 0,
      stuck: 0,
      stuckTotal: 0,
      ghost: 0,
      age: 0,
      leaving: -1,
      service: {
        kind: depot.kind,
        home: depot.id,
        stopsLeft: Math.round(rand(profile.stops)),
        returning: false,
        dwell: 0,
        flashers,
      },
    };
    this.place(car);
    return car;
  }

  /** After a stop: on to the next one, or back to base. Returns false if the vehicle should leave. */
  private continueService(car: Car): boolean {
    const sv = car.service!;
    const net = this.network;
    const last = car.tiles[car.tiles.length - 1];
    const start = last && net ? net.tileAt(last.x, last.z) : undefined;
    if (!net || !start) return false;
    const profile = SERVICE_PROFILES[sv.kind];
    const lastDir = car.dirs[car.dirs.length - 1];

    sv.stopsLeft--;
    let trip: ReturnType<CarManager['planTrip']> = null;
    let depot: Depot | undefined;
    if (sv.stopsLeft > 0) {
      const goal = this.pickStop(net, start);
      if (goal) trip = this.planTrip(net, start, [lastDir], goal);
      if (trip) for (let k = 0; k < trip.path.speed.length; k++) trip.path.speed[k] *= profile.speed;
    }
    if (!trip) {
      depot = this.depots.get(sv.home);
      if (!depot) return false;
      sv.returning = true;
      sv.stopsLeft = 0;
      if (depot.tile === start) {
        // Already outside: just pull in.
        const path: Path = {
          xs: [car.x], zs: [car.z], ss: [0], speed: [DRIVEWAY_SPEED],
          stepS: [0], length: 0, events: [],
        };
        appendPoints(path, this.driveway(depot, true, lastDir), DRIVEWAY_SPEED);
        if (path.xs.length < 2) return false;
        this.setPath(car, path, [start], [lastDir]);
        return true;
      }
      trip = this.planTrip(net, start, [lastDir], depot.tile);
      if (!trip) return false;
    }

    const { steps, path } = trip;
    if (Math.hypot(path.xs[0] - car.x, path.zs[0] - car.z) > 1e-3) {
      prependPoints(path, [[car.x, car.z]], Math.min(TURN_SPEED, path.speed[0]));
    }
    if (depot) appendPoints(path, this.driveway(depot, true, steps[steps.length - 1].dir), DRIVEWAY_SPEED);
    this.setPath(car, path, steps.map(st => st.tile), steps.map(st => st.dir));
    return true;
  }

  private setPath(car: Car, path: Path, tiles: Tile[], dirs: number[]): void {
    car.path = path;
    car.tiles = tiles;
    car.dirs = dirs;
    car.finalDir = dirs[dirs.length - 1];
    car.s = 0;
    car.seg = 0;
    car.ev = 0;
    car.permitted = false;
    car.movement = null;
    car.stuck = 0;
    car.stuckTotal = 0;
  }

  // ── Perception ────────────────────────────────────────────

  private hashKey(cx: number, cz: number): number {
    return (cx + 16) * 4096 + (cz + 16);
  }

  private buildHash(): void {
    this.hash.clear();
    for (const car of this.cars) {
      const key = this.hashKey(Math.floor(car.x), Math.floor(car.z));
      let bucket = this.hash.get(key);
      if (!bucket) {
        bucket = [];
        this.hash.set(key, bucket);
      }
      bucket.push(car);
    }
  }

  private query(x: number, z: number, r: number): Car[] {
    const out = this.nearby;
    out.length = 0;
    for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) {
      for (let cz = Math.floor(z - r); cz <= Math.floor(z + r); cz++) {
        const bucket = this.hash.get(this.hashKey(cx, cz));
        if (bucket) for (const car of bucket) out.push(car);
      }
    }
    return out;
  }

  /**
   * Distance along this car's path to the first car sitting on it, between
   * sFrom and sTo. Returns the gap from this car's front to that car's rear.
   */
  private findOnPath(car: Car, sFrom: number, sTo: number, slowOnly: boolean): { other: Car; gap: number } | null {
    const { xs, zs, ss } = car.path;
    const [mx, mz] = positionAt(car.path, (sFrom + sTo) / 2, car.seg);
    const reach = (sTo - sFrom) / 2 + 0.8;
    const candidates = this.query(mx, mz, reach);
    const p = this.player;
    if (p && Math.abs(p.x - mx) <= reach + 1 && Math.abs(p.z - mz) <= reach + 1) candidates.push(p);
    let best: { other: Car; gap: number } | null = null;
    let k0 = car.seg;
    while (k0 > 0 && ss[k0] > sFrom) k0--;
    while (k0 < ss.length - 2 && ss[k0 + 1] < sFrom) k0++;

    for (const other of candidates) {
      if (other === car || (slowOnly && other.v > 0.6)) continue;
      const ohx = Math.cos(other.yaw);
      const ohz = -Math.sin(other.yaw);
      for (let k = k0; k < ss.length - 1 && ss[k] <= sTo; k++) {
        const ax = xs[k], az = zs[k];
        const bx = xs[k + 1] - ax, bz = zs[k + 1] - az;
        const len2 = bx * bx + bz * bz;
        if (len2 === 0) continue;
        // The last segment extends past the path end: a car parking still
        // has to stop short of whoever is queued just beyond its spot.
        const tMax = k === ss.length - 2 ? 1 + CAR_LEN / Math.sqrt(len2) : 1;
        const t = Math.min(tMax, Math.max(0, ((other.x - ax) * bx + (other.z - az) * bz) / len2));
        const dx = other.x - (ax + bx * t);
        const dz = other.z - (az + bz * t);
        // A car crossing at an angle blocks more of the lane than its centre suggests.
        const len = Math.sqrt(len2);
        const tol = LANE_TOL + CROSS_TOL * Math.abs(ohx * bz - ohz * bx) / len;
        if (dx * dx + dz * dz > tol * tol) continue;
        const along = ss[k] + len * t;
        if (along <= car.s + 0.02 || along < sFrom || along > sTo) continue;
        const gap = along - car.s - CAR_LEN;
        if (!best || gap < best.gap) best = { other, gap };
        break;
      }
    }
    return best;
  }

  private scanLeader(car: Car): void {
    const look = Math.min(3.5, 1 + (car.v * car.v) / (2 * BRAKE) + CAR_LEN);
    const hit = this.findOnPath(car, car.s, car.s + look + HALF, false);
    if (hit) {
      car.leader = hit.other;
      car.leaderGap = hit.gap;
    }
  }

  // ── Junction control ──────────────────────────────────────

  private movementFor(car: Car, e: PathEvent): Movement {
    return { car, inDir: e.inDir, outDir: e.outDir, arrival: this.time, frame: this.frame };
  }

  private stopAt(car: Car, dist: number): void {
    car.controlGap = Math.min(car.controlGap, dist);
  }

  private grant(car: Car, e: PathEvent): void {
    car.permitted = true;
    if (e.junction) {
      car.movement = e.junction.waiting.get(car) ?? this.movementFor(car, e);
      e.junction.waiting.delete(car);
      e.junction.occupants.push(car.movement);
    }
  }

  private control(car: Car): void {
    const e = car.path.events[car.ev];
    if (!e || car.permitted || car.leaving >= 0) return;
    const front = car.s + HALF;
    if (front >= e.sEntry) {
      car.permitted = true;
      return;
    }
    const dist = e.sEntry - front;
    if (dist > APPROACH) return;
    const first = car.leaderGap > dist - 0.05;

    if (e.junction) {
      const j = e.junction;
      j.counting[isXAxis(e.inDir) ? 0 : 1]++;
      if (j.control === 'signal') {
        const light = signalFor(j, e.inDir);
        if (light === 'red') return this.stopAt(car, dist);
        if (light === 'yellow') {
          // Too close to stop comfortably: carry on through.
          if (dist <= (car.v * car.v) / (2 * BRAKE_MAX) + 0.05) this.grant(car, e);
          else this.stopAt(car, dist);
          return;
        }
        if (dist > Math.max(0.5, (car.v * car.v) / (2 * BRAKE) + 0.1)) return;
        // Green still means giving way to whoever is already crossing your path
        // (left turns against oncoming traffic, merges into the same exit).
        const mine = this.movementFor(car, e);
        for (const other of j.occupants) {
          if (other.car !== car && movementsConflict(mine, other)) return this.stopAt(car, dist);
        }
        if (!this.exitClear(car, e)) return this.stopAt(car, dist);
        return this.grant(car, e);
      }
      this.yieldAt(car, e, j, dist, first);
      return;
    }

    // Roundabout: give way to traffic already circulating.
    this.stopAt(car, dist);
    if (!first || dist > DECIDE) return;
    const ra = e.roundabout!;
    for (const other of this.query(ra.cx, ra.cz, 2.3)) {
      if (other === car) continue;
      const oe = other.path.events[other.ev];
      if (!oe || oe.roundabout !== ra) continue;
      if (other.s + HALF < oe.sEntry || other.s - HALF > oe.sExit) continue;
      const angle = Math.atan2(other.z - ra.cz, other.x - ra.cx);
      const upstream = ((angle - e.mergeAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      if (upstream < 1.7 || upstream > Math.PI * 2 - 0.5) return;
    }
    car.controlGap = Infinity;
    this.grant(car, e);
  }

  /** All-way give-way: first come, first served among crossing movements. */
  private yieldAt(car: Car, e: PathEvent, j: Junction, dist: number, first: boolean): void {
    this.stopAt(car, dist);
    if (!first) return;
    let mine = j.waiting.get(car);
    if (!mine) {
      mine = this.movementFor(car, e);
      j.waiting.set(car, mine);
    }
    mine.frame = this.frame;
    if (dist > DECIDE) return;

    for (const other of j.occupants) {
      if (other.car !== car && movementsConflict(mine, other)) return;
    }
    for (const other of j.waiting.values()) {
      if (other === mine || other.frame < this.frame - 1) continue;
      if (other.arrival < mine.arrival && movementsConflict(mine, other)) return;
    }
    if (!this.exitClear(car, e)) return;
    car.controlGap = Infinity;
    this.grant(car, e);
  }

  /** Don't enter a junction unless there is room to leave it. */
  private exitClear(car: Car, e: PathEvent): boolean {
    if (e.sExit >= car.path.length - 0.05) return true;
    return !this.findOnPath(car, e.sExit - 0.1, Math.min(car.path.length, e.sExit + CAR_LEN + 0.3), true);
  }

  /** Waiting for a light/give-way, directly or behind a queue that is. */
  private waitingLegitimately(car: Car, depth = 0): boolean {
    if (car.waitMemo) return car.waitMemo > 0;
    let result = false;
    if (car.controlGap <= car.leaderGap) result = true;
    else if (car.leader && depth < 30) result = this.waitingLegitimately(car.leader, depth + 1);
    car.waitMemo = result ? 1 : -1;
    return result;
  }

  // ── Motion ────────────────────────────────────────────────

  /** Advances one car; returns false once it should be removed. */
  private move(car: Car, dt: number): boolean {
    const sv = car.service;
    if (sv && sv.dwell > 0 && car.leaving < 0) {
      // Parked at a stop: lights keep flashing, traffic finds its way round.
      car.v = 0;
      car.age += dt;
      sv.dwell -= dt;
      if (sv.dwell <= 0) {
        if (sv.emergencyId) {
          const resolvedId = sv.emergencyId;
          sv.emergencyId = undefined;
          sv.stopsLeft = 0;
          this.notifyEmergencyResolved(resolvedId);
        }
        if (!this.continueService(car)) car.leaving = 0;
      }
      this.place(car, dt);
      return true;
    }
    const path = car.path;
    car.age += dt;
    car.ghost -= dt;

    // Speed limit: this segment and any slower ones coming up, braking in time.
    let vmax = path.speed[car.seg];
    for (let k = car.seg + 1; k < path.ss.length - 1 && path.ss[k] < car.s + 2; k++) {
      vmax = Math.min(vmax, Math.sqrt(path.speed[k] ** 2 + 2 * BRAKE * Math.max(0, path.ss[k] - car.s)));
    }
    if (!car.exiting) {
      vmax = Math.min(vmax, Math.sqrt(2 * BRAKE * Math.max(0, path.length - car.s)) + 0.15);
    }

    const leaderFree = car.ignoreLeader || car.ghost > 0 ? Infinity : car.leaderGap - MIN_GAP;
    const free = Math.min(leaderFree, car.controlGap - 0.03);
    const target = Math.min(vmax, Math.sqrt(2 * BRAKE * Math.max(0, free)));
    car.v = target > car.v ? Math.min(target, car.v + ACCEL * dt) : Math.max(target, car.v - BRAKE_MAX * dt);
    let ds = car.v * dt;
    if (ds > free) ds = Math.max(0, free);
    car.s = Math.min(path.length, car.s + ds);

    // Deadlock watchdog
    if (car.v < 0.05) {
      car.stuckTotal += dt;
      if (!this.waitingLegitimately(car)) car.stuck += dt;
    } else {
      car.stuck = 0;
      car.stuckTotal = Math.max(0, car.stuckTotal - dt * 2);
    }
    if (car.stuck > DEADLOCK_SECONDS) {
      car.ghost = GHOST_SECONDS;
      car.stuck = 0;
    }
    if (car.stuckTotal > GIVE_UP_SECONDS && car.leaving < 0 && car !== this.riding) car.leaving = 0;

    if (car.s >= path.length - 1e-3 && car === this.riding && !sv && car.leaving < 0 && this.extendRide(car)) {
      // The player is aboard: drive on somewhere new instead of parking or leaving town.
      this.place(car, dt);
      return true;
    }
    if (car.s >= path.length - 1e-3) {
      if (car.exiting) return false;
      if (sv && car.leaving < 0) {
        if (sv.returning) {
          // Back inside: rest before the next call-out.
          const depot = this.depots.get(sv.home);
          if (depot) depot.next = Math.max(depot.next, this.time + rand(SERVICE_PROFILES[sv.kind].rest));
          car.leaving = 0;
        } else {
          if (sv.emergencyId) {
            this.notifyEmergencyArrived(sv.emergencyId);
          }
          sv.dwell = rand(SERVICE_PROFILES[sv.kind].dwell);
          car.v = 0;
        }
      } else if (car.leaving < 0) car.leaving = 0;
    }

    this.place(car, dt);

    if (car.leaving >= 0) {
      car.leaving += dt;
      if (car.leaving >= FADE) return false;
      car.mesh.scale.setScalar(1 - car.leaving / FADE);
    } else if (!car.entering && car.age < FADE) {
      car.mesh.scale.setScalar(0.3 + 0.7 * (car.age / FADE));
    } else {
      car.mesh.scale.setScalar(1);
    }
    return true;
  }

  /** Gives a ridden car a fresh trip from where it is now; false if there is nowhere to go. */
  private extendRide(car: Car): boolean {
    const net = this.network;
    const last = car.tiles[car.tiles.length - 1];
    const from = last ? net?.tileAt(last.x, last.z) : null;
    if (!net || !from || !net.endpoints.length) return false;
    const dir = car.dirs[car.dirs.length - 1];
    for (let attempt = 0; attempt < 6; attempt++) {
      const goal = pick(net.endpoints);
      if (goal === from || (attempt < 4 && Math.abs(goal.x - from.x) + Math.abs(goal.z - from.z) < 6)) continue;
      const trip = this.planTrip(net, from, [dir], goal);
      if (!trip) continue;
      car.path.events[car.ev]?.junction?.waiting.delete(car);
      car.tiles = trip.steps.map(st => st.tile);
      car.dirs = trip.steps.map(st => st.dir);
      car.finalDir = trip.steps[trip.steps.length - 1].dir;
      car.exiting = car.entering = false;
      car.path = trip.path;
      car.s = nearestS(trip.path, car.x, car.z);
      car.seg = 0;
      car.ev = 0;
      car.permitted = false;
      car.movement = null;
      car.stuck = car.stuckTotal = 0;
      return true;
    }
    return false;
  }

  private place(car: Car, dt = 0): void {
    const { xs, zs, ss } = car.path;
    while (car.seg < ss.length - 2 && ss[car.seg + 1] <= car.s) car.seg++;
    const k = car.seg;
    const len = ss[k + 1] - ss[k];
    const t = len > 0 ? Math.min(1, Math.max(0, (car.s - ss[k]) / len)) : 0;
    car.x = xs[k] + (xs[k + 1] - xs[k]) * t;
    car.z = zs[k] + (zs[k + 1] - zs[k]) * t;
    const heading = Math.atan2(-(zs[k + 1] - zs[k]), xs[k + 1] - xs[k]);
    car.yaw = dt > 0 ? car.yaw + angleDelta(car.yaw, heading) * (1 - Math.exp(-dt * 14)) : heading;
    car.mesh.position.set(car.x * CELL_SIZE, CAR_Y, car.z * CELL_SIZE);
    car.mesh.rotation.y = car.yaw;
  }

  private removeMesh(car: Car): void {
    this.scene.remove(car.mesh);
    this.disposeMesh(car.mesh);
    const e = car.path.events[car.ev];
    e?.junction?.waiting.delete(car);
  }

  private disposeMesh(group: THREE.Group): void {
    disposeCarMesh(group);
  }
}

/** Distance along a path of its closest point to (x, z), so a re-routed car carries on from where it is. */
function nearestS(path: Path, x: number, z: number): number {
  const { xs, zs, ss } = path;
  let best = 0, bestD = Infinity;
  for (let k = 0; k + 1 < xs.length; k++) {
    const dx = xs[k + 1] - xs[k], dz = zs[k + 1] - zs[k];
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - xs[k]) * dx + (z - zs[k]) * dz) / len2)) : 0;
    const d = (xs[k] + dx * t - x) ** 2 + (zs[k] + dz * t - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = ss[k] + (ss[k + 1] - ss[k]) * t;
    }
  }
  return best;
}

// ── Car model ─────────────────────────────────────────────

let contactShadowTexture: THREE.Texture | null = null;

/** A soft dark oval under the car, shared texture, own geometry and material (cars dispose theirs). */
export function createContactShadow(): THREE.Mesh {
  if (!contactShadowTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(32, 32, 4, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.75)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    contactShadowTexture = new THREE.CanvasTexture(canvas);
  }
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.72, 0.4).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: contactShadowTexture, color: 0x000000, transparent: true, opacity: 0.42,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
  );
  shadow.name = 'contact-shadow';
  shadow.position.y = 0.006;
  shadow.renderOrder = -1;
  return shadow;
}

/** A small car, nose along +x, about half a cell long. */
export function createCarMesh(color: number): THREE.Group {
  const group = new THREE.Group();
  // Cars move all the time, so they don't cast into the sun's shadow map (it
  // would have to be redrawn every frame); a soft contact shadow sits under them.
  group.add(createContactShadow());

  // Materials
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.6,
    roughness: 0.4
  });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    metalness: 0.9,
    roughness: 0.1,
    transparent: true,
    opacity: 0.7
  });
  const wheelMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    metalness: 0.3,
    roughness: 0.8
  });
  const hubcapMaterial = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    metalness: 0.8,
    roughness: 0.2
  });
  const headlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffee,
    emissive: 0xffffaa,
    emissiveIntensity: 0.3
  });
  const taillightMaterial = new THREE.MeshStandardMaterial({
    color: 0xff2222,
    emissive: 0xff0000,
    emissiveIntensity: 0.4
  });
  const grilleMaterial = new THREE.MeshStandardMaterial({
    color: 0x222222,
    metalness: 0.5,
    roughness: 0.5
  });

  // Main car body - lower section (longer, sleeker)
  const bodyLower = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.12, 0.26),
    bodyMaterial,
  );
  bodyLower.position.y = 0.08;
  bodyLower.receiveShadow = true;
  group.add(bodyLower);

  // Hood (front sloped section)
  const hood = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.04, 0.24),
    bodyMaterial,
  );
  hood.position.set(0.16, 0.14, 0);
  hood.rotation.z = -0.15;
  group.add(hood);

  // Trunk (rear section)
  const trunk = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.04, 0.24),
    bodyMaterial,
  );
  trunk.position.set(-0.20, 0.14, 0);
  trunk.rotation.z = 0.1;
  group.add(trunk);

  // Cabin (passenger compartment)
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.11, 0.22),
    bodyMaterial,
  );
  cabin.position.set(-0.02, 0.19, 0);
  group.add(cabin);

  // Front windshield (angled)
  const frontWindshield = new THREE.Mesh(
    new THREE.PlaneGeometry(0.20, 0.10),
    glassMaterial,
  );
  frontWindshield.position.set(0.08, 0.20, 0);
  frontWindshield.rotation.y = Math.PI / 2;
  frontWindshield.rotation.x = 0;
  frontWindshield.rotation.z = -0.4;
  group.add(frontWindshield);

  // Rear windshield (angled)
  const rearWindshield = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.09),
    glassMaterial,
  );
  rearWindshield.position.set(-0.12, 0.20, 0);
  rearWindshield.rotation.y = Math.PI / 2;
  rearWindshield.rotation.z = 0.35;
  group.add(rearWindshield);

  // Side windows
  const sideWindowGeom = new THREE.PlaneGeometry(0.18, 0.08);
  const leftWindow = new THREE.Mesh(sideWindowGeom, glassMaterial);
  leftWindow.position.set(-0.02, 0.21, 0.112);
  leftWindow.rotation.y = 0;
  group.add(leftWindow);

  const rightWindow = new THREE.Mesh(sideWindowGeom, glassMaterial);
  rightWindow.position.set(-0.02, 0.21, -0.112);
  rightWindow.rotation.y = Math.PI;
  group.add(rightWindow);

  // Wheels (4 cylinders with hubcaps)
  const wheelGeom = new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12);
  const hubcapGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.01, 8);
  const wheelPositions = [
    { x: 0.16, z: 0.13 },   // front-left
    { x: 0.16, z: -0.13 },  // front-right
    { x: -0.16, z: 0.13 },  // rear-left
    { x: -0.16, z: -0.13 }, // rear-right
  ];

  for (const pos of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeom, wheelMaterial);
    wheel.position.set(pos.x, 0.05, pos.z);
    wheel.rotation.x = Math.PI / 2;
    group.add(wheel);

    // Hubcap
    const hubcap = new THREE.Mesh(hubcapGeom, hubcapMaterial);
    hubcap.position.set(pos.x, 0.05, pos.z > 0 ? pos.z + 0.02 : pos.z - 0.02);
    hubcap.rotation.x = Math.PI / 2;
    group.add(hubcap);
  }

  // Headlights (front)
  const headlightGeom = new THREE.BoxGeometry(0.02, 0.03, 0.06);
  const leftHeadlight = new THREE.Mesh(headlightGeom, headlightMaterial);
  leftHeadlight.position.set(0.27, 0.10, 0.08);
  group.add(leftHeadlight);

  const rightHeadlight = new THREE.Mesh(headlightGeom, headlightMaterial);
  rightHeadlight.position.set(0.27, 0.10, -0.08);
  group.add(rightHeadlight);

  // Taillights (rear)
  const taillightGeom = new THREE.BoxGeometry(0.02, 0.03, 0.05);
  const leftTaillight = new THREE.Mesh(taillightGeom, taillightMaterial);
  leftTaillight.position.set(-0.27, 0.10, 0.09);
  group.add(leftTaillight);

  const rightTaillight = new THREE.Mesh(taillightGeom, taillightMaterial);
  rightTaillight.position.set(-0.27, 0.10, -0.09);
  group.add(rightTaillight);

  // Front grille
  const grille = new THREE.Mesh(
    new THREE.BoxGeometry(0.01, 0.05, 0.14),
    grilleMaterial,
  );
  grille.position.set(0.275, 0.09, 0);
  group.add(grille);

  // Bumpers
  const bumperMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    metalness: 0.4,
    roughness: 0.6
  });
  const frontBumper = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.04, 0.26),
    bumperMaterial,
  );
  frontBumper.position.set(0.28, 0.04, 0);
  group.add(frontBumper);

  const rearBumper = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.04, 0.26),
    bumperMaterial,
  );
  rearBumper.position.set(-0.28, 0.04, 0);
  group.add(rearBumper);

  // Scale the whole car slightly for better visibility
  group.scale.set(0.9, 0.9, 0.9);

  return group;
}

export function disposeCarMesh(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) {
        child.material.dispose();
      }
    }
  });
}
