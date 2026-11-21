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

  // Mouse panning state
  private isPanning = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private mousePanSpeed = 0.15;

  // Left-click pan mode (enabled when pointer tool is active)
  private leftClickPanEnabled = false;

  constructor(sceneManager: SceneManager) {
    this.sceneManager = sceneManager;
    this.targetZoom = sceneManager.getFrustumSize();

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof Element && e.target.closest('input, select, textarea, [contenteditable="true"]')) return;
      this.keys.add(e.code);
      if (!e.repeat) {
        if (e.code === 'KeyQ') this.targetRotation -= Math.PI / 2;
        if (e.code === 'KeyE') this.targetRotation += Math.PI / 2;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    // Mouse panning events
    window.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    window.addEventListener('mouseleave', () => this.stopPanning());
    window.addEventListener('contextmenu', (e) => {
      // Prevent context menu on right-click when used for panning
      if (this.isPanning) e.preventDefault();
    });
  }

  frameCity(city: CityState): void {
    this.plotSize = city.grid.length * CELL_SIZE;
    this.keys.clear();
    this.stopPanning();
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

  setLeftClickPanEnabled(enabled: boolean): void {
    this.leftClickPanEnabled = enabled;
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

  private onWheel(e: WheelEvent): void {
    if ((e.target as HTMLElement).closest('#ui-root')) return;
    e.preventDefault();
    // Proportional zoom: each notch scales the view by the same factor at any
    // zoom level, and trackpads (many small deltas) stay smooth.
    const pixels = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    const factor = Math.exp(clamp(pixels, -200, 200) * 0.0015);
    this.targetZoom = clamp(this.targetZoom * factor, this.minZoom, this.getZoomOutLimit());
  }

  private onMouseDown(e: MouseEvent): void {
    // Right-click (button 2) or middle-click (button 1) to pan
    // Also left-click (button 0) when pointer tool is active
    if (e.button === 2 || e.button === 1 || (e.button === 0 && this.leftClickPanEnabled)) {
      if (e.button === 0 && (e.target as HTMLElement).closest('#ui-root')) return;
      this.isPanning = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      document.body.style.cursor = 'grabbing';
      e.preventDefault();
    }
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.isPanning) return;

    const deltaX = e.clientX - this.lastMouseX;
    const deltaY = e.clientY - this.lastMouseY;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    // Calculate pan based on zoom level (smaller frustum = slower pan)
    const zoomFactor = this.sceneManager.getFrustumSize() / 50;
    const panAmount = this.mousePanSpeed * zoomFactor;

    // Pan direction relative to current camera rotation
    const forward = new THREE.Vector3(
      -Math.sin(this.rotationAngle), 0, -Math.cos(this.rotationAngle),
    );
    const right = new THREE.Vector3(
      Math.cos(this.rotationAngle), 0, -Math.sin(this.rotationAngle),
    );

    // Move the camera so the board follows the pointer in screen space.
    this.target.addScaledVector(right, -deltaX * panAmount);
    this.target.addScaledVector(forward, deltaY * panAmount);

    // Clamp target to grid bounds
    this.target.x = clamp(this.target.x, -10, this.plotSize + 10);
    this.target.z = clamp(this.target.z, -10, this.plotSize + 10);
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button === 2 || e.button === 1 || (e.button === 0 && this.leftClickPanEnabled)) {
      this.stopPanning();
    }
  }

  private stopPanning(): void {
    if (this.isPanning) {
      this.isPanning = false;
      document.body.style.cursor = '';
    }
  }
}

