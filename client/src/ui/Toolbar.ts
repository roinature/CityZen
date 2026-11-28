import {
  BuildingType, BUILDING_DEFS, INFRA_CATEGORIES, INFRA_WATERFRONT_TYPES, ROAD_TYPES,
  ZONE_DENSITY_COSTS, ZONE_TYPES, ZoneDensity, isUtilityConduit, isZone,
  type InfraCategory,
} from '@cityzen/shared';
import { BuildingFactory } from '../world/BuildingFactory.js';
import {
  CATEGORY_ICONS,
  SERVICE_CATEGORY_ICONS,
  getBuildingSvgIcon,
  getDensityIcon,
} from './ToolbarIcons.js';

interface MainCategory {
  label: string;
  types: readonly BuildingType[];
}

const CATEGORIES: readonly MainCategory[] = [
  { label: 'Roads', types: ROAD_TYPES },
  { label: 'Zones', types: ZONE_TYPES },
  { label: 'Parks', types: [BuildingType.PARK, BuildingType.PARKING] },
  { label: 'Waterfront', types: INFRA_WATERFRONT_TYPES },
  { label: 'Services', types: [] },
];

const SERVICE_CATEGORIES: readonly InfraCategory[] = INFRA_CATEGORIES.filter(
  (category) => category.id !== 'waterfront',
);

const ZONE_DENSITIES: ReadonlyArray<{ density: ZoneDensity; label: string }> = [
  { density: ZoneDensity.LOW, label: 'Low Density' },
  { density: ZoneDensity.MEDIUM, label: 'Medium Density' },
  { density: ZoneDensity.HIGH, label: 'High Density' },
];

function formatBuildingTooltipSub(type: BuildingType): string {
  const def = BUILDING_DEFS[type];
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
  return `${price} · ${sizeText}${spec}`;
}

export class Toolbar {
  readonly controls: HTMLDivElement;
  private dock: HTMLDivElement;
  private level2Rail: HTMLDivElement;
  private level3Rail: HTMLDivElement;
  private tooltip: HTMLDivElement;

  private categoryButtons = new Map<string, HTMLButtonElement>();
  private serviceButtons = new Map<string, HTMLButtonElement>();
  private itemButtons = new Map<BuildingType, HTMLButtonElement>();
  private densityButtons = new Map<ZoneDensity, HTMLButtonElement>();

  private activeType: BuildingType | null = null;
  private activeDensity: ZoneDensity | null = null;
  private openCategory: string | null = null;
  private openServiceId: string | null = null;
  private openZoneType: BuildingType | null = null;

  constructor(
    parent: HTMLElement,
    demand: HTMLElement,
    private onSelect: (type: BuildingType, density?: ZoneDensity) => void,
  ) {
    this.dock = document.createElement('div');
    this.dock.className = 'build-dock';

    // Level 1: Primary vertical rail
    const mainRail = document.createElement('div');
    mainRail.className = 'build-rail build-rail-main';

    this.controls = document.createElement('div');
    this.controls.className = 'build-controls';

    const sep1 = document.createElement('div');
    sep1.className = 'build-rail-sep';

    const categories = document.createElement('div');
    categories.className = 'build-categories';
    categories.setAttribute('role', 'group');
    categories.setAttribute('aria-label', 'Build categories');

    for (const category of CATEGORIES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tool-round-btn';
      btn.innerHTML = CATEGORY_ICONS[category.label] ?? '';
      btn.setAttribute('aria-label', category.label);
      btn.setAttribute('aria-controls', 'build-catalog-l2');
      btn.setAttribute('aria-expanded', 'false');
      btn.dataset.tooltipTitle = category.label;
      btn.addEventListener('click', () => {
        if (this.openCategory === category.label) {
          this.close();
          return;
        }
        this.showCategory(category);
      });
      categories.appendChild(btn);
      this.categoryButtons.set(category.label, btn);
    }

    const sep2 = document.createElement('div');
    sep2.className = 'build-rail-sep';

    mainRail.append(this.controls, sep1, categories, sep2, demand);

    // Level 2: Sub-options rail (build artifacts or service subcategories)
    this.level2Rail = document.createElement('div');
    this.level2Rail.className = 'build-rail build-rail-sub';
    this.level2Rail.id = 'build-catalog-l2';
    this.level2Rail.hidden = true;

    // Level 3: Nested rail (zone density levels or service buildings)
    this.level3Rail = document.createElement('div');
    this.level3Rail.className = 'build-rail build-rail-leaf';
    this.level3Rail.id = 'build-catalog-l3';
    this.level3Rail.hidden = true;

    // Shared floating hover tooltip (never clipped by scrolling rails)
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'build-tooltip';
    this.tooltip.setAttribute('role', 'tooltip');
    this.tooltip.hidden = true;

    this.dock.append(mainRail, this.level2Rail, this.level3Rail, this.tooltip);
    parent.appendChild(this.dock);

    this.bindTooltips();
  }

