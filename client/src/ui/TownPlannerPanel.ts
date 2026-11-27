import {
  BuildingType, DEFAULT_TOWN, TOWN_CHARACTERS, TOWN_CHARACTER_KNOBS, applySiteTerrain, createEmptyGrid,
  getEffectiveSize, isRoad, isZone, normalizeTownSettings, planTown,
  type CityState, type Grid, type TownCharacter, type TownSettings,
} from '@cityzen/shared';

const SETTINGS_KEY = 'cityzen_town_settings';
const SCALE = 5;

type SliderKey = 'extent' | 'block' | 'irregular' | 'curvy' | 'culdesacs' | 'density' | 'core' | 'downtown' | 'lots' | 'parks' | 'parking' | 'built';

const SLIDERS: ReadonlyArray<{ key: SliderKey; label: string; hint: string; min: number; max: number; step: number }> = [
  { key: 'extent', label: 'Town size', hint: 'How much of the plot the town covers', min: 0.3, max: 1, step: 0.05 },
  { key: 'block', label: 'Block size', hint: 'Cells between neighbouring streets', min: 3, max: 8, step: 1 },
  { key: 'core', label: 'Downtown grid', hint: 'Size of the street grid in the middle', min: 0, max: 1, step: 0.05 },
  { key: 'irregular', label: 'Irregular', hint: 'How uneven the downtown grid is', min: 0, max: 1, step: 0.05 },
  { key: 'curvy', label: 'Curvy streets', hint: 'How much residential streets bend', min: 0, max: 1, step: 0.05 },
  { key: 'culdesacs', label: 'Cul-de-sacs', hint: 'Streets that end instead of joining up', min: 0, max: 1, step: 0.05 },
  { key: 'density', label: 'Street density', hint: 'How much land around downtown gets streets', min: 0, max: 1, step: 0.05 },
  { key: 'downtown', label: 'Tower reach', hint: 'How far out downtown towers go', min: 0, max: 1, step: 0.05 },
  { key: 'lots', label: 'Lots', hint: 'Share of suburban frontage with a lot', min: 0, max: 1, step: 0.05 },
  { key: 'parks', label: 'Parks', hint: 'Share of residential land kept green', min: 0, max: 0.5, step: 0.05 },
  { key: 'parking', label: 'Parking', hint: 'Parking lots among shops and industry', min: 0, max: 1, step: 0.05 },
  { key: 'built', label: 'Already built', hint: 'Lots that start with a building. Buildings cost upkeep before anyone moves in.', min: 0, max: 1, step: 0.05 },
];

const EXITS = ['north', 'east', 'south', 'west'] as const;
const title = (text: string) => text[0].toUpperCase() + text.slice(1);

/** Settings and live preview for replacing the city with a planned town. */
export class TownPlannerPanel {
  private overlay: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private stats: HTMLElement;
  private buildButton: HTMLButtonElement;
  private settings: TownSettings;
  private city: CityState | null = null;
  private baseTerrain: Grid | null = null;
  private confirming = false;
  private busy = false;
  private previewQueued = false;

