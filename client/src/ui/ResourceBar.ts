import type { ResourceState } from '@cityzen/shared';

export class ResourceBar {
  private container: HTMLDivElement;
  private moneyEl: HTMLSpanElement;
  private popEl: HTMLSpanElement;
  private happyEl: HTMLSpanElement;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'resource-bar';
    this.container.innerHTML = `
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
    `;
    parent.appendChild(this.container);

    this.moneyEl = this.container.querySelector('#res-money')!;
    this.popEl = this.container.querySelector('#res-pop')!;
    this.happyEl = this.container.querySelector('#res-happy')!;
  }

  update(resources: ResourceState): void {
    this.moneyEl.textContent = resources.money.toLocaleString();
    this.popEl.textContent = resources.population.toLocaleString();
    this.happyEl.textContent = `${resources.happiness}%`;
  }
}
