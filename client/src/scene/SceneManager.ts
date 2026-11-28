import * as THREE from 'three';
import { PostProcessing } from './PostProcessing.js';
import { ShadowCache } from './ShadowCache.js';

/** Vertical field of view of the perspective camera. */
const FOV = 40;

export class SceneManager {
  scene: THREE.Scene;
  private orthographic: THREE.OrthographicCamera;
  private perspectiveCamera = new THREE.PerspectiveCamera(FOV, 1, 1, 3000);
  private perspective = true;
  private fog = new THREE.Fog(0xcfdbe6, 100, 400);
  renderer: THREE.WebGLRenderer;
  /** Glow, grading and antialiasing between the scene and the screen. */
  readonly post: PostProcessing;
  private drawingSize = new THREE.Vector2();

  private frustumSize = 50;
  /** Close-up mode for a camera riding along at street level. */
  private closeUp = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();

    const aspect = canvas.clientWidth / canvas.clientHeight;
    this.orthographic = new THREE.OrthographicCamera(
      (-this.frustumSize * aspect) / 2,
      (this.frustumSize * aspect) / 2,
      this.frustumSize / 2,
      -this.frustumSize / 2,
      0.1,
      1000,
    );
    // Edges are smoothed in the post-processing buffer, not the canvas.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.5 : 2));
    this.post = new PostProcessing(this.renderer, coarse ? 2 : 4);
    this.onResize();
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Shadow maps are redrawn only when a caster changes. This runs after
    // three has updated every matrix and before it draws the shadow maps.
    const shadows = new ShadowCache(this.renderer, this.scene);
    this.scene.onBeforeRender = (_renderer, _scene, camera) => shadows.update(camera);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // Initialize layers: 0 (Common), 1 (Day) enabled; 2 (Night) disabled
    this.setDayNight(false);

    new ResizeObserver(() => this.onResize()).observe(canvas);
  }

  private onResize(): void {
    this.updateProjection();
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
    this.renderer.getDrawingBufferSize(this.drawingSize);
    this.post?.setSize(this.drawingSize.x, this.drawingSize.y);
  }

  get camera(): THREE.OrthographicCamera | THREE.PerspectiveCamera {
    return this.perspective ? this.perspectiveCamera : this.orthographic;
  }

  isPerspective(): boolean {
    return this.perspective;
  }

  setPerspective(perspective: boolean): void {
    this.perspective = perspective;
    this.updateProjection();
  }

  /** How far the perspective camera stands back to frame the same ground as the orthographic one. */
  getViewDistance(): number {
    return this.frustumSize / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  }

  private updateProjection(): void {
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const { orthographic, perspectiveCamera } = this;
    orthographic.left = (-this.frustumSize * aspect) / 2;
    orthographic.right = (this.frustumSize * aspect) / 2;
    orthographic.top = this.frustumSize / 2;
    orthographic.bottom = -this.frustumSize / 2;
    orthographic.updateProjectionMatrix();

    const distance = this.getViewDistance();
    perspectiveCamera.aspect = aspect;
    perspectiveCamera.near = this.closeUp ? 0.03 : Math.max(0.2, distance * 0.04);
    perspectiveCamera.updateProjectionMatrix();
    // Haze starts beyond the city in overview, or softly across distant blocks at street level.
    if (this.closeUp) {
      this.fog.near = 24;
      this.fog.far = 165;
    } else {
      this.fog.near = distance + 60;
      this.fog.far = distance * 2 + 420;
    }
    if (this.scene.background instanceof THREE.Color) this.fog.color = this.scene.background;
    this.scene.fog = this.perspective ? this.fog : null;
  }

  /** A perspective view from just behind a car, with a near plane to match. */
  setCloseUp(closeUp: boolean): void {
    this.closeUp = closeUp;
    if (closeUp) this.perspective = true;
    this.updateProjection();
  }

  getFrustumSize(): number {
    return this.frustumSize;
  }

  setFrustumSize(size: number): void {
    this.frustumSize = size;
    this.updateProjection();
  }

  /** Layer 1 is drawn by day and layer 2 by night. */
  setDayNight(isNight: boolean): void {
    for (const camera of [this.orthographic, this.perspectiveCamera]) {
      camera.layers.enable(0);
      camera.layers.enable(isNight ? 2 : 1);
      camera.layers.disable(isNight ? 1 : 2);
    }
  }

  render(): void {
    this.post.render(this.scene, this.camera);
  }
}
