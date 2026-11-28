import * as THREE from 'three';
import {
  CELL_SIZE, DEFAULT_GRID_SIZE, getEffectiveSize, isStarterEntranceRoad,
  type CityState, type Grid, type PlacedBuilding, type UtilityGridReport, type UtilityLayer,
} from '@cityzen/shared';
import { CityBuildings, type GridRect } from './CityBuildings.js';
import { CITY_STYLES, type CityStyle, type CityStyleId } from './CityStyle.js';
import { createRoadSurface, indexRoads } from './RoadSurface.js';
import { createServiceModel, hasServiceModel } from './ServiceModels.js';
import { StreetFurniture } from './StreetFurniture.js';
import { UtilityOverlay } from './UtilityOverlay.js';
import { EmergencyEffects } from './EmergencyEffects.js';
import { ObstacleMap, STEP_HEIGHT, type Obstacle } from './explore/ObstacleMap.js';

const NIGHT_FADE_SECONDS = 1.2;

export interface CityLook {
  style: CityStyleId;
  /** Multiplier on building heights. */
  skyline: number;
  crossings: boolean;
  trees: boolean;
}

export class CityRenderer {
  private buildings = new CityBuildings();
  private furniture = new StreetFurniture();
  private utilities = new UtilityOverlay();
  private emergencies = new EmergencyEffects();
  private surface: THREE.Mesh | null = null;
  private rotors: THREE.Object3D[] = [];
  private models = new Map<string, THREE.Group>();
  private state: CityState | null = null;
  private needsSync = false;
  private surfaceKey = '';
  private night = 0;
  private activeLayer: UtilityLayer = 'surface';
  private look: CityLook = { style: 'classic', skyline: 1, crossings: true, trees: true };
  private obstacles: ObstacleMap | null = null;
  private selectionGroup: THREE.Group | null = null;
  private selectionId: string | null = null;
  private selectionPulse = 0;

  constructor(private scene: THREE.Scene, private entranceRoad: THREE.Group) {
    scene.add(
      this.buildings.group,
      this.furniture.group,
      this.utilities.powerLinesGroup,
      this.utilities.layerGroup,
      this.emergencies.group,
    );
  }

  setActiveLayer(layer: UtilityLayer): UtilityGridReport | null {
    this.activeLayer = layer;
    const opacity = layer === 'water' || layer === 'sewage' ? 0.24 : layer === 'power' ? 0.65 : 1.0;
    this.buildings.setLayerOpacity(opacity);
    this.applyModelsOpacity(opacity);
    return this.utilities.setActiveLayer(layer, this.state);
  }

  getActiveLayer(): UtilityLayer {
    return this.activeLayer;
  }

  getUtilityReport(): UtilityGridReport | null {
    return this.utilities.getLastReport();
  }

