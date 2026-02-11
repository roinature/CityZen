import {
  type ResourceState,
  type CityState,
  type GameClock,
  calculateTaxRevenue,
  calculateMaintenance,
  MIN_TAX_RATE,
  MAX_TAX_RATE,
  TAX_RATE_STEP,
  MAX_GAME_SPEED,
} from '@cityzen/shared';

const SPEED_LABELS = ['||', '>', '>>', '>>>'];

export class ResourceBar {
  private container: HTMLDivElement;
  private moneyEl: HTMLSpanElement;
  private popEl: HTMLSpanElement;
  private happyEl: HTMLSpanElement;
  private taxRevenueEl: HTMLSpanElement;
  private maintenanceEl: HTMLSpanElement;
  private netIncomeEl: HTMLSpanElement;
  private taxSlider: HTMLInputElement;
  private taxLabel: HTMLSpanElement;
  private demandResEl: HTMLDivElement;
  private demandComEl: HTMLDivElement;
  private demandIndEl: HTMLDivElement;
  private clockEl: HTMLSpanElement;
  private speedBtns: HTMLButtonElement[] = [];

  onTaxRateChange: ((rate: number) => void) | null = null;
  onGameSpeedChange: ((speed: number) => void) | null = null;
  private unlimited = false;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'resource-bar';
    this.container.innerHTML = `
      <div class="resource-item clock-item">
        <span class="resource-value" id="res-clock">Day 0, Year 1</span>
        <div class="speed-controls" id="speed-controls"></div>
      </div>
      <div class="resource-separator"></div>
      <div class="resource-item">
        <span class="resource-icon">$</span>
        <span class="resource-value" id="res-money">5000</span>
      </div>
      <div class="resource-item">
        <span class="resource-icon">P</span>
        <span class="resource-value" id="res-pop">0</span>
      </div>
      <div class="resource-item">
        <span class="resource-icon">H</span>
        <span class="resource-value" id="res-happy">50</span>
      </div>
      <div class="resource-separator"></div>
      <div class="resource-item budget-item">
        <span class="budget-label">Tax</span>
        <span class="resource-value budget-positive" id="res-tax-revenue">+$0</span>
      </div>
      <div class="resource-item budget-item">
        <span class="budget-label">Maint</span>
        <span class="resource-value budget-negative" id="res-maintenance">-$0</span>
      </div>
      <div class="resource-item budget-item">
        <span class="budget-label">Net</span>
        <span class="resource-value" id="res-net-income">$0</span>
      </div>
      <div class="resource-separator"></div>
      <div class="resource-item tax-slider-item">
        <span class="budget-label" id="tax-rate-label">Tax: 10%</span>
        <input type="range" id="tax-slider" min="${MIN_TAX_RATE}" max="${MAX_TAX_RATE}" step="${TAX_RATE_STEP}" value="10" class="tax-slider" />
      </div>
      <div class="resource-separator"></div>
      <div class="demand-bar">
        <span class="demand-title">Demand</span>
        <div class="demand-item">
          <span class="demand-label" style="color:#66BB6A">R</span>
          <div class="demand-meter-track"><div class="demand-meter-fill" id="demand-res"></div></div>
        </div>
        <div class="demand-item">
          <span class="demand-label" style="color:#42A5F5">C</span>
          <div class="demand-meter-track"><div class="demand-meter-fill" id="demand-com"></div></div>
        </div>
        <div class="demand-item">
          <span class="demand-label" style="color:#FFA726">I</span>
          <div class="demand-meter-track"><div class="demand-meter-fill" id="demand-ind"></div></div>
        </div>
      </div>
    `;
    parent.appendChild(this.container);

