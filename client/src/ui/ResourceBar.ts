import {
  evaluateCityUtilities,
  MAX_GAME_SPEED,
  type CityState,
  type GameClock,
  type ResourceState,
  type UtilityLayer,
} from '@cityzen/shared';
import { LOW_HAPPINESS } from './happinessAdvice.js';

const SPEED_LABELS = ['Ⅱ', '1×', '2×', '3×'];

export class ResourceBar {
  private container: HTMLDivElement;
  private moneyEl: HTMLSpanElement;
  private popEl: HTMLSpanElement;
  private happyEl: HTMLSpanElement;
  private happinessButton: HTMLButtonElement;
  private cityNameEl: HTMLSpanElement;
  readonly actions: HTMLDivElement;
  readonly demand: HTMLDivElement;
  private lastMoney: number | null = null;
  private demandResEl: HTMLDivElement;
  private demandComEl: HTMLDivElement;
  private demandIndEl: HTMLDivElement;
  private clockEl: HTMLSpanElement;
  private utilPowerBtn: HTMLButtonElement;
  private utilWaterBtn: HTMLButtonElement;
  private utilSewageBtn: HTMLButtonElement;
  private speedSelect: HTMLSelectElement;
  private speedBtns: HTMLButtonElement[] = [];
  private requestedSpeed: { speed: number; expiresAt: number } | null = null;

  onGameSpeedChange: ((speed: number) => void) | null = null;
  onOpenAdvisor: (() => void) | null = null;
  onSelectUtilityLayer: ((layer: UtilityLayer) => void) | null = null;
  private unlimited = false;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'resource-bar';
    this.container.innerHTML = `
      <div class="resource-identity">
        <div class="resource-city">
          <span class="resource-label">CityZen</span>
          <strong id="res-city-name"></strong>
        </div>
        <div class="resource-actions"></div>
      </div>
      <div class="resource-metrics">
        <div class="resource-stats">
          <div class="resource-item">
            <span class="resource-label">Treasury</span>
            <span class="resource-value" id="res-money"></span>
          </div>
          <div class="resource-item">
            <span class="resource-label">Population</span>
            <span class="resource-value" id="res-pop"></span>
          </div>
          <button type="button" class="resource-item happiness-advisor" aria-haspopup="dialog" aria-controls="city-advisor">
            <span class="resource-label">Happiness</span>
            <span class="resource-value" id="res-happy"></span>
          </button>
          <div class="resource-utilities" role="group" aria-label="Utility networks">
            <button type="button" class="util-pill" id="res-util-power" title="Open Electricity Grid Layer"></button>
            <button type="button" class="util-pill" id="res-util-water" title="Open Water & Hydrology Layer"></button>
            <button type="button" class="util-pill" id="res-util-sewage" title="Open Sewage & Drainage Layer"></button>
          </div>
        </div>
        <div class="resource-item clock-item">
          <span class="resource-value" id="res-clock"></span>
          <div class="speed-controls" id="speed-controls" role="group" aria-label="Game speed"></div>
          <select class="speed-select" aria-label="Game speed"></select>
        </div>
      </div>
      <span class="app-version" title="Client build version">${__APP_VERSION__}</span>
    `;
    this.actions = this.container.querySelector('.resource-actions')!;
    parent.appendChild(this.container);
    this.demand = document.createElement('div');
    this.demand.className = 'demand-bar';
    this.demand.setAttribute('role', 'group');
    this.demand.setAttribute('aria-label', 'Zone demand');
    this.demand.innerHTML = `
        <div class="demand-item" title="Residential demand">
          <span class="demand-label" style="color:#66BB6A">R</span>
          <div class="demand-meter-track"><div class="demand-meter-fill" id="demand-res"></div></div>
        </div>
        <div class="demand-item" title="Commercial demand">
          <span class="demand-label" style="color:#42A5F5">C</span>
          <div class="demand-meter-track"><div class="demand-meter-fill" id="demand-com"></div></div>
        </div>
        <div class="demand-item" title="Industrial demand">
          <span class="demand-label" style="color:#FFA726">I</span>
          <div class="demand-meter-track"><div class="demand-meter-fill" id="demand-ind"></div></div>
        </div>
    `;

