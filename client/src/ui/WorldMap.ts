import { EARTH_SITES, distanceKm, type EarthSite, type WorldState, type SiteId } from '@cityzen/shared';
import { drawSiteMap } from '../world/SiteMap.js';
import { estimateUserLocation, hasGeolocationPermission, requestPreciseLocation, type UserLocation } from '../world/userLocation.js';
import { EarthGlobe, type PinState } from './EarthGlobe.js';

interface WorldMapCallbacks {
  playerId?: string;
  onClaimPlot(siteId: string, cityName: string): void;
  onEnterCity(cityId: string): void;
  onInvite?: () => void;
}

type CityEntry = NonNullable<WorldState['cities'][number]>;

const ALL = '';
const terrainStats = new Map<SiteId, ReturnType<typeof drawSiteMap>>();
function siteStats(id: SiteId) {
  let stats = terrainStats.get(id);
  if (!stats) terrainStats.set(id, stats = drawSiteMap(id));
  return stats;
}

function centroid(sites: readonly EarthSite[]) {
  // Average unit vectors so groups straddling the antimeridian still centre correctly.
  let x = 0, y = 0, z = 0;
  for (const site of sites) {
    const lat = site.latitude * Math.PI / 180, lon = site.longitude * Math.PI / 180;
    x += Math.cos(lat) * Math.cos(lon); y += Math.cos(lat) * Math.sin(lon); z += Math.sin(lat);
  }
  const spread = Math.max(...sites.map(a => Math.max(...sites.map(b => distanceKm(a.latitude, a.longitude, b.latitude, b.longitude)))));
  return {
    lat: Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI,
    lon: Math.atan2(y, x) * 180 / Math.PI,
    dist: Math.min(4.2, 1.7 + spread / 3500),
  };
}

function formatDistance(km: number) {
  return km < 10 ? 'right by you' : `${Math.round(km).toLocaleString()} km away`;
}

export class WorldMap {
  private overlay = document.createElement('div');
  private world?: WorldState;
  private selected?: SiteId;
  private sites: HTMLElement;
  private suggestions: HTMLElement;
  private form: HTMLFormElement;
  private cityName: HTMLInputElement;
  private continent: HTMLSelectElement;
  private country: HTMLSelectElement;
  private locateBtn: HTMLButtonElement;
  private locationNote: HTMLElement;
  private globeHost: HTMLElement;
  private globe?: EarthGlobe;
  private location: UserLocation = estimateUserLocation();
  /** Once the player spins the globe or picks a filter we stop re-framing on their location. */
  private userSteered = false;
  private introPlayed = false;

  constructor(parent: HTMLElement, private callbacks: WorldMapCallbacks) {
    this.overlay.className = 'worldmap-overlay';
    this.overlay.style.display = 'none';
    this.overlay.innerHTML = `
      <section class="worldmap-panel earth-panel">
        <div class="worldmap-header-row">
          <h2>Earth</h2>
          <button type="button" class="worldmap-invite-btn" hidden>Invite Friends</button>
        </div>
        <p class="worldmap-subtitle">Spin the globe and pick a site to found your city, or enter an existing one.</p>
        <div class="earth-layout">
          <div class="earth-globe">
            <button type="button" class="earth-locate-btn" title="Centre the globe on your location">◎ Near me</button>
            <div class="earth-legend"><i class="pin-available"></i>Open <i class="pin-claimed"></i>Claimed <i class="pin-yours"></i>Yours <i class="pin-you"></i>You</div>
          </div>
          <div class="earth-side">
            <h3>Suggested for you</h3>
            <p class="earth-location-note"></p>
            <div class="earth-suggestions"></div>
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
          </div>
        </div>
        <small>${EARTH_SITES.length} sites · 3.2 km per side · Green: buildable · Blue: sea · Ochre: steep slope<br>
        Elevation: USGS and NOAA via <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">Mapzen Terrain Tiles</a></small>
      </section>`;
    parent.append(this.overlay);
    const inviteBtn = this.overlay.querySelector('.worldmap-invite-btn') as HTMLButtonElement;
    if (callbacks.onInvite) {
      inviteBtn.hidden = false;
      inviteBtn.onclick = () => callbacks.onInvite?.();
    }
    this.globeHost = this.overlay.querySelector('.earth-globe')!;
    this.sites = this.overlay.querySelector('.earth-sites')!;
    this.suggestions = this.overlay.querySelector('.earth-suggestions')!;
    this.locationNote = this.overlay.querySelector('.earth-location-note')!;
    this.locateBtn = this.overlay.querySelector('.earth-locate-btn')!;
    this.form = this.overlay.querySelector('form')!;
    this.cityName = this.form.querySelector('input')!;
    this.continent = this.overlay.querySelector('.continent')!;
    this.country = this.overlay.querySelector('.country')!;

    this.continent.add(new Option('All continents', ALL));
    for (const name of new Set(EARTH_SITES.map(site => site.continent))) this.continent.add(new Option(name, name));
    this.continent.onchange = () => {
      this.userSteered = true;
      this.loadCountries();
      this.frameFilter();
    };
    this.country.onchange = () => {
      this.userSteered = true;
      this.selected = undefined;
      this.render();
      this.frameFilter();
    };
    this.locateBtn.onclick = () => void this.locate(true);
    this.form.onsubmit = event => {
      event.preventDefault();
      if (this.selected && this.cityName.value.trim()) this.callbacks.onClaimPlot(this.selected, this.cityName.value.trim());
    };
    this.resetFiltersToLocation();
  }

