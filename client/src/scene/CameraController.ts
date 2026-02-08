import * as THREE from 'three';
import { clamp } from '@cityzen/shared';
import type { SceneManager } from './SceneManager.js';

export class CameraController {
  private sceneManager: SceneManager;
  private keys = new Set<string>();
  private panSpeed = 30;
  private minZoom = 5;
  private maxZoom = 120;

  // Camera target (the point the camera looks at)
  private target = new THREE.Vector3(32, 0, 32);
  // Camera offset from target (computed from rotation)
  private offset = new THREE.Vector3(50, 50, 50);

  // Rotation around Y axis (radians). PI/4 = initial isometric view
  private rotationAngle = Math.PI / 4;
  private targetRotation = Math.PI / 4;
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

    window.addEventListener('keydown', (e) => {
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

  update(deltaTime: number): void {
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
    this.target.x = clamp(this.target.x, -10, 74);
    this.target.z = clamp(this.target.z, -10, 74);

    // Update camera position and lookAt
    const camera = this.sceneManager.camera;
    camera.position.copy(this.target).add(this.offset);
    camera.lookAt(this.target);
  }

  setPanSpeed(speed: number): void {
    this.panSpeed = speed;
  }

  setLeftClickPanEnabled(enabled: boolean): void {
    this.leftClickPanEnabled = enabled;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 3 : -3;
    const currentSize = this.sceneManager.getFrustumSize();
    const newSize = clamp(currentSize + delta, this.minZoom, this.maxZoom);
    this.sceneManager.setFrustumSize(newSize);
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

    // Move in opposite direction of drag
    this.target.addScaledVector(right, -deltaX * panAmount);
    this.target.addScaledVector(forward, -deltaY * panAmount);

    // Clamp target to grid bounds
    this.target.x = clamp(this.target.x, -10, 74);
    this.target.z = clamp(this.target.z, -10, 74);
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

