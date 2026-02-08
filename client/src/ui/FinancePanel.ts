import type { CityState } from '@cityzen/shared';
import { calculateTaxRevenue, calculateMaintenance, calculateNetIncome } from '@cityzen/shared';

export class FinancePanel {
  private overlay: HTMLDivElement;
  private bodyEl!: HTMLDivElement;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'finance-overlay';
    this.overlay.style.display = 'none';
    parent.appendChild(this.overlay);
    this.render();

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  private render(): void {
    const panel = document.createElement('div');
    panel.className = 'finance-panel';

    const header = document.createElement('h2');
    header.textContent = 'City Finances';
    panel.appendChild(header);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'finance-body';
    panel.appendChild(this.bodyEl);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'menu-btn';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => this.hide());
    panel.appendChild(closeBtn);

    this.overlay.appendChild(panel);
  }

  update(state: CityState): void {
    const revenue = calculateTaxRevenue(state);
    const maintenance = calculateMaintenance(state);
    const net = calculateNetIncome(state);
    const res = state.resources;

    const rows: [string, string, string?][] = [
      ['Population', String(res.population)],
      ['Happiness', `${res.happiness}%`],
      ['Tax Rate', `${res.taxRate}%`],
      ['', ''],
      ['Tax Revenue', `+$${revenue}`, 'positive'],
      ['Maintenance', `-$${maintenance}`, 'negative'],
      ['Net Income', `${net >= 0 ? '+' : ''}$${net}`, net >= 0 ? 'positive' : 'negative'],
      ['', ''],
      ['Treasury', `$${res.money}`],
      ['Buildings', String(state.buildings.length)],
    ];

    this.bodyEl.innerHTML = '';

    for (const [label, value, colorClass] of rows) {
      if (!label && !value) {
        const sep = document.createElement('div');
        sep.className = 'finance-separator';
        this.bodyEl.appendChild(sep);
        continue;
      }

      const row = document.createElement('div');
      row.className = 'finance-row';

      const labelEl = document.createElement('span');
      labelEl.className = 'finance-label';
      labelEl.textContent = label;

      const valueEl = document.createElement('span');
      valueEl.className = 'finance-value';
      if (colorClass) valueEl.classList.add(`finance-${colorClass}`);
      valueEl.textContent = value;

      row.appendChild(labelEl);
      row.appendChild(valueEl);
      this.bodyEl.appendChild(row);
    }
  }

  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    this.visible = true;
    this.overlay.style.display = 'flex';
  }

  hide(): void {
    this.visible = false;
    this.overlay.style.display = 'none';
  }

  isVisible(): boolean {
    return this.visible;
  }
}
