import { CAMERA_VIEWS, type CameraView } from '../scene/CameraController.js';
import { CITY_STYLES, type CityStyleId } from '../world/CityStyle.js';

export interface GameOptions {
  showGrid: boolean;
  showCars: boolean;
  maxCars: number;
  cameraSpeed: number;
  shadowsEnabled: boolean;
  /** Glow round lights, colour grading and lens falloff. */
  postEffects: boolean;
  cityStyle: CityStyleId;
  cameraView: CameraView;
  /** Building heights, percent. */
  skyline: number;
  crossings: boolean;
  trees: boolean;
  unlimitedMoney: boolean;
  soundEnabled: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
}

const OPTIONS_KEY = 'cityzen_options';

const DEFAULT_OPTIONS: GameOptions = {
  showGrid: true,
  showCars: true,
  maxCars: 20,
  cameraSpeed: 30,
  shadowsEnabled: true,
  postEffects: true,
  cityStyle: 'classic',
  cameraView: 'hero',
  skyline: 100,
  crossings: true,
  trees: true,
  unlimitedMoney: false,
  soundEnabled: true,
  masterVolume: 50,
  musicVolume: 70,
  sfxVolume: 80,
};

function selectOptions(items: Record<string, { label: string }>): string {
  return Object.entries(items).map(([id, { label }]) => `<option value="${id}">${label}</option>`).join('');
}

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
            <label for="opt-style">City Style</label>
            <select id="opt-style">${selectOptions(CITY_STYLES)}</select>
          </div>
          <div class="option-row">
            <label for="opt-view">Camera (V)</label>
            <select id="opt-view">${selectOptions(CAMERA_VIEWS)}</select>
          </div>
          <div class="option-row">
            <label for="opt-skyline">Skyline Height</label>
            <input type="range" id="opt-skyline" min="50" max="180" step="10" />
            <span class="option-value" id="opt-skyline-val"></span>
          </div>
          <div class="option-row">
            <label for="opt-crossings">Crosswalks</label>
            <input type="checkbox" id="opt-crossings" />
          </div>
          <div class="option-row">
            <label for="opt-trees">Trees</label>
            <input type="checkbox" id="opt-trees" />
          </div>
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
            <label for="opt-post">Glow &amp; Color Grading</label>
            <input type="checkbox" id="opt-post" />
          </div>
          <div class="option-row">
            <label for="opt-unlimited">Unlimited Money</label>
            <input type="checkbox" id="opt-unlimited" />
          </div>
          <hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:8px 0" />
          <div class="option-row">
            <label for="opt-sound">Sound</label>
            <input type="checkbox" id="opt-sound" />
          </div>
          <div class="option-row">
            <label for="opt-master-vol">Master Volume</label>
            <input type="range" id="opt-master-vol" min="0" max="100" step="5" />
            <span class="option-value" id="opt-master-vol-val"></span>
          </div>
          <div class="option-row">
            <label for="opt-music-vol">Music Volume</label>
            <input type="range" id="opt-music-vol" min="0" max="100" step="5" />
            <span class="option-value" id="opt-music-vol-val"></span>
          </div>
          <div class="option-row">
            <label for="opt-sfx-vol">SFX Volume</label>
            <input type="range" id="opt-sfx-vol" min="0" max="100" step="5" />
            <span class="option-value" id="opt-sfx-vol-val"></span>
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
    this.bindCheckbox('opt-crossings', 'crossings');
    this.bindCheckbox('opt-trees', 'trees');
    this.bindSelect('opt-style', 'cityStyle');
    this.bindSelect('opt-view', 'cameraView');
    this.bindRange('opt-skyline', 'skyline', 'opt-skyline-val');
    this.bindCheckbox('opt-shadows', 'shadowsEnabled');
    this.bindCheckbox('opt-post', 'postEffects');
    this.bindCheckbox('opt-unlimited', 'unlimitedMoney');
    this.bindCheckbox('opt-sound', 'soundEnabled');
    this.bindRange('opt-max-cars', 'maxCars', 'opt-max-cars-val');
    this.bindRange('opt-cam-speed', 'cameraSpeed', 'opt-cam-speed-val');
    this.bindRange('opt-master-vol', 'masterVolume', 'opt-master-vol-val');
    this.bindRange('opt-music-vol', 'musicVolume', 'opt-music-vol-val');
    this.bindRange('opt-sfx-vol', 'sfxVolume', 'opt-sfx-vol-val');

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
    (this.overlay.querySelector('#opt-post') as HTMLInputElement).checked = this.options.postEffects;
    (this.overlay.querySelector('#opt-unlimited') as HTMLInputElement).checked = this.options.unlimitedMoney;
    (this.overlay.querySelector('#opt-sound') as HTMLInputElement).checked = this.options.soundEnabled;

    (this.overlay.querySelector('#opt-crossings') as HTMLInputElement).checked = this.options.crossings;
    (this.overlay.querySelector('#opt-trees') as HTMLInputElement).checked = this.options.trees;
    (this.overlay.querySelector('#opt-style') as HTMLSelectElement).value = this.options.cityStyle;
    (this.overlay.querySelector('#opt-view') as HTMLSelectElement).value = this.options.cameraView;
    (this.overlay.querySelector('#opt-skyline') as HTMLInputElement).value = String(this.options.skyline);
    this.overlay.querySelector('#opt-skyline-val')!.textContent = String(this.options.skyline);

    const maxCarsEl = this.overlay.querySelector('#opt-max-cars') as HTMLInputElement;
    maxCarsEl.value = String(this.options.maxCars);
    this.overlay.querySelector('#opt-max-cars-val')!.textContent = String(this.options.maxCars);

    const camSpeedEl = this.overlay.querySelector('#opt-cam-speed') as HTMLInputElement;
    camSpeedEl.value = String(this.options.cameraSpeed);
    this.overlay.querySelector('#opt-cam-speed-val')!.textContent = String(this.options.cameraSpeed);

    const masterVolEl = this.overlay.querySelector('#opt-master-vol') as HTMLInputElement;
    masterVolEl.value = String(this.options.masterVolume);
    this.overlay.querySelector('#opt-master-vol-val')!.textContent = String(this.options.masterVolume);

    const musicVolEl = this.overlay.querySelector('#opt-music-vol') as HTMLInputElement;
    musicVolEl.value = String(this.options.musicVolume);
    this.overlay.querySelector('#opt-music-vol-val')!.textContent = String(this.options.musicVolume);

    const sfxVolEl = this.overlay.querySelector('#opt-sfx-vol') as HTMLInputElement;
    sfxVolEl.value = String(this.options.sfxVolume);
    this.overlay.querySelector('#opt-sfx-vol-val')!.textContent = String(this.options.sfxVolume);
  }

  private bindCheckbox(id: string, key: keyof GameOptions): void {
    const el = this.overlay.querySelector(`#${id}`) as HTMLInputElement;
    el.addEventListener('change', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.options as any)[key] = el.checked;
      this.saveAndNotify();
    });
  }

  private bindSelect(id: string, key: 'cityStyle' | 'cameraView'): void {
    const el = this.overlay.querySelector(`#${id}`) as HTMLSelectElement;
    el.addEventListener('change', () => {
      Object.assign(this.options, { [key]: el.value });
      this.saveAndNotify();
    });
  }

  nextCameraView(): CameraView {
    const views = Object.keys(CAMERA_VIEWS) as CameraView[];
    this.options.cameraView = views[(views.indexOf(this.options.cameraView) + 1) % views.length];
    this.syncUI();
    this.saveAndNotify();
    return this.options.cameraView;
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
      const options = { ...DEFAULT_OPTIONS, ...JSON.parse(raw) } as GameOptions;
      if (!(options.cityStyle in CITY_STYLES)) options.cityStyle = DEFAULT_OPTIONS.cityStyle;
      if (!(options.cameraView in CAMERA_VIEWS)) options.cameraView = DEFAULT_OPTIONS.cameraView;
      return options;
    } catch {
      return { ...DEFAULT_OPTIONS };
    }
  }
}
