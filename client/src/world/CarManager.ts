import * as THREE from 'three';
import {
  type CityState,
  type Position,
  BuildingType,
  CELL_SIZE,
  DEFAULT_GRID_SIZE,
} from '@cityzen/shared';

const CAR_COLORS = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0xff8f00, 0x8e24aa];
const CAR_SPEED = 2.5; // cells per second
const MAX_CARS = 20;
const CARS_PER_ROAD = 0.15; // spawn ratio: 1 car per ~7 road tiles
const COLLISION_DISTANCE = 0.4; // minimum distance before stopping (in cells)
const SLOW_DOWN_DISTANCE = 0.8; // distance at which cars start slowing down

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
  /** Current speed multiplier (0 = stopped, 1 = full speed) */
  speedMultiplier: number;
}

export class CarManager {
  private scene: THREE.Scene;
  private cars: Car[] = [];
  private roadSet: Set<string> = new Set();
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

    for (const car of this.cars) {
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

      car.progress += CAR_SPEED * deltaTime * car.speedMultiplier;

      if (car.progress >= 1) {
        // Arrived at destination cell — pick next cell
        car.from = car.to;
        car.progress = 0;
        this.pickNextCell(car);
      }

      // Interpolate world position
      const worldFrom = this.gridToWorld(car.from);
      const worldTo = this.gridToWorld(car.to);
      const x = worldFrom.x + (worldTo.x - worldFrom.x) * car.progress;
      const z = worldFrom.z + (worldTo.z - worldFrom.z) * car.progress;

      // Calculate lane offset - cars drive on the right side of the road
      // Offset perpendicular to direction of travel
      const laneOffset = this.getLaneOffset(car.direction);
      car.mesh.position.set(x + laneOffset.x, 0.15, z + laneOffset.z);
    }
  }

  /** Calculate the lane offset for right-hand traffic */
  private getLaneOffset(direction: Direction): { x: number; z: number } {
    // Offset is perpendicular to direction, to the right
    // For direction (dx, dz), right perpendicular is (dz, -dx)
    const laneWidth = CELL_SIZE * 0.22; // Offset from center
    return {
      x: direction.dz * laneWidth,
      z: -direction.dx * laneWidth,
    };
  }

  /** Find a car that is ahead of this car in its direction of travel */
  private getCarAhead(car: Car): Car | null {
    let closestCar: Car | null = null;
    let closestDistance = Infinity;

    for (const other of this.cars) {
      if (other === car) continue;

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

  /** Get the world position of a car (including lane offset) */
  private getCarWorldPosition(car: Car): { x: number; z: number } {
    const worldFrom = this.gridToWorld(car.from);
    const worldTo = this.gridToWorld(car.to);
    const laneOffset = this.getLaneOffset(car.direction);
    return {
      x: worldFrom.x + (worldTo.x - worldFrom.x) * car.progress + laneOffset.x,
      z: worldFrom.z + (worldTo.z - worldFrom.z) * car.progress + laneOffset.z,
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
  }

  private rebuildRoadSet(state: CityState): void {
    this.roadSet.clear();
    for (const b of state.buildings) {
      if (b.type === BuildingType.ROAD) {
        this.roadSet.add(this.posKey(b.position));
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

    // Pick a random road cell
    const startKey = roads[Math.floor(Math.random() * roads.length)];
    const from = this.keyToPos(startKey);

    const mesh = this.createCarMesh();
    const worldPos = this.gridToWorld(from);
    mesh.position.set(worldPos.x, 0.15, worldPos.z);
    this.scene.add(mesh);

    const car: Car = {
      mesh,
      from,
      to: { ...from },
      progress: 0,
      direction: DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)],
      speedMultiplier: 1,
    };

    this.pickNextCell(car);
    return car;
  }

  private pickNextCell(car: Car): void {
    // Try to continue in the same direction first
    const forward: Position = {
      x: car.from.x + car.direction.dx,
      z: car.from.z + car.direction.dz,
    };

    if (this.isRoad(forward)) {
      car.to = forward;
      this.rotateCarMesh(car);
      return;
    }

    // Otherwise pick a random adjacent road (excluding where we came from)
    const neighbors = DIRECTIONS
      .map((d) => ({ pos: { x: car.from.x + d.dx, z: car.from.z + d.dz }, dir: d }))
      .filter(({ pos, dir }) => {
        // Don't reverse direction unless it's the only option
        const isReverse = dir.dx === -car.direction.dx && dir.dz === -car.direction.dz;
        return !isReverse && this.isRoad(pos);
      });

    if (neighbors.length > 0) {
      const pick = neighbors[Math.floor(Math.random() * neighbors.length)];
      car.to = pick.pos;
      car.direction = pick.dir;
      this.rotateCarMesh(car);
      return;
    }

    // Dead end — allow reversing
    const reverse: Position = {
      x: car.from.x - car.direction.dx,
      z: car.from.z - car.direction.dz,
    };

    if (this.isRoad(reverse)) {
      car.to = reverse;
      car.direction = { dx: -car.direction.dx, dz: -car.direction.dz };
      this.rotateCarMesh(car);
      return;
    }

    // Completely isolated — stay put
    car.to = { ...car.from };
  }

  private isRoad(pos: Position): boolean {
    if (pos.x < 0 || pos.x >= DEFAULT_GRID_SIZE || pos.z < 0 || pos.z >= DEFAULT_GRID_SIZE) {
      return false;
    }
    return this.roadSet.has(this.posKey(pos));
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
    // atan2(dz, dx) gives angle from +X axis, which matches our car orientation
    const angle = Math.atan2(-car.direction.dz, car.direction.dx);
    car.mesh.rotation.y = angle;
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