    this.clockEl = this.container.querySelector('#res-clock')!;
    this.moneyEl = this.container.querySelector('#res-money')!;
    this.popEl = this.container.querySelector('#res-pop')!;
    this.happyEl = this.container.querySelector('#res-happy')!;
    this.taxRevenueEl = this.container.querySelector('#res-tax-revenue')!;
    this.maintenanceEl = this.container.querySelector('#res-maintenance')!;
    this.netIncomeEl = this.container.querySelector('#res-net-income')!;
    this.taxSlider = this.container.querySelector('#tax-slider')!;
    this.taxLabel = this.container.querySelector('#tax-rate-label')!;
    this.demandResEl = this.container.querySelector('#demand-res')!;
    this.demandComEl = this.container.querySelector('#demand-com')!;
    this.demandIndEl = this.container.querySelector('#demand-ind')!;

    // Build speed control buttons
    const speedContainer = this.container.querySelector('#speed-controls')!;
    for (let i = 0; i <= MAX_GAME_SPEED; i++) {
      const btn = document.createElement('button');
      btn.className = 'speed-btn';
      btn.textContent = SPEED_LABELS[i];
      btn.title = i === 0 ? 'Pause' : `${i}x speed`;
      const speed = i;
      btn.addEventListener('click', () => {
        this.onGameSpeedChange?.(speed);
      });
      speedContainer.appendChild(btn);
      this.speedBtns.push(btn);
    }

    this.taxSlider.addEventListener('input', () => {
      const rate = parseInt(this.taxSlider.value, 10);
      this.taxLabel.textContent = `Tax: ${rate}%`;
      this.onTaxRateChange?.(rate);
    });
  }

  setUnlimitedMoney(enabled: boolean): void {
    this.unlimited = enabled;
  }

  updateClock(clock: GameClock): void {
    this.clockEl.textContent = `Day ${clock.gameDay + 1}, Year ${clock.gameYear}`;
    for (let i = 0; i < this.speedBtns.length; i++) {
      this.speedBtns[i].classList.toggle('active', i === clock.speed);
    }
  }

  update(resources: ResourceState, state?: CityState): void {
    this.moneyEl.textContent = this.unlimited ? '\u221E' : resources.money.toLocaleString();
    this.popEl.textContent = resources.population.toLocaleString();
    this.happyEl.textContent = `${resources.happiness}%`;

    // Update demographics tooltip
    const summary = resources.populationSummary;
    if (summary) {
      this.popEl.title =
        `Children: ${summary.children}\n` +
        `Teens: ${summary.teens}\n` +
        `Young Adults: ${summary.youngAdults}\n` +
        `Adults: ${summary.adults}\n` +
        `Elders: ${summary.elders}`;
    }

    // Sync slider to server state (in case another player changed it)
    if (this.taxSlider.value !== String(resources.taxRate)) {
      this.taxSlider.value = String(resources.taxRate);
      this.taxLabel.textContent = `Tax: ${resources.taxRate}%`;
    }

    if (state) {
      const taxRevenue = calculateTaxRevenue(state);
      const maintenance = calculateMaintenance(state);
      const net = taxRevenue - maintenance;

      this.taxRevenueEl.textContent = `+$${taxRevenue}`;
      this.maintenanceEl.textContent = `-$${maintenance}`;
      this.netIncomeEl.textContent = net >= 0 ? `+$${net}` : `-$${Math.abs(net)}`;
      this.netIncomeEl.className = `resource-value ${net >= 0 ? 'budget-positive' : 'budget-negative'}`;

      // Update clock from state
      if (state.clock) {
        this.updateClock(state.clock);
      }
    }

    // Update demand bars
    if (resources.demand) {
      this.updateDemandBar(this.demandResEl, resources.demand.residential, '#66BB6A');
      this.updateDemandBar(this.demandComEl, resources.demand.commercial, '#42A5F5');
      this.updateDemandBar(this.demandIndEl, resources.demand.industrial, '#FFA726');
    }
  }

  private updateDemandBar(el: HTMLDivElement, value: number, color: string): void {
    // value is -1 to 1, map to 0-100% width
    const pct = Math.max(0, Math.min(100, (value + 1) * 50));
    el.style.width = `${pct}%`;
    el.style.backgroundColor = value > 0 ? color : '#666';
  }
}
