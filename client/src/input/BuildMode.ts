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
  ZONE_DENSITY_COSTS,
  CELL_SIZE,
  DEFAULT_GRID_SIZE,
  canPlaceBuilding,
  getEffectiveSize,
} from '@cityzen/shared';
import { BuildingFactory } from '../world/BuildingFactory.js';
import { GridRaycaster } from './Raycaster.js';
import type { ToolMode } from '../ui/BuildTools.js';

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

  // Previews are only rebuilt when something relevant changes (see previewKey)
  private lastPreviewKey: string | null = null;

  onPlace: ((pos: Position, type: BuildingType, density?: ZoneDensity, orientation?: RoadOrientation) => void) | null = null;
  onDemolish: ((pos: Position) => void) | null = null;
  onEdgeRoadClick: ((direction: EdgeDirection, position: number) => void) | null = null;
  /** Reports the cost of what is about to be placed (null = nothing), and whether the city can afford it. */
  onDragCostUpdate: ((cost: number | null, affordable?: boolean) => void) | null = null;

  constructor(scene: THREE.Scene, camera: THREE.Camera, canvas: HTMLCanvasElement) {
    this.scene = scene;
    this.camera = camera;
    this.raycaster = new GridRaycaster(canvas);
    this.factory = new BuildingFactory();
  }

  select(type: BuildingType): void {
    this.selectedType = type;
    this.lastPreviewKey = null;
    this.clearPreview();
    this.clearRectPreview();
  }

  setDensity(density: ZoneDensity | null): void {
    this.selectedDensity = density;
    this.lastPreviewKey = null;
  }

  deselect(): void {
    this.selectedType = null;
    this.selectedDensity = null;
    this.cancelInteraction();
    this.clearHover();
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

  /** Cost of one unit of the selected type (zones are priced by density). */
  private getUnitCost(): number {
    if (!this.selectedType) return 0;
    if (isZone(this.selectedType) && this.selectedDensity) {
      return ZONE_DENSITY_COSTS[this.selectedDensity];
    }
    return BUILDING_DEFS[this.selectedType].cost;
  }

  /** Everything the preview depends on. Unchanged key → keep the existing preview meshes. */
  private previewKey(state: CityState | null): string {
    const pos = (p: Position | null) => (p ? `${p.x},${p.z}` : '-');
    return [
      this.toolMode, this.selectedType, this.selectedDensity, this.brushSize,
      pos(this.currentHoverPos), this.isDragging, pos(this.lineDragStart), pos(this.rectDragStart),
      state?.id, state?.buildings.length, state?.resources.money, this.unlimitedMoney,
    ].join('|');
  }

  private canAfford(state: CityState, cost: number): boolean {
    return this.unlimitedMoney || state.resources.money >= cost;
  }

  updatePreview(state: CityState | null): void {
    // Rebuilding preview meshes every frame is wasteful (a zone drag can be
    // hundreds of cells) — only do it when the inputs actually changed.
    const key = this.previewKey(state);
    if (key === this.lastPreviewKey) return;
    this.lastPreviewKey = key;

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
      this.onDragCostUpdate?.(null);
      return;
    }

    // Line drag preview for roads
    if (this.isDragging && this.lineDragStart && isLineDragType(this.selectedType)) {
      this.clearPreview();
      this.updateLineDragPreview(state);
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
      this.selectedDensity ?? undefined,
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

    const unitCost = this.getUnitCost();
    this.onDragCostUpdate?.(unitCost, this.canAfford(state, unitCost));
  }

  /**
   * Split the dragged rectangle into cells that will be zoned and cells that
   * won't (occupied, or beyond what the treasury can pay for).
   */
  private computeRectPlacements(state: CityState | null): { placeable: Position[]; blocked: Position[]; cost: number } {
    const placeable: Position[] = [];
    const blocked: Position[] = [];
    let cost = 0;
    if (!this.rectDragStart || !this.currentHoverPos || !this.selectedType) {
      return { placeable, blocked, cost };
    }

    const minX = Math.min(this.rectDragStart.x, this.currentHoverPos.x);
    const maxX = Math.max(this.rectDragStart.x, this.currentHoverPos.x);
    const minZ = Math.min(this.rectDragStart.z, this.currentHoverPos.z);
    const maxZ = Math.max(this.rectDragStart.z, this.currentHoverPos.z);
    const unitCost = this.getUnitCost();

    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const pos: Position = { x, z };
        if (!state) {
          placeable.push(pos);
          continue;
        }
        // Occupancy/bounds only here; the budget is tracked cumulatively below
        const free = canPlaceBuilding(
          state.grid, pos, this.selectedType, state.resources, true, state.buildings,
        ).valid;
        if (free && this.canAfford(state, cost + unitCost)) {
          placeable.push(pos);
          cost += unitCost;
        } else {
          blocked.push(pos);
        }
      }
    }

    return { placeable, blocked, cost };
  }

  private updateRectPreview(state: CityState): void {
    this.clearRectPreview();
    if (!this.rectDragStart || !this.currentHoverPos || !this.selectedType) return;

    const { placeable, blocked, cost } = this.computeRectPlacements(state);
    this.rectPreviewGroup = new THREE.Group();
    const half = CELL_SIZE / 2;

    const addCell = (pos: Position, valid: boolean) => {
      const cellPreview = this.factory.createPreview(this.selectedType!, valid);
      cellPreview.position.set(pos.x * CELL_SIZE + half, 0, pos.z * CELL_SIZE + half);
      this.rectPreviewGroup!.add(cellPreview);
    };
    for (const pos of placeable) addCell(pos, true);
    for (const pos of blocked) addCell(pos, false);

    this.scene.add(this.rectPreviewGroup);

    // Warn when part of the area was dropped because the money ran out
    const unitCost = this.getUnitCost();
    const outOfMoney = blocked.length > 0 && !this.canAfford(state, cost + unitCost);
    this.onDragCostUpdate?.(cost, !outOfMoney);
  }

  canDraw(): boolean {
    return this.toolMode === 'build' && this.selectedType !== null &&
      (isLineDragType(this.selectedType) || isRectDragType(this.selectedType));
  }

  hover(x: number, y: number): void {
    this.currentHoverPos = this.raycaster.getGridPosition(x, y, this.camera);
  }

  clearHover(): void {
    this.currentHoverPos = null;
    this.clearPreview();
    this.clearBulldozePreview();
    this.lastPreviewKey = null;
    this.onDragCostUpdate?.(null);
  }

  startDraw(x: number, y: number): void {
    this.hover(x, y);
    if (!this.currentHoverPos || !this.selectedType) return;
    this.isDragging = true;
    if (isRectDragType(this.selectedType)) {
      this.rectDragStart = this.currentHoverPos;
    } else {
      this.lineDragStart = this.currentHoverPos;
    }
  }

  finishDraw(x: number, y: number): void {
    this.hover(x, y);
    // Line drag release — place all roads along the straight line
    if (this.isDragging && this.lineDragStart && this.selectedType && isLineDragType(this.selectedType) && this.onPlace && this.currentHoverPos) {
      const orientation = computeLineDragOrientation(this.lineDragStart, this.currentHoverPos);
      const { w, d } = getEffectiveSize(this.selectedType, orientation);
      const positions = computeStraightLine(this.lineDragStart, this.currentHoverPos, w, d);
      for (const pos of positions) {
        this.onPlace(pos, this.selectedType, undefined, orientation);
      }
    }

    // Rectangle drag release — place all zones in the rectangle
    if (this.isDragging && this.rectDragStart && this.selectedType && isRectDragType(this.selectedType) && this.onPlace && this.currentHoverPos) {
      // Only send cells that are free and affordable, instead of spamming the
      // server with requests it will reject
      const { placeable } = this.computeRectPlacements(this.currentCityState);
      for (const pos of placeable) {
        this.onPlace(pos, this.selectedType, this.selectedDensity ?? undefined);
      }
    }

    this.cancelInteraction();
  }

  cancelInteraction(): void {
    this.isDragging = false;
    this.lineDragStart = null;
    this.rectDragStart = null;
    this.lastPreviewKey = null;
    this.clearLineDragPreview();
    this.clearRectPreview();
  }

  tap(x: number, y: number): void {
    const pos = this.raycaster.getGridPosition(x, y, this.camera);
    if (!pos) return;
    if (this.toolMode === 'bulldoze') {
      this.demolishArea(pos);
    } else if (this.toolMode === 'pointer') {
      this.checkEdgeRoadClick(pos);
    } else if (this.selectedType && !this.canDraw()) {
      this.onPlace?.(pos, this.selectedType, this.selectedDensity ?? undefined);
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

  demolishAt(x: number, y: number): void {
    const pos = this.raycaster.getGridPosition(x, y, this.camera);
    if (pos) this.onDemolish?.(pos);
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

  private updateLineDragPreview(state: CityState): void {
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
    this.onDragCostUpdate?.(totalCost, this.canAfford(state, totalCost));
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