  constructor(parent: HTMLElement, private onGenerate: (settings: TownSettings) => Promise<boolean>) {
    this.settings = this.load();
    this.overlay = document.createElement('div');
    this.overlay.className = 'menu-overlay';
    this.overlay.style.display = 'none';
    this.overlay.innerHTML = `
      <div class="town-planner" role="dialog" aria-modal="true" aria-labelledby="town-planner-title">
        <div class="town-planner-preview">
          <h2 id="town-planner-title">Town Planner</h2>
          <canvas width="${64 * SCALE}" height="${64 * SCALE}" aria-label="Map of the planned town"></canvas>
          <div class="town-planner-stats" aria-live="polite"></div>
          <div class="town-planner-legend">
            <span style="--swatch:#8fbf7f">Homes</span><span style="--swatch:#d99a5f">Shops</span>
            <span style="--swatch:#6f8fb5">Downtown</span><span style="--swatch:#a39a7c">Industry</span>
            <span style="--swatch:#4f8f3f">Parks</span><span style="--swatch:#c65f8f">Services</span>
          </div>
        </div>
        <div class="town-planner-settings">
          <div class="town-planner-characters" role="group" aria-label="Town character">
            ${TOWN_CHARACTERS.map(name => `<button class="menu-btn" data-character="${name}">${title(name)}</button>`).join('')}
          </div>
          <div class="option-row">
            <label for="town-seed">Seed</label>
            <input type="number" id="town-seed" min="0" max="999999" step="1" />
            <button class="menu-btn" id="town-dice">Shuffle</button>
          </div>
          <div class="option-row">
            <label for="town-main">Main street</label>
            <select id="town-main"><option value="EW">East – west</option><option value="NS">North – south</option></select>
          </div>
          ${SLIDERS.map(({ key, label, hint, min, max, step }) => `
            <div class="option-row" title="${hint}">
              <label for="town-${key}">${label}</label>
              <input type="range" id="town-${key}" min="${min}" max="${max}" step="${step}" />
              <span class="option-value" id="town-${key}-val"></span>
            </div>`).join('')}
          <div class="option-row"><label for="town-cross">Cross street</label><input type="checkbox" id="town-cross" /></div>
          <div class="option-row"><label for="town-services">Public services</label><input type="checkbox" id="town-services" /></div>
          <div class="option-row town-planner-exits"><span>Roads out</span>
            ${EXITS.map(edge => `<label><input type="checkbox" data-exit="${edge}" /> ${title(edge)}</label>`).join('')}
          </div>
        </div>
        <div class="options-buttons">
          <button class="menu-btn" id="town-cancel">Cancel</button>
          <button class="menu-btn menu-btn-confirm" id="town-build">Build this town</button>
        </div>
      </div>`;
    parent.appendChild(this.overlay);
    this.canvas = this.overlay.querySelector('canvas')!;
    this.stats = this.overlay.querySelector('.town-planner-stats')!;
    this.buildButton = this.find('town-build');

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
    this.find('town-cancel').addEventListener('click', () => this.hide());
    this.buildButton.addEventListener('click', () => void this.build());
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-character]').forEach(button => {
      button.addEventListener('click', () => {
        const character = button.dataset.character as TownCharacter;
        this.change({ character, ...TOWN_CHARACTER_KNOBS[character] });
      });
    });
    const seed = this.find<HTMLInputElement>('town-seed');
    seed.addEventListener('change', () => this.change({ seed: seed.valueAsNumber }));
    this.find('town-dice').addEventListener('click', () => this.change({ seed: Math.floor(Math.random() * 1_000_000) }));
    const main = this.find<HTMLSelectElement>('town-main');
    main.addEventListener('change', () => this.change({ mainStreet: main.value === 'NS' ? 'NS' : 'EW' }));
    for (const { key } of SLIDERS) {
      const slider = this.find<HTMLInputElement>(`town-${key}`);
      slider.addEventListener('input', () => this.change({ [key]: slider.valueAsNumber }));
    }
    const cross = this.find<HTMLInputElement>('town-cross');
    cross.addEventListener('change', () => this.change({ crossStreet: cross.checked }));
    const services = this.find<HTMLInputElement>('town-services');
    services.addEventListener('change', () => this.change({ services: services.checked }));
    this.overlay.querySelectorAll<HTMLInputElement>('[data-exit]').forEach(box => {
      box.addEventListener('change', () => this.change({
        exits: EXITS.filter(edge => edge === box.dataset.exit ? box.checked : this.settings.exits.includes(edge)),
      }));
    });
  }

  show(city: CityState): void {
    this.city = city;
    if (city.siteId) {
      const terrain = createEmptyGrid(city.grid.length);
      applySiteTerrain(terrain, city.siteId);
      this.baseTerrain = terrain;
    } else {
      this.baseTerrain = city.grid;
    }
    this.setConfirming(false);
    this.overlay.style.display = 'flex';
    this.sync();
  }

  hide(): void {
    this.overlay.style.display = 'none';
  }

  isVisible(): boolean {
    return this.overlay.style.display !== 'none';
  }

  private find<T extends HTMLElement = HTMLButtonElement>(id: string): T {
    return this.overlay.querySelector<T>(`#${id}`)!;
  }

  private change(patch: Partial<TownSettings>): void {
    this.settings = normalizeTownSettings({ ...this.settings, ...patch });
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch { /* Not remembered; nothing else depends on it. */ }
    this.setConfirming(false);
    this.sync();
  }

  private load(): TownSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? normalizeTownSettings(JSON.parse(raw)) : { ...DEFAULT_TOWN };
    } catch {
      return { ...DEFAULT_TOWN };
    }
  }

  private sync(): void {
    const s = this.settings;
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-character]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.character === s.character));
    });
    this.find<HTMLInputElement>('town-seed').value = String(s.seed);
    this.find<HTMLSelectElement>('town-main').value = s.mainStreet;
    for (const { key } of SLIDERS) {
      this.find<HTMLInputElement>(`town-${key}`).value = String(s[key]);
      this.find(`town-${key}-val`).textContent = key === 'block' ? String(s[key]) : `${Math.round(s[key] * 100)}%`;
    }
    this.find<HTMLInputElement>('town-cross').checked = s.crossStreet;
    this.find<HTMLInputElement>('town-services').checked = s.services;
    this.overlay.querySelectorAll<HTMLInputElement>('[data-exit]').forEach(box => {
      box.checked = s.exits.some(edge => edge === box.dataset.exit);
    });
    if (this.previewQueued) return;
    this.previewQueued = true;
    requestAnimationFrame(() => {
      this.previewQueued = false;
      this.preview();
    });
  }

  private preview(): void {
    if (!this.city || !this.baseTerrain) return;
    const { grid, buildings } = planTown(this.baseTerrain, this.settings, 'preview', '');
    const ctx = this.canvas.getContext('2d')!;
    grid.forEach((column, x) => column.forEach((cell, z) => {
      ctx.fillStyle = cell.terrain === 'water' ? '#447f99' : cell.terrain === 'steep' ? '#8f7f5c' : '#b9c79c';
      ctx.fillRect(x * SCALE, z * SCALE, SCALE, SCALE);
    }));
    let streets = 0, lots = 0, parks = 0;
    for (const b of buildings) {
      const { w, d } = getEffectiveSize(b.type, b.orientation);
      if (isRoad(b.type)) streets++;
      else if (isZone(b.type)) lots++;
      else if (b.type === BuildingType.PARK) parks++;
      ctx.fillStyle = isRoad(b.type) ? '#33363b'
        : b.type === BuildingType.PARK ? '#4f8f3f'
        : b.type === BuildingType.PARKING ? '#70747a'
        : b.type === BuildingType.ZONE_INDUSTRIAL ? '#a39a7c'
        : isZone(b.type) && b.density === 'high' ? '#6f8fb5'
        : b.type === BuildingType.ZONE_COMMERCIAL ? '#d99a5f'
        : isZone(b.type) ? '#8fbf7f' : '#c65f8f';
      ctx.fillRect(b.position.x * SCALE, b.position.z * SCALE, w * SCALE, d * SCALE);
    }
    this.stats.textContent = `${streets} road tiles · ${lots} lots · ${parks} parks`
      + (this.settings.built > 0.3 ? ' · Upkeep on this many buildings may bankrupt the town before people move in' : '');
  }

  private setConfirming(confirming: boolean): void {
    this.confirming = confirming;
    this.buildButton.textContent = confirming ? 'Replace the current city? Click again' : 'Build this town';
  }

  private async build(): Promise<void> {
    if (this.busy) return;
    if (!this.confirming) {
      this.setConfirming(true);
      return;
    }
    this.busy = true;
    this.buildButton.disabled = true;
    this.buildButton.textContent = 'Building…';
    const built = await this.onGenerate(this.settings);
    this.busy = false;
    this.buildButton.disabled = false;
    this.setConfirming(false);
    if (built) this.hide();
  }
}
