import * as THREE from 'three';
import {
  type CityState,
  type Position,
  BUILDING_DEFS,
  isRoad,
  CELL_SIZE,
  DEFAULT_GRID_SIZE,
  getEffectiveSize,
} from '@cityzen/shared';

const CAR_COLORS = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0xff8f00, 0x8e24aa];
const CAR_SPEED = 2.5; // cells per second
const MAX_CARS = 20;
const CARS_PER_ROAD = 0.15; // spawn ratio: 1 car per ~7 road tiles
const COLLISION_DISTANCE = 0.4; // minimum distance before stopping (in cells)
const SLOW_DOWN_DISTANCE = 0.8; // distance at which cars start slowing down
const CAR_Y = 0.03; // Y position: wheels sit just above road surface (road at 0.02)

interface Direction {
  dx: number;
  dz: number;
}

const DIRECTIONS: Direction[] = [
  { dx: 1, dz: 0 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: 0, dz: -1 },
];

interface Car {
  mesh: THREE.Group;
  /** Current grid cell the car is moving from */
  from: Position;
  /** Grid cell the car is moving toward */
  to: Position;
  /** 0..1 interpolation between from and to */
  progress: number;
  /** Current movement direction */
  direction: Direction;
  /** Direction the car was traveling when it entered the 'from' cell */
  prevDirection: Direction;
  /** Current speed multiplier (0 = stopped, 1 = full speed) */
  speedMultiplier: number;
  /** Whether the car is performing a U-turn at a dead end */
  uTurn: boolean;
  /** Whether the car is driving off the grid edge */
  exiting: boolean;
}

export class CarManager {
  private scene: THREE.Scene;
  private cars: Car[] = [];
  private roadSet: Set<string> = new Set();
  private roadSpeedMap: Map<string, number> = new Map();
  private roadBuildingMap: Map<string, string> = new Map();
  private roadBuildingData: Map<string, { x: number; z: number; w: number; d: number }> = new Map();
  private enabled = true;
  private maxCarLimit = MAX_CARS;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  setMaxCars(max: number): void {
    this.maxCarLimit = max;
  }

