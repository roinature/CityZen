export interface GameOptions {
  showGrid: boolean;
  showCars: boolean;
  maxCars: number;
  cameraSpeed: number;
  shadowsEnabled: boolean;
  unlimitedMoney: boolean;
}

const OPTIONS_KEY = 'cityzen_options';

const DEFAULT_OPTIONS: GameOptions = {
  showGrid: true,
  showCars: true,
  maxCars: 20,
  cameraSpeed: 30,
  shadowsEnabled: true,
  unlimitedMoney: false,
};

export type OptionsChangeCallback = (options: GameOptions) => void;

export class OptionsPanel {
  private overlay: HTMLDivElement;
  private options: GameOptions;
  private onChange: OptionsChangeCallback;

  constructor(parent: HTMLElement, onChange: OptionsChangeCallback) {
    this.onChange = onChange;
    this.options = this.loadOptions();

    this.overlay = document.createElement('div');
    this.overlay.className = 'menu-overlay';
    this.overlay.style.display = 'none';
    this.overlay.innerHTML = `
      <div class="options-panel">
        <h2>Options</h2>
        <div class="options-list">
          <div class="option-row">
            <label for="opt-grid">Show Grid</label>
            <input type="checkbox" id="opt-grid" />
          </div>
          <div class="option-row">
            <label for="opt-cars">Show Cars</label>
            <input type="checkbox" id="opt-cars" />
          </div>
          <div class="option-row">
            <label for="opt-max-cars">Max Cars</label>
            <input type="range" id="opt-max-cars" min="0" max="50" step="5" />
            <span class="option-value" id="opt-max-cars-val"></span>
          </div>
          <div class="option-row">
            <label for="opt-cam-speed">Camera Speed</label>
            <input type="range" id="opt-cam-speed" min="10" max="80" step="5" />
            <span class="option-value" id="opt-cam-speed-val"></span>
          </div>
          <div class="option-row">
            <label for="opt-shadows">Shadows</label>
            <input type="checkbox" id="opt-shadows" />
          </div>
          <div class="option-row">
            <label for="opt-unlimited">Unlimited Money</label>
            <input type="checkbox" id="opt-unlimited" />
          </div>
        </div>
        <div class="options-buttons">
          <button class="menu-btn" id="opt-back">Back</button>
          <button class="menu-btn" id="opt-reset">Reset Defaults</button>
        </div>
      </div>
    `;
    parent.appendChild(this.overlay);

    // Click outside to close
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });

    this.overlay.querySelector('#opt-back')!.addEventListener('click', () => this.hide());
    this.overlay.querySelector('#opt-reset')!.addEventListener('click', () => {
      this.options = { ...DEFAULT_OPTIONS };
      this.syncUI();
      this.saveAndNotify();
    });

    // Bind change handlers
    this.bindCheckbox('opt-grid', 'showGrid');
    this.bindCheckbox('opt-cars', 'showCars');
    this.bindCheckbox('opt-shadows', 'shadowsEnabled');
    this.bindCheckbox('opt-unlimited', 'unlimitedMoney');
    this.bindRange('opt-max-cars', 'maxCars', 'opt-max-cars-val');
    this.bindRange('opt-cam-speed', 'cameraSpeed', 'opt-cam-speed-val');

    this.syncUI();
    // Emit initial options
    this.onChange(this.options);
  }

  show(): void {
    this.overlay.style.display = 'flex';
    this.syncUI();
  }

  hide(): void {
    this.overlay.style.display = 'none';
  }

  isVisible(): boolean {
    return this.overlay.style.display !== 'none';
  }

  getOptions(): GameOptions {
    return { ...this.options };
  }

  private syncUI(): void {
    (this.overlay.querySelector('#opt-grid') as HTMLInputElement).checked = this.options.showGrid;
    (this.overlay.querySelector('#opt-cars') as HTMLInputElement).checked = this.options.showCars;
    (this.overlay.querySelector('#opt-shadows') as HTMLInputElement).checked = this.options.shadowsEnabled;
    (this.overlay.querySelector('#opt-unlimited') as HTMLInputElement).checked = this.options.unlimitedMoney;

    const maxCarsEl = this.overlay.querySelector('#opt-max-cars') as HTMLInputElement;
    maxCarsEl.value = String(this.options.maxCars);
    this.overlay.querySelector('#opt-max-cars-val')!.textContent = String(this.options.maxCars);

    const camSpeedEl = this.overlay.querySelector('#opt-cam-speed') as HTMLInputElement;
    camSpeedEl.value = String(this.options.cameraSpeed);
    this.overlay.querySelector('#opt-cam-speed-val')!.textContent = String(this.options.cameraSpeed);
  }

  private bindCheckbox(id: string, key: keyof GameOptions): void {
    const el = this.overlay.querySelector(`#${id}`) as HTMLInputElement;
    el.addEventListener('change', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.options as any)[key] = el.checked;
      this.saveAndNotify();
    });
  }

  private bindRange(id: string, key: keyof GameOptions, valueId: string): void {
    const el = this.overlay.querySelector(`#${id}`) as HTMLInputElement;
    el.addEventListener('input', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.options as any)[key] = Number(el.value);
      this.overlay.querySelector(`#${valueId}`)!.textContent = el.value;
      this.saveAndNotify();
    });
  }

  private saveAndNotify(): void {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(this.options));
    this.onChange(this.options);
  }

  private loadOptions(): GameOptions {
    try {
      const raw = localStorage.getItem(OPTIONS_KEY);
      if (!raw) return { ...DEFAULT_OPTIONS };
      return { ...DEFAULT_OPTIONS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_OPTIONS };
    }
  }
}
