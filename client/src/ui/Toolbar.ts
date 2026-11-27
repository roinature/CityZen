import {
  BuildingType, BUILDING_DEFS, INFRA_CATEGORIES, INFRA_WATERFRONT_TYPES, ROAD_TYPES,
  ZONE_DENSITY_COSTS, ZONE_TYPES, ZoneDensity, isUtilityConduit, isZone,
} from '@cityzen/shared';
import { BuildingFactory } from '../world/BuildingFactory.js';
import { DensityPicker } from './DensityPicker.js';

const CATEGORIES: ReadonlyArray<{ label: string; types: readonly BuildingType[] }> = [
  { label: 'Roads', types: ROAD_TYPES },
  { label: 'Zones', types: ZONE_TYPES },
  { label: 'Parks', types: [BuildingType.PARK, BuildingType.PARKING] },
  { label: 'Waterfront', types: INFRA_WATERFRONT_TYPES },
  { label: 'Services', types: [] },
];

export class Toolbar {
  readonly controls: HTMLDivElement;
  private pane: HTMLDivElement;
  private items: HTMLDivElement;
  private serviceCategories: HTMLSelectElement;
  private categoryButtons: HTMLButtonElement[] = [];
  private itemButtons = new Map<BuildingType, HTMLButtonElement>();
  private activeType: BuildingType | null = null;
  private openCategory: string | null = null;
  private densityPicker: DensityPicker;

  constructor(
    parent: HTMLElement,
    demand: HTMLElement,
    private onSelect: (type: BuildingType, density?: ZoneDensity) => void,
  ) {
    const dock = document.createElement('div');
    dock.className = 'build-dock';
    this.pane = document.createElement('div');
    this.pane.className = 'build-pane';
    this.pane.id = 'build-catalog';
    this.pane.hidden = true;
    dock.appendChild(this.pane);

    this.serviceCategories = document.createElement('select');
    this.serviceCategories.className = 'build-service-select';
    this.serviceCategories.setAttribute('aria-label', 'Service category');
    for (const category of INFRA_CATEGORIES) {
      this.serviceCategories.add(new Option(category.label, category.id));
    }
    this.serviceCategories.addEventListener('change', () => this.renderServices());
    this.pane.appendChild(this.serviceCategories);

    this.items = document.createElement('div');
    this.items.className = 'build-items';
    this.pane.appendChild(this.items);

    const bar = document.createElement('div');
    bar.className = 'build-bar';
    this.controls = document.createElement('div');
    this.controls.className = 'build-controls';

    const categories = document.createElement('div');
    categories.className = 'build-categories';
    categories.setAttribute('role', 'group');
    categories.setAttribute('aria-label', 'Build categories');
    for (const category of CATEGORIES) {
      const btn = document.createElement('button');
      btn.className = 'hud-button';
      btn.textContent = category.label;
      btn.setAttribute('aria-controls', this.pane.id);
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () => {
        if (this.openCategory === category.label) {
          this.close();
          return;
        }
        this.showCategory(category);
      });
      categories.appendChild(btn);
      this.categoryButtons.push(btn);
    }

    bar.append(this.controls, categories, demand);
    dock.appendChild(bar);
    parent.appendChild(dock);
    this.densityPicker = new DensityPicker(this.pane);
  }

  private renderServices(): void {
    const category = INFRA_CATEGORIES[this.serviceCategories.selectedIndex];
    this.renderItems(category.types);
  }

  private showCategory(category: (typeof CATEGORIES)[number]): void {
    this.openCategory = category.label;
    this.pane.hidden = false;
    this.updateCategories();
    this.serviceCategories.hidden = category.label !== 'Services';
    if (this.serviceCategories.hidden) this.renderItems(category.types);
    else this.renderServices();
  }

  showBuilding(type: BuildingType): void {
    const direct = CATEGORIES.find(category => category.types.includes(type));
    if (direct) {
      this.showCategory(direct);
      this.itemButtons.get(type)?.focus();
      return;
    }
    const service = INFRA_CATEGORIES.find(category => category.types.includes(type));
    if (service) this.serviceCategories.value = service.id;
    const category = CATEGORIES.find(category => service ? category.label === 'Services' : category.types.includes(type));
    if (!category) return;
    this.showCategory(category);
    this.itemButtons.get(type)?.focus();
  }

  private renderItems(types: readonly BuildingType[]): void {
    this.densityPicker.hide();
    this.items.replaceChildren();
    this.itemButtons.clear();
    for (const type of types) {
      const def = BUILDING_DEFS[type];
      const btn = document.createElement('button');
      btn.className = 'build-item';
      btn.setAttribute('aria-pressed', String(this.activeType === type));

      const preview = document.createElement('span');
      preview.className = 'build-item-preview';
      const iconPath = BuildingFactory.getBuildingIcon(type);
      preview.style.backgroundColor = def.color;
      if (iconPath) preview.style.backgroundImage = `url(${iconPath})`;

      const info = document.createElement('span');
      info.className = 'build-item-info';
      const label = document.createElement('span');
      label.textContent = def.label;
      const cost = document.createElement('span');
      cost.className = 'build-item-cost';
      const price = isZone(type)
        ? `$${ZONE_DENSITY_COSTS[ZoneDensity.LOW]}–$${ZONE_DENSITY_COSTS[ZoneDensity.HIGH]}`
        : `$${def.cost.toLocaleString()}`;
      const sizeText = isUtilityConduit(type) ? 'drag' : `${def.size.w}×${def.size.d}`;
      const spec = def.effects.powerGenerationMW
        ? ` · ${def.effects.powerGenerationMW} MW`
        : def.effects.waterSupplyM3
          ? ` · ${def.effects.waterSupplyM3} m³/h`
          : def.effects.sewageCapacityM3
            ? ` · ${def.effects.sewageCapacityM3} m³/h`
            : '';
      cost.textContent = `${price} · ${sizeText}${spec}`;
      info.append(label, cost);
      btn.append(preview, info);

      btn.addEventListener('click', (event) => {
        if (isZone(type) && this.activeType !== type) {
          event.stopPropagation();
          this.densityPicker.show(btn, (density) => this.onSelect(type, density));
        } else {
          this.onSelect(type);
        }
      });

      this.itemButtons.set(type, btn);
      this.items.appendChild(btn);
    }
    this.items.scrollLeft = 0;
  }

  private updateCategories(): void {
    for (const btn of this.categoryButtons) {
      btn.setAttribute('aria-expanded', String(btn.textContent === this.openCategory));
    }
  }

  dismissPicker(): boolean {
    return this.densityPicker.hide();
  }

  close(): boolean {
    const pickerWasOpen = this.dismissPicker();
    if (!this.openCategory) return pickerWasOpen;
    this.openCategory = null;
    this.pane.hidden = true;
    this.updateCategories();
    return true;
  }

  setActive(type: BuildingType | null): void {
    this.activeType = type;
    for (const [itemType, btn] of this.itemButtons) {
      btn.setAttribute('aria-pressed', String(itemType === type));
    }
  }
}
