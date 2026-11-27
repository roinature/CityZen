import type { CameraController } from '../scene/CameraController.js';
import type { BuildMode } from './BuildMode.js';

const TAP_SLOP = 8;
/** Radians turned by dragging the height of the map. */
const ORBIT_SPEED = Math.PI * 1.2;

export class MapInput {
  private pointers = new Map<number, PointerEvent>();
  private start: PointerEvent | null = null;
  private moved = false;
  private cameraOnly = false;
  private drawing = false;
  private orbiting = false;
  /** When set, a left-click tap on the map goes here instead of the build tools. */
  onTap: ((clientX: number, clientY: number) => void) | null = null;
  /** Off while the player is exploring the city: the map is not being edited or panned. */
  enabled = true;

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
      if (!this.enabled) return;
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
    this.orbiting = false;
    this.drawing = false;
    this.canvas.classList.remove('panning');
    this.build.cancelInteraction();
    this.build.clearHover();
  }

  private onDown = (event: PointerEvent): void => {
    if (!this.enabled) return;
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
    // Right or middle drag orbits; so does a left drag with a modifier, for trackpads.
    this.orbiting = event.pointerType !== 'touch'
      && (event.button !== 0 || event.shiftKey || event.altKey || event.ctrlKey);
    this.drawing = !this.orbiting && event.button === 0 && this.build.canDraw();
    if (this.drawing) this.build.startDraw(event.clientX, event.clientY);
    else if (event.button === 0) this.build.hover(event.clientX, event.clientY);
  };

  private onMove = (event: PointerEvent): void => {
    if (!this.enabled) return;
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
      const angle = Math.atan2(second.clientY - first.clientY, second.clientX - first.clientX);
      const nextAngle = Math.atan2(nextSecond.clientY - nextFirst.clientY, nextSecond.clientX - nextFirst.clientX);
      // Twisting two fingers turns the map with them.
      const twist = Math.atan2(Math.sin(nextAngle - angle), Math.cos(nextAngle - angle));
      if (distance > 30) this.camera.orbit(twist, 0);
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
    if (this.orbiting) {
      if (!this.moved) return;
      const from = wasMoving ? previous : this.start;
      const scale = ORBIT_SPEED / this.canvas.clientHeight;
      this.canvas.classList.add('panning');
      this.build.clearHover();
      this.camera.orbit((from.clientX - event.clientX) * scale, (event.clientY - from.clientY) * scale * 0.6);
    } else if (this.cameraOnly || (this.moved && (
      event.pointerType === 'touch' || this.build.getToolMode() === 'pointer'
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
      if (event.button === 0 && this.onTap) this.onTap(event.clientX, event.clientY);
      else if (event.button === 0) this.build.tap(event.clientX, event.clientY);
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