  update(deltaTime: number, state: CityState | null): void {
    if (!state || !this.enabled) return;

    this.rebuildRoadSet(state);
    this.adjustCarCount();

    for (let ci = this.cars.length - 1; ci >= 0; ci--) {
      const car = this.cars[ci];
      // Check for cars ahead and adjust speed
      const carAhead = this.getCarAhead(car);
      if (carAhead) {
        const distance = this.getDistanceToCar(car, carAhead);
        if (distance < COLLISION_DISTANCE) {
          // Too close - stop completely
          car.speedMultiplier = 0;
        } else if (distance < SLOW_DOWN_DISTANCE) {
          // Gradually slow down as we approach
          car.speedMultiplier = Math.max(0.1, (distance - COLLISION_DISTANCE) / (SLOW_DOWN_DISTANCE - COLLISION_DISTANCE));
        } else {
          car.speedMultiplier = 1;
        }
      } else {
        // No car ahead - full speed
        car.speedMultiplier = Math.min(1, car.speedMultiplier + deltaTime * 2); // Gradually accelerate
      }

      // Road speed multiplier + U-turn slowdown
      const roadSpeed = this.roadSpeedMap.get(this.posKey(car.from)) ?? 1.0;
      const speedFactor = car.uTurn ? 0.6 : 1;
      car.progress += CAR_SPEED * deltaTime * car.speedMultiplier * speedFactor * roadSpeed;

      if (car.progress >= 1) {
        if (car.exiting) {
          // Car has driven off the edge — remove it
          this.scene.remove(car.mesh);
          this.disposeMesh(car.mesh);
          this.cars.splice(ci, 1);
          continue;
        }
        // Arrived at destination cell — pick next cell
        car.from = car.to;
        car.progress = 0;
        car.uTurn = false;
        this.pickNextCell(car);
      }

      if (car.uTurn) {
        // U-turn: follow a semicircular arc within the same cell
        const cellCenter = this.gridToWorld(car.from);
        const laneWidth = CELL_SIZE * 0.3;
        const arcShift = CELL_SIZE * 0.2;

        const arcCenterX = cellCenter.x + car.prevDirection.dx * arcShift;
        const arcCenterZ = cellCenter.z + car.prevDirection.dz * arcShift;
        const startAngle = Math.atan2(-car.prevDirection.dx, car.prevDirection.dz);
        const currentAngle = startAngle - Math.PI * car.progress;

        const carX = arcCenterX + Math.cos(currentAngle) * laneWidth;
        const carZ = arcCenterZ + Math.sin(currentAngle) * laneWidth;
        car.mesh.position.set(carX, CAR_Y, carZ);

        const tangentX = Math.sin(currentAngle);
        const tangentZ = -Math.cos(currentAngle);
        car.mesh.rotation.y = Math.atan2(-tangentZ, tangentX);
      } else {
        const worldFrom = this.gridToWorld(car.from);
        const worldTo = this.gridToWorld(car.to);
        const prevOff = this.getLaneOffset(car.prevDirection);
        const currOff = this.getLaneOffset(car.direction);
        const t = car.progress;

        // Start and end positions in lane
        const sx = worldFrom.x + prevOff.x;
        const sz = worldFrom.z + prevOff.z;
        const ex = worldTo.x + currOff.x;
        const ez = worldTo.z + currOff.z;

        const isTurn = car.prevDirection.dx !== car.direction.dx
                    || car.prevDirection.dz !== car.direction.dz;

        let carX: number, carZ: number;

        if (isTurn) {
          // Detect left vs right turn via cross product
          const cross = car.prevDirection.dx * car.direction.dz
                      - car.prevDirection.dz * car.direction.dx;
          const isLeftTurn = cross < 0;

          let tx: number, tz: number;

          if (isLeftTurn) {
            // Left turn: route through intersection center in two phases.
            // Phase 1 (t 0→0.5): lane → center, Phase 2 (t 0.5→1): center → exit lane.
            const mx = worldFrom.x;
            const mz = worldFrom.z;
            const d = CELL_SIZE * 0.35;

            if (t < 0.5) {
              const pt = t * 2;
              const mp = 1 - pt;
              // Quadratic Bézier: S → C1 → M
              const c1x = sx + car.prevDirection.dx * d;
              const c1z = sz + car.prevDirection.dz * d;
              carX = mp*mp*sx + 2*mp*pt*c1x + pt*pt*mx;
              carZ = mp*mp*sz + 2*mp*pt*c1z + pt*pt*mz;
              tx = 2*mp*(c1x - sx) + 2*pt*(mx - c1x);
              tz = 2*mp*(c1z - sz) + 2*pt*(mz - c1z);
            } else {
              const pt = (t - 0.5) * 2;
              const mp = 1 - pt;
              // Quadratic Bézier: M → C2 → E
              const c2x = ex - car.direction.dx * d;
              const c2z = ez - car.direction.dz * d;
              carX = mp*mp*mx + 2*mp*pt*c2x + pt*pt*ex;
              carZ = mp*mp*mz + 2*mp*pt*c2z + pt*pt*ez;
              tx = 2*mp*(c2x - mx) + 2*pt*(ex - c2x);
              tz = 2*mp*(c2z - mz) + 2*pt*(ez - c2z);
            }
          } else {
            // Right turn: cubic Bézier hugging the inner corner.
            const d = CELL_SIZE * 0.5;
            const c1x = sx + car.prevDirection.dx * d;
            const c1z = sz + car.prevDirection.dz * d;
            const c2x = ex - car.direction.dx * d;
            const c2z = ez - car.direction.dz * d;

            const mt = 1 - t;
            carX = mt*mt*mt*sx + 3*mt*mt*t*c1x + 3*mt*t*t*c2x + t*t*t*ex;
            carZ = mt*mt*mt*sz + 3*mt*mt*t*c1z + 3*mt*t*t*c2z + t*t*t*ez;
            tx = 3*mt*mt*(c1x-sx) + 6*mt*t*(c2x-c1x) + 3*t*t*(ex-c2x);
            tz = 3*mt*mt*(c1z-sz) + 6*mt*t*(c2z-c1z) + 3*t*t*(ez-c2z);
          }

          car.mesh.rotation.y = Math.atan2(-tz, tx);
        } else {
          // Straight: simple linear interpolation
          carX = sx + (ex - sx) * t;
          carZ = sz + (ez - sz) * t;
          car.mesh.rotation.y = Math.atan2(-car.direction.dz, car.direction.dx);
        }

        car.mesh.position.set(carX, CAR_Y, carZ);
      }
    }
  }