  private applyModelsOpacity(opacity: number): void {
    const translucent = opacity < 0.99;
    for (const model of this.models.values()) {
      model.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of mats) {
          mat.transparent = translucent;
          mat.opacity = opacity;
          mat.depthWrite = !translucent;
          mat.needsUpdate = true;
        }
      });
    }
  }

  setLook(look: CityLook): void {
    if (JSON.stringify(look) === JSON.stringify(this.look)) return;
    if (look.style !== this.look.style) this.syncModels([], CITY_STYLES[look.style]);
    this.look = look;
    this.surfaceKey = '';
    this.needsSync = true;
  }

  syncState(state: CityState): void {
    this.state = state;
    this.needsSync = true;
  }

  highlightZones(highlight: boolean): void {
    this.buildings.highlightZones(highlight);
  }

  setPreviewClearance(rect: GridRect | null): void {
    this.buildings.setPreviewClearance(rect);
  }

  /** Highlights the footprint of the currently inspected building in 3D. */
  setSelectedBuilding(building: PlacedBuilding | null): void {
    this.clearSelectionHighlight();
    if (!building) return;
    this.selectionId = building.id;
    this.selectionPulse = 0;
    const { w: effW, d: effD } = getEffectiveSize(building.type, building.orientation);
    const w = effW * CELL_SIZE;
    const d = effD * CELL_SIZE;
    const group = new THREE.Group();
    group.name = 'selected-building-highlight';

    const padMat = new THREE.MeshBasicMaterial({
      color: 0xa7dfb8,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.02, d * 1.02).rotateX(-Math.PI / 2), padMat);
    pad.position.y = 0.048;
    pad.renderOrder = 14;
    group.add(pad);

    const borderMat = new THREE.MeshBasicMaterial({
      color: 0x69f0ae,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const t = 0.065 * CELL_SIZE;
    const hw = (w * 1.03) / 2;
    const hd = (d * 1.03) / 2;
    const addBar = (bw: number, bd: number, x: number, z: number) => {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(bw, bd).rotateX(-Math.PI / 2), borderMat.clone());
      bar.name = 'selection-border';
      bar.position.set(x, 0.054, z);
      bar.renderOrder = 15;
      group.add(bar);
    };
    addBar(w * 1.03, t, 0, -hd + t / 2);
    addBar(w * 1.03, t, 0, hd - t / 2);
    addBar(t, d * 1.03 - t * 2, -hw + t / 2, 0);
    addBar(t, d * 1.03 - t * 2, hw - t / 2, 0);
    borderMat.dispose();

    group.position.set(
      building.position.x * CELL_SIZE + w / 2,
      0,
      building.position.z * CELL_SIZE + d / 2,
    );
    this.selectionGroup = group;
    this.scene.add(group);
  }

  private clearSelectionHighlight(): void {
    this.selectionId = null;
    if (!this.selectionGroup) return;
    this.scene.remove(this.selectionGroup);
    disposeModel(this.selectionGroup);
    this.selectionGroup = null;
  }

  /** Apply pending changes and advance animations. Call once per frame. */
  update(deltaTime: number, isNight: boolean): void {
    if (this.needsSync && this.state) this.rebuild(this.state);
    this.needsSync = false;
    this.buildings.update(deltaTime);
    this.emergencies.update(deltaTime, this.state);
    for (const rotor of this.rotors) rotor.rotation.z -= deltaTime * 1.1;
    if (this.selectionGroup) {
      this.selectionPulse += deltaTime * 3.2;
      const pulse = 0.72 + 0.25 * Math.sin(this.selectionPulse);
      for (const child of this.selectionGroup.children) {
        if (child instanceof THREE.Mesh && child.name === 'selection-border') {
          (child.material as THREE.MeshBasicMaterial).opacity = pulse;
        }
      }
    }

    const target = isNight ? 1 : 0;
    if (this.night !== target) {
      const step = deltaTime / NIGHT_FADE_SECONDS;
      this.night = target > this.night ? Math.min(1, this.night + step) : Math.max(0, this.night - step);
      this.buildings.setNight(this.night);
      this.furniture.setNight(this.night);
    }
  }

  /** What stands where, for walking, sailing and flying through the city. */
  getObstacles(): ObstacleMap {
    if (this.needsSync && this.state) this.rebuild(this.state);
    this.needsSync = false;
    if (this.obstacles) return this.obstacles;
    const boxes: Obstacle[] = [...this.buildings.getFootprints()];
    const box = new THREE.Box3();
    for (const model of this.models.values()) {
      model.updateMatrixWorld(true);
      model.traverse(child => {
        if (!(child instanceof THREE.Mesh) || child.name === 'wake') return;
        box.setFromObject(child);
        if (box.isEmpty() || box.max.y / CELL_SIZE < STEP_HEIGHT) return;
        boxes.push({
          x0: box.min.x / CELL_SIZE, z0: box.min.z / CELL_SIZE,
          x1: box.max.x / CELL_SIZE, z1: box.max.z / CELL_SIZE,
          top: box.max.y / CELL_SIZE,
        });
      });
    }
    this.obstacles = new ObstacleMap(this.state?.grid.length ?? DEFAULT_GRID_SIZE, boxes);
    return this.obstacles;
  }

  private rebuild(state: CityState): void {
    this.obstacles = null;
    this.entranceRoad.visible = state.buildings.length === 0
      || state.buildings.some(building => isStarterEntranceRoad(building, DEFAULT_GRID_SIZE));
    const { look } = this;
    const style = CITY_STYLES[look.style];
    const roads = indexRoads(state.buildings);

    // The ground only changes with the layout, or when a lot gets its first building.
    let key = `${state.grid.length}`;
    for (const b of state.buildings) {
      key += `;${b.type},${b.position.x},${b.position.z},${b.orientation ?? ''}${b.density ?? ''}${b.developmentLevel ? 1 : 0}`;
    }
    if (key !== this.surfaceKey) {
      this.surfaceKey = key;
      this.clearSurface();
      const isWater = (x: number, z: number) => state.grid[x]?.[z]?.terrain === 'water';
      this.surface = createRoadSurface(state.buildings, roads, state.grid.length, { style, crossings: look.crossings, isWater });
      this.scene.add(this.surface);
      this.furniture.rebuild(state.buildings, roads, state.grid.length, style, look.trees, isWater);
    }
    this.buildings.rebuild(state.buildings, roads, { style, skyline: look.skyline });
    this.syncModels(state.buildings, style, state.grid);
    if (this.activeLayer !== 'surface') {
      const opacity = this.activeLayer === 'water' || this.activeLayer === 'sewage' ? 0.24 : 0.65;
      this.applyModelsOpacity(opacity);
    }
    this.utilities.rebuild(state);
    if (this.selectionId && !state.buildings.some(b => b.id === this.selectionId)) {
      this.clearSelectionHighlight();
    }
  }

  private syncModels(buildings: readonly PlacedBuilding[], style: CityStyle, grid?: Grid): void {
    const current = new Set<string>();
    for (const building of buildings) {
      if (!hasServiceModel(building.type)) continue;
      current.add(building.id);
      if (this.models.has(building.id)) continue;
      const model = createServiceModel(building, style, grid);
      this.models.set(building.id, model);
      this.scene.add(model);
    }
    for (const [id, model] of this.models) {
      if (current.has(id)) continue;
      this.scene.remove(model);
      disposeModel(model);
      this.models.delete(id);
    }
    this.rotors = [...this.models.values()].flatMap(model => model.getObjectByName('rotor') ?? []);
  }

  private clearSurface(): void {
    if (!this.surface) return;
    this.scene.remove(this.surface);
    this.surface.geometry.dispose();
    (this.surface.material as THREE.Material).dispose();
    this.surface = null;
  }

  clear(): void {
    this.state = null;
    this.obstacles = null;
    this.needsSync = false;
    this.surfaceKey = '';
    this.entranceRoad.visible = false;
    this.clearSurface();
    this.buildings.clear();
    this.furniture.clear();
    this.utilities.clear();
    this.emergencies.clear();
    this.clearSelectionHighlight();
    this.syncModels([], CITY_STYLES[this.look.style]);
  }
}

function disposeModel(group: THREE.Group): void {
  group.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    child.material.dispose();
  });
}
