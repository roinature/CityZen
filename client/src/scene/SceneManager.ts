import * as THREE from 'three';

export class SceneManager {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;

  private frustumSize = 50;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.OrthographicCamera(
      (-this.frustumSize * aspect) / 2,
      (this.frustumSize * aspect) / 2,
      this.frustumSize / 2,
      -this.frustumSize / 2,
      0.1,
      1000,
    );
    // Isometric angle
    this.camera.position.set(50, 50, 50);
    this.camera.lookAt(32, 0, 32); // Center of 64x64 grid

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    window.addEventListener('resize', () => this.onResize());
  }

  private onResize(): void {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera.left = (-this.frustumSize * aspect) / 2;
    this.camera.right = (this.frustumSize * aspect) / 2;
    this.camera.top = this.frustumSize / 2;
    this.camera.bottom = -this.frustumSize / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  getFrustumSize(): number {
    return this.frustumSize;
  }

  setFrustumSize(size: number): void {
    this.frustumSize = size;
    this.onResize();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
