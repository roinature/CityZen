import { ZoneDensity, ZONE_DENSITY_COSTS } from '@cityzen/shared';

export class DensityPicker {
  private container: HTMLDivElement;
  private onPick: ((density: ZoneDensity) => void) | null = null;
  private onOutsideClick = (event: MouseEvent): void => {
    if (!this.container.contains(event.target as Node)) this.hide();
  };

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'density-picker';
    parent.appendChild(this.container);
    this.render();
    window.addEventListener('resize', () => this.hide());
  }

  private render(): void {
    const densities: Array<{ density: ZoneDensity; label: string }> = [
      { density: ZoneDensity.LOW, label: 'Low' },
      { density: ZoneDensity.MEDIUM, label: 'Medium' },
      { density: ZoneDensity.HIGH, label: 'High' },
    ];

    for (const { density, label } of densities) {
      const btn = document.createElement('button');
      btn.className = 'density-option';

      const labelSpan = document.createElement('span');
      labelSpan.textContent = label;

      const costSpan = document.createElement('span');
      costSpan.className = 'density-cost';
      costSpan.textContent = `$${ZONE_DENSITY_COSTS[density]}`;

      btn.appendChild(labelSpan);
      btn.appendChild(costSpan);

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onPick?.(density);
        this.hide();
      });

      this.container.appendChild(btn);
    }
  }

  show(anchorElement: HTMLElement, onPick: (density: ZoneDensity) => void): void {
    this.onPick = onPick;
    this.container.style.display = 'flex';

    const rect = anchorElement.getBoundingClientRect();
    const width = this.container.offsetWidth;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    this.container.style.left = `${left}px`;
    this.container.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    document.addEventListener('click', this.onOutsideClick);
  }

  hide(): boolean {
    if (!this.onPick) return false;
    this.container.style.display = 'none';
    this.onPick = null;
    document.removeEventListener('click', this.onOutsideClick);
    return true;
  }
}
