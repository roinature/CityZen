import * as THREE from 'three';
import {
  type BuildingType,
  type Position,
  type CityState,
  type EdgeDirection,
  type PlacedBuilding,
  type RoadOrientation,
  type ZoneDensity,
  isRoad,
  isZone,
  BUILDING_DEFS,
  CELL_SIZE,
  DEFAULT_GRID_SIZE,
  canPlaceBuilding,
  getEffectiveSize,
} from '@cityzen/shared';
import { BuildingFactory } from '../world/BuildingFactory.js';
import { GridRaycaster } from './Raycaster.js';
import type { ToolMode } from '../ui/ToolSidebar.js';

function isLineDragType(type: BuildingType): boolean {
  return isRoad(type);
}

function isRectDragType(type: BuildingType): boolean {
  return isZone(type);
}

function computeLineDragOrientation(start: Position, end: Position): RoadOrientation {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  return Math.abs(dx) >= Math.abs(dz) ? 'EW' : 'NS';
}

function computeStraightLine(start: Position, end: Position, stepW: number, stepD: number): Position[] {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const positions: Position[] = [];
  const maxX = DEFAULT_GRID_SIZE - stepW;
  const maxZ = DEFAULT_GRID_SIZE - stepD;

  // Clamp the start so the line always begins within valid bounds
  const clampedStart: Position = {
    x: Math.max(0, Math.min(maxX, start.x)),
    z: Math.max(0, Math.min(maxZ, start.z)),
  };

  if (Math.abs(dx) >= Math.abs(dz)) {
    // Horizontal dominant — clamp end x to grid bounds
    const dir = dx >= 0 ? 1 : -1;
    const clampedEndX = Math.max(0, Math.min(maxX, end.x));
    const dist = Math.abs(clampedEndX - clampedStart.x);
    const steps = Math.floor(dist / stepW);
    for (let i = 0; i <= steps; i++) {
      positions.push({ x: clampedStart.x + i * stepW * dir, z: clampedStart.z });
    }
  } else {
    // Vertical dominant — clamp end z to grid bounds
    const dir = dz >= 0 ? 1 : -1;
    const clampedEndZ = Math.max(0, Math.min(maxZ, end.z));
    const dist = Math.abs(clampedEndZ - clampedStart.z);
    const steps = Math.floor(dist / stepD);
    for (let i = 0; i <= steps; i++) {
      positions.push({ x: clampedStart.x, z: clampedStart.z + i * stepD * dir });
    }
  }

  return positions;
}

export class BuildMode {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private raycaster: GridRaycaster;
  private factory: BuildingFactory;

  private selectedType: BuildingType | null = null;
  private selectedDensity: ZoneDensity | null = null;
  private previewMesh: THREE.Group | null = null;
  private currentHoverPos: Position | null = null;

  // Tool mode
  private toolMode: ToolMode = 'pointer';
  private brushSize = 1;

  // Drag state (shared by line and rect drag)
  private isDragging = false;
  private unlimitedMoney = false;

  // Line drag state (for roads)
  private lineDragStart: Position | null = null;
  private lineDragPreviewGroup: THREE.Group | null = null;

  // Rectangle drag state (for zones)
  private rectDragStart: Position | null = null;
  private rectPreviewGroup: THREE.Group | null = null;

  // Bulldoze preview
  private bulldozePreviewGroup: THREE.Group | null = null;

  onPlace: ((pos: Position, type: BuildingType, density?: ZoneDensity, orientation?: RoadOrientation) => void) | null = null;
  onDemolish: ((pos: Position) => void) | null = null;
  onEdgeRoadClick: ((direction: EdgeDirection, position: number) => void) | null = null;
  onDragCostUpdate: ((cost: number | null) => void) | null = null;

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

  setDensity(density: ZoneDensity | null): void {
    this.selectedDensity = density;
  }

  deselect(): void {
    this.selectedType = null;
    this.selectedDensity = null;
    this.isDragging = false;
    this.lineDragStart = null;
    this.rectDragStart = null;
    this.clearPreview();
    this.clearLineDragPreview();
    this.clearRectPreview();
    this.clearBulldozePreview();
    this.onDragCostUpdate?.(null);
  }

  getSelectedType(): BuildingType | null {
    return this.selectedType;
  }

  setUnlimitedMoney(enabled: boolean): void {
    this.unlimitedMoney = enabled;
  }

  setToolMode(mode: ToolMode): void {
    this.toolMode = mode;
    if (mode !== 'build') {
      this.deselect();
    }
  }

  getToolMode(): ToolMode {
    return this.toolMode;
  }

  setBrushSize(size: number): void {
    this.brushSize = Math.max(1, Math.min(3, size));
  }