  // ---- Location ------------------------------------------------------------

  private sitesByDistance(sites: readonly EarthSite[] = EARTH_SITES) {
    const { latitude, longitude } = this.location;
    return sites
      .map(site => ({ site, km: distanceKm(latitude, longitude, site.latitude, site.longitude) }))
      .sort((a, b) => a.km - b.km);
  }

  private resetFiltersToLocation() {
    const nearest = this.sitesByDistance()[0].site;
    this.continent.value = nearest.continent;
    this.loadCountries(nearest.country);
  }

  private async locate(userAsked: boolean) {
    if (!userAsked && !(await hasGeolocationPermission())) return;
    this.locateBtn.disabled = true;
    this.locateBtn.textContent = '◎ Locating…';
    try {
      this.location = await requestPreciseLocation();
      if (userAsked) this.userSteered = false;
      if (!this.userSteered) {
        this.selected = undefined;
        this.resetFiltersToLocation();
        this.globe?.flyTo(this.location.latitude, this.location.longitude, 3.1);
      }
      this.globe?.setUserLocation(this.location.latitude, this.location.longitude);
      this.render();
    } catch (error) {
      if (userAsked) this.locationNote.textContent = `Couldn't get your location (${(error as Error).message}). Using your time zone instead.`;
      if (userAsked) this.globe?.flyTo(this.location.latitude, this.location.longitude, 3.1);
    } finally {
      this.locateBtn.disabled = false;
      this.locateBtn.textContent = '◎ Near me';
    }
  }

  // ---- Globe ---------------------------------------------------------------

  private ensureGlobe() {
    if (this.globe) return this.globe;
    try {
      this.globe = new EarthGlobe(this.globeHost);
    } catch (error) {
      console.warn('Globe unavailable, falling back to the site list', error);
      this.globeHost.hidden = true;
      return undefined;
    }
    this.globe.onPick = id => this.selectSite(id as SiteId, { fromGlobe: true });
    this.globe.onInteract = () => { this.userSteered = true; };
    this.globe.setUserLocation(this.location.latitude, this.location.longitude);
    this.syncGlobe();
    return this.globe;
  }

  private pinState(site: EarthSite): PinState {
    const city = this.cityAt(site.id);
    if (!city) return 'available';
    return this.callbacks.playerId && city.ownerId === this.callbacks.playerId ? 'yours' : 'claimed';
  }

  private syncGlobe() {
    if (!this.globe) return;
    this.globe.setPins(EARTH_SITES.map(site => {
      const city = this.cityAt(site.id);
      return {
        id: site.id,
        label: city ? `${city.name} · ${site.name}` : `${site.name}, ${site.country}`,
        latitude: site.latitude,
        longitude: site.longitude,
        state: this.pinState(site),
      };
    }));
    this.globe.setSelected(this.selected);
  }

  private frameFilter() {
    const sites = this.filteredSites();
    if (!this.globe || !sites.length) return;
    const { lat, lon, dist } = this.continent.value === ALL ? { ...centroid(EARTH_SITES), dist: 4.2 } : centroid(sites);
    this.globe.flyTo(lat, lon, dist);
  }

  // ---- Selection & lists ---------------------------------------------------

  private cityAt(siteId: string) {
    return this.world?.cities.find(city => city.siteId === siteId);
  }

  private selectSite(id: SiteId, { fromGlobe = false } = {}) {
    const site = EARTH_SITES.find(s => s.id === id);
    if (!site) return;
    this.userSteered = true;
    if (this.continent.value !== ALL && this.continent.value !== site.continent) {
      this.continent.value = site.continent;
      this.loadCountries(site.country);
    } else if (this.country.value !== ALL && this.country.value !== site.country) {
      this.country.value = site.country;
    }
    this.selected = this.cityAt(id) ? undefined : id;
    this.globe?.setSelected(id);
    this.globe?.flyTo(site.latitude, site.longitude, fromGlobe ? undefined : 2.3);
    this.render(id);
    if (this.selected) this.cityName.focus({ preventScroll: true });
  }

