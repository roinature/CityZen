import * as THREE from 'three';
import { clamp } from '@cityzen/shared';
import type { SceneManager } from './SceneManager.js';

export class CameraController {
  private sceneManager: SceneManager;
  private keys = new Set<string>();
  private panSpeed = 30;
  private minZoom = 15;
  private maxZoom = 120;

  // Camera target (the point the camera looks at)
  private target = new THREE.Vector3(32, 0, 32);
  // Camera offset from target (maintains isometric angle)
  private offset = new THREE.Vector3(50, 50, 50);

  constructor(sceneManager: SceneManager) {
    this.sceneManager = sceneManager;

    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  update(deltaTime: number): void {
    const speed = this.panSpeed * deltaTime;

    // Pan direction relative to isometric view
    // In isometric: "up" on screen moves along -X and -Z, "right" moves along +X and -Z
    const forward = new THREE.Vector3(-1, 0, -1).normalize();
    const right = new THREE.Vector3(1, 0, -1).normalize();

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

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 3 : -3;
    const currentSize = this.sceneManager.getFrustumSize();
    const newSize = clamp(currentSize + delta, this.minZoom, this.maxZoom);
    this.sceneManager.setFrustumSize(newSize);
  }
}
