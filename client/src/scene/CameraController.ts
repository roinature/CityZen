import * as THREE from 'three';
import { CELL_SIZE, DEFAULT_GRID_SIZE, clamp, getEffectiveSize, getStarterEntranceX, type CityState } from '@cityzen/shared';
import type { SceneManager } from './SceneManager.js';

const START_ANGLE = Math.PI / 4;
const MIN_PITCH = THREE.MathUtils.degToRad(7);
const MAX_PITCH = THREE.MathUtils.degToRad(88);
/** An orthographic view tilted lower than this would reach under the ground. */
const MIN_ORTHOGRAPHIC_PITCH = THREE.MathUtils.degToRad(29);
/** Radians per second while a rotation key is held. */
const KEY_ORBIT_SPEED = 1.6;

export type CameraView = 'hero' | 'isometric' | 'top' | 'street';

/** Elevation above the horizon, in degrees, and projection of each view. */
export const CAMERA_VIEWS: Record<CameraView, { label: string; pitch: number; perspective: boolean; maxZoom?: number }> = {
  hero: { label: 'Skyline', pitch: 27, perspective: true },
  isometric: { label: 'Isometric', pitch: 35.26, perspective: false },
  top: { label: 'Top down', pitch: 84, perspective: true },
  street: { label: 'Street', pitch: 14, perspective: true, maxZoom: 12 },
};

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
  private readonly rotationAnimSpeed = 11;
  private view: CameraView = 'hero';
  private pitch = THREE.MathUtils.degToRad(CAMERA_VIEWS.hero.pitch);
  private targetPitch = this.pitch;
  private zoomBeforeStreet = 0;

  constructor(sceneManager: SceneManager) {
    this.sceneManager = sceneManager;
    this.targetZoom = sceneManager.getFrustumSize();

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof Element && e.target.closest('input, select, textarea, [contenteditable="true"]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      this.keys.add(e.code);
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
    const groundTilt = Math.sin(this.pitch);
    // Reserve room for the status bar, dock, and the tops of buildings.
    this.openingZoom = Math.max(30, span * groundTilt * 0.85 + 6, (span + 4) / aspect);
    const { maxZoom } = CAMERA_VIEWS[this.view];
    this.zoomBeforeStreet = this.openingZoom;
    this.targetZoom = maxZoom ? Math.min(maxZoom, this.openingZoom) : this.openingZoom;
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

    const held = (plus: string, minus: string) => Number(this.keys.has(plus)) - Number(this.keys.has(minus));
    const turn = held('KeyE', 'KeyQ');
    const tilt = held('KeyR', 'KeyF');
    if (turn || tilt) this.orbit(turn * KEY_ORBIT_SPEED * deltaTime, tilt * KEY_ORBIT_SPEED * 0.5 * deltaTime);

    // Ease towards the target angles, so a drag glides to a stop
    const ease = 1 - Math.exp(-this.rotationAnimSpeed * deltaTime);
    this.rotationAngle += (this.targetRotation - this.rotationAngle) * ease;
    this.pitch += (this.targetPitch - this.pitch) * ease;
    if (Math.abs(this.targetRotation - this.rotationAngle) < 1e-4) this.rotationAngle = this.targetRotation;
    if (Math.abs(this.targetPitch - this.pitch) < 1e-4) this.pitch = this.targetPitch;

    // The orthographic camera only has to stay above the ground across the
    // whole viewport; the perspective one frames the city by standing back.
    const distance = this.sceneManager.isPerspective()
      ? this.sceneManager.getViewDistance()
      : 87 * Math.max(1, this.sceneManager.getFrustumSize() / 90);
    const flat = distance * Math.cos(this.pitch);
    this.offset.set(flat * Math.sin(this.rotationAngle), distance * Math.sin(this.pitch), flat * Math.cos(this.rotationAngle));

    // Pan directions relative to current camera rotation
    const forward = new THREE.Vector3(
      -Math.sin(this.rotationAngle), 0, -Math.cos(this.rotationAngle),
    );
    const right = new THREE.Vector3(
      Math.cos(this.rotationAngle), 0, -Math.sin(this.rotationAngle),
    );

    // Slow down close to the ground.
    const speed = this.panSpeed * deltaTime * Math.min(1, this.sceneManager.getFrustumSize() / 30);
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

  setView(view: CameraView): void {
    if (view === this.view) return;
    const { pitch, perspective, maxZoom } = CAMERA_VIEWS[view];
    if (maxZoom) this.zoomBeforeStreet = this.targetZoom;
    else if (CAMERA_VIEWS[this.view].maxZoom) this.targetZoom = this.zoomBeforeStreet;
    if (maxZoom) this.targetZoom = Math.min(this.targetZoom, maxZoom);
    this.view = view;
    this.targetPitch = THREE.MathUtils.degToRad(pitch);
    this.sceneManager.setPerspective(perspective);
  }

  /** Centre the view on a ground point, keeping the angle and zoom. */
  lookAt(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.update(0);
  }

  getTarget(): THREE.Vector3 {
    return this.target;
  }

  isPerspectiveView(): boolean {
    return CAMERA_VIEWS[this.view].perspective;
  }

  getRotationAngle(): number {
    return this.rotationAngle;
  }

  /** Turn around the point in view and tilt towards (+) or away from the top-down view, in radians. */
  orbit(turn: number, tilt: number): void {
    this.targetRotation += turn;
    const lowest = this.sceneManager.isPerspective() ? MIN_PITCH : MIN_ORTHOGRAPHIC_PITCH;
    this.targetPitch = clamp(this.targetPitch + tilt, lowest, MAX_PITCH);
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
    // Near the horizon a small drag would otherwise cross the whole map.
    const groundTilt = Math.max(0.25, Math.sin(this.pitch));
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
