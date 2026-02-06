import type { CityListItem } from '@cityzen/shared';

export interface LobbyCallbacks {
  onCreate: (cityName: string, playerName: string) => void;
  onJoin: (cityId: string, playerName: string) => void;
}

export class Lobby {
  private overlay: HTMLDivElement;
  private cityListEl: HTMLDivElement;
  private callbacks: LobbyCallbacks;

  constructor(parent: HTMLElement, callbacks: LobbyCallbacks) {
    this.callbacks = callbacks;
    this.overlay = document.createElement('div');
    this.overlay.className = 'lobby-overlay';
    this.overlay.innerHTML = `
      <div class="lobby-panel">
        <h1>CityZen</h1>
        <input type="text" id="player-name" placeholder="Your name" value="Player" />
        <input type="text" id="city-name" placeholder="City name" value="New City" />
        <button id="create-btn">Create New City</button>
        <div class="city-list">
          <h3>Or join an existing city:</h3>
          <div id="city-list-items"></div>
        </div>
      </div>
    `;
    parent.appendChild(this.overlay);

    this.cityListEl = this.overlay.querySelector('#city-list-items')!;

    this.overlay.querySelector('#create-btn')!.addEventListener('click', () => {
      const playerName = (this.overlay.querySelector('#player-name') as HTMLInputElement).value || 'Player';
      const cityName = (this.overlay.querySelector('#city-name') as HTMLInputElement).value || 'New City';
      this.callbacks.onCreate(cityName, playerName);
    });
  }

  updateCityList(cities: CityListItem[]): void {
    this.cityListEl.innerHTML = '';
    if (cities.length === 0) {
      this.cityListEl.innerHTML = '<div style="opacity:0.5;font-size:12px;padding:8px">No cities yet</div>';
      return;
    }

    for (const city of cities) {
      const item = document.createElement('div');
      item.className = 'city-list-item';
      item.innerHTML = `
        <div class="city-info">
          <span class="city-name">${city.name}</span>
          <span class="city-stats">${city.buildingCount} buildings, ${city.playerCount} online</span>
        </div>
      `;
      item.addEventListener('click', () => {
        const playerName = (this.overlay.querySelector('#player-name') as HTMLInputElement).value || 'Player';
        this.callbacks.onJoin(city.id, playerName);
      });
      this.cityListEl.appendChild(item);
    }
  }

  show(): void {
    this.overlay.style.display = 'flex';
  }

  hide(): void {
    this.overlay.style.display = 'none';
  }
}
