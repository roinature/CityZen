import * as THREE from 'three';
import {
  type BuildingType,
  type Position,
  type CityState,
  BuildingType as BT,
  BUILDING_DEFS,
  CELL_SIZE,
  canPlaceBuilding,
} from '@cityzen/shared';
import { BuildingFactory } from '../world/BuildingFactory.js';
import { GridRaycaster } from './Raycaster.js';

function isContinuousType(type: BuildingType): boolean {
  return type === BT.ROAD;
}

function samePos(a: Position | null, b: Position | null): boolean {
  if (!a || !b) return false;
  return a.x === b.x && a.z === b.z;
}

export class BuildMode {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private raycaster: GridRaycaster;
  private factory: BuildingFactory;

  private selectedType: BuildingType | null = null;
  private previewMesh: THREE.Group | null = null;
  private currentHoverPos: Position | null = null;

  // Continuous drawing state (for roads)
  private isDragging = false;
  private lastPlacedPos: Position | null = null;

  onPlace: ((pos: Position, type: BuildingType) => void) | null = null;
  onDemolish: ((pos: Position) => void) | null = null;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;
    this.raycaster = new GridRaycaster();
    this.factory = new BuildingFactory();

    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', () => this.onMouseUp());
    window.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.onRightClick(e);
    });
  }

  select(type: BuildingType): void {
    this.selectedType = type;
    this.clearPreview();
  }

  deselect(): void {
    this.selectedType = null;
    this.isDragging = false;
    this.lastPlacedPos = null;
    this.clearPreview();
  }

  getSelectedType(): BuildingType | null {
    return this.selectedType;
  }

  updatePreview(state: CityState | null): void {
    if (!this.selectedType || !this.currentHoverPos || !state) {
      this.clearPreview();
      return;
    }

    const result = canPlaceBuilding(state.grid, this.currentHoverPos, this.selectedType, state.resources);

    this.clearPreview();
    this.previewMesh = this.factory.createPreview(this.selectedType, result.valid);
    const def = BUILDING_DEFS[this.selectedType];
    const w = def.size.w * CELL_SIZE;
    const d = def.size.d * CELL_SIZE;
    this.previewMesh.position.set(
      this.currentHoverPos.x * CELL_SIZE + w / 2,
      0,
      this.currentHoverPos.z * CELL_SIZE + d / 2,
    );
    this.scene.add(this.previewMesh);
  }

  private onMouseMove(e: MouseEvent): void {
    const pos = this.raycaster.getGridPosition(e.clientX, e.clientY, this.camera);
    this.currentHoverPos = pos;

    // Continuous drawing: place on every new cell while dragging
    if (this.isDragging && this.selectedType && isContinuousType(this.selectedType) && this.onPlace && pos) {
      if (!samePos(pos, this.lastPlacedPos)) {
        this.onPlace(pos, this.selectedType);
        this.lastPlacedPos = { ...pos };
      }
    }
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return; // Left click only
    if (!this.selectedType || !this.onPlace) return;
    if ((e.target as HTMLElement).closest('#ui-root')) return;

    if (isContinuousType(this.selectedType)) {
      this.isDragging = true;
      this.lastPlacedPos = null;

      // Place immediately on the cell under the cursor
      const pos = this.raycaster.getGridPosition(e.clientX, e.clientY, this.camera);
      if (pos) {
        this.onPlace(pos, this.selectedType);
        this.lastPlacedPos = { ...pos };
      }
    }
  }

  private onMouseUp(): void {
    this.isDragging = false;
    this.lastPlacedPos = null;
  }

  private onClick(e: MouseEvent): void {
    if (!this.selectedType || !this.onPlace) return;
    if ((e.target as HTMLElement).closest('#ui-root')) return;

    // Skip click handler for continuous types — they're handled by mousedown/move
    if (isContinuousType(this.selectedType)) return;

    const pos = this.raycaster.getGridPosition(e.clientX, e.clientY, this.camera);
    if (pos) {
      this.onPlace(pos, this.selectedType);
    }
  }

  private onRightClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('#ui-root')) return;

    const pos = this.raycaster.getGridPosition(e.clientX, e.clientY, this.camera);
    if (pos && this.onDemolish) {
      this.onDemolish(pos);
    }
  }

  private clearPreview(): void {
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      this.previewMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
      this.previewMesh = null;
    }
  }
}