  updatePreview(state: CityState | null): void {
    // Bulldoze preview
    if (this.toolMode === 'bulldoze' && this.currentHoverPos && state) {
      this.clearPreview();
      this.clearLineDragPreview();
      this.clearRectPreview();
      this.updateBulldozePreview(state);
      return;
    }
    this.clearBulldozePreview();

    if (!this.selectedType || !this.currentHoverPos || !state) {
      this.clearPreview();
      this.clearLineDragPreview();
      this.clearRectPreview();
      return;
    }

    // Line drag preview for roads
    if (this.isDragging && this.lineDragStart && isLineDragType(this.selectedType)) {
      this.clearPreview();
      this.updateLineDragPreview();
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
    this.clearLineDragPreview();

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
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return; // Left click only
    if (this.toolMode !== 'build') return;
    if (!this.selectedType || !this.onPlace) return;
    if ((e.target as HTMLElement).closest('#ui-root')) return;

    const pos = this.raycaster.getGridPosition(e.clientX, e.clientY, this.camera);
    console.log('[BuildMode] mousedown', { pos, selectedType: this.selectedType, toolMode: this.toolMode });

    // Rectangle drag for zones
    if (isRectDragType(this.selectedType)) {
      this.isDragging = true;
      if (pos) {
        this.rectDragStart = { ...pos };
      }
      return;
    }

    // Line drag for roads
    if (isLineDragType(this.selectedType)) {
      this.isDragging = true;
      if (pos) {
        this.lineDragStart = { ...pos };
      }
      return;
    }
  }

  private onMouseUp(): void {
    console.log('[BuildMode] mouseup', {
      isDragging: this.isDragging,
      lineDragStart: this.lineDragStart,
      selectedType: this.selectedType,
      isLineDrag: this.selectedType ? isLineDragType(this.selectedType) : null,
      hasOnPlace: !!this.onPlace,
      currentHoverPos: this.currentHoverPos,
    });

    // Line drag release — place all roads along the straight line
    if (this.isDragging && this.lineDragStart && this.selectedType && isLineDragType(this.selectedType) && this.onPlace && this.currentHoverPos) {
      const orientation = computeLineDragOrientation(this.lineDragStart, this.currentHoverPos);
      const { w, d } = getEffectiveSize(this.selectedType, orientation);
      const positions = computeStraightLine(this.lineDragStart, this.currentHoverPos, w, d);
      console.log('[BuildMode] placing roads', { count: positions.length, positions, orientation });
      for (const pos of positions) {
        this.onPlace(pos, this.selectedType, undefined, orientation);
      }
    }

    // Rectangle drag release — place all zones in the rectangle
    if (this.isDragging && this.rectDragStart && this.selectedType && isRectDragType(this.selectedType) && this.onPlace && this.currentHoverPos) {
      const minX = Math.min(this.rectDragStart.x, this.currentHoverPos.x);
      const maxX = Math.max(this.rectDragStart.x, this.currentHoverPos.x);
      const minZ = Math.min(this.rectDragStart.z, this.currentHoverPos.z);
      const maxZ = Math.max(this.rectDragStart.z, this.currentHoverPos.z);

      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          this.onPlace({ x, z }, this.selectedType, this.selectedDensity ?? undefined);
        }
      }
    }