  private bindTooltips(): void {
    let activeTarget: HTMLElement | null = null;

    const show = (target: HTMLElement): void => {
      const title = target.dataset.tooltipTitle;
      if (!title) return;
      activeTarget = target;
      const sub = target.dataset.tooltipSub;
      this.tooltip.replaceChildren();
      const titleEl = document.createElement('span');
      titleEl.className = 'build-tooltip-title';
      titleEl.textContent = title;
      this.tooltip.appendChild(titleEl);
      if (sub) {
        const subEl = document.createElement('span');
        subEl.className = 'build-tooltip-sub';
        subEl.textContent = sub;
        this.tooltip.appendChild(subEl);
      }
      this.tooltip.hidden = false;

      const rect = target.getBoundingClientRect();
      const tipHeight = this.tooltip.offsetHeight;
      const top = Math.max(8, Math.min(rect.top + rect.height / 2 - tipHeight / 2, window.innerHeight - tipHeight - 8));
      this.tooltip.style.left = `${rect.right + 10}px`;
      this.tooltip.style.top = `${top}px`;
    };

    const hide = (): void => {
      activeTarget = null;
      this.tooltip.hidden = true;
    };

    this.dock.addEventListener('pointerover', (event) => {
      if ((event as PointerEvent).pointerType === 'touch') return;
      const btn = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tooltip-title]');
      if (btn) show(btn);
    });

    this.dock.addEventListener('pointerout', (event) => {
      if (!activeTarget) return;
      const next = (event.relatedTarget as HTMLElement | null)?.closest<HTMLElement>('[data-tooltip-title]');
      if (next !== activeTarget) hide();
    });

