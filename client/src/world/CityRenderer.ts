import * as THREE from 'three';
import {
  DEFAULT_GRID_SIZE, isStarterEntranceRoad,
  type CityState, type Grid, type PlacedBuilding, type UtilityGridReport, type UtilityLayer,
} from '@cityzen/shared';
import { CityBuildings, type GridRect } from './CityBuildings.js';
import { CITY_STYLES, type CityStyle, type CityStyleId } from './CityStyle.js';
import { createRoadSurface, indexRoads } from './RoadSurface.js';
import { createServiceModel, hasServiceModel } from './ServiceModels.js';
import { StreetFurniture } from './StreetFurniture.js';
import { UtilityOverlay } from './UtilityOverlay.js';

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
  private surface: THREE.Mesh | null = null;
  private rotors: THREE.Object3D[] = [];
  private models = new Map<string, THREE.Group>();
  private state: CityState | null = null;
  private needsSync = false;
  private surfaceKey = '';
  private night = 0;
  private activeLayer: UtilityLayer = 'surface';
  private look: CityLook = { style: 'classic', skyline: 1, crossings: true, trees: true };

  constructor(private scene: THREE.Scene, private entranceRoad: THREE.Group) {
    scene.add(
      this.buildings.group,
      this.furniture.group,
      this.utilities.powerLinesGroup,
      this.utilities.layerGroup,
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

  /** Apply pending changes and advance animations. Call once per frame. */
  update(deltaTime: number, isNight: boolean): void {
    if (this.needsSync && this.state) this.rebuild(this.state);
    this.needsSync = false;
    this.buildings.update(deltaTime);
    for (const rotor of this.rotors) rotor.rotation.z -= deltaTime * 1.1;

    const target = isNight ? 1 : 0;
    if (this.night !== target) {
      const step = deltaTime / NIGHT_FADE_SECONDS;
      this.night = target > this.night ? Math.min(1, this.night + step) : Math.max(0, this.night - step);
      this.buildings.setNight(this.night);
      this.furniture.setNight(this.night);
    }
  }

  private rebuild(state: CityState): void {
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
      this.surface = createRoadSurface(state.buildings, roads, state.grid.length, { style, crossings: look.crossings });
      this.scene.add(this.surface);
      this.furniture.rebuild(state.buildings, roads, state.grid.length, style, look.trees);
    }
    this.buildings.rebuild(state.buildings, roads, { style, skyline: look.skyline });
    this.syncModels(state.buildings, style, state.grid);
    if (this.activeLayer !== 'surface') {
      const opacity = this.activeLayer === 'water' || this.activeLayer === 'sewage' ? 0.24 : 0.65;
      this.applyModelsOpacity(opacity);
    }
    this.utilities.rebuild(state);
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
    this.needsSync = false;
    this.surfaceKey = '';
    this.entranceRoad.visible = false;
    this.clearSurface();
    this.buildings.clear();
    this.furniture.clear();
    this.utilities.clear();
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
