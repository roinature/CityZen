import {
  BUILDING_DEFS,
  BuildingType,
  EMERGENCY_LABELS,
  INFRA_CATEGORIES,
  MaslowNeed,
  SERVICE_BUILDING_FLEETS,
  ZONE_DENSITY_COSTS,
  ZoneDensity,
  calculateLaborStats,
  canDockBoats,
  evaluateCityUtilities,
  getBuildingMaintenance,
  getEffectiveFleetSize,
  getEffectiveSize,
  getZoneLevelDef,
  getZoneLevelHappinessRequirement,
  hasOperationalResponder,
  hasRoadFrontage,
  isGeneratorBuilding,
  isSewageFacilityBuilding,
  isUtilityConduit,
  isWaterFacilityBuilding,
  isZone,
  type CityState,
  type PlacedBuilding,
  type UtilityGridReport,
  type UtilityLayer,
  type ZoneType,
} from '@cityzen/shared';
import { BuildingFactory } from '../world/BuildingFactory.js';
import type { DepotFleetStatus, DepotVehicleStatus } from '../world/CarManager.js';
import type { BoatKind, BoatPhase, BuildingMaritimeStatus } from '../world/BoatManager.js';

export interface BuildingCardCallbacks {
  getDepotStatus: (buildingId: string) => DepotFleetStatus;
  getMaritimeStatus: (buildingId: string) => BuildingMaritimeStatus;
  onSetFleetSize: (buildingId: string, fleetSize: number) => Promise<{ success: boolean; error?: string }>;
  onDispatchVehicle: (buildingId: string) => boolean;
  onRecallVehicles: (buildingId: string) => number;
  onDispatchVessel: (buildingId: string) => boolean;
  onFocusPosition: (cellX: number, cellZ: number) => void;
  onOpenUtilityLayer: (layer: UtilityLayer) => void;
  onDemolish: (building: PlacedBuilding) => void;
  onClose?: () => void;
}

const MASLOW_LABELS: Record<MaslowNeed, string> = {
  [MaslowNeed.PHYSIOLOGICAL]: 'Physiological',
  [MaslowNeed.SAFETY]: 'Safety',
  [MaslowNeed.LOVE_BELONGING]: 'Community & Health',
  [MaslowNeed.ESTEEM]: 'Esteem',
  [MaslowNeed.COGNITIVE]: 'Education',
  [MaslowNeed.AESTHETIC]: 'Culture & Parks',
  [MaslowNeed.SELF_ACTUALIZATION]: 'Civic Pride',
};

const VEHICLE_ICONS: Record<string, string> = {
  police: '🚓',
  fire: '🚒',
  ambulance: '🚑',
  garbage: '🚛',
  bus: '🚌',
};

const BOAT_LABELS: Record<BoatKind, string> = {
  cargo: 'Cargo Ship',
  ferry: 'Passenger Ferry',
  sailboat: 'Sailboat',
  yacht: 'Motor Yacht',
  fishing: 'Fishing Trawler',
};

const BOAT_ICONS: Record<BoatKind, string> = {
  cargo: '🚢',
  ferry: '⛴️',
  sailboat: '⛵',
  yacht: '🛥️',
  fishing: '🎣',
};

function formatBoatPhase(phase: BoatPhase): string {
  switch (phase) {
    case 'cruising': return 'Inbound';
    case 'docking': return 'Docking';
    case 'docked': return 'Moored at Berth';
    case 'undocking': return 'Undocking';
    case 'departing': return 'Departing';
  }
}

function formatVehicleState(v: DepotVehicleStatus): { label: string; tone: 'alert' | 'ok' | 'muted' } {
  switch (v.state) {
    case 'responding':
      return { label: '🚨 Responding to Incident', tone: 'alert' };
    case 'on_scene':
      return { label: '⚡ Working on Scene', tone: 'alert' };
    case 'at_stop':
      return { label: `Stopped (${Math.max(0, v.stopsLeft - 1)} left)`, tone: 'ok' };
    case 'patrolling':
      return { label: `En Route (${v.stopsLeft} stop${v.stopsLeft === 1 ? '' : 's'})`, tone: 'ok' };
    case 'returning':
      return { label: '↩ Returning to Depot', tone: 'muted' };
  }
}

function getBuildingCategoryMeta(type: BuildingType): { label: string; icon: string } {
  if (type === BuildingType.ZONE_RESIDENTIAL) return { label: 'Residential Zone', icon: '🏠' };
  if (type === BuildingType.ZONE_COMMERCIAL) return { label: 'Commercial Zone', icon: '🏪' };
  if (type === BuildingType.ZONE_INDUSTRIAL) return { label: 'Industrial Zone', icon: '🏭' };
  if (type === BuildingType.PARK) return { label: 'Public Park', icon: '🌳' };
  if (type === BuildingType.PARKING) return { label: 'Parking Facility', icon: '🅿️' };
  const cat = INFRA_CATEGORIES.find(c => c.types.includes(type));
  if (cat) return { label: `${cat.label} Service`, icon: cat.icon };
  return { label: 'City Building', icon: '🏢' };
}

/**
 * Computes how many citizens this specific building actively serves for its primary
 * Maslow contribution, using the same quality-ordered provider allocation as the simulation.
 */