    this.dock.addEventListener('focusin', (event) => {
      const btn = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tooltip-title]');
      if (btn && btn.matches(':focus-visible')) show(btn);
    });

    this.dock.addEventListener('focusout', () => hide());
    this.level2Rail.addEventListener('scroll', hide, { passive: true });
    this.level3Rail.addEventListener('scroll', hide, { passive: true });
  }

  private hideTooltip(): void {
    this.tooltip.hidden = true;
  }

  private showCategory(category: MainCategory): void {
    this.openCategory = category.label;
    this.openServiceId = null;
    this.openZoneType = null;
    this.level2Rail.hidden = false;
    this.level3Rail.hidden = true;
    this.level3Rail.replaceChildren();
    this.densityButtons.clear();
    this.updateCategories();

    if (category.label === 'Services') {
      this.renderServiceCategories();
      if (this.activeType) {
        const activeService = SERVICE_CATEGORIES.find((s) => s.types.includes(this.activeType!));
        if (activeService) this.showServiceCategory(activeService);
      }
      return;
    }

    this.renderBuildings(this.level2Rail, category.types);
    if (category.label === 'Zones' && this.activeType && isZone(this.activeType)) {
      this.showZoneDensities(this.activeType);
    }
  }

  private renderServiceCategories(): void {
    this.level2Rail.replaceChildren();
    this.serviceButtons.clear();
    this.itemButtons.clear();

    for (const service of SERVICE_CATEGORIES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tool-round-btn';
      btn.innerHTML = SERVICE_CATEGORY_ICONS[service.id] ?? '';
      btn.setAttribute('aria-label', service.label);
      btn.setAttribute('aria-controls', 'build-catalog-l3');
      btn.setAttribute('aria-expanded', String(this.openServiceId === service.id));
      btn.dataset.tooltipTitle = service.label;
      btn.dataset.tooltipSub = `${service.types.length} buildings`;
      btn.addEventListener('click', () => {
        if (this.openServiceId === service.id) {
          this.closeLevel3();
          return;
        }
        this.showServiceCategory(service);
      });
      this.serviceButtons.set(service.id, btn);
      this.level2Rail.appendChild(btn);
    }
    this.level2Rail.scrollTop = 0;
  }

  private showServiceCategory(service: InfraCategory): void {
    this.openServiceId = service.id;
    this.openZoneType = null;
    this.densityButtons.clear();
    this.level3Rail.hidden = false;
    this.updateServiceButtons();
    this.renderBuildings(this.level3Rail, service.types);
  }

  private showZoneDensities(zoneType: BuildingType): void {
    const def = BUILDING_DEFS[zoneType];
    this.openZoneType = zoneType;
    this.openServiceId = null;
    this.level3Rail.hidden = false;
    this.level3Rail.replaceChildren();
    this.densityButtons.clear();

    for (const { density, label } of ZONE_DENSITIES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tool-round-btn tool-round-btn-tinted';
      btn.style.setProperty('--btn-accent', def.color);
      btn.innerHTML = getDensityIcon(density);
      const cost = `$${ZONE_DENSITY_COSTS[density]}`;
      btn.setAttribute('aria-label', `${def.label} — ${label} (${cost})`);
      btn.setAttribute(
        'aria-pressed',
        String(this.activeType === zoneType && this.activeDensity === density),
      );
      btn.dataset.tooltipTitle = label;
      btn.dataset.tooltipSub = `${def.label} · ${cost}`;

      btn.addEventListener('click', () => {
        if (this.activeType === zoneType && this.activeDensity === density) {
          this.activeDensity = null;
          this.onSelect(zoneType);
        } else {
          this.activeDensity = density;
          this.onSelect(zoneType, density);
        }
        this.syncActiveStates();
      });

      this.densityButtons.set(density, btn);
      this.level3Rail.appendChild(btn);
    }

    this.level3Rail.scrollTop = 0;
    this.syncZoneExpanded();
  }

  private renderBuildings(container: HTMLDivElement, types: readonly BuildingType[]): void {
    container.replaceChildren();
    this.itemButtons.clear();

    for (const type of types) {
      const def = BUILDING_DEFS[type];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tool-round-btn';
      btn.setAttribute('aria-label', def.label);
      btn.setAttribute('aria-pressed', String(this.activeType === type));
      btn.dataset.tooltipTitle = def.label;
      btn.dataset.tooltipSub = formatBuildingTooltipSub(type);

      const customSvg = getBuildingSvgIcon(type);
      const iconPath = customSvg ? null : BuildingFactory.getBuildingIcon(type);

      if (customSvg) {
        if (isZone(type) || isUtilityConduit(type)) {
          btn.classList.add('tool-round-btn-tinted');
          btn.style.setProperty('--btn-accent', def.color);
        }
        btn.innerHTML = customSvg;
      } else if (iconPath) {
        btn.classList.add('tool-round-btn-artifact');
        const thumb = document.createElement('span');
        thumb.className = 'tool-btn-thumb';
        thumb.style.backgroundColor = def.color;
        thumb.style.backgroundImage = `url(${iconPath})`;
        btn.appendChild(thumb);
      } else {
        const swatch = document.createElement('span');
        swatch.className = 'tool-btn-swatch';
        swatch.style.backgroundColor = def.color;
        btn.appendChild(swatch);
      }

      if (isZone(type)) {
        btn.setAttribute('aria-controls', 'build-catalog-l3');
        btn.setAttribute('aria-expanded', String(this.openZoneType === type));
        btn.addEventListener('click', () => {
          if (this.openZoneType === type) {
            this.closeLevel3();
            return;
          }
          this.showZoneDensities(type);
        });
      } else {
        btn.addEventListener('click', () => {
          this.onSelect(type);
        });
      }

      this.itemButtons.set(type, btn);
      container.appendChild(btn);
    }

    container.scrollTop = 0;
  }

  showBuilding(type: BuildingType): void {
    const direct = CATEGORIES.find((category) => category.types.includes(type));
    if (direct) {
      this.showCategory(direct);
      if (isZone(type)) {
        this.showZoneDensities(type);
      }
      this.itemButtons.get(type)?.focus();
      return;
    }

    const service = SERVICE_CATEGORIES.find((category) => category.types.includes(type));
    const servicesMain = CATEGORIES.find((category) => category.label === 'Services');
    if (!service || !servicesMain) return;
    this.showCategory(servicesMain);
    this.showServiceCategory(service);
    this.itemButtons.get(type)?.focus();
  }

  private closeLevel3(): boolean {
    if (this.level3Rail.hidden) return false;
    this.openServiceId = null;
    this.openZoneType = null;
    this.level3Rail.hidden = true;
    this.level3Rail.replaceChildren();
    this.densityButtons.clear();
    this.updateServiceButtons();
    this.syncZoneExpanded();
    this.hideTooltip();
    return true;
  }

  private updateCategories(): void {
    for (const [label, btn] of this.categoryButtons) {
      btn.setAttribute('aria-expanded', String(label === this.openCategory));
    }
  }

  private updateServiceButtons(): void {
    for (const [id, btn] of this.serviceButtons) {
      btn.setAttribute('aria-expanded', String(id === this.openServiceId));
    }
  }

  private syncZoneExpanded(): void {
    for (const [type, btn] of this.itemButtons) {
      if (isZone(type)) {
        btn.setAttribute('aria-expanded', String(type === this.openZoneType));
      }
    }
  }

  private syncActiveStates(): void {
    for (const [itemType, btn] of this.itemButtons) {
      btn.setAttribute('aria-pressed', String(itemType === this.activeType));
    }
    for (const [density, btn] of this.densityButtons) {
      btn.setAttribute(
        'aria-pressed',
        String(this.openZoneType !== null && this.activeType === this.openZoneType && this.activeDensity === density),
      );
    }
  }

  dismissPicker(): boolean {
    // Only eat a map click if the user opened a zone's density menu and hasn't picked a density yet.
    if (this.openZoneType !== null && this.activeType !== this.openZoneType) {
      return this.closeLevel3();
    }
    return false;
  }

  close(): boolean {
    this.hideTooltip();
    if (!this.openCategory) return false;
    this.openCategory = null;
    this.openServiceId = null;
    this.openZoneType = null;
    this.level2Rail.hidden = true;
    this.level2Rail.replaceChildren();
    this.level3Rail.hidden = true;
    this.level3Rail.replaceChildren();
    this.serviceButtons.clear();
    this.itemButtons.clear();
    this.densityButtons.clear();
    this.updateCategories();
    return true;
  }

  setActive(type: BuildingType | null): void {
    this.activeType = type;
    if (type === null || !isZone(type)) {
      this.activeDensity = null;
    }
    this.syncActiveStates();
  }
}
