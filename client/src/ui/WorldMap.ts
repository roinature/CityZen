import type { WorldState, WorldCityEntry, WorldPosition, EdgeDirection } from '@cityzen/shared';
import { WORLD_MAP_SIZE, findMatchingConnections, getNeighborDirection } from '@cityzen/shared';

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
  private claimDialog: HTMLFormElement;
  private nameInput: HTMLInputElement;

  constructor(parent: HTMLElement, callbacks: WorldMapCallbacks) {
    this.callbacks = callbacks;

    this.overlay = document.createElement('div');
    this.overlay.className = 'worldmap-overlay';
    this.overlay.style.display = 'none';
    this.overlay.innerHTML = `
      <div class="worldmap-panel">
        <h2>World Map</h2>
        <p class="worldmap-subtitle">Select an empty plot to start a city, or select an existing city to join it.</p>
        <div class="worldmap-grid"></div>
        <form class="worldmap-claim-dialog" hidden>
          <input type="text" class="worldmap-city-name" aria-label="City name" placeholder="City name" value="New City" />
          <div class="worldmap-claim-buttons">
            <button type="submit" class="worldmap-claim-btn">Claim Plot</button>
            <button type="button" class="worldmap-cancel-btn">Cancel</button>
          </div>
        </form>
      </div>
    `;
    parent.appendChild(this.overlay);

    this.gridContainer = this.overlay.querySelector('.worldmap-grid')!;
    this.claimDialog = this.overlay.querySelector('.worldmap-claim-dialog')!;
    this.nameInput = this.overlay.querySelector('.worldmap-city-name')!;

    this.claimDialog.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!this.selectedPlot) return;
      const cityName = this.nameInput.value.trim() || 'New City';
      this.callbacks.onClaimPlot(this.selectedPlot, cityName);
      this.hideClaimDialog();
    });

    this.overlay.querySelector('.worldmap-cancel-btn')!.addEventListener('click', () => {
      const plot = this.gridContainer.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      this.hideClaimDialog();
      plot?.focus();
    });

    this.buildGrid();
  }

  private buildGrid(): void {
    this.gridContainer.innerHTML = '';
    for (let wz = 0; wz < WORLD_MAP_SIZE; wz++) {
      for (let wx = 0; wx < WORLD_MAP_SIZE; wx++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'worldmap-cell worldmap-cell-empty';
        cell.dataset.wx = String(wx);
        cell.dataset.wz = String(wz);
        cell.setAttribute('aria-label', `Empty plot ${wx + 1}, ${wz + 1}`);
        cell.setAttribute('aria-pressed', 'false');
        cell.addEventListener('click', (event) => {
          const touch = event.pointerType === 'touch' ||
            (!event.pointerType && event.detail > 0 && matchMedia('(pointer: coarse)').matches);
          this.onCellClick(wx, wz, touch);
        });
        this.gridContainer.appendChild(cell);
      }
    }
  }

  private onCellClick(wx: number, wz: number, touch: boolean): void {
    const city = this.world?.cities.find(c => c.position.wx === wx && c.position.wz === wz);
    if (city) {
      // Enter existing city
      this.callbacks.onEnterCity(city.cityId);
    } else {
      // Select empty plot for claiming
      this.selectedPlot = { wx, wz };
      this.showClaimDialog(touch);
    }
  }

  private showClaimDialog(touch: boolean): void {
    this.claimDialog.hidden = false;
    this.nameInput.value = 'New City';
    this.updatePlotSelection();
    if (touch) {
      this.claimDialog.scrollIntoView({ block: 'nearest' });
    } else {
      this.nameInput.focus();
      this.nameInput.select();
    }
  }

  private hideClaimDialog(): void {
    this.claimDialog.hidden = true;
    this.selectedPlot = null;
    this.updatePlotSelection();
  }

  private updatePlotSelection(): void {
    this.gridContainer.querySelectorAll('.worldmap-cell-empty').forEach(cell => {
      const plot = cell as HTMLButtonElement;
      const selected = this.selectedPlot?.wx === Number(plot.dataset.wx) &&
        this.selectedPlot.wz === Number(plot.dataset.wz);
      plot.setAttribute('aria-pressed', String(selected));
    });
  }

  updateWorld(world: WorldState): void {
    this.world = world;
    this.renderCells();
  }

  private renderCells(): void {
    if (!this.world) return;

    const cells = this.gridContainer.querySelectorAll('.worldmap-cell');
    cells.forEach(cell => {
      const el = cell as HTMLButtonElement;
      const wx = parseInt(el.dataset.wx!, 10);
      const wz = parseInt(el.dataset.wz!, 10);
      const city = this.world!.cities.find(c => c.position.wx === wx && c.position.wz === wz);

      if (city) {
        el.className = 'worldmap-cell worldmap-cell-occupied';
        el.removeAttribute('aria-pressed');
        el.setAttribute('aria-label', `Enter ${city.name}, owned by ${city.ownerName}, population ${city.population}`);

        // Check for edge connections and render indicators
        const connectionIndicators = this.getConnectionIndicators(city);

        el.innerHTML = connectionIndicators;
        const label = document.createElement('span');
        label.className = 'worldmap-city-label';
        label.textContent = city.name;
        const owner = document.createElement('span');
        owner.className = 'worldmap-city-owner';
        owner.textContent = city.ownerName;
        const population = document.createElement('span');
        population.className = 'worldmap-city-pop';
        population.textContent = `Pop: ${city.population}`;
        el.append(label, owner, population);
      } else {
        el.className = 'worldmap-cell worldmap-cell-empty';
        el.setAttribute('aria-label', `Empty plot ${wx + 1}, ${wz + 1}`);
        el.innerHTML = '';
      }
    });
    this.updatePlotSelection();
  }

  /**
   * Generate HTML for connection indicators on each edge of a city cell.
   * Shows solid indicators for matched connections, dashed for unmatched roads.
   */
  private getConnectionIndicators(city: WorldCityEntry): string {
    if (!this.world || !city.edgeConnections?.length) return '';

    const indicators: string[] = [];
    const directions: EdgeDirection[] = ['north', 'south', 'east', 'west'];

    for (const direction of directions) {
      const hasRoadAtEdge = city.edgeConnections.some(e => e.direction === direction);
      if (!hasRoadAtEdge) continue;

      // Check if there's a neighbor city with matching connection
      const neighbor = this.findNeighborCity(city.position, direction);
      const isConnected = neighbor && findMatchingConnections(city, neighbor) !== null;

      const indicatorClass = isConnected
        ? `worldmap-connection worldmap-connection-${direction} worldmap-connection-matched`
        : `worldmap-connection worldmap-connection-${direction} worldmap-connection-unmatched`;

      indicators.push(`<span class="${indicatorClass}" aria-hidden="true"></span>`);
    }

    return indicators.join('');
  }

  /**
   * Find the neighboring city in a given direction.
   */
  private findNeighborCity(position: WorldPosition, direction: EdgeDirection): WorldCityEntry | null {
    if (!this.world) return null;

    let targetWx = position.wx;
    let targetWz = position.wz;

    switch (direction) {
      case 'north': targetWz -= 1; break;
      case 'south': targetWz += 1; break;
      case 'east': targetWx += 1; break;
      case 'west': targetWx -= 1; break;
    }

    return this.world.cities.find(c =>
      c.position.wx === targetWx && c.position.wz === targetWz
    ) || null;
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

