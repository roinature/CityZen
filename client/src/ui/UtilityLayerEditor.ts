import {
  BUILDING_DEFS,
  BuildingType,
  INFRA_ENERGY_TYPES,
  INFRA_SEWAGE_TYPES,
  INFRA_WATER_TYPES,
  evaluateCityUtilities,
  isUtilityConduit,
  type CityState,
  type UtilityGridReport,
  type UtilityLayer,
} from '@cityzen/shared';
import type { ToolMode } from './BuildTools.js';

export interface UtilityLayerCallbacks {
  onSelectLayer: (layer: UtilityLayer) => void;
  onSelectBuilding: (type: BuildingType, layer: UtilityLayer) => void;
  onSelectBulldoze: (layer: UtilityLayer) => void;
}

const LAYER_META: ReadonlyArray<{
  id: UtilityLayer;
  label: string;
  shortLabel: string;
  title: string;
  accent: string;
  types: readonly BuildingType[];
}> = [
  {
    id: 'surface',
    label: 'Surface',
    shortLabel: 'City',
    title: 'Surface View',
    accent: '#a7dfb8',
    types: [],
  },
  {
    id: 'power',
    label: '\u26A1 Power',
    shortLabel: '\u26A1',
    title: 'Electricity Grid Editor',
    accent: '#ffd54f',
    types: INFRA_ENERGY_TYPES,
  },
  {
    id: 'water',
    label: '\uD83D\uDCA7 Water',
    shortLabel: '\uD83D\uDCA7',
    title: 'Water & Hydrology Editor',
    accent: '#4fc3f7',
    types: INFRA_WATER_TYPES,
  },
  {
    id: 'sewage',
    label: '\uD83D\uDEB0 Sewage',
    shortLabel: '\uD83D\uDEB0',
    title: 'Sewage & Drainage Editor',
    accent: '#4db6ac',
    types: INFRA_SEWAGE_TYPES,
  },
];

function formatBuildingSpec(type: BuildingType): string {
  const def = BUILDING_DEFS[type];
  const e = def.effects;
  const costLabel = def.cost >= 10_000 && def.cost % 1000 === 0
    ? `$${def.cost / 1000}k`
    : `$${def.cost.toLocaleString()}`;
  const parts = [costLabel];
  if (type === BuildingType.UTILITY_POWER_LINE) {
    parts.push('span 6', 'range 4');
  } else if (isUtilityConduit(type)) {
    parts.push('drag');
  } else {
    parts.push(`${def.size.w}\u00D7${def.size.d}`);
  }
  if (e.powerGenerationMW) parts.push(`+${e.powerGenerationMW} MW`, 'range 6');
  if (e.waterSupplyM3) parts.push(`${e.waterSupplyM3} m\u00B3/h`);
  if (e.sewageCapacityM3) parts.push(`${e.sewageCapacityM3} m\u00B3/h`);
  if (e.requiresWaterSource) parts.push('source');
  if (type === BuildingType.ENERGY_SUBSTATION) parts.push('range 9');
  return parts.join(' \u00B7 ');
}

/**
 * Dedicated Layer Switcher + Utility Network Inspector & Editor for
 * Electricity (`power`), Water & Hydrology (`water`), and Sewage (`sewage`).
 */
export class UtilityLayerEditor {
  private readonly root: HTMLDivElement;
  private readonly switcher: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly statsEl: HTMLDivElement;
  private readonly meterFillEl: HTMLDivElement;
  private readonly hintEl: HTMLParagraphElement;
  private readonly toolsEl: HTMLDivElement;
  private readonly legendEl: HTMLDivElement;

  private readonly tabButtons = new Map<UtilityLayer, HTMLButtonElement>();
  private readonly tabDots = new Map<UtilityLayer, HTMLSpanElement>();
  private toolButtons = new Map<BuildingType, HTMLButtonElement>();
  private bulldozeBtn: HTMLButtonElement | null = null;