  private filteredSites() {
    return EARTH_SITES.filter(site =>
      (this.continent.value === ALL || site.continent === this.continent.value) &&
      (this.country.value === ALL || site.country === this.country.value));
  }

  private loadCountries(preferred?: string) {
    this.country.replaceChildren(new Option('All countries', ALL));
    const sites = EARTH_SITES.filter(site => this.continent.value === ALL || site.continent === this.continent.value);
    const countries = [...new Set(sites.map(site => site.country))].sort();
    for (const name of countries) this.country.add(new Option(name, name));
    this.country.value = preferred && countries.includes(preferred) ? preferred : ALL;
    this.selected = undefined;
    this.render();
  }

  private formatCityBadge(city: CityEntry): { label: string; kind: string } | null {
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

  private siteCard(site: EarthSite, km: number, compact = false) {
    const city = this.cityAt(site.id);
    if (city && this.selected === site.id) this.selected = undefined;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.siteId = site.id;
    button.disabled = !this.world;
    button.setAttribute('aria-pressed', String(this.selected === site.id));
    const { canvas: source, min, max, buildable } = siteStats(site.id);
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext('2d')!.drawImage(source, 0, 0);
    const info = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = site.name;
    const place = document.createElement('span');
    place.textContent = `${site.country} · ${formatDistance(km)}`;
    const terrain = document.createElement('span');
    terrain.textContent = compact
      ? `${buildable}% buildable${site.coast ? ' · coastal' : ''}`
      : `${Math.abs(site.latitude).toFixed(3)}° ${site.latitude < 0 ? 'S' : 'N'} · ${Math.abs(site.longitude).toFixed(3)}° ${site.longitude < 0 ? 'W' : 'E'} · ${min}–${max} m · ${buildable}% buildable`;
    const action = document.createElement('b');
    if (city) {
      const isOfflineCached = city.online === false && city.hasCachedSnapshot;
      action.textContent = isOfflineCached ? `Tour ${city.name} (Read-only)` : `Enter ${city.name}`;
    } else {
      action.textContent = this.selected === site.id ? 'Name your city below' : 'Available';
    }
    info.append(title, place, terrain, action);
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
      this.selectSite(site.id);
    };
    return button;
  }

  private renderSuggestions() {
    this.suggestions.replaceChildren();
    const open = this.sitesByDistance().filter(({ site }) => !this.cityAt(site.id));
    const picks = open.slice(0, 3);
    // Fill the last slot with a roomy, flat site when the nearby picks are cramped, else the next closest.
    const roomy = picks.every(p => siteStats(p.site.id).buildable < 95)
      ? open.slice(3).find(({ site }) => siteStats(site.id).buildable >= 95)
      : undefined;
    const fourth = roomy ?? open[3];
    if (fourth) picks.push(fourth);
    for (const { site, km } of picks) this.suggestions.append(this.siteCard(site, km, true));
    if (!picks.length) this.suggestions.textContent = 'Every site is taken. Visit a neighbour below!';
    this.locationNote.textContent = this.location.source === 'precise'
      ? 'Closest open sites to you.'
      : 'Closest open sites to your time zone. Tap ◎ Near me for a precise match.';
  }

  private render(scrollTo?: string) {
    this.renderSuggestions();
    this.sites.replaceChildren();
    for (const { site, km } of this.sitesByDistance(this.filteredSites())) this.sites.append(this.siteCard(site, km));
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
    this.syncGlobe();
    if (scrollTo) this.sites.querySelector(`[data-site-id="${scrollTo}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  updateWorld(world: WorldState) { this.world = world; this.render(); }

  show() {
    this.overlay.style.display = 'flex';
    const globe = this.ensureGlobe();
    if (globe) {
      globe.start();
      if (!this.introPlayed) {
        // Open on the far side of the planet, then sweep around to the player.
        this.introPlayed = true;
        globe.setView(15, this.location.longitude + 150, 5.5);
        globe.flyTo(this.location.latitude, this.location.longitude, 3.1, 2200);
      }
    }
    void this.locate(false);
  }

  hide() {
    this.overlay.style.display = 'none';
    this.globe?.stop();
    this.selected = undefined;
    this.cityName.value = '';
    this.render();
  }

  isVisible() { return this.overlay.style.display !== 'none'; }
}
