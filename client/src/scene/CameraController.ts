import * as THREE from 'three';
import { CELL_SIZE, DEFAULT_GRID_SIZE, clamp, getEffectiveSize, getStarterEntranceX, type CityState } from '@cityzen/shared';
import type { SceneManager } from './SceneManager.js';

const START_ANGLE = Math.PI / 4;

export class CameraController {
  private sceneManager: SceneManager;
  private keys = new Set<string>();
  private panSpeed = 30;
  private minZoom = 5;
  private maxZoom = 120;
  private openingZoom = 50;
  private targetZoom: number;
  private readonly zoomAnimSpeed = 12;

  // Camera target (the point the camera looks at)
  private target = new THREE.Vector3(DEFAULT_GRID_SIZE * CELL_SIZE / 2, 0, DEFAULT_GRID_SIZE * CELL_SIZE / 2);
  private plotSize = DEFAULT_GRID_SIZE * CELL_SIZE;
  // Camera offset from target (computed from rotation)
  private offset = new THREE.Vector3(50, 50, 50);

  // Rotation around Y axis (radians). PI/4 = initial isometric view
  private rotationAngle = START_ANGLE;
  private targetRotation = START_ANGLE;
  private readonly rotationAnimSpeed = 5;
  private readonly orbitRadius = 50 * Math.SQRT2; // ~70.71, same XZ distance as original (50,50)
  private readonly orbitHeight = 50;

