import { ZoneDensity, ZONE_DENSITY_COSTS } from '@cityzen/shared';

export class DensityPicker {
  private container: HTMLDivElement;
  private onPick: ((density: ZoneDensity) => void) | null = null;
  private closeHandler: ((e: MouseEvent) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'density-picker';
    parent.appendChild(this.container);
    this.render();
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

    // Position to the left of the anchor button
    const rect = anchorElement.getBoundingClientRect();
    this.container.style.top = `${rect.top}px`;
    this.container.style.right = `${window.innerWidth - rect.left + 8}px`;

    // Close on outside click (delayed to avoid immediate close from the triggering click)
    requestAnimationFrame(() => {
      this.closeHandler = (e: MouseEvent) => {
        if (!this.container.contains(e.target as Node)) {
          this.hide();
        }
      };
      document.addEventListener('click', this.closeHandler);
    });
  }

  hide(): void {
    this.container.style.display = 'none';
    this.onPick = null;
    if (this.closeHandler) {
      document.removeEventListener('click', this.closeHandler);
      this.closeHandler = null;
    }
  }
}