    this.cityNameEl = this.container.querySelector('#res-city-name')!;
    this.clockEl = this.container.querySelector('#res-clock')!;
    this.moneyEl = this.container.querySelector('#res-money')!;
    this.popEl = this.container.querySelector('#res-pop')!;
    this.happyEl = this.container.querySelector('#res-happy')!;
    this.happinessButton = this.container.querySelector('.happiness-advisor')!;
    this.happinessButton.addEventListener('click', () => this.onOpenAdvisor?.());
    this.utilPowerBtn = this.container.querySelector('#res-util-power')!;
    this.utilWaterBtn = this.container.querySelector('#res-util-water')!;
    this.utilSewageBtn = this.container.querySelector('#res-util-sewage')!;
    this.utilPowerBtn.addEventListener('click', () => this.onSelectUtilityLayer?.('power'));
    this.utilWaterBtn.addEventListener('click', () => this.onSelectUtilityLayer?.('water'));
    this.utilSewageBtn.addEventListener('click', () => this.onSelectUtilityLayer?.('sewage'));
    this.utilPowerBtn.textContent = '\u26A1 0 MW';
    this.utilWaterBtn.textContent = '\uD83D\uDCA7 0 m\u00B3';
    this.utilSewageBtn.textContent = '\uD83D\uDEB0 0 m\u00B3';
    this.demandResEl = this.demand.querySelector('#demand-res')!;
    this.demandComEl = this.demand.querySelector('#demand-com')!;
    this.demandIndEl = this.demand.querySelector('#demand-ind')!;

