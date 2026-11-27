import * as THREE from 'three';
import {
  BuildingType,
  type Position,
  type CityState,
  type EdgeDirection,
  type PlacedBuilding,
  type PlaceBuildingsPayload,
  type RoadOrientation,
  type UtilityLayer,
  type ZoneDensity,
  findGridBuildingToDemolish,
  isRoad,
  isUtilityConduit,
  isWaterfront,
  isZone,
  BUILDING_DEFS,
  ZONE_DENSITY_COSTS,
  CELL_SIZE,
  DEFAULT_GRID_SIZE,
  canPlaceBuilding,
  getEffectiveSize,
  getPlacementCost,
  getWaterfrontFacing,
  replacesRoads,
  resolveWaterfrontOrientation,
} from '@cityzen/shared';
import { BuildingFactory } from '../world/BuildingFactory.js';
import type { GridRect } from '../world/CityBuildings.js';
import { CITY_STYLES, type CityStyleId } from '../world/CityStyle.js';
import { GridRaycaster } from './Raycaster.js';
import type { ToolMode } from '../ui/BuildTools.js';

function disposePreviewGroup(group: THREE.Group): void {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (child instanceof THREE.InstancedMesh) child.dispose();
    child.geometry.dispose();
    if (Array.isArray(child.material)) {
      for (const m of child.material) m.dispose();
    } else {
      child.material.dispose();
    }
  });
}

