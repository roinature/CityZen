import type { WorldState, WorldCityEntry, WorldPosition } from '@cityzen/shared';
import { WORLD_MAP_SIZE } from '@cityzen/shared';

export interface WorldMapCallbacks {
  onClaimPlot: (position: WorldPosition, cityName: string) => void;
  onEnterCity: (cityId: string) => void;
}

export class WorldMap {
  private overlay: HTMLDivElement;
  private gridContainer: HTMLDivElement;
  private callbacks: WorldMapCallbacks;
  private world: WorldState | null = null;
  private selectedPlot: WorldPosition | null = null;
  private claimDialog: HTMLDivElement;

  constructor(parent: HTMLElement, callbacks: WorldMapCallbacks) {
    this.callbacks = callbacks;

    this.overlay = document.createElement('div');
    this.overlay.className = 'worldmap-overlay';
    this.overlay.style.display = 'none';
    this.overlay.innerHTML = `
      <div class="worldmap-panel">
        <h2>World Map</h2>
        <p class="worldmap-subtitle">Click an empty plot to start your city, or click an existing city to join it.</p>
        <div class="worldmap-grid"></div>
        <div class="worldmap-claim-dialog" style="display:none">
          <input type="text" class="worldmap-city-name" placeholder="City name" value="New City" />
          <div class="worldmap-claim-buttons">
            <button class="worldmap-claim-btn">Claim Plot</button>
            <button class="worldmap-cancel-btn">Cancel</button>
          </div>
        </div>
      </div>
    `;
    parent.appendChild(this.overlay);

    this.gridContainer = this.overlay.querySelector('.worldmap-grid')!;
    this.claimDialog = this.overlay.querySelector('.worldmap-claim-dialog')!;

    this.overlay.querySelector('.worldmap-claim-btn')!.addEventListener('click', () => {
      if (!this.selectedPlot) return;
      const nameInput = this.overlay.querySelector('.worldmap-city-name') as HTMLInputElement;
      const cityName = nameInput.value.trim() || 'New City';
      this.callbacks.onClaimPlot(this.selectedPlot, cityName);
      this.hideClaimDialog();
    });

    this.overlay.querySelector('.worldmap-cancel-btn')!.addEventListener('click', () => {
      this.hideClaimDialog();
    });

    this.buildGrid();
  }

  private buildGrid(): void {
    this.gridContainer.innerHTML = '';
    for (let wz = 0; wz < WORLD_MAP_SIZE; wz++) {
      for (let wx = 0; wx < WORLD_MAP_SIZE; wx++) {
        const cell = document.createElement('div');
        cell.className = 'worldmap-cell worldmap-cell-empty';
        cell.dataset.wx = String(wx);
        cell.dataset.wz = String(wz);
        cell.addEventListener('click', () => this.onCellClick(wx, wz));
        this.gridContainer.appendChild(cell);
      }
    }
  }

  private onCellClick(wx: number, wz: number): void {
    const city = this.world?.cities.find(c => c.position.wx === wx && c.position.wz === wz);
    if (city) {
      // Enter existing city
      this.callbacks.onEnterCity(city.cityId);
    } else {
      // Select empty plot for claiming
      this.selectedPlot = { wx, wz };
      this.showClaimDialog();
    }
  }

  private showClaimDialog(): void {
    this.claimDialog.style.display = 'flex';
    const nameInput = this.overlay.querySelector('.worldmap-city-name') as HTMLInputElement;
    nameInput.value = 'New City';
    nameInput.focus();
    nameInput.select();
  }

  private hideClaimDialog(): void {
    this.claimDialog.style.display = 'none';
    this.selectedPlot = null;
  }

  updateWorld(world: WorldState): void {
    this.world = world;
    this.renderCells();
  }

  private renderCells(): void {
    if (!this.world) return;

    const cells = this.gridContainer.querySelectorAll('.worldmap-cell');
    cells.forEach(cell => {
      const el = cell as HTMLDivElement;
      const wx = parseInt(el.dataset.wx!, 10);
      const wz = parseInt(el.dataset.wz!, 10);
      const city = this.world!.cities.find(c => c.position.wx === wx && c.position.wz === wz);

      if (city) {
        el.className = 'worldmap-cell worldmap-cell-occupied';
        el.innerHTML = `
          <div class="worldmap-city-label">${city.name}</div>
          <div class="worldmap-city-owner">${city.ownerName}</div>
          <div class="worldmap-city-pop">Pop: ${city.population}</div>
        `;
      } else {
        el.className = 'worldmap-cell worldmap-cell-empty';
        el.innerHTML = '';
      }
    });
  }

  show(): void {
    this.overlay.style.display = 'flex';
  }

  hide(): void {
    this.overlay.style.display = 'none';
    this.hideClaimDialog();
  }

  isVisible(): boolean {
    return this.overlay.style.display !== 'none';
  }
}
