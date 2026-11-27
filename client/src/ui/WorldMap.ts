import { EARTH_SITES, type WorldState, type SiteId } from '@cityzen/shared';
import { drawSiteMap } from '../world/SiteMap.js';

interface WorldMapCallbacks {
  playerId?: string;
  onClaimPlot(siteId: string, cityName: string): void;
  onEnterCity(cityId: string): void;
  onInvite?: () => void;
}

export class WorldMap {
  private overlay = document.createElement('div');
  private world?: WorldState;
  private selected?: SiteId;
  private sites: HTMLElement;
  private form: HTMLFormElement;
  private cityName: HTMLInputElement;
  private continent: HTMLSelectElement;
  private country: HTMLSelectElement;

  constructor(parent: HTMLElement, private callbacks: WorldMapCallbacks) {
    this.overlay.className = 'worldmap-overlay';
    this.overlay.style.display = 'none';
    this.overlay.innerHTML = `
      <section class="worldmap-panel earth-panel">
        <div class="worldmap-header-row">
          <h2>Earth</h2>
          <button type="button" class="worldmap-invite-btn" hidden>Invite Friends</button>
        </div>
        <p class="worldmap-subtitle">Choose a site to found your city or enter an existing city.</p>
        <div class="earth-filters">
          <label>Continent<select class="continent"></select></label>
          <label>Country<select class="country"></select></label>
        </div>
        <div class="earth-sites"></div>
        <form class="worldmap-claim-dialog" hidden>
          <input class="worldmap-city-name" aria-label="City name" placeholder="City name" maxlength="80" required />
          <button class="worldmap-claim-btn">Found city</button>
        </form>
        <div class="earth-legacy"></div>
        <small>3.2 km per side · Green: buildable · Blue: sea · Ochre: steep slope<br>
        Elevation: USGS and NOAA via <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">Mapzen Terrain Tiles</a></small>
      </section>`;
    parent.append(this.overlay);
    const inviteBtn = this.overlay.querySelector('.worldmap-invite-btn') as HTMLButtonElement;
    if (callbacks.onInvite) {
      inviteBtn.hidden = false;
      inviteBtn.onclick = () => callbacks.onInvite?.();
    }
    this.sites = this.overlay.querySelector('.earth-sites')!;
    this.form = this.overlay.querySelector('form')!;
    this.cityName = this.form.querySelector('input')!;
    this.continent = this.overlay.querySelector('.continent')!;
    this.country = this.overlay.querySelector('.country')!;
    for (const name of new Set(EARTH_SITES.map(site => site.continent))) this.continent.add(new Option(name, name));
    this.continent.onchange = () => this.loadCountries();
    this.country.onchange = () => { this.selected = undefined; this.render(); };
    this.loadCountries();
    this.form.onsubmit = event => {
      event.preventDefault();
      if (this.selected && this.cityName.value.trim()) this.callbacks.onClaimPlot(this.selected, this.cityName.value.trim());
    };
  }

  private loadCountries() {
    this.country.replaceChildren();
    const sites = EARTH_SITES.filter(site => site.continent === this.continent.value);
    for (const name of new Set(sites.map(site => site.country))) this.country.add(new Option(name, name));
    this.selected = undefined;
    this.render();
  }

  private formatCityBadge(city: NonNullable<WorldState['cities'][number]>): { label: string; kind: string } | null {
    if (city.online === undefined) return null;
    if (this.callbacks.playerId && city.ownerId === this.callbacks.playerId) {
      return { label: 'Yours · Local', kind: 'yours' };
    }
    if (city.online) {
      return { label: `Online · ${city.ownerName}`, kind: 'online' };
    }
    if (city.hasCachedSnapshot) {
      return { label: `Offline · Cached (${city.ownerName})`, kind: 'cached' };
    }
    return { label: `Offline · ${city.ownerName}`, kind: 'offline' };
  }

  private render() {
    this.sites.replaceChildren();
    for (const site of EARTH_SITES.filter(site => site.continent === this.continent.value && site.country === this.country.value)) {
      const city = this.world?.cities.find(city => city.siteId === site.id);
      if (city && this.selected === site.id) this.selected = undefined;
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = !this.world;
      button.setAttribute('aria-pressed', String(this.selected === site.id));
      const { canvas, min, max, buildable } = drawSiteMap(site.id);
      const info = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = site.name;
      const coordinates = document.createElement('span');
      coordinates.textContent = `${Math.abs(site.latitude).toFixed(3)}° ${site.latitude < 0 ? 'S' : 'N'} · ${Math.abs(site.longitude).toFixed(3)}° ${site.longitude < 0 ? 'W' : 'E'}`;
      const terrain = document.createElement('span');
      terrain.textContent = `${min}–${max} m · ${buildable}% buildable`;
      const action = document.createElement('b');
      if (city) {
        const isOfflineCached = city.online === false && city.hasCachedSnapshot;
        action.textContent = isOfflineCached ? `Tour ${city.name} (Read-only)` : `Enter ${city.name}`;
      } else {
        action.textContent = 'Available';
      }
      info.append(title, coordinates, terrain, action);
      if (city) {
        const badge = this.formatCityBadge(city);
        if (badge) {
          const pill = document.createElement('span');
          pill.className = `site-status-badge site-status-${badge.kind}`;
          pill.textContent = badge.label;
          info.append(pill);
        }
      }
      button.append(canvas, info);
      button.onclick = () => {
        if (city) return this.callbacks.onEnterCity(city.cityId);
        this.selected = site.id;
        this.render();
        this.cityName.focus();
      };
      this.sites.append(button);
    }
    this.form.hidden = !this.selected;
    const legacy = this.overlay.querySelector('.earth-legacy')!;
    legacy.replaceChildren();
    for (const city of this.world?.cities.filter(city => !city.siteId) ?? []) {
      const button = document.createElement('button');
      const badge = this.formatCityBadge(city);
      button.textContent = badge ? `Enter ${city.name} (${badge.label})` : `Enter ${city.name} (original city)`;
      button.onclick = () => this.callbacks.onEnterCity(city.cityId);
      legacy.append(button);
    }
  }

  updateWorld(world: WorldState) { this.world = world; this.render(); }
  show() { this.overlay.style.display = 'flex'; }
  hide() {
    this.overlay.style.display = 'none';
    this.selected = undefined;
    this.cityName.value = '';
    this.render();
  }
  isVisible() { return this.overlay.style.display !== 'none'; }
}