  constructor(sceneManager: SceneManager) {
    this.sceneManager = sceneManager;
    this.targetZoom = sceneManager.getFrustumSize();

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof Element && e.target.closest('input, select, textarea, [contenteditable="true"]')) return;
      this.keys.add(e.code);
      if (!e.repeat) {
        if (e.code === 'KeyQ') this.rotate(-1);
        if (e.code === 'KeyE') this.rotate(1);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  frameCity(city: CityState): void {
    this.plotSize = city.grid.length * CELL_SIZE;
    this.keys.clear();
    this.rotationAngle = START_ANGLE;
    this.targetRotation = START_ANGLE;

    let span = 0;
    if (city.buildings.length === 0) {
      // Start near the foreground edge with space to lay out the first streets.
      const entranceX = (getStarterEntranceX(city.grid.length) + 0.5) * CELL_SIZE;
      this.target.set(entranceX, 0, this.plotSize * 0.87);
    } else {
      let minX = this.plotSize, minZ = this.plotSize, maxX = 0, maxZ = 0;
      for (const building of city.buildings) {
        const { x, z } = building.position;
        const { w, d } = getEffectiveSize(building.type, building.orientation);
        minX = Math.min(minX, x * CELL_SIZE);
        minZ = Math.min(minZ, z * CELL_SIZE);
        maxX = Math.max(maxX, (x + w) * CELL_SIZE);
        maxZ = Math.max(maxZ, (z + d) * CELL_SIZE);
      }
      this.target.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
      span = ((maxX - minX) + (maxZ - minZ)) / Math.SQRT2;
    }

    const aspect = window.innerWidth / window.innerHeight;
    const groundTilt = this.orbitHeight / Math.hypot(this.orbitRadius, this.orbitHeight);
    // Reserve room for the status bar, dock, and the tops of buildings.
    this.openingZoom = Math.max(30, span * groundTilt + 16, (span + 10) / aspect);
    this.targetZoom = this.openingZoom;
    this.sceneManager.setFrustumSize(this.targetZoom);
    this.update(0);
  }

  update(deltaTime: number): void {
    // Smooth zoom toward the target frustum size
    const currentZoom = this.sceneManager.getFrustumSize();
    const zoomDiff = this.targetZoom - currentZoom;
    if (Math.abs(zoomDiff) > 0.01) {
      const t = Math.min(1, this.zoomAnimSpeed * deltaTime);
      this.sceneManager.setFrustumSize(currentZoom + zoomDiff * t);
    } else if (zoomDiff !== 0) {
      this.sceneManager.setFrustumSize(this.targetZoom);
    }

    // Smooth rotation animation
    const rotDiff = this.targetRotation - this.rotationAngle;
    if (Math.abs(rotDiff) > 0.001) {
      const step = this.rotationAnimSpeed * deltaTime;
      if (Math.abs(rotDiff) < step) {
        this.rotationAngle = this.targetRotation;
      } else {
        this.rotationAngle += Math.sign(rotDiff) * step;
      }
    }

    // Compute offset from rotation angle
    this.offset.set(
      this.orbitRadius * Math.sin(this.rotationAngle),
      this.orbitHeight,
      this.orbitRadius * Math.cos(this.rotationAngle),
    );
    // Keep the orthographic camera above the ground across the whole viewport at wide zooms.
    this.offset.multiplyScalar(Math.max(1, this.sceneManager.getFrustumSize() / 90));

    // Pan directions relative to current camera rotation
    const forward = new THREE.Vector3(
      -Math.sin(this.rotationAngle), 0, -Math.cos(this.rotationAngle),
    );
    const right = new THREE.Vector3(
      Math.cos(this.rotationAngle), 0, -Math.sin(this.rotationAngle),
    );

    const speed = this.panSpeed * deltaTime;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) {
      this.target.addScaledVector(forward, speed);
    }
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) {
      this.target.addScaledVector(forward, -speed);
    }
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) {
      this.target.addScaledVector(right, -speed);
    }
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) {
      this.target.addScaledVector(right, speed);
    }

    // Clamp target to grid bounds (with some margin)
    this.target.x = clamp(this.target.x, -10, this.plotSize + 10);
    this.target.z = clamp(this.target.z, -10, this.plotSize + 10);

    // Update camera position and lookAt
    const camera = this.sceneManager.camera;
    camera.position.copy(this.target).add(this.offset);
    camera.lookAt(this.target);
    camera.updateMatrixWorld();
  }

  setPanSpeed(speed: number): void {
    this.panSpeed = speed;
  }

  getRotationAngle(): number {
    return this.rotationAngle;
  }

  rotate(direction: -1 | 1): void {
    this.targetRotation += direction * Math.PI / 2;
  }

  // Map equal slider steps to equal changes in magnification.
  getZoomPercent(): number {
    const limit = this.getZoomOutLimit();
    return Math.round(100 * Math.log(limit / this.targetZoom) / Math.log(limit / this.minZoom));
  }

  setZoomPercent(percent: number): void {
    const limit = this.getZoomOutLimit();
    this.targetZoom = limit * Math.pow(this.minZoom / limit, clamp(percent, 0, 100) / 100);
  }

  private getZoomOutLimit(): number {
    return Math.max(this.maxZoom, this.openingZoom);
  }

  zoomByWheel(pixels: number): void {
    const factor = Math.exp(clamp(pixels, -200, 200) * 0.0015);
    this.targetZoom = clamp(this.targetZoom * factor, this.minZoom, this.getZoomOutLimit());
  }

  /** Move the ground under the old gesture center to the new one, keeping it under the fingers during zoom. */
  moveMap(
    fromX: number, fromY: number, toX: number, toY: number,
    viewportHeight: number, zoomFactor = 1,
  ): void {
    const zoom = this.sceneManager.getFrustumSize();
    const nextZoom = zoomFactor === 1 ? zoom : clamp(zoom * zoomFactor, this.minZoom, this.getZoomOutLimit());
    const groundTilt = this.orbitHeight / Math.hypot(this.orbitRadius, this.orbitHeight);
    const right = (fromX * zoom - toX * nextZoom) / viewportHeight;
    const forward = (toY * nextZoom - fromY * zoom) / (viewportHeight * groundTilt);
    const sin = Math.sin(this.rotationAngle);
    const cos = Math.cos(this.rotationAngle);
    this.target.x += right * cos - forward * sin;
    this.target.z -= right * sin + forward * cos;
    if (zoomFactor !== 1) {
      this.targetZoom = nextZoom;
      this.sceneManager.setFrustumSize(nextZoom);
    }
    this.update(0);
  }
}