    // Build speed control buttons
    this.speedSelect = this.container.querySelector('.speed-select')!;
    this.speedSelect.addEventListener('change', () => this.requestGameSpeed(Number(this.speedSelect.value)));
    const speedContainer = this.container.querySelector('#speed-controls')!;
    for (let i = 0; i <= MAX_GAME_SPEED; i++) {
      this.speedSelect.add(new Option(i === 0 ? 'Paused' : SPEED_LABELS[i], String(i)));
      const btn = document.createElement('button');
      btn.className = 'speed-btn';
      btn.textContent = SPEED_LABELS[i];
      btn.setAttribute('aria-label', i === 0 ? 'Pause' : `${i}× speed`);
      const speed = i;
      btn.addEventListener('click', () => this.requestGameSpeed(speed));
      speedContainer.appendChild(btn);
      this.speedBtns.push(btn);
    }
  }

  setUnlimitedMoney(enabled: boolean): void {
    this.unlimited = enabled;
  }

  updateClock(clock: GameClock): void {
    this.clockEl.textContent = `Day ${clock.gameDay + 1}, Year ${clock.gameYear}`;
    if (this.requestedSpeed && (this.requestedSpeed.speed === clock.speed || Date.now() >= this.requestedSpeed.expiresAt)) {
      this.requestedSpeed = null;
    }
    const selectedSpeed = this.requestedSpeed?.speed ?? clock.speed;
    this.speedSelect.value = String(selectedSpeed);
    for (let i = 0; i < this.speedBtns.length; i++) {
      this.speedBtns[i].setAttribute('aria-pressed', String(i === selectedSpeed));
    }
  }

  private requestGameSpeed(speed: number): void {
    // Reflect the click immediately; the server clock is broadcast every 2s.
    this.requestedSpeed = { speed, expiresAt: Date.now() + 5000 };
    this.speedSelect.value = String(speed);
    for (let i = 0; i < this.speedBtns.length; i++) {
      this.speedBtns[i].setAttribute('aria-pressed', String(i === speed));
    }
    this.onGameSpeedChange?.(speed);
  }

  update(resources: ResourceState, state?: CityState): void {
    const money = Math.floor(resources.money);
    this.moneyEl.textContent = this.unlimited ? '\u221E' : `${money < 0 ? '−' : ''}$${Math.abs(money).toLocaleString()}`;
    this.moneyEl.classList.toggle('budget-negative', !this.unlimited && money < 0);
    this.moneyEl.title = money < 0 ? 'In debt: city services are degrading. Raise taxes or cut upkeep.' : '';
    // Flash on purchases and refunds (bigger jumps than the per-tick trickle)
    if (!this.unlimited && this.lastMoney !== null && Math.abs(money - this.lastMoney) >= 5) {
      this.flashMoney(money > this.lastMoney);
    }
    this.lastMoney = money;

    this.popEl.textContent = resources.population.toLocaleString();
    const happiness = Math.floor(resources.happiness);
    this.happyEl.textContent = `${happiness}%`;
    this.happinessButton.classList.toggle('low', resources.population > 0 && resources.happiness < LOW_HAPPINESS);
    this.happinessButton.setAttribute('aria-label', `Happiness ${happiness}%. Open City Advisor`);
    this.happinessButton.title = 'Open City Advisor';

    // Update demographics tooltip
    const summary = resources.populationSummary;
    this.popEl.title = summary
      ? `Children: ${summary.children}\n` +
        `Teens: ${summary.teens}\n` +
        `Young Adults: ${summary.youngAdults}\n` +
        `Adults: ${summary.adults}\n` +
        `Elders: ${summary.elders}`
      : '';

    if (state) {
      this.cityNameEl.textContent = state.name;
      this.cityNameEl.title = state.name;
      if (state.clock) this.updateClock(state.clock);
    }

    const util = resources.utilities ?? (state ? evaluateCityUtilities(state).summary : undefined);
    if (util) {
      this.utilPowerBtn.textContent = `\u26A1 ${util.powerDemandMW.toFixed(0)}/${util.powerGenerationMW.toFixed(0)} MW`;
      this.utilPowerBtn.dataset.alert = util.unpoweredBuildings > 0 ? 'bad' : util.brownoutBuildings > 0 ? 'warn' : 'ok';
      this.utilPowerBtn.title = `Power: ${util.powerDemandMW.toFixed(1)} / ${util.powerGenerationMW.toFixed(1)} MW` +
        (util.unpoweredBuildings > 0 ? ` (${util.unpoweredBuildings} unpowered)` : '') + ' — click to edit Power Layer';

      this.utilWaterBtn.textContent = `\uD83D\uDCA7 ${util.waterDemandM3}/${util.waterSupplyM3} m\u00B3`;
      this.utilWaterBtn.dataset.alert = util.unwateredBuildings > 0 ? 'bad' : util.waterLoadPct > 90 ? 'warn' : 'ok';
      this.utilWaterBtn.title = `Water: ${util.waterDemandM3} / ${util.waterSupplyM3} m³/h` +
        (util.unwateredBuildings > 0 ? ` (${util.unwateredBuildings} dry)` : '') + ' — click to edit Water Layer';

      this.utilSewageBtn.textContent = `\uD83D\uDEB0 ${util.sewageDemandM3}/${util.sewageCapacityM3} m\u00B3`;
      this.utilSewageBtn.dataset.alert = util.backedUpBuildings > 0 ? 'bad' : util.sewageLoadPct > 90 ? 'warn' : 'ok';
      this.utilSewageBtn.title = `Sewage: ${util.sewageDemandM3} / ${util.sewageCapacityM3} m³/h` +
        (util.backedUpBuildings > 0 ? ` (${util.backedUpBuildings} unconnected/backed up)` : '') + ' — click to edit Sewage Layer';
    }

    // Update demand bars
    if (resources.demand) {
      this.updateDemandBar(this.demandResEl, resources.demand.residential, '#66BB6A', 'Residential');
      this.updateDemandBar(this.demandComEl, resources.demand.commercial, '#42A5F5', 'Commercial');
      this.updateDemandBar(this.demandIndEl, resources.demand.industrial, '#FFA726', 'Industrial');
    }
  }

  private flashMoney(gain: boolean): void {
    const cls = gain ? 'money-flash-gain' : 'money-flash-spend';
    this.moneyEl.classList.remove('money-flash-gain', 'money-flash-spend');
    // Force a reflow so re-adding the class restarts the animation
    void this.moneyEl.offsetWidth;
    this.moneyEl.classList.add(cls);
  }

  private updateDemandBar(el: HTMLDivElement, value: number, color: string, label: string): void {
    // Only positive demand (0 to 1) triggers zone development; map it directly to 0-100% width.
    const positive = Math.max(0, Math.min(1, value));
    const pct = Math.round(positive * 100);
    el.style.width = `${pct}%`;
    el.style.backgroundColor = positive > 0 ? color : '#666';
    const item = el.closest<HTMLElement>('.demand-item');
    if (item) {
      item.title = positive > 0 ? `${label} demand: ${pct}%` : `${label} demand: none`;
    }
  }
}
