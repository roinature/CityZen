import type { CameraController } from '../scene/CameraController.js';

export class ZoomControl {
  private slider: HTMLInputElement;

  constructor(parent: HTMLElement, private camera: CameraController) {
    const controls = document.createElement('div');
    controls.className = 'zoom-control';
    controls.innerHTML = `
      <button type="button" class="hud-button" aria-label="Zoom out">−</button>
      <div class="zoom-control-track">
        <label for="camera-zoom">Zoom</label>
        <input id="camera-zoom" type="range" min="0" max="100" step="1" />
      </div>
      <button type="button" class="hud-button" aria-label="Zoom in">+</button>
    `;
    this.slider = controls.querySelector('input')!;
    this.slider.addEventListener('input', () => this.camera.setZoomPercent(this.slider.valueAsNumber));
    const [out, zoomIn] = controls.querySelectorAll('button');
    out.addEventListener('click', () => this.step(-12));
    zoomIn.addEventListener('click', () => this.step(12));
    parent.appendChild(controls);
    this.update();
  }

  private step(amount: number): void {
    this.camera.setZoomPercent(this.camera.getZoomPercent() + amount);
    this.update();
  }

  update(): void {
    const zoom = this.camera.getZoomPercent();
    if (this.slider.valueAsNumber !== zoom) this.slider.valueAsNumber = zoom;
  }
}