  /** Calculate the lane offset for right-hand traffic */
  private getLaneOffset(direction: Direction): { x: number; z: number } {
    // Offset perpendicular to direction, to the right
    // In this coordinate system (+Z = south), 90° clockwise rotation of (dx, dz) is (-dz, dx)
    const laneWidth = CELL_SIZE * 0.3;
    return {
      x: -direction.dz * laneWidth,
      z: direction.dx * laneWidth,
    };
  }

  /** Find a car that is ahead of this car in its direction of travel */
  private getCarAhead(car: Car): Car | null {
    let closestCar: Car | null = null;
    let closestDistance = Infinity;

    for (const other of this.cars) {
      if (other === car || other.exiting) continue;

      // Check if the other car is ahead of this car
      if (this.isCarAhead(car, other)) {
        const distance = this.getDistanceToCar(car, other);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestCar = other;
        }
      }
    }

    return closestCar;
  }

  /** Check if 'other' car is ahead of 'car' in its direction of travel */
  private isCarAhead(car: Car, other: Car): boolean {
    // Cars traveling in opposite directions are in different lanes - ignore them
    const dirDot = car.direction.dx * other.direction.dx + car.direction.dz * other.direction.dz;
    if (dirDot < 0) {
      // Opposite directions - different lanes, no collision possible
      return false;
    }

    // Get actual world positions (including lane offsets)
    const carPos = this.getCarWorldPosition(car);
    const otherPos = this.getCarWorldPosition(other);

    // Vector from car to other
    const toOther = {
      x: otherPos.x - carPos.x,
      z: otherPos.z - carPos.z,
    };

    // Normalize car's direction
    const dirLength = Math.sqrt(car.direction.dx * car.direction.dx + car.direction.dz * car.direction.dz);
    const normDir = {
      dx: car.direction.dx / dirLength,
      dz: car.direction.dz / dirLength,
    };

    // Dot product to check if other is in front
    const dot = toOther.x * normDir.dx + toOther.z * normDir.dz;

    // Cross product magnitude for lateral distance (should be small for same lane)
    const cross = Math.abs(toOther.x * normDir.dz - toOther.z * normDir.dx);

    // Other car is ahead if:
    // 1. Dot product is positive (in front)
    // 2. Lateral distance is small (same lane - tighter check now that we have lanes)
    return dot > 0 && cross < CELL_SIZE * 0.35;
  }

  /** Get the world position of a car (including interpolated lane offset) */
  private getCarWorldPosition(car: Car): { x: number; z: number } {
    if (car.uTurn) {
      const cellCenter = this.gridToWorld(car.from);
      const laneWidth = CELL_SIZE * 0.3;
      const arcShift = CELL_SIZE * 0.2;
      const arcCenterX = cellCenter.x + car.prevDirection.dx * arcShift;
      const arcCenterZ = cellCenter.z + car.prevDirection.dz * arcShift;
      const startAngle = Math.atan2(-car.prevDirection.dx, car.prevDirection.dz);
      const currentAngle = startAngle - Math.PI * car.progress;
      return {
        x: arcCenterX + Math.cos(currentAngle) * laneWidth,
        z: arcCenterZ + Math.sin(currentAngle) * laneWidth,
      };
    }

    const worldFrom = this.gridToWorld(car.from);
    const worldTo = this.gridToWorld(car.to);
    const prevOff = this.getLaneOffset(car.prevDirection);
    const currOff = this.getLaneOffset(car.direction);
    const t = car.progress;

    const sx = worldFrom.x + prevOff.x;
    const sz = worldFrom.z + prevOff.z;
    const ex = worldTo.x + currOff.x;
    const ez = worldTo.z + currOff.z;

    const isTurn = car.prevDirection.dx !== car.direction.dx
                || car.prevDirection.dz !== car.direction.dz;

    if (isTurn) {
      const cross = car.prevDirection.dx * car.direction.dz
                  - car.prevDirection.dz * car.direction.dx;
      const isLeftTurn = cross < 0;

      if (isLeftTurn) {
        const mx = worldFrom.x;
        const mz = worldFrom.z;
        const d = CELL_SIZE * 0.35;

        if (t < 0.5) {
          const pt = t * 2;
          const mp = 1 - pt;
          const c1x = sx + car.prevDirection.dx * d;
          const c1z = sz + car.prevDirection.dz * d;
          return {
            x: mp*mp*sx + 2*mp*pt*c1x + pt*pt*mx,
            z: mp*mp*sz + 2*mp*pt*c1z + pt*pt*mz,
          };
        } else {
          const pt = (t - 0.5) * 2;
          const mp = 1 - pt;
          const c2x = ex - car.direction.dx * d;
          const c2z = ez - car.direction.dz * d;
          return {
            x: mp*mp*mx + 2*mp*pt*c2x + pt*pt*ex,
            z: mp*mp*mz + 2*mp*pt*c2z + pt*pt*ez,
          };
        }
      } else {
        const d = CELL_SIZE * 0.5;
        const c1x = sx + car.prevDirection.dx * d;
        const c1z = sz + car.prevDirection.dz * d;
        const c2x = ex - car.direction.dx * d;
        const c2z = ez - car.direction.dz * d;
        const mt = 1 - t;
        return {
          x: mt*mt*mt*sx + 3*mt*mt*t*c1x + 3*mt*t*t*c2x + t*t*t*ex,
          z: mt*mt*mt*sz + 3*mt*mt*t*c1z + 3*mt*t*t*c2z + t*t*t*ez,
        };
      }
    }

    return {
      x: sx + (ex - sx) * t,
      z: sz + (ez - sz) * t,
    };
  }

  /** Calculate distance between two cars in world units */
  private getDistanceToCar(car: Car, other: Car): number {
    const carPos = this.getCarWorldPosition(car);
    const otherPos = this.getCarWorldPosition(other);
    const dx = otherPos.x - carPos.x;
    const dz = otherPos.z - carPos.z;
    return Math.sqrt(dx * dx + dz * dz) / CELL_SIZE; // Return distance in cells
  }

  clear(): void {
    for (const car of this.cars) {
      this.scene.remove(car.mesh);
      this.disposeMesh(car.mesh);
    }
    this.cars = [];
    this.roadSet.clear();
    this.roadSpeedMap.clear();
    this.roadBuildingMap.clear();
    this.roadBuildingData.clear();
  }

  private rebuildRoadSet(state: CityState): void {
    this.roadSet.clear();
    this.roadSpeedMap.clear();
    this.roadBuildingMap.clear();
    this.roadBuildingData.clear();
    for (const b of state.buildings) {
      if (isRoad(b.type)) {
        const def = BUILDING_DEFS[b.type];
        const speed = def.speedMultiplier ?? 1.0;
        const { w, d } = getEffectiveSize(b.type, b.orientation);
        this.roadBuildingData.set(b.id, {
          x: b.position.x, z: b.position.z,
          w, d,
        });
        for (let dx = 0; dx < w; dx++) {
          for (let dz = 0; dz < d; dz++) {
            const key = `${b.position.x + dx},${b.position.z + dz}`;
            this.roadSet.add(key);
            this.roadSpeedMap.set(key, speed);
            this.roadBuildingMap.set(key, b.id);
          }
        }
      }
    }
  }

  private adjustCarCount(): void {
    const desiredCount = Math.min(this.maxCarLimit, Math.floor(this.roadSet.size * CARS_PER_ROAD));

    // Remove excess cars
    while (this.cars.length > desiredCount) {
      const car = this.cars.pop()!;
      this.scene.remove(car.mesh);
      this.disposeMesh(car.mesh);
    }

    // Remove cars sitting on demolished roads
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      if (!this.roadSet.has(this.posKey(car.from)) && !this.roadSet.has(this.posKey(car.to))) {
        this.scene.remove(car.mesh);
        this.disposeMesh(car.mesh);
        this.cars.splice(i, 1);
      }
    }

    // Spawn new cars
    while (this.cars.length < desiredCount && this.roadSet.size > 0) {
      const car = this.spawnCar();
      if (car) {
        this.cars.push(car);
      } else {
        break;
      }
    }
  }

  private spawnCar(): Car | null {
    const roads = Array.from(this.roadSet);
    if (roads.length === 0) return null;

    // 30% chance to spawn from a grid edge if edge roads exist
    if (Math.random() < 0.3) {
      const edgeCar = this.spawnEdgeCar();
      if (edgeCar) return edgeCar;
    }

    // Pick a random road cell
    const startKey = roads[Math.floor(Math.random() * roads.length)];
    const from = this.keyToPos(startKey);

    const mesh = this.createCarMesh();
    const worldPos = this.gridToWorld(from);
    mesh.position.set(worldPos.x, CAR_Y, worldPos.z);
    this.scene.add(mesh);

    const dir = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
    const car: Car = {
      mesh,
      from,
      to: { ...from },
      progress: 0,
      direction: dir,
      prevDirection: dir,
      speedMultiplier: 1,
      uTurn: false,
      exiting: false,
    };

    this.pickNextCell(car);
    return car;
  }

  /** Find road cells on the grid edges that can receive cars from outside */
  private getEdgeRoadCells(): { pos: Position; dir: Direction }[] {
    const result: { pos: Position; dir: Direction }[] = [];
    for (const key of this.roadSet) {
      const pos = this.keyToPos(key);
      // West edge: car enters heading east
      if (pos.x === 0) result.push({ pos, dir: { dx: 1, dz: 0 } });
      // East edge: car enters heading west
      if (pos.x === DEFAULT_GRID_SIZE - 1) result.push({ pos, dir: { dx: -1, dz: 0 } });
      // North edge: car enters heading south
      if (pos.z === 0) result.push({ pos, dir: { dx: 0, dz: 1 } });
      // South edge: car enters heading north
      if (pos.z === DEFAULT_GRID_SIZE - 1) result.push({ pos, dir: { dx: 0, dz: -1 } });
    }
    return result;
  }

  /** Spawn a car entering from outside the grid at an edge road cell */
  private spawnEdgeCar(): Car | null {
    const edges = this.getEdgeRoadCells();
    if (edges.length === 0) return null;

    const pick = edges[Math.floor(Math.random() * edges.length)];
    // Start one cell outside the grid
    const from: Position = {
      x: pick.pos.x - pick.dir.dx,
      z: pick.pos.z - pick.dir.dz,
    };

    const mesh = this.createCarMesh();
    const worldPos = this.gridToWorld(from);
    mesh.position.set(worldPos.x, CAR_Y, worldPos.z);
    const angle = Math.atan2(-pick.dir.dz, pick.dir.dx);
    mesh.rotation.y = angle;
    this.scene.add(mesh);

    return {
      mesh,
      from,
      to: pick.pos,
      progress: 0,
      direction: pick.dir,
      prevDirection: pick.dir,
      speedMultiplier: 1,
      uTurn: false,
      exiting: false,
    };
  }

  private pickNextCell(car: Car): void {
    // Save current direction as previous before potentially changing it
    car.prevDirection = { ...car.direction };

    // Try to continue in the same direction first
    const forward: Position = {
      x: car.from.x + car.direction.dx,
      z: car.from.z + car.direction.dz,
    };

    if (this.canMoveTo(car.from, forward)) {
      car.to = forward;
      this.rotateCarMesh(car);
      return;
    }

    // If forward is off-grid, let the car drive off the edge
    if (this.isOffGrid(forward) && this.isEdgeRoad(car.from, car.direction)) {
      car.to = forward;
      car.exiting = true;
      this.rotateCarMesh(car);
      return;
    }

    // Otherwise pick a random adjacent road (excluding where we came from)
    const neighbors = DIRECTIONS
      .map((d) => ({ pos: { x: car.from.x + d.dx, z: car.from.z + d.dz }, dir: d }))
      .filter(({ pos, dir }) => {
        // Don't reverse direction unless it's the only option
        const isReverse = dir.dx === -car.direction.dx && dir.dz === -car.direction.dz;
        return !isReverse && this.canMoveTo(car.from, pos);
      });

    if (neighbors.length > 0) {
      const pick = neighbors[Math.floor(Math.random() * neighbors.length)];
      car.to = pick.pos;
      car.direction = pick.dir;
      this.rotateCarMesh(car);
      return;
    }

    // Dead end — perform U-turn arc, then continue in reverse
    const reverse: Position = {
      x: car.from.x - car.direction.dx,
      z: car.from.z - car.direction.dz,
    };

    if (this.canMoveTo(car.from, reverse)) {
      // U-turn: stay in same cell, reverse direction, follow arc
      car.to = { ...car.from };
      car.direction = { dx: -car.direction.dx, dz: -car.direction.dz };
      car.uTurn = true;
      return;
    }

    // Completely isolated — stay put
    car.to = { ...car.from };
  }

  /** Check if a position is outside the grid bounds */
  private isOffGrid(pos: Position): boolean {
    return pos.x < 0 || pos.x >= DEFAULT_GRID_SIZE || pos.z < 0 || pos.z >= DEFAULT_GRID_SIZE;
  }

  /** Check if a road cell is on the grid edge facing the given direction */
  private isEdgeRoad(pos: Position, dir: Direction): boolean {
    if (!this.roadSet.has(this.posKey(pos))) return false;
    if (dir.dx === 1 && pos.x === DEFAULT_GRID_SIZE - 1) return true;
    if (dir.dx === -1 && pos.x === 0) return true;
    if (dir.dz === 1 && pos.z === DEFAULT_GRID_SIZE - 1) return true;
    if (dir.dz === -1 && pos.z === 0) return true;
    return false;
  }

  private isRoad(pos: Position): boolean {
    if (pos.x < 0 || pos.x >= DEFAULT_GRID_SIZE || pos.z < 0 || pos.z >= DEFAULT_GRID_SIZE) {
      return false;
    }
    return this.roadSet.has(this.posKey(pos));
  }

  /** Check if a car can move from one cell to an adjacent cell */
  private canMoveTo(from: Position, to: Position): boolean {
    if (!this.isRoad(to)) return false;

    const fromId = this.roadBuildingMap.get(this.posKey(from));
    const toId = this.roadBuildingMap.get(this.posKey(to));
    if (!fromId || !toId) return false;

    // Same building: always allow internal movement
    if (fromId === toId) return true;

    // Different buildings: only allow if both cells are on their respective
    // building edges facing the direction of movement
    const fromData = this.roadBuildingData.get(fromId)!;
    const toData = this.roadBuildingData.get(toId)!;

    const dx = to.x - from.x;
    const dz = to.z - from.z;

    // Check 'from' cell is on the exit edge of its building
    let fromOnEdge = false;
    if (dx === 1) fromOnEdge = from.x === fromData.x + fromData.w - 1;
    else if (dx === -1) fromOnEdge = from.x === fromData.x;
    else if (dz === 1) fromOnEdge = from.z === fromData.z + fromData.d - 1;
    else if (dz === -1) fromOnEdge = from.z === fromData.z;

    // Check 'to' cell is on the entry edge of its building
    let toOnEdge = false;
    if (dx === 1) toOnEdge = to.x === toData.x;
    else if (dx === -1) toOnEdge = to.x === toData.x + toData.w - 1;
    else if (dz === 1) toOnEdge = to.z === toData.z;
    else if (dz === -1) toOnEdge = to.z === toData.z + toData.d - 1;

    return fromOnEdge && toOnEdge;
  }

  private createCarMesh(): THREE.Group {
    const group = new THREE.Group();
    const color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];

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
    bodyLower.castShadow = true;
    bodyLower.receiveShadow = true;
    group.add(bodyLower);

    // Hood (front sloped section)
    const hood = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.04, 0.24),
      bodyMaterial,
    );
    hood.position.set(0.16, 0.14, 0);
    hood.rotation.z = -0.15;
    hood.castShadow = true;
    group.add(hood);

    // Trunk (rear section)
    const trunk = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.04, 0.24),
      bodyMaterial,
    );
    trunk.position.set(-0.20, 0.14, 0);
    trunk.rotation.z = 0.1;
    trunk.castShadow = true;
    group.add(trunk);

    // Cabin (passenger compartment)
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.11, 0.22),
      bodyMaterial,
    );
    cabin.position.set(-0.02, 0.19, 0);
    cabin.castShadow = true;
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
      wheel.castShadow = true;
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

  private rotateCarMesh(car: Car): void {
    // Car model is built with front facing +X direction
    // Rotation is smoothly interpolated in the update loop
    // Only set rotation immediately for initial spawn (when prevDirection === direction)
    if (car.prevDirection.dx === car.direction.dx && car.prevDirection.dz === car.direction.dz) {
      const angle = Math.atan2(-car.direction.dz, car.direction.dx);
      car.mesh.rotation.y = angle;
    }
  }

  private gridToWorld(pos: Position): { x: number; z: number } {
    return {
      x: pos.x * CELL_SIZE + CELL_SIZE / 2,
      z: pos.z * CELL_SIZE + CELL_SIZE / 2,
    };
  }

  private posKey(pos: Position): string {
    return `${pos.x},${pos.z}`;
  }

  private keyToPos(key: string): Position {
    const [x, z] = key.split(',').map(Number);
    return { x, z };
  }

  private disposeMesh(group: THREE.Group): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }
}
