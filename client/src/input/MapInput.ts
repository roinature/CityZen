import type { CameraController } from '../scene/CameraController.js';
import type { BuildMode } from './BuildMode.js';

const TAP_SLOP = 8;

export class MapInput {
  private pointers = new Map<number, PointerEvent>();
  private start: PointerEvent | null = null;
  private moved = false;
  private cameraOnly = false;
  private drawing = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: CameraController,
    private build: BuildMode,
    private dismissPicker: () => boolean,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('lostpointercapture', this.onCancel);
    canvas.addEventListener('pointerleave', () => {
      if (!this.start) this.build.clearHover();
    });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.camera.zoomByWheel(event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY);
    }, { passive: false });
    window.addEventListener('blur', () => this.cancel());
  }

  cancel(): void {
    const pointerIds = [...this.pointers.keys()];
    this.pointers.clear();
    for (const id of pointerIds) {
      if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    }
    this.reset();
  }

  private reset(): void {
    this.start = null;
    this.drawing = false;
    this.canvas.classList.remove('panning');
    this.build.cancelInteraction();
    this.build.clearHover();
  }

  private onDown = (event: PointerEvent): void => {
    if (event.button < 0 || event.button > 2) return;
    if (this.start && (event.pointerType !== 'touch' || this.start.pointerType !== 'touch')) return;
    if (event.button === 1) event.preventDefault();
    this.pointers.set(event.pointerId, event);
    this.canvas.setPointerCapture(event.pointerId);

    if (this.start) {
      this.cameraOnly = true;
      this.drawing = false;
      this.build.cancelInteraction();
      this.build.clearHover();
      return;
    }

    this.start = event;
    this.cameraOnly = false;
    this.moved = false;
    if (this.dismissPicker()) {
      // The gesture that closes the picker can still pan, but cannot edit the city.
      this.cameraOnly = true;
      return;
    }
    this.drawing = event.button === 0 && this.build.canDraw();
    if (this.drawing) this.build.startDraw(event.clientX, event.clientY);
    else if (event.button === 0) this.build.hover(event.clientX, event.clientY);
  };

  private onMove = (event: PointerEvent): void => {
    if (!this.start) {
      if (event.pointerType !== 'touch') this.build.hover(event.clientX, event.clientY);
      return;
    }

    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    const [first, second] = this.pointers.values();
    this.pointers.set(event.pointerId, event);
    if (second) {
      const nextFirst = first.pointerId === event.pointerId ? event : first;
      const nextSecond = second.pointerId === event.pointerId ? event : second;
      const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
      const nextDistance = Math.hypot(nextFirst.clientX - nextSecond.clientX, nextFirst.clientY - nextSecond.clientY);
      this.moveCamera(
        (first.clientX + second.clientX) / 2, (first.clientY + second.clientY) / 2,
        (nextFirst.clientX + nextSecond.clientX) / 2, (nextFirst.clientY + nextSecond.clientY) / 2,
        distance > 1 && nextDistance > 1 ? distance / nextDistance : 1,
      );
      return;
    }

    if (this.drawing) {
      if (this.isOnMap(event)) this.build.hover(event.clientX, event.clientY);
      else this.build.clearHover();
      return;
    }

    const wasMoving = this.moved || this.cameraOnly;
    this.moved ||= this.exceedsTapSlop(event);
    if (this.cameraOnly || (this.moved && (
      event.pointerType === 'touch' || this.start.button !== 0 || this.build.getToolMode() === 'pointer'
    ))) {
      const from = wasMoving ? previous : this.start;
      this.moveCamera(from.clientX, from.clientY, event.clientX, event.clientY);
    } else if (event.pointerType !== 'touch') {
      if (this.isOnMap(event)) this.build.hover(event.clientX, event.clientY);
      else this.build.clearHover();
    }
  };

  private onUp = (event: PointerEvent): void => {
    if (!this.pointers.delete(event.pointerId)) return;
    if (this.pointers.size > 0) return;
    const onMap = this.isOnMap(event);
    if (onMap && this.drawing) {
      this.build.finishDraw(event.clientX, event.clientY);
    } else if (onMap && !this.cameraOnly && !this.moved && !this.exceedsTapSlop(event)) {
      if (event.button === 0) this.build.tap(event.clientX, event.clientY);
      if (event.button === 2) this.build.demolishAt(event.clientX, event.clientY);
    }
    this.reset();
    if (onMap && event.pointerType !== 'touch') this.build.hover(event.clientX, event.clientY);
  };

  private onCancel = (event: PointerEvent): void => {
    if (this.pointers.has(event.pointerId)) this.cancel();
  };

  private exceedsTapSlop(event: PointerEvent): boolean {
    return !!this.start &&
      Math.hypot(event.clientX - this.start.clientX, event.clientY - this.start.clientY) > TAP_SLOP;
  }

  private isOnMap(event: PointerEvent): boolean {
    return document.elementFromPoint(event.clientX, event.clientY) === this.canvas;
  }

  private moveCamera(fromX: number, fromY: number, toX: number, toY: number, zoomFactor = 1): void {
    const bounds = this.canvas.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    this.canvas.classList.add('panning');
    this.camera.moveMap(fromX - centerX, fromY - centerY, toX - centerX, toY - centerY, bounds.height, zoomFactor);
  }
}
