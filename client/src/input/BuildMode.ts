import * as THREE from 'three';
import {
  type BuildingType,
  type Position,
  type CityState,
  isRoad,
  isZone,
  BUILDING_DEFS,
  CELL_SIZE,
  canPlaceBuilding,
} from '@cityzen/shared';
import { BuildingFactory } from '../world/BuildingFactory.js';
import { GridRaycaster } from './Raycaster.js';

function isContinuousType(type: BuildingType): boolean {
  return isRoad(type);
}

function isRectDragType(type: BuildingType): boolean {
  return isZone(type);
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
  private unlimitedMoney = false;

  // Rectangle drag state (for zones)
  private rectDragStart: Position | null = null;
  private rectPreviewGroup: THREE.Group | null = null;

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
    this.clearRectPreview();
  }

  deselect(): void {
    this.selectedType = null;
    this.isDragging = false;
    this.lastPlacedPos = null;
    this.rectDragStart = null;
    this.clearPreview();
    this.clearRectPreview();
  }

  getSelectedType(): BuildingType | null {
    return this.selectedType;
  }

  setUnlimitedMoney(enabled: boolean): void {
    this.unlimitedMoney = enabled;
  }

  updatePreview(state: CityState | null): void {
    if (!this.selectedType || !this.currentHoverPos || !state) {
      this.clearPreview();
      this.clearRectPreview();
      return;
    }

    // Rectangle drag preview for zones
    if (this.isDragging && this.rectDragStart && isRectDragType(this.selectedType)) {
      this.clearPreview();
      this.updateRectPreview(state);
      return;
    }

    // Normal single-cell preview
    this.clearRectPreview();

    const result = canPlaceBuilding(
      state.grid, this.currentHoverPos, this.selectedType,
      state.resources, this.unlimitedMoney, state.buildings,
    );

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

  private updateRectPreview(state: CityState): void {
    this.clearRectPreview();
    if (!this.rectDragStart || !this.currentHoverPos || !this.selectedType) return;

    const minX = Math.min(this.rectDragStart.x, this.currentHoverPos.x);
    const maxX = Math.max(this.rectDragStart.x, this.currentHoverPos.x);
    const minZ = Math.min(this.rectDragStart.z, this.currentHoverPos.z);
    const maxZ = Math.max(this.rectDragStart.z, this.currentHoverPos.z);

    this.rectPreviewGroup = new THREE.Group();

    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const pos: Position = { x, z };
        const result = canPlaceBuilding(
          state.grid, pos, this.selectedType,
          state.resources, this.unlimitedMoney, state.buildings,
        );

        const cellPreview = this.factory.createPreview(this.selectedType, result.valid);
        const half = CELL_SIZE / 2;
        cellPreview.position.set(
          x * CELL_SIZE + half,
          0,
          z * CELL_SIZE + half,
        );
        this.rectPreviewGroup.add(cellPreview);
      }
    }

    this.scene.add(this.rectPreviewGroup);
  }

  private onMouseMove(e: MouseEvent): void {
    const pos = this.raycaster.getGridPosition(e.clientX, e.clientY, this.camera);
    this.currentHoverPos = pos;

    // Continuous drawing: place on every new cell while dragging (roads only)
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

    const pos = this.raycaster.getGridPosition(e.clientX, e.clientY, this.camera);

    // Rectangle drag for zones
    if (isRectDragType(this.selectedType)) {
      this.isDragging = true;
      if (pos) {
        this.rectDragStart = { ...pos };
      }
      return;
    }

    // Continuous drag for roads
    if (isContinuousType(this.selectedType)) {
      this.isDragging = true;
      this.lastPlacedPos = null;

      if (pos) {
        this.onPlace(pos, this.selectedType);
        this.lastPlacedPos = { ...pos };
      }
    }
  }

  private onMouseUp(): void {
    // Rectangle drag release — place all zones in the rectangle
    if (this.isDragging && this.rectDragStart && this.selectedType && isRectDragType(this.selectedType) && this.onPlace && this.currentHoverPos) {
      const minX = Math.min(this.rectDragStart.x, this.currentHoverPos.x);
      const maxX = Math.max(this.rectDragStart.x, this.currentHoverPos.x);
      const minZ = Math.min(this.rectDragStart.z, this.currentHoverPos.z);
      const maxZ = Math.max(this.rectDragStart.z, this.currentHoverPos.z);

      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          this.onPlace({ x, z }, this.selectedType);
        }
      }
    }

    this.isDragging = false;
    this.lastPlacedPos = null;
    this.rectDragStart = null;
    this.clearRectPreview();
  }

  private onClick(e: MouseEvent): void {
    if (!this.selectedType || !this.onPlace) return;
    if ((e.target as HTMLElement).closest('#ui-root')) return;

    // Skip click handler for continuous and rect-drag types — handled by mousedown/move/up
    if (isContinuousType(this.selectedType) || isRectDragType(this.selectedType)) return;

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

  private clearRectPreview(): void {
    if (this.rectPreviewGroup) {
      this.scene.remove(this.rectPreviewGroup);
      this.rectPreviewGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
      this.rectPreviewGroup = null;
    }
  }
}
