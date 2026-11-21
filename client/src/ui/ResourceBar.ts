import { type ResourceState, type CityState, type GameClock, MAX_GAME_SPEED } from '@cityzen/shared';

const SPEED_LABELS = ['Ⅱ', '1×', '2×', '3×'];

export class ResourceBar {
  private container: HTMLDivElement;
  private moneyEl: HTMLSpanElement;
  private popEl: HTMLSpanElement;
  private happyEl: HTMLSpanElement;
  private cityNameEl: HTMLSpanElement;
  readonly actions: HTMLDivElement;
  readonly demand: HTMLDivElement;
  private lastMoney: number | null = null;
  private demandResEl: HTMLDivElement;
  private demandComEl: HTMLDivElement;
  private demandIndEl: HTMLDivElement;
  private clockEl: HTMLSpanElement;
  private speedBtns: HTMLButtonElement[] = [];

  onGameSpeedChange: ((speed: number) => void) | null = null;
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
          <div class="resource-item">
            <span class="resource-label">Happiness</span>
            <span class="resource-value" id="res-happy"></span>
          </div>
        </div>
        <div class="resource-item clock-item">
          <span class="resource-value" id="res-clock"></span>
          <div class="speed-controls" id="speed-controls" role="group" aria-label="Game speed"></div>
        </div>
      </div>
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
    this.demandResEl = this.demand.querySelector('#demand-res')!;
    this.demandComEl = this.demand.querySelector('#demand-com')!;
    this.demandIndEl = this.demand.querySelector('#demand-ind')!;

    // Build speed control buttons
    const speedContainer = this.container.querySelector('#speed-controls')!;
    for (let i = 0; i <= MAX_GAME_SPEED; i++) {
      const btn = document.createElement('button');
      btn.className = 'speed-btn';
      btn.textContent = SPEED_LABELS[i];
      btn.setAttribute('aria-label', i === 0 ? 'Pause' : `${i}× speed`);
      const speed = i;
      btn.addEventListener('click', () => {
        this.onGameSpeedChange?.(speed);
      });
      speedContainer.appendChild(btn);
      this.speedBtns.push(btn);
    }
  }

  setUnlimitedMoney(enabled: boolean): void {
    this.unlimited = enabled;
  }

  updateClock(clock: GameClock): void {
    this.clockEl.textContent = `Day ${clock.gameDay + 1}, Year ${clock.gameYear}`;
    for (let i = 0; i < this.speedBtns.length; i++) {
      this.speedBtns[i].setAttribute('aria-pressed', String(i === clock.speed));
    }
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
    const happiness = Math.round(resources.happiness);
    this.happyEl.textContent = `${happiness}%`;
    this.happyEl.classList.toggle('budget-negative', happiness < 30);

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

    // Update demand bars
    if (resources.demand) {
      this.updateDemandBar(this.demandResEl, resources.demand.residential, '#66BB6A');
      this.updateDemandBar(this.demandComEl, resources.demand.commercial, '#42A5F5');
      this.updateDemandBar(this.demandIndEl, resources.demand.industrial, '#FFA726');
    }
  }

  private flashMoney(gain: boolean): void {
    const cls = gain ? 'money-flash-gain' : 'money-flash-spend';
    this.moneyEl.classList.remove('money-flash-gain', 'money-flash-spend');
    // Force a reflow so re-adding the class restarts the animation
    void this.moneyEl.offsetWidth;
    this.moneyEl.classList.add(cls);
  }

  private updateDemandBar(el: HTMLDivElement, value: number, color: string): void {
    // value is -1 to 1, map to 0-100% width
    const pct = Math.max(0, Math.min(100, (value + 1) * 50));
    el.style.width = `${pct}%`;
    el.style.backgroundColor = value > 0 ? color : '#666';
  }
}