export function computeBuildingServiceReach(
  state: CityState,
  targetBuilding: PlacedBuilding,
  utilities: UtilityGridReport,
): Array<{ need: MaslowNeed; served: number; effectiveCapacity: number; rawCapacity: number; quality: number; factor: number }> {
  const def = BUILDING_DEFS[targetBuilding.type];
  const contributions = def?.effects?.maslowContributions;
  if (!contributions || contributions.length === 0) return [];

  const getOperationalFactor = (building: PlacedBuilding): number => {
    const { summary } = utilities;
    const totalConsumers = summary.poweredBuildings + summary.unpoweredBuildings;
    if (isGeneratorBuilding(building.type)) {
      if (totalConsumers > 0 && summary.poweredBuildings === 0) return 0;
      if (totalConsumers > 0) {
        const connectedShare = summary.poweredBuildings / totalConsumers;
        const overloadPenalty = summary.powerDemandMW > summary.powerGenerationMW && summary.powerGenerationMW > 0
          ? summary.powerGenerationMW / summary.powerDemandMW
          : 1;
        return connectedShare * Math.min(1, overloadPenalty);
      }
      return 1;
    }
    if (isWaterFacilityBuilding(building.type)) {
      const pipeState = utilities.waterPipeState.get(building.id);
      if (pipeState === 'dry') return 0;
      if (totalConsumers > 0) {
        const connectedShare = (summary.wateredBuildings + summary.unwateredBuildings) > 0
          ? summary.wateredBuildings / (summary.wateredBuildings + summary.unwateredBuildings)
          : 1;
        return connectedShare * (pipeState === 'low_pressure' ? 0.7 : 1);
      }
      return 1;
    }
    if (isSewageFacilityBuilding(building.type)) {
      const sewerState = utilities.sewagePipeState.get(building.id);
      if (sewerState === 'disconnected') return 0;
      if (totalConsumers > 0) {
        const connectedShare = (summary.drainedBuildings + summary.backedUpBuildings) > 0
          ? summary.drainedBuildings / (summary.drainedBuildings + summary.backedUpBuildings)
          : 1;
        return connectedShare * (sewerState === 'backed_up' ? 0.65 : 1);
      }
      return 1;
    }
    return utilities.buildings.get(building.id)?.efficiency ?? 1;
  };

  const targetFactor = getOperationalFactor(targetBuilding);
  const population = Math.max(0, state.resources.population);

  return contributions.map(mc => {
    const effectiveCapacity = Math.round(mc.capacityServed * targetFactor);
    if (effectiveCapacity <= 0 || population <= 0) {
      return {
        need: mc.need,
        served: 0,
        effectiveCapacity,
        rawCapacity: mc.capacityServed,
        quality: mc.value,
        factor: targetFactor,
      };
    }

    // Collect all active providers for this need in quality-descending order
    const providers: Array<{ id: string; value: number; cap: number }> = [];
    for (const b of state.buildings) {
      if (isZone(b.type) || isUtilityConduit(b.type)) continue;
      const bContribs = BUILDING_DEFS[b.type]?.effects?.maslowContributions;
      const match = bContribs?.find(c => c.need === mc.need);
      if (!match) continue;
      const f = getOperationalFactor(b);
      const cap = Math.round(match.capacityServed * f);
      if (cap > 0) providers.push({ id: b.id, value: match.value, cap });
    }
    providers.sort((a, b) => b.value - a.value);

    let unserved = population;
    let servedByTarget = 0;
    for (const p of providers) {
      if (unserved <= 0) break;
      const take = Math.min(p.cap, unserved);
      if (p.id === targetBuilding.id) {
        servedByTarget = take;
        break;
      }
      unserved -= take;
    }

    return {
      need: mc.need,
      served: servedByTarget,
      effectiveCapacity,
      rawCapacity: mc.capacityServed,
      quality: mc.value,
      factor: targetFactor,
    };
  });
}

/**
 * Floating Building & Service Building Inspector Card.
 * Displays Card Data, Fleet Management, Occupancy, and Utility Usage with live telemetry.
 */
export class BuildingCard {
  private readonly root: HTMLElement;
  private readonly iconEl: HTMLDivElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly statusBadgeEl: HTMLSpanElement;
  private readonly alertEl: HTMLDivElement;
  private readonly cardDataEl: HTMLDivElement;
  private readonly fleetEl: HTMLDivElement;
  private readonly occupancyEl: HTMLDivElement;
  private readonly usageEl: HTMLDivElement;
  private readonly statusMsgEl: HTMLDivElement;
  private readonly demolishBtn: HTMLButtonElement;