    this.isDragging = false;
    this.lineDragStart = null;
    this.rectDragStart = null;
    this.clearLineDragPreview();
    this.clearRectPreview();
    this.onDragCostUpdate?.(null);
  }

  private onClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('#ui-root')) return;

    // Bulldoze mode: left-click demolishes
    if (this.toolMode === 'bulldoze' && e.button === 0) {
      const pos = this.raycaster.getGridPosition(e.clientX, e.clientY, this.camera);
      if (pos && this.onDemolish) {
        this.demolishArea(pos);
      }
      return;
    }

    // Pointer mode: check for edge road click to enter adjacent city
    if (this.toolMode === 'pointer') {
      const pos = this.raycaster.getGridPosition(e.clientX, e.clientY, this.camera);
      if (pos && this.onEdgeRoadClick) {
        this.checkEdgeRoadClick(pos);
      }
      return;
    }

    if (!this.selectedType || !this.onPlace) return;

    // Skip click handler for line-drag and rect-drag types — handled by mousedown/move/up
    if (isLineDragType(this.selectedType) || isRectDragType(this.selectedType)) return;

    const pos = this.raycaster.getGridPosition(e.clientX, e.clientY, this.camera);
    if (pos) {
      this.onPlace(pos, this.selectedType, this.selectedDensity ?? undefined);
    }
  }

  private demolishArea(center: Position): void {
    if (!this.onDemolish) return;
    const half = Math.floor(this.brushSize / 2);
    for (let dx = -half; dx < this.brushSize - half; dx++) {
      for (let dz = -half; dz < this.brushSize - half; dz++) {
        this.onDemolish({ x: center.x + dx, z: center.z + dz });
      }
    }
  }

  private onRightClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('#ui-root')) return;

    const pos = this.raycaster.getGridPosition(e.clientX, e.clientY, this.camera);
    if (pos && this.onDemolish) {
      this.onDemolish(pos);
    }
  }

  /**
   * Check if clicked position is an edge road and emit callback for cross-city navigation.
   */
  private checkEdgeRoadClick(pos: Position): void {
    if (!this.currentCityState || !this.onEdgeRoadClick) return;

    // Find building at this position
    const cell = this.currentCityState.grid[pos.x]?.[pos.z];
    if (!cell?.buildingId) return;

    const building = this.currentCityState.buildings.find((b: PlacedBuilding) => b.id === cell.buildingId);
    if (!building || !isRoad(building.type)) return;

    // Check if this road is at an edge
    const maxCoord = DEFAULT_GRID_SIZE - 1;
    let direction: EdgeDirection | null = null;
    let edgePosition: number | null = null;

    if (pos.x === 0) {
      direction = 'west';
      edgePosition = pos.z;
    } else if (pos.x === maxCoord) {
      direction = 'east';
      edgePosition = pos.z;
    } else if (pos.z === 0) {
      direction = 'north';
      edgePosition = pos.x;
    } else if (pos.z === maxCoord) {
      direction = 'south';
      edgePosition = pos.x;
    }

    if (direction && edgePosition !== null) {
      this.onEdgeRoadClick(direction, edgePosition);
    }
  }

  private currentCityState: CityState | null = null;

  setCityState(state: CityState | null): void {
    this.currentCityState = state;
  }

  private updateLineDragPreview(): void {
    this.clearLineDragPreview();
    if (!this.lineDragStart || !this.currentHoverPos || !this.selectedType) return;

    const orientation = computeLineDragOrientation(this.lineDragStart, this.currentHoverPos);
    const { w: effW, d: effD } = getEffectiveSize(this.selectedType, orientation);
    const positions = computeStraightLine(this.lineDragStart, this.currentHoverPos, effW, effD);

    this.lineDragPreviewGroup = new THREE.Group();
    const w = effW * CELL_SIZE;
    const d = effD * CELL_SIZE;

    for (const pos of positions) {
      const ghost = this.factory.createGhostPreview(this.selectedType, orientation);
      ghost.position.set(
        pos.x * CELL_SIZE + w / 2,
        0,
        pos.z * CELL_SIZE + d / 2,
      );
      this.lineDragPreviewGroup.add(ghost);
    }

    this.scene.add(this.lineDragPreviewGroup);

    // Update cost indicator
    const def = BUILDING_DEFS[this.selectedType];
    const totalCost = positions.length * def.cost;
    this.onDragCostUpdate?.(totalCost);
  }

  private clearLineDragPreview(): void {
    if (this.lineDragPreviewGroup) {
      this.scene.remove(this.lineDragPreviewGroup);
      this.lineDragPreviewGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
      this.lineDragPreviewGroup = null;
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

  private updateBulldozePreview(state: CityState): void {
    this.clearBulldozePreview();
    if (!this.currentHoverPos) return;

    this.bulldozePreviewGroup = new THREE.Group();
    const half = Math.floor(this.brushSize / 2);
    const seen = new Set<string>();

    for (let dx = -half; dx < this.brushSize - half; dx++) {
      for (let dz = -half; dz < this.brushSize - half; dz++) {
        const x = this.currentHoverPos.x + dx;
        const z = this.currentHoverPos.z + dz;
        if (x < 0 || z < 0 || x >= DEFAULT_GRID_SIZE || z >= DEFAULT_GRID_SIZE) continue;

        const cell = state.grid[x]?.[z];
        if (!cell?.buildingId || seen.has(cell.buildingId)) continue;
        seen.add(cell.buildingId);

        const building = state.buildings.find((b: PlacedBuilding) => b.id === cell.buildingId);
        if (!building) continue;

        const { w: effW, d: effD } = getEffectiveSize(building.type, building.orientation);
        const w = effW * CELL_SIZE;
        const d = effD * CELL_SIZE;

        const preview = this.factory.createBulldozePreview(building.type);
        preview.position.set(
          building.position.x * CELL_SIZE + w / 2,
          0,
          building.position.z * CELL_SIZE + d / 2,
        );
        this.bulldozePreviewGroup.add(preview);
      }
    }

    this.scene.add(this.bulldozePreviewGroup);
  }

  private clearBulldozePreview(): void {
    if (this.bulldozePreviewGroup) {
      this.scene.remove(this.bulldozePreviewGroup);
      this.bulldozePreviewGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
      this.bulldozePreviewGroup = null;
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
