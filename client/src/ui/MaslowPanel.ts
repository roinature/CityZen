import { MaslowNeed, MASLOW_NEEDS_ORDERED, type PopulationSummary } from '@cityzen/shared';

const NEED_LABELS: Record<MaslowNeed, string> = {
  [MaslowNeed.PHYSIOLOGICAL]: 'Physiological',
  [MaslowNeed.SAFETY]: 'Safety',
  [MaslowNeed.LOVE_BELONGING]: 'Love & Belonging',
  [MaslowNeed.ESTEEM]: 'Esteem',
  [MaslowNeed.COGNITIVE]: 'Cognitive',
  [MaslowNeed.AESTHETIC]: 'Aesthetic',
  [MaslowNeed.SELF_ACTUALIZATION]: 'Self-Actualization',
};

const NEED_COLORS: Record<MaslowNeed, string> = {
  [MaslowNeed.PHYSIOLOGICAL]: '#e57373',
  [MaslowNeed.SAFETY]: '#ffb74d',
  [MaslowNeed.LOVE_BELONGING]: '#fff176',
  [MaslowNeed.ESTEEM]: '#81c784',
  [MaslowNeed.COGNITIVE]: '#64b5f6',
  [MaslowNeed.AESTHETIC]: '#ce93d8',
  [MaslowNeed.SELF_ACTUALIZATION]: '#f48fb1',
};

export class MaslowPanel {
  private overlay: HTMLDivElement;
  private bars: Map<MaslowNeed, HTMLDivElement> = new Map();
  private values: Map<MaslowNeed, HTMLSpanElement> = new Map();
  private migrationEl!: HTMLDivElement;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'maslow-overlay';
    this.overlay.style.display = 'none';
    parent.appendChild(this.overlay);
    this.render();

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  private render(): void {
    const panel = document.createElement('div');
    panel.className = 'maslow-panel';

    const header = document.createElement('h2');
    header.textContent = 'Maslow Needs';
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'maslow-body';

    for (const need of MASLOW_NEEDS_ORDERED) {
      const row = document.createElement('div');
      row.className = 'maslow-row';

      const label = document.createElement('span');
      label.className = 'maslow-label';
      label.textContent = NEED_LABELS[need];

      const track = document.createElement('div');
      track.className = 'maslow-bar-track';

      const fill = document.createElement('div');
      fill.className = 'maslow-bar-fill';
      fill.style.backgroundColor = NEED_COLORS[need];
      fill.style.width = '50%';
      track.appendChild(fill);
      this.bars.set(need, fill);

      const valueEl = document.createElement('span');
      valueEl.className = 'maslow-value';
      valueEl.textContent = '50';
      this.values.set(need, valueEl);

      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(valueEl);
      body.appendChild(row);
    }

    panel.appendChild(body);

    this.migrationEl = document.createElement('div');
    this.migrationEl.className = 'maslow-migration';
    this.migrationEl.style.display = 'none';
    panel.appendChild(this.migrationEl);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'menu-btn';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => this.hide());
    panel.appendChild(closeBtn);

    this.overlay.appendChild(panel);
  }

  update(summary: PopulationSummary): void {
    for (const need of MASLOW_NEEDS_ORDERED) {
      const val = Math.round(summary.averageMaslow[need]);
      const fill = this.bars.get(need);
      const valueEl = this.values.get(need);
      if (fill) fill.style.width = `${val}%`;
      if (valueEl) valueEl.textContent = String(val);
    }
  }

  showMigrationWarning(count: number, direction: 'in' | 'out', cityName: string): void {
    this.migrationEl.style.display = 'block';
    if (direction === 'out') {
      this.migrationEl.textContent = `${count} people migrating to ${cityName}`;
      this.migrationEl.style.color = '#f44336';
    } else {
      this.migrationEl.textContent = `${count} people arriving from ${cityName}`;
      this.migrationEl.style.color = '#4caf50';
    }
    setTimeout(() => {
      this.migrationEl.style.display = 'none';
    }, 5000);
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
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