function isLineDragType(type: BuildingType): boolean {
  return (isRoad(type) && !replacesRoads(type)) || isUtilityConduit(type);
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
  private getCamera: () => THREE.Camera;
  private raycaster: GridRaycaster;
  private factory: BuildingFactory;

  private selectedType: BuildingType | null = null;
  private selectedDensity: ZoneDensity | null = null;
  private preferredOrientation: RoadOrientation = 'EW';
  private styleId: CityStyleId = 'classic';
  private previewMesh: THREE.Group | null = null;
  private previewMeshKey: string | null = null;
  private currentHoverPos: Position | null = null;

  // Tool mode & active utility layer
  private toolMode: ToolMode = 'pointer';
  private activeLayer: UtilityLayer = 'surface';
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

  onPaint: ((stroke: PlaceBuildingsPayload) => void) | null = null;
  onPlace: ((pos: Position, type: BuildingType, density?: ZoneDensity, orientation?: RoadOrientation) => void) | null = null;
  onDemolish: ((pos: Position, layer: UtilityLayer) => void) | null = null;
  onEdgeRoadClick: ((direction: EdgeDirection, position: number) => void) | null = null;
  /** Reports the cost of what is about to be placed (null = nothing), whether affordable, any terrain-leveling fee included, and optional invalid placement hint. */
  onDragCostUpdate: ((cost: number | null, affordable?: boolean, gradingCost?: number, invalidReason?: string) => void) | null = null;
  /** Footprint whose existing zoned buildings should step aside for a valid hover preview. */
  onPreviewClearance: ((rect: GridRect | null) => void) | null = null;

  constructor(scene: THREE.Scene, getCamera: () => THREE.Camera, canvas: HTMLCanvasElement) {
    this.scene = scene;
    this.getCamera = getCamera;
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

  rotateSelection(): void {
    this.preferredOrientation = this.preferredOrientation === 'EW' ? 'NS' : 'EW';
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

  setStyle(style: CityStyleId): void {
    if (this.styleId === style) return;
    this.styleId = style;
    this.lastPreviewKey = null;
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

  setActiveLayer(layer: UtilityLayer): void {
    if (this.activeLayer === layer) return;
    this.activeLayer = layer;
    this.lastPreviewKey = null;
  }

  getActiveLayer(): UtilityLayer {
    return this.activeLayer;
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
    const lastId = state?.buildings.length ? state.buildings[state.buildings.length - 1].id : '';
    return [
      this.toolMode, this.activeLayer, this.selectedType, this.selectedDensity, this.preferredOrientation, this.brushSize, this.styleId,
      pos(this.currentHoverPos), this.isDragging, pos(this.lineDragStart), pos(this.rectDragStart),
      state?.id, state?.buildings.length, lastId, state?.resources.money, this.unlimitedMoney,
    ].join('|');
  }

  private resolveHoverOrientation(state: CityState, pos: Position, type: BuildingType): RoadOrientation | undefined {
    if (isWaterfront(type)) {
      return resolveWaterfrontOrientation(state.grid, pos, type, state.buildings, this.preferredOrientation);
    }
    if (type === BuildingType.TRANS_HARBOR) {
      const facingPref = getWaterfrontFacing(state.grid, pos, type, this.preferredOrientation);
      if (facingPref) return this.preferredOrientation;
      const alt: RoadOrientation = this.preferredOrientation === 'EW' ? 'NS' : 'EW';
      if (getWaterfrontFacing(state.grid, pos, type, alt)) return alt;
    }
    const def = BUILDING_DEFS[type];
    if (!isZone(type) && !isRoad(type) && def.size.w !== def.size.d) {
      return this.preferredOrientation;
    }
    return undefined;
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

    const orientation = this.resolveHoverOrientation(state, this.currentHoverPos, this.selectedType);
    const facing = (isWaterfront(this.selectedType) || this.selectedType === BuildingType.TRANS_HARBOR)
      ? getWaterfrontFacing(state.grid, this.currentHoverPos, this.selectedType, orientation) ?? undefined
      : undefined;

    const result = canPlaceBuilding(
      state.grid, this.currentHoverPos, this.selectedType,
      state.resources, this.unlimitedMoney, state.buildings,
      this.selectedDensity ?? undefined, orientation,
    );

    const meshKey = `${this.selectedType}|${result.valid}|${this.styleId}|${orientation ?? ''}|${facing ?? ''}`;
    if (!this.previewMesh || this.previewMeshKey !== meshKey) {
      this.disposePreviewOnly();
      this.previewMesh = this.factory.createPreview(
        this.selectedType, result.valid, CITY_STYLES[this.styleId], orientation, facing,
      );
      this.previewMeshKey = meshKey;
      this.scene.add(this.previewMesh);
    }

    const { w: effW, d: effD } = getEffectiveSize(this.selectedType, orientation);
    const w = effW * CELL_SIZE;
    const d = effD * CELL_SIZE;
    this.previewMesh.position.set(
      this.currentHoverPos.x * CELL_SIZE + w / 2,
      0,
      this.currentHoverPos.z * CELL_SIZE + d / 2,
    );

    if (result.valid && !isZone(this.selectedType) && !isUtilityConduit(this.selectedType)) {
      this.onPreviewClearance?.({
        x: this.currentHoverPos.x,
        z: this.currentHoverPos.z,
        w: effW,
        d: effD,
      });
    } else {
      this.onPreviewClearance?.(null);
    }

    const { totalCost, gradingCost } = getPlacementCost(
      state.grid,
      this.currentHoverPos,
      this.selectedType,
      this.selectedDensity ?? undefined,
      orientation,
    );
    const invalidHint = !result.valid && result.reason && result.reason !== 'Cell occupied' && result.reason !== 'Not enough money'
      ? result.reason
      : undefined;
    this.onDragCostUpdate?.(totalCost, this.canAfford(state, totalCost), gradingCost, invalidHint);
  }

  private getRectanglePositions(start: Position, end: Position): Position[] {
    const positions: Position[] = [];
    for (let x = Math.min(start.x, end.x); x <= Math.max(start.x, end.x); x++) {
      for (let z = Math.min(start.z, end.z); z <= Math.max(start.z, end.z); z++) {
        positions.push({ x, z });
      }
    }
    return positions;
  }

  private updateRectPreview(state: CityState): void {
    this.clearRectPreview();
    if (!this.rectDragStart || !this.currentHoverPos || !this.selectedType) return;

    const placeable: Position[] = [];
    const blocked: Position[] = [];
    const unitCost = this.getUnitCost();
    let cost = 0;
    let outOfMoney = false;
    for (const position of this.getRectanglePositions(this.rectDragStart, this.currentHoverPos)) {
      const free = canPlaceBuilding(state.grid, position, this.selectedType, state.resources, true).valid;
      if (free && this.canAfford(state, cost + unitCost)) {
        placeable.push(position);
        cost += unitCost;
      } else {
        blocked.push(position);
        outOfMoney ||= free;
      }
    }
    this.rectPreviewGroup = new THREE.Group();
    for (const [positions, valid] of [[placeable, true], [blocked, false]] as const) {
      if (!positions.length) continue;
      const geometry = new THREE.BoxGeometry(CELL_SIZE * 0.85, 0.3, CELL_SIZE * 0.85);
      const material = new THREE.MeshLambertMaterial({
        color: valid ? 0x00ff00 : 0xff0000,
        transparent: true,
        opacity: 0.5,
      });
      const tiles = new THREE.InstancedMesh(geometry, material, positions.length);
      const transform = new THREE.Matrix4();
      positions.forEach(({ x, z }, index) => {
        transform.makeTranslation((x + 0.5) * CELL_SIZE, 0.15, (z + 0.5) * CELL_SIZE);
        tiles.setMatrixAt(index, transform);
      });
      tiles.instanceMatrix.needsUpdate = true;
      this.rectPreviewGroup.add(tiles);
    }

    this.scene.add(this.rectPreviewGroup);

    this.onDragCostUpdate?.(cost, !outOfMoney);
  }

  canDraw(): boolean {
    return this.toolMode === 'build' && this.selectedType !== null &&
      (isLineDragType(this.selectedType) || isRectDragType(this.selectedType));
  }

  hover(x: number, y: number): void {
    this.currentHoverPos = this.raycaster.getGridPosition(x, y, this.getCamera(), this.isDragging);
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
    if (this.isDragging && this.selectedType && this.currentHoverPos) {
      const type = this.selectedType;
      if (this.lineDragStart && isLineDragType(type)) {
        const orientation = computeLineDragOrientation(this.lineDragStart, this.currentHoverPos);
        const { w, d } = getEffectiveSize(type, orientation);
        const positions = computeStraightLine(this.lineDragStart, this.currentHoverPos, w, d);
        this.onPaint?.({ positions, type, orientation });
      } else if (this.rectDragStart && isRectDragType(type)) {
        const positions = this.getRectanglePositions(this.rectDragStart, this.currentHoverPos);
        this.onPaint?.({ positions, type, density: this.selectedDensity ?? undefined });
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
    const pos = this.raycaster.getGridPosition(x, y, this.getCamera());
    if (!pos) return;
    if (this.toolMode === 'bulldoze') {
      this.demolishArea(pos);
    } else if (this.toolMode === 'pointer') {
      this.checkEdgeRoadClick(pos);
    } else if (this.selectedType && !this.canDraw()) {
      const orientation = this.currentCityState
        ? this.resolveHoverOrientation(this.currentCityState, pos, this.selectedType)
        : undefined;
      this.onPlace?.(pos, this.selectedType, this.selectedDensity ?? undefined, orientation);
    }
  }

  private demolishArea(center: Position): void {
    if (!this.onDemolish) return;
    const half = Math.floor(this.brushSize / 2);
    for (let dx = -half; dx < this.brushSize - half; dx++) {
      for (let dz = -half; dz < this.brushSize - half; dz++) {
        this.onDemolish({ x: center.x + dx, z: center.z + dz }, this.activeLayer);
      }
    }
  }

  demolishAt(x: number, y: number): void {
    const pos = this.raycaster.getGridPosition(x, y, this.getCamera());
    if (pos) this.onDemolish?.(pos, this.activeLayer);
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
    const leveled = new Set<string>();
    let totalCost = 0;
    let gradingCost = 0;

    for (const pos of positions) {
      const placeable = canPlaceBuilding(
        state.grid, pos, this.selectedType, state.resources, true, state.buildings, undefined, orientation,
      ).valid;
      let segValid = false;
      if (placeable) {
        const quote = getPlacementCost(state.grid, pos, this.selectedType, undefined, orientation, leveled);
        const nextTotal = totalCost + quote.totalCost;
        segValid = this.canAfford(state, nextTotal);
        totalCost = nextTotal;
        gradingCost += quote.gradingCost;
        for (const cell of quote.gradedCells) {
          leveled.add(`${cell.x},${cell.z}`);
        }
      }

      const ghost = this.factory.createGhostPreview(
        this.selectedType, orientation, CITY_STYLES[this.styleId], segValid,
      );
      ghost.position.set(
        pos.x * CELL_SIZE + w / 2,
        0,
        pos.z * CELL_SIZE + d / 2,
      );
      this.lineDragPreviewGroup.add(ghost);
    }

    this.scene.add(this.lineDragPreviewGroup);

    // Update cost indicator (includes deduplicated terrain-leveling fee)
    this.onDragCostUpdate?.(totalCost, this.canAfford(state, totalCost), gradingCost);
  }

  private clearLineDragPreview(): void {
    if (this.lineDragPreviewGroup) {
      this.scene.remove(this.lineDragPreviewGroup);
      disposePreviewGroup(this.lineDragPreviewGroup);
      this.lineDragPreviewGroup = null;
    }
  }

  private disposePreviewOnly(): void {
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      disposePreviewGroup(this.previewMesh);
      this.previewMesh = null;
      this.previewMeshKey = null;
    }
  }

  private clearPreview(): void {
    this.disposePreviewOnly();
    this.onPreviewClearance?.(null);
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

        const building = findGridBuildingToDemolish(state.grid, state.buildings, { x, z }, this.activeLayer);
        if (!building || seen.has(building.id)) continue;
        seen.add(building.id);

        const { w: effW, d: effD } = getEffectiveSize(building.type, building.orientation);
        const w = effW * CELL_SIZE;
        const d = effD * CELL_SIZE;

        const preview = this.factory.createBulldozePreview(building.type, building.orientation);
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
      disposePreviewGroup(this.bulldozePreviewGroup);
      this.bulldozePreviewGroup = null;
    }
  }

  private clearRectPreview(): void {
    if (this.rectPreviewGroup) {
      this.scene.remove(this.rectPreviewGroup);
      disposePreviewGroup(this.rectPreviewGroup);
      this.rectPreviewGroup = null;
    }
  }
}