  private activeLayer: UtilityLayer = 'surface';
  private activeBuilding: BuildingType | null = null;
  private activeToolMode: ToolMode = 'pointer';
  private lastState: CityState | null = null;
  private lastReport: UtilityGridReport | null = null;

  constructor(parent: HTMLElement, private readonly callbacks: UtilityLayerCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'utility-layer-dock';

    // Layer switcher strip
    this.switcher = document.createElement('div');
    this.switcher.className = 'utility-layer-bar';
    this.switcher.setAttribute('role', 'tablist');
    this.switcher.setAttribute('aria-label', 'City utility layers (press L to cycle)');

    for (const meta of LAYER_META) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-button utility-layer-tab';
      btn.dataset.layer = meta.id;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(meta.id === 'surface'));
      btn.title = `${meta.title} (press L to cycle layers)`;

      const labelSpan = document.createElement('span');
      labelSpan.textContent = meta.label;
      btn.appendChild(labelSpan);

      if (meta.id !== 'surface') {
        const dot = document.createElement('span');
        dot.className = 'utility-layer-dot';
        btn.appendChild(dot);
        this.tabDots.set(meta.id, dot);
      }

      btn.addEventListener('click', () => {
        const next = this.activeLayer === meta.id && meta.id !== 'surface' ? 'surface' : meta.id;
        this.callbacks.onSelectLayer(next);
      });
      this.switcher.appendChild(btn);
      this.tabButtons.set(meta.id, btn);
    }

    // Expanded layer inspector & tool palette
    this.panel = document.createElement('div');
    this.panel.className = 'utility-layer-panel';
    this.panel.hidden = true;

    const header = document.createElement('div');
    header.className = 'utility-layer-header';
    this.titleEl = document.createElement('h3');
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'hud-button utility-layer-close';
    closeBtn.textContent = 'Surface \u00D7';
    closeBtn.title = 'Return to normal Surface view (Esc)';
    closeBtn.addEventListener('click', () => this.callbacks.onSelectLayer('surface'));
    header.append(this.titleEl, closeBtn);

    this.statsEl = document.createElement('div');
    this.statsEl.className = 'utility-layer-stats';

    const meterTrack = document.createElement('div');
    meterTrack.className = 'utility-meter-track';
    this.meterFillEl = document.createElement('div');
    this.meterFillEl.className = 'utility-meter-fill';
    meterTrack.appendChild(this.meterFillEl);

    this.hintEl = document.createElement('p');
    this.hintEl.className = 'utility-layer-hint';

    this.toolsEl = document.createElement('div');
    this.toolsEl.className = 'utility-layer-tools';

    this.legendEl = document.createElement('div');
    this.legendEl.className = 'utility-layer-legend';

    this.panel.append(header, this.statsEl, meterTrack, this.hintEl, this.toolsEl, this.legendEl);
    this.root.append(this.switcher, this.panel);
    parent.appendChild(this.root);
  }

  getLayer(): UtilityLayer {
    return this.activeLayer;
  }

  cycleLayer(): UtilityLayer {
    const order: UtilityLayer[] = ['surface', 'power', 'water', 'sewage'];
    const next = order[(order.indexOf(this.activeLayer) + 1) % order.length];
    this.callbacks.onSelectLayer(next);
    return next;
  }

  setLayer(layer: UtilityLayer): void {
    const changed = this.activeLayer !== layer;
    this.activeLayer = layer;
    for (const [id, btn] of this.tabButtons) {
      btn.setAttribute('aria-selected', String(id === layer));
      btn.setAttribute('aria-pressed', String(id === layer));
    }
    this.panel.hidden = layer === 'surface';
    this.panel.dataset.layer = layer;
    if (changed && layer !== 'surface') {
      this.renderLayerTools(layer);
      this.renderLegend(layer);
    }
    this.refreshStats();
  }

  setActiveTool(mode: ToolMode, building: BuildingType | null): void {
    this.activeToolMode = mode;
    this.activeBuilding = building;
    this.syncToolSelection();
  }

  update(state: CityState | null, precomputedReport?: UtilityGridReport | null): void {
    this.lastState = state;
    this.lastReport = state ? (precomputedReport ?? evaluateCityUtilities(state)) : null;
    this.updateStatusDots();
    if (!this.panel.hidden) {
      this.refreshStats();
    }
  }

  private renderLayerTools(layer: Exclude<UtilityLayer, 'surface'>): void {
    const meta = LAYER_META.find(m => m.id === layer)!;
    this.titleEl.textContent = meta.title;
    this.titleEl.style.color = meta.accent;

    this.toolsEl.replaceChildren();
    this.toolButtons.clear();

    for (const type of meta.types) {
      const def = BUILDING_DEFS[type];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'utility-tool-btn';
      btn.innerHTML = `
        <span class="utility-tool-swatch" style="background:${def.color}"></span>
        <span class="utility-tool-meta">
          <strong>${def.label}</strong>
          <small>${formatBuildingSpec(type)}</small>
        </span>
      `;
      btn.addEventListener('click', () => this.callbacks.onSelectBuilding(type, layer));
      this.toolsEl.appendChild(btn);
      this.toolButtons.set(type, btn);
    }

    const bulldozeLabel = layer === 'power'
      ? 'Clear Power Line'
      : layer === 'water'
        ? 'Clear Water Pipe'
        : 'Clear Sewage Pipe';
    this.bulldozeBtn = document.createElement('button');
    this.bulldozeBtn.type = 'button';
    this.bulldozeBtn.className = 'utility-tool-btn utility-tool-bulldoze';
    this.bulldozeBtn.innerHTML = `
      <span class="utility-tool-swatch" style="background:#ef5350"></span>
      <span class="utility-tool-meta">
        <strong>${bulldozeLabel}</strong>
        <small>Remove ${layer} items</small>
      </span>
    `;
    this.bulldozeBtn.addEventListener('click', () => this.callbacks.onSelectBulldoze(layer));
    this.toolsEl.appendChild(this.bulldozeBtn);

    this.syncToolSelection();
  }

  private syncToolSelection(): void {
    for (const [type, btn] of this.toolButtons) {
      btn.setAttribute('aria-pressed', String(this.activeToolMode === 'build' && this.activeBuilding === type));
    }
    if (this.bulldozeBtn) {
      this.bulldozeBtn.setAttribute('aria-pressed', String(this.activeToolMode === 'bulldoze'));
    }
  }

  private renderLegend(layer: Exclude<UtilityLayer, 'surface'>): void {
    const items: Array<[string, string]> = layer === 'power'
      ? [
          ['#ffeb3b', 'Energized line'],
          ['#69f0ae', 'Powered'],
          ['#ffab40', 'Brownout / overload'],
          ['#ff5252', 'Unpowered'],
        ]
      : layer === 'water'
        ? [
            ['#00b0ff', 'Shore / Aquifer source'],
            ['#40c4ff', 'Pressurized pipe & homes'],
            ['#78909c', 'Dry pipe (needs source)'],
            ['#ff5252', 'No water'],
          ]
        : [
            ['#26a69a', 'Draining sewer'],
            ['#64ffda', 'Drained building'],
            ['#ff6e40', 'Backed up'],
            ['#8d6e63', 'Disconnected pipe'],
          ];

    this.legendEl.replaceChildren();
    for (const [hex, text] of items) {
      const chip = document.createElement('span');
      chip.className = 'utility-legend-item';
      chip.innerHTML = `<i style="background:${hex}"></i>${text}`;
      this.legendEl.appendChild(chip);
    }
  }

  private updateStatusDots(): void {
    const s = this.lastReport?.summary;
    const setTabStatus = (layer: UtilityLayer, status: 'ok' | 'warn' | 'alert' | 'idle', tooltip?: string) => {
      const dot = this.tabDots.get(layer);
      const btn = this.tabButtons.get(layer);
      if (dot) dot.dataset.status = status;
      if (btn) {
        btn.dataset.status = status;
        if (tooltip) btn.title = tooltip;
      }
    };
    if (!s) {
      setTabStatus('power', 'idle');
      setTabStatus('water', 'idle');
      setTabStatus('sewage', 'idle');
      return;
    }

    const consumers = s.poweredBuildings + s.unpoweredBuildings;
    setTabStatus(
      'power',
      s.unpoweredBuildings > 0 ? 'alert'
        : s.brownoutBuildings > 0 || s.powerLoadPct > 90 ? 'warn'
        : consumers > 0 || s.powerGenerationMW > 0 ? 'ok' : 'idle',
      `Power: ${s.powerDemandMW.toFixed(1)} / ${s.powerGenerationMW.toFixed(1)} MW` +
        (s.unpoweredBuildings > 0 ? ` (${s.unpoweredBuildings} unpowered)` : '') +
        ' — click to edit (L)',
    );
    setTabStatus(
      'water',
      s.unwateredBuildings > 0 ? 'alert'
        : s.waterLoadPct > 90 ? 'warn'
        : consumers > 0 || s.waterSupplyM3 > 0 ? 'ok' : 'idle',
      `Water: ${s.waterDemandM3} / ${s.waterSupplyM3} m³/h` +
        (s.unwateredBuildings > 0 ? ` (${s.unwateredBuildings} dry)` : '') +
        ' — click to edit (L)',
    );
    setTabStatus(
      'sewage',
      s.backedUpBuildings > 0 ? 'alert'
        : s.sewageLoadPct > 90 ? 'warn'
        : consumers > 0 || s.sewageCapacityM3 > 0 ? 'ok' : 'idle',
      `Sewage: ${s.sewageDemandM3} / ${s.sewageCapacityM3} m³/h` +
        (s.backedUpBuildings > 0 ? ` (${s.backedUpBuildings} backed up)` : '') +
        ' — click to edit (L)',
    );
  }

  private refreshStats(): void {
    if (this.activeLayer === 'surface') return;
    const report = this.lastReport;
    if (!report || !this.lastState) {
      this.statsEl.textContent = '';
      this.hintEl.textContent = '';
      return;
    }

    const s = report.summary;
    if (this.activeLayer === 'power') {
      const totalBld = s.poweredBuildings + s.unpoweredBuildings;
      this.renderStatRows([
        ['Generation', `${s.powerGenerationMW.toFixed(1)} MW`],
        ['Consumption', `${s.powerDemandMW.toFixed(1)} MW (${s.powerLoadPct}%)`],
        ['Powered Buildings', `${s.poweredBuildings} / ${totalBld}`],
        ['Active Subgrids', `${s.powerSubgrids}`],
      ]);
      this.setMeter(s.powerLoadPct, '#ffd54f');

      if (s.powerGenerationMW <= 0 && totalBld > 0) {
        this.hintEl.textContent = 'No power generation! Build a Wind Turbine, Solar Farm, or Coal Plant and wire Power Lines.';
      } else if (s.powerDemandMW > s.powerGenerationMW) {
        this.hintEl.textContent = `Grid overloaded (${s.powerDemandMW.toFixed(1)} / ${s.powerGenerationMW.toFixed(1)} MW)! Add generators to stop brownouts and blackouts.`;
      } else if (s.unpoweredBuildings > 0) {
        this.hintEl.textContent = `${s.unpoweredBuildings} building${s.unpoweredBuildings === 1 ? ' is' : 's are'} outside grid reach. Stretch Power Lines to the edge of your zoned district (zones pass electricity automatically).`;
      } else if (s.powerSubgrids > 1) {
        this.hintEl.textContent = `${s.powerSubgrids} separate power subgrids detected. Stretch Power Lines across unzoned gaps to share reserve MW.`;
      } else {
        this.hintEl.textContent = 'Power grid healthy! Zoned neighborhoods conduct electricity automatically; stretch Power Lines only across unzoned gaps.';
      }
    } else if (this.activeLayer === 'water') {
      const totalBld = s.wateredBuildings + s.unwateredBuildings;
      this.renderStatRows([
        ['Water Supply', `${s.waterSupplyM3} m\u00B3/h`],
        ['Water Demand', `${s.waterDemandM3} m\u00B3/h (${s.waterLoadPct}%)`],
        ['Supplied Buildings', `${s.wateredBuildings} / ${totalBld}`],
        ['Active Sources', `${s.activeWaterSources}`],
      ]);
      this.setMeter(s.waterLoadPct, '#29b6f6');

      const dryNote = [...report.facilityNotes.values()][0];
      if (dryNote) {
        this.hintEl.textContent = dryNote;
      } else if (s.activeWaterSources === 0) {
        this.hintEl.textContent = 'Blue tiles mark shorelines and underground aquifers. Place a Pump Station or Water Tower on a blue source, then drag Water Pipes.';
      } else if (s.waterDemandM3 > s.waterSupplyM3) {
        this.hintEl.textContent = 'Water demand exceeds pumping supply! Add a Pump Station on a water source or a Treatment Plant.';
      } else if (s.unwateredBuildings > 0) {
        this.hintEl.textContent = `${s.unwateredBuildings} building${s.unwateredBuildings === 1 ? ' lacks' : 's lack'} piped water. Drag Water Pipes from your source network.`;
      } else {
        this.hintEl.textContent = 'All buildings have pressurized water. Surface buildings are faded so you can edit underground mains.';
      }
    } else if (this.activeLayer === 'sewage') {
      const totalBld = s.drainedBuildings + s.backedUpBuildings;
      this.renderStatRows([
        ['Treatment Cap.', `${s.sewageCapacityM3} m\u00B3/h`],
        ['Wastewater Load', `${s.sewageDemandM3} m\u00B3/h (${s.sewageLoadPct}%)`],
        ['Drained Buildings', `${s.drainedBuildings} / ${totalBld}`],
      ]);
      this.setMeter(s.sewageLoadPct, '#26a69a');

      if (s.sewageCapacityM3 <= 0 && totalBld > 0) {
        this.hintEl.textContent = 'Build a Sewage Station or Sewage Plant (powered) and run Sewage Pipes to drain wastewater.';
      } else if (s.sewageDemandM3 > s.sewageCapacityM3) {
        this.hintEl.textContent = 'Sewage treatment overloaded! Add a Sewage Plant to prevent backups.';
      } else if (s.backedUpBuildings > 0) {
        this.hintEl.textContent = `${s.backedUpBuildings} building${s.backedUpBuildings === 1 ? ' is' : 's are'} not connected to an active Sewer Pipe.`;
      } else {
        this.hintEl.textContent = 'Sewer network draining cleanly. Zones require Sewage drainage to reach Level 3 high-rises.';
      }
    }
  }

  private renderStatRows(rows: Array<[string, string]>): void {
    this.statsEl.replaceChildren();
    for (const [k, v] of rows) {
      const row = document.createElement('div');
      row.className = 'utility-stat-row';
      row.innerHTML = `<span>${k}</span><strong>${v}</strong>`;
      this.statsEl.appendChild(row);
    }
  }

  private setMeter(loadPct: number, color: string): void {
    const clamped = Math.max(0, Math.min(100, loadPct));
    this.meterFillEl.style.width = `${clamped}%`;
    this.meterFillEl.style.backgroundColor = loadPct > 100 ? '#ef5350' : loadPct > 85 ? '#ffa726' : color;
  }
}