  private buildingId: string | null = null;
  private lastState: CityState | null = null;
  private readOnly = false;
  private busyFleet = false;
  private confirmDemolish = false;
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement, private readonly callbacks: BuildingCardCallbacks) {
    this.root = document.createElement('aside');
    this.root.className = 'building-card';
    this.root.setAttribute('aria-label', 'Building inspector');
    this.root.hidden = true;

    // Header
    const header = document.createElement('header');
    header.className = 'building-card-header';

    this.iconEl = document.createElement('div');
    this.iconEl.className = 'building-card-icon';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'building-card-title-wrap';
    const topRow = document.createElement('div');
    topRow.className = 'building-card-top-row';
    this.titleEl = document.createElement('h2');
    this.statusBadgeEl = document.createElement('span');
    this.statusBadgeEl.className = 'building-status-pill';
    topRow.append(this.titleEl, this.statusBadgeEl);

    this.subtitleEl = document.createElement('div');
    this.subtitleEl.className = 'building-card-subtitle';
    titleWrap.append(topRow, this.subtitleEl);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'hud-button building-card-close';
    closeBtn.setAttribute('aria-label', 'Close building card');
    closeBtn.title = 'Close (Esc)';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
      this.hide();
      this.callbacks.onClose?.();
    });

    header.append(this.iconEl, titleWrap, closeBtn);

    // Emergency banner
    this.alertEl = document.createElement('div');
    this.alertEl.className = 'building-card-alert';
    this.alertEl.hidden = true;

    // Scrollable body with the 4 sections
    const body = document.createElement('div');
    body.className = 'building-card-body';

    this.cardDataEl = this.createSection('Card Data');
    this.fleetEl = this.createSection('Fleet Management');
    this.occupancyEl = this.createSection('Occupancy');
    this.usageEl = this.createSection('Usage & Utilities');

    body.append(
      this.cardDataEl.parentElement!,
      this.fleetEl.parentElement!,
      this.occupancyEl.parentElement!,
      this.usageEl.parentElement!,
    );

    this.statusMsgEl = document.createElement('div');
    this.statusMsgEl.className = 'building-card-feedback';
    this.statusMsgEl.hidden = true;

    // Footer actions
    const footer = document.createElement('footer');
    footer.className = 'building-card-footer';

    const locateBtn = document.createElement('button');
    locateBtn.type = 'button';
    locateBtn.className = 'hud-button building-card-action';
    locateBtn.textContent = 'Center View';
    locateBtn.addEventListener('click', () => {
      const b = this.getSelectedBuilding();
      if (!b) return;
      const { w, d } = getEffectiveSize(b.type, b.orientation);
      this.callbacks.onFocusPosition(b.position.x + w / 2, b.position.z + d / 2);
    });

    this.demolishBtn = document.createElement('button');
    this.demolishBtn.type = 'button';
    this.demolishBtn.className = 'hud-button building-card-demolish';
    this.demolishBtn.addEventListener('click', () => this.handleDemolishClick());

    footer.append(locateBtn, this.demolishBtn);

    this.root.append(header, this.alertEl, body, this.statusMsgEl, footer);
    parent.appendChild(this.root);
  }

  private createSection(heading: string): HTMLDivElement {
    const section = document.createElement('section');
    section.className = 'building-card-section';
    const h3 = document.createElement('h3');
    h3.className = 'building-card-section-title';
    h3.textContent = heading;
    const content = document.createElement('div');
    content.className = 'building-card-section-content';
    section.append(h3, content);
    return content;
  }

  show(building: PlacedBuilding, state: CityState, utilityReport?: UtilityGridReport | null): void {
    const switched = this.buildingId !== building.id;
    this.buildingId = building.id;
    this.lastState = state;
    if (switched) {
      this.resetDemolishConfirm();
      this.setFeedback('');
    }
    this.root.hidden = false;
    this.refresh(state, utilityReport);
  }

  hide(): void {
    this.buildingId = null;
    this.resetDemolishConfirm();
    this.setFeedback('');
    this.root.hidden = true;
  }

  isVisible(): boolean {
    return !this.root.hidden && this.buildingId !== null;
  }

  getBuildingId(): string | null {
    return this.buildingId;
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
    if (this.isVisible() && this.lastState) {
      this.refresh(this.lastState);
    }
  }

  private getSelectedBuilding(): PlacedBuilding | null {
    if (!this.buildingId || !this.lastState) return null;
    return this.lastState.buildings.find(b => b.id === this.buildingId) ?? null;
  }

  refresh(state: CityState, precomputedReport?: UtilityGridReport | null): void {
    this.lastState = state;
    if (!this.buildingId || this.root.hidden) return;
    const building = state.buildings.find(b => b.id === this.buildingId);
    if (!building) {
      this.hide();
      this.callbacks.onClose?.();
      return;
    }

    const utilities = precomputedReport ?? evaluateCityUtilities(state);
    this.renderHeader(building, state, utilities);
    this.renderAlert(building, state);
    this.renderCardData(building, state, utilities);
    this.renderFleet(building, state);
    this.renderOccupancy(building, state, utilities);
    this.renderUsage(building, state, utilities);
    this.renderFooter(building);
  }

  private renderHeader(building: PlacedBuilding, state: CityState, utilities: UtilityGridReport): void {
    const def = BUILDING_DEFS[building.type];
    const cat = getBuildingCategoryMeta(building.type);
    const { w, d } = getEffectiveSize(building.type, building.orientation);

    const iconUrl = BuildingFactory.getBuildingIcon(building.type);
    this.iconEl.style.backgroundColor = def.color;
    if (iconUrl) {
      this.iconEl.style.backgroundImage = `url(${iconUrl})`;
      this.iconEl.textContent = '';
    } else {
      this.iconEl.style.backgroundImage = '';
      this.iconEl.textContent = cat.icon;
    }

    this.titleEl.textContent = def.label;

    const subParts = [cat.label];
    if (isZone(building.type)) {
      const densityLabel = (building.density ?? ZoneDensity.MEDIUM);
      subParts[0] = `${densityLabel.charAt(0).toUpperCase() + densityLabel.slice(1)} Density`;
      const lvl = building.developmentLevel ?? 0;
      subParts.push(lvl > 0 ? `Level ${lvl}/3` : 'Empty Lot');
    } else {
      subParts.push(`${w}×${d}`);
    }
    subParts.push(`(${building.position.x}, ${building.position.z})`);
    this.subtitleEl.textContent = subParts.join(' · ');

    // Operational status badge
    const activeEm = (state.emergencies ?? []).find(e => e.buildingId === building.id);
    const uStatus = utilities.buildings.get(building.id);
    const fleetCfg = SERVICE_BUILDING_FLEETS[building.type];
    const roadConnected = hasRoadFrontage(state, building);

    let badgeText = 'Operational';
    let badgeTone: 'ok' | 'warn' | 'alert' | 'muted' = 'ok';

    if (activeEm) {
      badgeText = activeEm.respondingAtTick ? 'Responding' : 'Emergency!';
      badgeTone = 'alert';
    } else if (isZone(building.type) && (building.developmentLevel ?? 0) === 0) {
      badgeText = roadConnected ? 'Developing' : 'Needs Road';
      badgeTone = roadConnected ? 'muted' : 'warn';
    } else if (fleetCfg && getEffectiveFleetSize(building) === 0) {
      badgeText = 'Fleet Suspended';
      badgeTone = 'warn';
    } else if (fleetCfg && !roadConnected) {
      badgeText = 'No Road Access';
      badgeTone = 'warn';
    } else if (isWaterFacilityBuilding(building.type)) {
      const ps = utilities.waterPipeState.get(building.id);
      if (ps === 'dry') { badgeText = 'Dry / Offline'; badgeTone = 'alert'; }
      else if (ps === 'low_pressure') { badgeText = 'Low Pressure'; badgeTone = 'warn'; }
    } else if (isSewageFacilityBuilding(building.type)) {
      const ss = utilities.sewagePipeState.get(building.id);
      if (ss === 'disconnected') { badgeText = 'Offline'; badgeTone = 'alert'; }
      else if (ss === 'backed_up') { badgeText = 'Overloaded'; badgeTone = 'warn'; }
    } else if (uStatus) {
      if (uStatus.efficiency <= 0.05) { badgeText = 'Offline'; badgeTone = 'alert'; }
      else if (uStatus.efficiency < 0.9) { badgeText = `${Math.round(uStatus.efficiency * 100)}% Eff.`; badgeTone = 'warn'; }
    }

    this.statusBadgeEl.textContent = badgeText;
    this.statusBadgeEl.dataset.tone = badgeTone;
  }

  private renderAlert(building: PlacedBuilding, state: CityState): void {
    const em = (state.emergencies ?? []).find(e => e.buildingId === building.id);
    if (!em) {
      this.alertEl.hidden = true;
      return;
    }
    this.alertEl.hidden = false;
    const icon = { robbery: '🚨', fire: '🔥', medical: '🚑', sewage_overflow: '☣️' }[em.kind];
    const ticksLeft = Math.max(0, em.deadlineTick - state.tick);
    const statusLine = em.respondingAtTick
      ? 'Emergency crew is on scene resolving the incident.'
      : `Unit needed within ~${ticksLeft * 2}s (${ticksLeft} ticks) before severe damage!`;
    this.alertEl.innerHTML = `
      <strong>${icon} ${EMERGENCY_LABELS[em.kind]}</strong>
      <span>${statusLine}</span>
    `;
  }

  private renderCardData(building: PlacedBuilding, state: CityState, utilities: UtilityGridReport): void {
    const def = BUILDING_DEFS[building.type];
    const paidCost = isZone(building.type) && building.density
      ? ZONE_DENSITY_COSTS[building.density]
      : def.cost;
    const maint = getBuildingMaintenance(building);
    const baseMaint = (def.effects.maintenance ?? 0) + (
      isZone(building.type) && (building.developmentLevel ?? 0) > 0
        ? getZoneLevelDef(building.type as ZoneType, building.density, building.developmentLevel!).maintenance
        : 0
    );
    const maintDelta = maint - baseMaint;

    let happiness = def.effects.happiness ?? 0;
    if (isZone(building.type) && (building.developmentLevel ?? 0) > 0) {
      happiness += getZoneLevelDef(building.type as ZoneType, building.density, building.developmentLevel!).happiness;
    }

    const { w, d } = getEffectiveSize(building.type, building.orientation);
    const MaintNote = maintDelta !== 0 ? ` (${maintDelta > 0 ? '+' : ''}$${maintDelta} fleet)` : '';

    const grid = document.createElement('div');
    grid.className = 'building-stat-grid';
    const cells: Array<[string, string, string?]> = [
      ['Value', `$${paidCost.toLocaleString()}`],
      ['Upkeep', `$${maint}/tick${MaintNote}`, maint > 0 ? 'warn-soft' : undefined],
      ['Happiness', `${happiness > 0 ? '+' : ''}${happiness}`, happiness > 0 ? 'positive' : happiness < 0 ? 'negative' : undefined],
      ['Footprint', `${w}×${d} (${w * d} tile${w * d === 1 ? '' : 's'})`],
    ];
    for (const [label, val, cls] of cells) {
      const item = document.createElement('div');
      item.className = 'building-stat-box';
      item.innerHTML = `<span class="building-stat-label">${label}</span><strong class="building-stat-val ${cls ?? ''}">${val}</strong>`;
      grid.appendChild(item);
    }

    this.cardDataEl.replaceChildren(grid);

    // Zone growth hint or Maslow service contribution tags
    if (isZone(building.type)) {
      const level = building.developmentLevel ?? 0;
      const note = document.createElement('div');
      note.className = 'building-card-note';
      if (level >= 3) {
        note.textContent = 'Maximum development level (Level 3) reached.';
      } else {
        const nextLevel = level + 1;
        const reqHappiness = getZoneLevelHappinessRequirement(nextLevel);
        const roadOk = hasRoadFrontage(state, building);
        if (!roadOk) {
          note.textContent = 'Connect an adjacent road so builders can develop this lot.';
        } else if (Math.round(state.resources.happiness) < reqHappiness) {
          note.textContent = `Next upgrade (Level ${nextLevel}) requires ${reqHappiness}% city happiness (currently ${Math.round(state.resources.happiness)}%).`;
        } else if (nextLevel === 2) {
          note.textContent = 'Next upgrade (Level 2) requires Electricity & Water supply plus zone demand.';
        } else if (nextLevel === 3) {
          note.textContent = 'Next upgrade (Level 3) requires Electricity, Water & Sewage drainage plus strong demand.';
        } else {
          note.textContent = 'Ready to develop when zone demand rises.';
        }
      }
      this.cardDataEl.appendChild(note);
    } else {
      const reaches = computeBuildingServiceReach(state, building, utilities);
      if (reaches.length > 0) {
        const tags = document.createElement('div');
        tags.className = 'building-tag-list';
        for (const r of reaches) {
          const pill = document.createElement('span');
          pill.className = 'building-tag';
          pill.textContent = `${MASLOW_LABELS[r.need]} +${Math.round(r.quality * r.factor)} (cap ${r.effectiveCapacity})`;
          tags.appendChild(pill);
        }
        this.cardDataEl.appendChild(tags);
      }
    }
  }

  private renderFleet(building: PlacedBuilding, state: CityState): void {
    this.fleetEl.replaceChildren();
    const fleetCfg = SERVICE_BUILDING_FLEETS[building.type];

    // 1. Road Service Fleet Depot (Police, Fire, Health, Sanitation, Transit)
    if (fleetCfg) {
      const depotStatus = this.callbacks.getDepotStatus(building.id);
      const configured = getEffectiveFleetSize(building);
      const deployedCount = depotStatus.vehicles.length;
      const standbyCount = Math.max(0, configured - deployedCount);
      const vIcon = VEHICLE_ICONS[fleetCfg.kind] ?? '🚐';

      // Stepper row
      const controlRow = document.createElement('div');
      controlRow.className = 'fleet-control-row';

      const meta = document.createElement('div');
      meta.className = 'fleet-control-meta';
      meta.innerHTML = `
        <strong>${vIcon} ${fleetCfg.pluralLabel}</strong>
        <small>${deployedCount} deployed · ${standbyCount} standby (max ${fleetCfg.maxFleet})</small>
      `;

      const stepper = document.createElement('div');
      stepper.className = 'fleet-stepper';

      const minusBtn = document.createElement('button');
      minusBtn.type = 'button';
      minusBtn.className = 'hud-button fleet-step-btn';
      minusBtn.textContent = '−';
      minusBtn.title = `Remove 1 ${fleetCfg.unitLabel} (-$${fleetCfg.upkeepPerUnit}/tick)`;
      minusBtn.disabled = this.readOnly || this.busyFleet || configured <= 0;
      minusBtn.addEventListener('click', () => void this.changeFleetSize(building.id, configured - 1));

      const countEl = document.createElement('span');
      countEl.className = 'fleet-step-value';
      countEl.textContent = `${configured}`;

      const plusBtn = document.createElement('button');
      plusBtn.type = 'button';
      plusBtn.className = 'hud-button fleet-step-btn';
      plusBtn.textContent = '+';
      plusBtn.title = `Add 1 ${fleetCfg.unitLabel} (+$${fleetCfg.upkeepPerUnit}/tick)`;
      plusBtn.disabled = this.readOnly || this.busyFleet || configured >= fleetCfg.maxFleet;
      plusBtn.addEventListener('click', () => void this.changeFleetSize(building.id, configured + 1));

      stepper.append(minusBtn, countEl, plusBtn);
      controlRow.append(meta, stepper);
      this.fleetEl.appendChild(controlRow);

      if (!depotStatus.hasRoadAccess && !hasRoadFrontage(state, building)) {
        const warn = document.createElement('div');
        warn.className = 'building-card-note warn';
        warn.textContent = '⚠️ Place a street, avenue, or highway adjacent to this building so vehicles can exit the bay.';
        this.fleetEl.appendChild(warn);
        return;
      }

      // Dispatch / Recall action buttons
      const actions = document.createElement('div');
      actions.className = 'fleet-action-row';

      const dispatchBtn = document.createElement('button');
      dispatchBtn.type = 'button';
      dispatchBtn.className = 'hud-button fleet-action-btn';
      dispatchBtn.textContent = `Dispatch ${fleetCfg.unitLabel}`;
      dispatchBtn.disabled = this.readOnly || standbyCount <= 0 || !depotStatus.hasRoadAccess;
      dispatchBtn.addEventListener('click', () => {
        const ok = this.callbacks.onDispatchVehicle(building.id);
        this.setFeedback(ok ? `${fleetCfg.unitLabel} dispatched onto road network.` : 'Driveway busy or no reachable road destination.');
        this.refresh(state);
      });

      const canRecall = depotStatus.vehicles.some(v => !v.emergencyId && v.state !== 'returning');
      const recallBtn = document.createElement('button');
      recallBtn.type = 'button';
      recallBtn.className = 'hud-button fleet-action-btn';
      recallBtn.textContent = 'Recall Patrols';
      recallBtn.disabled = this.readOnly || !canRecall;
      recallBtn.addEventListener('click', () => {
        const n = this.callbacks.onRecallVehicles(building.id);
        this.setFeedback(n > 0 ? `Recalled ${n} unit${n === 1 ? '' : 's'} to base.` : 'No patrolling units to recall.');
        this.refresh(state);
      });

      actions.append(dispatchBtn, recallBtn);
      this.fleetEl.appendChild(actions);

      // Live unit roster
      const list = document.createElement('div');
      list.className = 'fleet-unit-list';
      if (configured === 0) {
        const empty = document.createElement('div');
        empty.className = 'fleet-unit-empty';
        empty.textContent = 'Fleet grounded (0 units). Press + to commission vehicles.';
        list.appendChild(empty);
      } else {
        for (const v of depotStatus.vehicles) {
          const st = formatVehicleState(v);
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'fleet-unit-row';
          row.dataset.tone = st.tone;
          row.title = 'Click to follow unit on map';
          row.innerHTML = `
            <span class="fleet-unit-id">${vIcon} Unit #${v.id}</span>
            <span class="fleet-unit-state">${st.label}</span>
          `;
          row.addEventListener('click', () => this.callbacks.onFocusPosition(v.x, v.z));
          list.appendChild(row);
        }
        if (standbyCount > 0) {
          const standbyRow = document.createElement('div');
          standbyRow.className = 'fleet-unit-standby';
          const nextSec = Math.ceil(depotStatus.nextDispatchInSec);
          standbyRow.textContent = `${standbyCount} ${standbyCount === 1 ? 'unit' : 'units'} parked in bay` +
            (state.clock.speed > 0 && nextSec > 0 ? ` · next patrol ~${nextSec}s` : '');
          list.appendChild(standbyRow);
        }
      }
      this.fleetEl.appendChild(list);
      return;
    }

    // 2. Maritime / Waterfront Fleet & Berths
    if (canDockBoats(building.type)) {
      const mStatus = this.callbacks.getMaritimeStatus(building.id);
      const summary = document.createElement('div');
      summary.className = 'fleet-control-row';
      const allowedNames = mStatus.allowedKinds.map(k => BOAT_LABELS[k]).join(', ') || 'Maritime Vessels';
      summary.innerHTML = `
        <div class="fleet-control-meta">
          <strong>⚓ Harbor Berths (${mStatus.occupiedBerths} / ${mStatus.totalBerths} active)</strong>
          <small>${allowedNames}</small>
        </div>
      `;
      if (mStatus.totalBerths > mStatus.occupiedBerths && !this.readOnly) {
        const callBtn = document.createElement('button');
        callBtn.type = 'button';
        callBtn.className = 'hud-button fleet-action-btn';
        callBtn.textContent = 'Call Vessel';
        callBtn.addEventListener('click', () => {
          const ok = this.callbacks.onDispatchVessel(building.id);
          this.setFeedback(ok ? 'Inbound vessel routed to berth.' : 'No open water channel available right now.');
          this.refresh(state);
        });
        summary.appendChild(callBtn);
      }
      this.fleetEl.appendChild(summary);

      if (mStatus.totalBerths === 0) {
        const warn = document.createElement('div');
        warn.className = 'building-card-note warn';
        warn.textContent = 'Needs open navigable water frontage (at least 12 connected water tiles) for vessels to dock.';
        this.fleetEl.appendChild(warn);
        return;
      }

      const list = document.createElement('div');
      list.className = 'fleet-unit-list';
      if (mStatus.vessels.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'fleet-unit-standby';
        empty.textContent = 'All berths open — awaiting next scheduled vessel.';
        list.appendChild(empty);
      } else {
        for (const vessel of mStatus.vessels) {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'fleet-unit-row';
          row.dataset.tone = vessel.phase === 'docked' ? 'ok' : 'muted';
          row.title = 'Click to locate vessel on water';
          row.innerHTML = `
            <span class="fleet-unit-id">${BOAT_ICONS[vessel.kind]} ${BOAT_LABELS[vessel.kind]} #${vessel.id}</span>
            <span class="fleet-unit-state">${formatBoatPhase(vessel.phase)}</span>
          `;
          row.addEventListener('click', () => this.callbacks.onFocusPosition(vessel.x, vessel.z));
          list.appendChild(row);
        }
      }
      this.fleetEl.appendChild(list);
      return;
    }

    // 3. Fire Helicopter Pad (Aerial Fleet)
    if (building.type === BuildingType.FIRE_HELICOPTER) {
      const info = document.createElement('div');
      info.className = 'building-card-note';
      info.textContent = '🚁 Aerial Response Unit stationed on pad · Provides high-reach city safety coverage.';
      this.fleetEl.appendChild(info);
      return;
    }

    // 4. Non-depot buildings: Show Road Access & Municipal Fleet Coverage
    const roadOk = hasRoadFrontage(state, building);
    const accessRow = document.createElement('div');
    accessRow.className = 'building-kv-row';
    accessRow.innerHTML = `
      <span>Road Network Access</span>
      <strong class="${roadOk ? 'positive' : 'warn-soft'}">${roadOk ? 'Connected' : 'Unconnected'}</strong>
    `;
    this.fleetEl.appendChild(accessRow);

    const services: Array<[string, string, boolean]> = [
      ['🚓 Police', 'robbery', roadOk && hasOperationalResponder(state, 'robbery')],
      ['🚒 Fire', 'fire', roadOk && hasOperationalResponder(state, 'fire')],
      ['🚑 Medical', 'medical', roadOk && hasOperationalResponder(state, 'medical')],
      ['🚛 Sanitation', 'sewage_overflow', roadOk && hasOperationalResponder(state, 'sewage_overflow')],
    ];
    const coverage = document.createElement('div');
    coverage.className = 'building-tag-list';
    for (const [label, , covered] of services) {
      const chip = document.createElement('span');
      chip.className = `building-tag ${covered ? 'covered' : 'uncovered'}`;
      chip.textContent = `${label} ${covered ? '✓' : '—'}`;
      coverage.appendChild(chip);
    }
    this.fleetEl.appendChild(coverage);
  }

  private renderOccupancy(building: PlacedBuilding, state: CityState, utilities: UtilityGridReport): void {
    this.occupancyEl.replaceChildren();
    const def = BUILDING_DEFS[building.type];
    const labor = calculateLaborStats(state);
    const staffingRatio = labor.jobs > 0 ? Math.min(1, labor.workers / labor.jobs) : 0;
    const uEff = utilities.buildings.get(building.id)?.efficiency ?? 1;

    const addOccupancyMeter = (label: string, current: number, capacity: number, unit: string, accent: string, detail?: string) => {
      const pct = capacity > 0 ? Math.min(100, Math.round((current / capacity) * 100)) : 0;
      const block = document.createElement('div');
      block.className = 'building-meter-block';
      block.innerHTML = `
        <div class="building-kv-row">
          <span>${label}</span>
          <strong>${current.toLocaleString()} / ${capacity.toLocaleString()} ${unit} (${pct}%)</strong>
        </div>
        <div class="utility-meter-track">
          <div class="utility-meter-fill" style="width:${pct}%;background:${accent}"></div>
        </div>
      `;
      if (detail) {
        const sub = document.createElement('small');
        sub.className = 'building-meter-sub';
        sub.textContent = detail;
        block.appendChild(sub);
      }
      this.occupancyEl.appendChild(block);
    };

    // 1. Residential Zone
    if (building.type === BuildingType.ZONE_RESIDENTIAL) {
      const level = building.developmentLevel ?? 0;
      if (level <= 0) {
        const empty = document.createElement('div');
        empty.className = 'building-card-note';
        empty.textContent = '0 / 0 residents — Undeveloped residential lot.';
        this.occupancyEl.appendChild(empty);
        return;
      }
      const levelDef = getZoneLevelDef(building.type, building.density, level);
      const entry = state.resources.zonePopulations?.find(z => z.buildingId === building.id);
      const cap = entry?.capacity ?? levelDef.populationCapacity;
      const pop = entry
        ? entry.population
        : labor.housingCapacity > 0
          ? Math.min(cap, Math.round((state.resources.population / labor.housingCapacity) * cap))
          : 0;
      addOccupancyMeter(
        'Residents Housed',
        pop,
        cap,
        'citizens',
        '#66bb6a',
        pop >= cap ? 'At full housing capacity' : pop === 0 ? 'Vacant units available for newcomers' : `${cap - pop} housing spaces open`,
      );
      return;
    }

    // 2. Commercial / Industrial Zone
    if (building.type === BuildingType.ZONE_COMMERCIAL || building.type === BuildingType.ZONE_INDUSTRIAL) {
      const level = building.developmentLevel ?? 0;
      if (level <= 0) {
        const empty = document.createElement('div');
        empty.className = 'building-card-note';
        empty.textContent = `0 / 0 jobs — Undeveloped ${building.type === BuildingType.ZONE_COMMERCIAL ? 'commercial' : 'industrial'} lot.`;
        this.occupancyEl.appendChild(empty);
        return;
      }
      const levelDef = getZoneLevelDef(building.type, building.density, level);
      const jobs = levelDef.jobs;
      const filled = Math.min(jobs, Math.round(jobs * staffingRatio * (uEff > 0 ? 1 : 0)));
      const accent = building.type === BuildingType.ZONE_COMMERCIAL ? '#42a5f5' : '#ffa726';
      addOccupancyMeter(
        'Active Workforce',
        filled,
        jobs,
        'jobs',
        accent,
        uEff <= 0
          ? 'Workplace closed due to utility outage'
          : filled < jobs
            ? `${jobs - filled} open position${jobs - filled === 1 ? '' : 's'} — grow residential population to staff`
            : 'Fully staffed & paying business taxes',
      );
      return;
    }

    let renderedAny = false;

    // 3. Standalone buildings with direct jobs (e.g. Waterfront docks, ports, marinas, ferries)
    if ((def.effects.jobs ?? 0) > 0) {
      const jobs = def.effects.jobs!;
      const filled = Math.min(jobs, Math.round(jobs * staffingRatio * (uEff > 0 ? 1 : 0)));
      addOccupancyMeter('Facility Staff', filled, jobs, 'workers', '#4fc3f7');
      renderedAny = true;
    }

    // 4. Service / Civic / Utility buildings serving citizens (Maslow capacityServed)
    const reaches = computeBuildingServiceReach(state, building, utilities);
    if (reaches.length > 0) {
      const primary = reaches[0];
      const noun = building.type.startsWith('edu_') ? 'students'
        : building.type.startsWith('health_') && building.type !== BuildingType.HEALTH_CEMETERY ? 'patients'
        : building.type.startsWith('tour_') || building.type.startsWith('art_') || building.type === BuildingType.PARK ? 'visitors'
        : building.type.startsWith('trans_') || building.type === BuildingType.WATERFRONT_FERRY ? 'passengers'
        : 'citizens';
      const detail = primary.factor < 0.99
        ? `Capacity reduced from ${primary.rawCapacity} (${Math.round(primary.factor * 100)}% utility efficiency)`
        : state.resources.population > primary.effectiveCapacity && primary.served >= primary.effectiveCapacity
          ? 'Operating at maximum citizen capacity'
          : undefined;
      addOccupancyMeter('Citizens Served', primary.served, primary.effectiveCapacity, noun, '#a7dfb8', detail);
      renderedAny = true;
    }

    // 5. Parking Lot & unmanned utility structures
    if (!renderedAny) {
      if (building.type === BuildingType.PARKING) {
        const capacity = 24;
        let nearbyDev = 0;
        for (const other of state.buildings) {
          if (other.id === building.id) continue;
          const dist = Math.abs(other.position.x - building.position.x) + Math.abs(other.position.z - building.position.z);
          if (dist <= 6 && ((isZone(other.type) && (other.developmentLevel ?? 0) > 0) || (!isZone(other.type) && !isUtilityConduit(other.type)))) {
            nearbyDev++;
          }
        }
        const occupied = Math.min(capacity, Math.round(Math.min(1, nearbyDev / 10) * capacity));
        addOccupancyMeter('Parked Vehicles', occupied, capacity, 'spaces', '#90a4ae', 'Serves nearby shops, homes & commuters');
      } else {
        const note = document.createElement('div');
        note.className = 'building-card-note';
        note.textContent = 'Automated unmanned infrastructure · No on-site resident or staff occupancy.';
        this.occupancyEl.appendChild(note);
      }
    }
  }

  private renderUsage(building: PlacedBuilding, _state: CityState, utilities: UtilityGridReport): void {
    this.usageEl.replaceChildren();
    const def = BUILDING_DEFS[building.type];
    const s = utilities.summary;
    const bStatus = utilities.buildings.get(building.id);

    const addLayerAction = (layer: Exclude<UtilityLayer, 'surface'>, text: string) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-button building-layer-link';
      btn.textContent = text;
      btn.addEventListener('click', () => this.callbacks.onOpenUtilityLayer(layer));
      this.usageEl.appendChild(btn);
    };

    // A. Power Generators & Substations
    if (isGeneratorBuilding(building.type) || building.type === BuildingType.ENERGY_SUBSTATION) {
      const genMW = def.effects.powerGenerationMW ?? 0;
      const lineState = utilities.powerLineState.get(building.id) ?? 'energized';
      const rows: Array<[string, string, string?]> = [];
      if (genMW > 0) {
        rows.push(['Power Output', `+${genMW} MW`, 'positive']);
      } else {
        rows.push(['Distribution Radius', '9 tiles (Substation)']);
      }
      rows.push(
        ['City Grid Load', `${s.powerDemandMW.toFixed(1)} / ${s.powerGenerationMW.toFixed(1)} MW (${s.powerLoadPct}%)`, s.powerLoadPct > 100 ? 'negative' : undefined],
        ['Grid Status', lineState === 'overloaded' ? 'Overloaded' : lineState === 'unenergized' ? 'Unenergized' : 'Energized',
          lineState === 'energized' ? 'positive' : 'warn-soft'],
        ['Powered Buildings', `${s.poweredBuildings} / ${s.poweredBuildings + s.unpoweredBuildings}`],
      );
      this.appendKvRows(rows);
      this.appendLoadBar(s.powerLoadPct, '#ffd54f');
      addLayerAction('power', '⚡ Inspect Power Grid');
      return;
    }

    // B. Water Supply Facilities
    if (isWaterFacilityBuilding(building.type)) {
      const supply = def.effects.waterSupplyM3 ?? 0;
      const pipeState = utilities.waterPipeState.get(building.id) ?? 'pressurized';
      const powerOk = bStatus ? bStatus.powered : true;
      const rows: Array<[string, string, string?]> = [
        ['Supply Capacity', `+${supply} m³/h`, pipeState === 'dry' ? 'negative' : 'positive'],
        ['City Water Load', `${s.waterDemandM3} / ${s.waterSupplyM3} m³/h (${s.waterLoadPct}%)`, s.waterLoadPct > 100 ? 'negative' : undefined],
        ['Pump Electricity', `${(bStatus?.powerDemandMW ?? def.effects.powerDemandMW ?? 0).toFixed(1)} MW · ${powerOk ? 'Powered' : 'No Power'}`, powerOk ? 'positive' : 'negative'],
        ['Facility Status', pipeState === 'dry' ? 'Dry / Offline' : pipeState === 'low_pressure' ? 'Low Pressure' : 'Pressurized',
          pipeState === 'pressurized' ? 'positive' : 'negative'],
      ];
      this.appendKvRows(rows);
      this.appendLoadBar(s.waterLoadPct, '#29b6f6');
      const note = utilities.facilityNotes.get(building.id);
      if (note) {
        const warn = document.createElement('div');
        warn.className = 'building-card-note warn';
        warn.textContent = note;
        this.usageEl.appendChild(warn);
      }
      addLayerAction('water', '💧 Inspect Water Network');
      return;
    }

    // C. Sewage Treatment Facilities
    if (isSewageFacilityBuilding(building.type)) {
      const cap = def.effects.sewageCapacityM3 ?? 0;
      const sewerState = utilities.sewagePipeState.get(building.id) ?? 'draining';
      const powerOk = bStatus ? bStatus.powered : true;
      const rows: Array<[string, string, string?]> = [
        ['Treatment Capacity', `+${cap} m³/h`, sewerState === 'disconnected' ? 'negative' : 'positive'],
        ['City Sewage Load', `${s.sewageDemandM3} / ${s.sewageCapacityM3} m³/h (${s.sewageLoadPct}%)`, s.sewageLoadPct > 100 ? 'negative' : undefined],
        ['Plant Electricity', `${(bStatus?.powerDemandMW ?? def.effects.powerDemandMW ?? 0).toFixed(1)} MW · ${powerOk ? 'Powered' : 'No Power'}`, powerOk ? 'positive' : 'negative'],
        ['Drainage Status', sewerState === 'disconnected' ? 'Offline' : sewerState === 'backed_up' ? 'Overloaded' : 'Draining Cleanly',
          sewerState === 'draining' ? 'positive' : 'negative'],
      ];
      this.appendKvRows(rows);
      this.appendLoadBar(s.sewageLoadPct, '#26a69a');
      addLayerAction('sewage', '🚰 Inspect Sewage Network');
      return;
    }

    // D. Standard Consumer Building (Zones, Services, Parks, Waterfronts)
    if (!bStatus || (isZone(building.type) && (building.developmentLevel ?? 0) === 0)) {
      const note = document.createElement('div');
      note.className = 'building-card-note';
      note.textContent = 'No utility consumption yet — utilities activate once a building is constructed on this lot.';
      this.usageEl.appendChild(note);
      return;
    }

    const effPct = Math.round(bStatus.efficiency * 100);
    const effRow = document.createElement('div');
    effRow.className = 'building-meter-block';
    effRow.innerHTML = `
      <div class="building-kv-row">
        <span>Operating Efficiency</span>
        <strong class="${effPct >= 90 ? 'positive' : effPct > 0 ? 'warn-soft' : 'negative'}">${effPct}%</strong>
      </div>
      <div class="utility-meter-track">
        <div class="utility-meter-fill" style="width:${effPct}%;background:${effPct >= 90 ? '#69f0ae' : effPct > 0 ? '#ffa726' : '#ef5350'}"></div>
      </div>
    `;
    this.usageEl.appendChild(effRow);

    const formatPower = (): [string, string] => {
      if (bStatus.powerState === 'not_needed') return ['0 MW · Not needed', ''];
      const mw = `${bStatus.powerDemandMW.toFixed(1)} MW`;
      if (bStatus.powerState === 'powered') return [`${mw} · Powered`, 'positive'];
      if (bStatus.powerState === 'brownout') return [`${mw} · Brownout (${Math.round(bStatus.powerRatio * 100)}%)`, 'warn-soft'];
      if (bStatus.powerState === 'blackout') return [`${mw} · Blackout`, 'negative'];
      return [`${mw} · Unconnected`, 'negative'];
    };

    const formatWater = (): [string, string] => {
      if (bStatus.waterState === 'not_needed') return ['0 m³/h · Not needed', ''];
      const m3 = `${bStatus.waterDemandM3} m³/h`;
      if (bStatus.waterState === 'supplied') return [`${m3} · ${bStatus.waterTreated ? 'Treated' : 'Supplied'}`, 'positive'];
      if (bStatus.waterState === 'low_pressure') return [`${m3} · Low Pressure`, 'warn-soft'];
      if (bStatus.waterState === 'dry_pipe') return [`${m3} · Dry Pipe`, 'negative'];
      return [`${m3} · Unconnected`, 'negative'];
    };

    const formatSewage = (): [string, string] => {
      if (bStatus.sewageState === 'not_needed') return ['0 m³/h · Not needed', ''];
      const m3 = `${bStatus.sewageOutputM3} m³/h`;
      if (bStatus.sewageState === 'drained') return [`${m3} · Draining`, 'positive'];
      if (bStatus.sewageState === 'backed_up') return [`${m3} · Backed Up`, 'negative'];
      if (bStatus.sewageState === 'disconnected_pipe') return [`${m3} · Disconnected`, 'negative'];
      return [`${m3} · No Sewer`, 'warn-soft'];
    };

    const [pVal, pCls] = formatPower();
    const [wVal, wCls] = formatWater();
    const [sVal, sCls] = formatSewage();

    this.appendKvRows([
      ['⚡ Electricity', pVal, pCls],
      ['💧 Water', wVal, wCls],
      ['🚰 Sewage', sVal, sCls],
    ]);

    // Quick-fix shortcut if a utility is missing
    if (!bStatus.powered && bStatus.powerState !== 'not_needed') {
      addLayerAction('power', '⚡ Connect Power');
    } else if (!bStatus.watered && bStatus.waterState !== 'not_needed') {
      addLayerAction('water', '💧 Connect Water');
    } else if (!bStatus.drained && bStatus.sewageState !== 'not_needed') {
      addLayerAction('sewage', '🚰 Connect Sewage');
    }
  }

  private appendKvRows(rows: Array<[string, string, string?]>): void {
    const list = document.createElement('div');
    list.className = 'building-kv-list';
    for (const [k, v, cls] of rows) {
      const row = document.createElement('div');
      row.className = 'building-kv-row';
      row.innerHTML = `<span>${k}</span><strong class="${cls ?? ''}">${v}</strong>`;
      list.appendChild(row);
    }
    this.usageEl.appendChild(list);
  }

  private appendLoadBar(loadPct: number, color: string): void {
    const clamped = Math.max(0, Math.min(100, loadPct));
    const fill = loadPct > 100 ? '#ef5350' : loadPct > 85 ? '#ffa726' : color;
    const track = document.createElement('div');
    track.className = 'utility-meter-track';
    track.innerHTML = `<div class="utility-meter-fill" style="width:${clamped}%;background:${fill}"></div>`;
    this.usageEl.appendChild(track);
  }

  private renderFooter(building: PlacedBuilding): void {
    const def = BUILDING_DEFS[building.type];
    const paid = isZone(building.type) && building.density ? ZONE_DENSITY_COSTS[building.density] : def.cost;
    const refund = Math.floor(paid / 2);
    this.demolishBtn.hidden = this.readOnly;
    if (this.confirmDemolish) {
      this.demolishBtn.textContent = `Confirm Bulldoze (+$${refund.toLocaleString()})`;
      this.demolishBtn.classList.add('confirm');
    } else {
      this.demolishBtn.textContent = `Demolish (+$${refund.toLocaleString()})`;
      this.demolishBtn.classList.remove('confirm');
    }
  }

  private handleDemolishClick(): void {
    const b = this.getSelectedBuilding();
    if (!b || this.readOnly) return;
    if (!this.confirmDemolish) {
      this.confirmDemolish = true;
      this.renderFooter(b);
      this.confirmTimer = setTimeout(() => {
        this.confirmDemolish = false;
        const cur = this.getSelectedBuilding();
        if (cur) this.renderFooter(cur);
      }, 3500);
      return;
    }
    this.resetDemolishConfirm();
    this.callbacks.onDemolish(b);
    this.hide();
  }

  private resetDemolishConfirm(): void {
    this.confirmDemolish = false;
    if (this.confirmTimer) {
      clearTimeout(this.confirmTimer);
      this.confirmTimer = null;
    }
    this.demolishBtn.classList.remove('confirm');
  }

  private async changeFleetSize(buildingId: string, nextSize: number): Promise<void> {
    if (this.busyFleet || this.readOnly) return;
    this.busyFleet = true;
    try {
      const res = await this.callbacks.onSetFleetSize(buildingId, nextSize);
      if (!res.success) {
        this.setFeedback(res.error ?? 'Could not update fleet size', true);
      } else {
        this.setFeedback(`Fleet size updated to ${nextSize}.`);
      }
    } catch {
      this.setFeedback('Could not reach city host.', true);
    } finally {
      this.busyFleet = false;
      if (this.lastState) this.refresh(this.lastState);
    }
  }

  private setFeedback(msg: string, isError = false): void {
    this.statusMsgEl.textContent = msg;
    this.statusMsgEl.hidden = !msg;
    this.statusMsgEl.classList.toggle('error', isError);
  }
}
