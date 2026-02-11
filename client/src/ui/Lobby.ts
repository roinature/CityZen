export interface WorldListItem {
  id: string;
  name: string;
  totalPopulation: number;
  cityCount: number;
}

export interface LobbyCallbacks {
  onEnterWorld: (playerName: string, worldId: string) => void;
  fetchWorlds?: () => Promise<WorldListItem[]>;
  onCreateWorld?: (name: string) => Promise<{ worldId: string } | null>;
}

export class Lobby {
  private overlay: HTMLDivElement;
  private callbacks: LobbyCallbacks;
  private nameInput!: HTMLInputElement;
  private worldListEl!: HTMLDivElement;
  private createWorldInput!: HTMLInputElement;
  private selectedWorldId: string = 'default';

  constructor(parent: HTMLElement, callbacks: LobbyCallbacks) {
    this.callbacks = callbacks;
    this.overlay = document.createElement('div');
    this.overlay.className = 'lobby-overlay';
    this.overlay.innerHTML = `
      <div class="lobby-panel">
        <h1>CityZen</h1>
        <p style="text-align:center;opacity:0.6;margin-bottom:20px;font-size:13px;">Build your city in a shared world</p>
        <input type="text" id="player-name" placeholder="Your name" value="Player" />
        <div class="lobby-section">
          <label class="lobby-label">Select World</label>
          <div id="world-list" class="lobby-world-list">
            <div class="lobby-world-item selected" data-world-id="default">
              <span class="lobby-world-name">Default World</span>
              <span class="lobby-world-info">Loading...</span>
            </div>
          </div>
        </div>
        <div class="lobby-section lobby-create-world">
          <input type="text" id="create-world-name" placeholder="New world name" />
          <button id="create-world-btn" class="lobby-btn-secondary">Create World</button>
        </div>
        <button id="enter-world-btn">Enter World</button>
      </div>
    `;
    parent.appendChild(this.overlay);

    this.nameInput = this.overlay.querySelector('#player-name') as HTMLInputElement;
    this.worldListEl = this.overlay.querySelector('#world-list') as HTMLDivElement;
    this.createWorldInput = this.overlay.querySelector('#create-world-name') as HTMLInputElement;

    const enterBtn = this.overlay.querySelector('#enter-world-btn')!;
    enterBtn.addEventListener('click', () => this.enter());

    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.enter();
    });

    const createBtn = this.overlay.querySelector('#create-world-btn')!;
    createBtn.addEventListener('click', () => this.createWorld());

    this.createWorldInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.createWorld();
    });
  }

  private enter(): void {
    const playerName = this.nameInput.value.trim() || 'Player';
    this.callbacks.onEnterWorld(playerName, this.selectedWorldId);
  }

  private async createWorld(): Promise<void> {
    const name = this.createWorldInput.value.trim();
    if (!name || !this.callbacks.onCreateWorld) return;

    const result = await this.callbacks.onCreateWorld(name);
    if (result) {
      this.createWorldInput.value = '';
      this.selectedWorldId = result.worldId;
      await this.refreshWorlds();
    }
  }

  async refreshWorlds(): Promise<void> {
    if (!this.callbacks.fetchWorlds) return;

    try {
      const worlds = await this.callbacks.fetchWorlds();
      this.worldListEl.innerHTML = '';

      for (const world of worlds) {
        const item = document.createElement('div');
        item.className = 'lobby-world-item';
        if (world.id === this.selectedWorldId) {
          item.classList.add('selected');
        }
        item.dataset.worldId = world.id;
        item.innerHTML = `
          <span class="lobby-world-name">${world.name}</span>
          <span class="lobby-world-info">${world.cityCount} cities, ${world.totalPopulation} people</span>
        `;
        item.addEventListener('click', () => {
          this.selectedWorldId = world.id;
          this.worldListEl.querySelectorAll('.lobby-world-item').forEach(el =>
            el.classList.toggle('selected', el === item)
          );
        });
        this.worldListEl.appendChild(item);
      }
    } catch (e) {
      console.error('Failed to fetch worlds:', e);
    }
  }

  show(): void {
    this.overlay.style.display = 'flex';
    this.refreshWorlds();
  }

  hide(): void {
    this.overlay.style.display = 'none';
  }

  isVisible(): boolean {
    return this.overlay.style.display !== 'none';
  }
}
