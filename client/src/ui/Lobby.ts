export interface WorldListItem {
  id: string;
  name: string;
  totalPopulation: number;
  cityCount: number;
}

export interface LobbyCallbacks {
  onEnterWorld: (playerName: string, worldId: string) => void | Promise<void>;
  fetchWorlds?: () => Promise<WorldListItem[]>;
  onCreateWorld?: (name: string) => Promise<{ worldId: string } | null>;
}

export class Lobby {
  private overlay: HTMLDivElement;
  private callbacks: LobbyCallbacks;
  private nameInput!: HTMLInputElement;
  private worldListEl!: HTMLDivElement;
  private createWorldInput!: HTMLInputElement;
  private enterBtn!: HTMLButtonElement;
  private createBtn!: HTMLButtonElement;
  private statusEl!: HTMLDivElement;
  private busy = false;
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
        <div class="lobby-status" role="status"></div>
      </div>
    `;
    parent.appendChild(this.overlay);

    this.nameInput = this.overlay.querySelector('#player-name') as HTMLInputElement;
    this.worldListEl = this.overlay.querySelector('#world-list') as HTMLDivElement;
    this.createWorldInput = this.overlay.querySelector('#create-world-name') as HTMLInputElement;

    this.statusEl = this.overlay.querySelector('.lobby-status') as HTMLDivElement;
    this.enterBtn = this.overlay.querySelector('#enter-world-btn') as HTMLButtonElement;
    this.enterBtn.addEventListener('click', () => this.enter());

    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.enter();
    });

    this.createBtn = this.overlay.querySelector('#create-world-btn') as HTMLButtonElement;
    this.createBtn.addEventListener('click', () => this.createWorld());

    this.createWorldInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.createWorld();
    });
  }

  /** Show progress or an error under the buttons. The server can take a few seconds. */
  private setStatus(text: string, isError = false): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('error', isError);
  }

  private setBusy(busy: boolean, enterLabel = 'Enter World', createLabel = 'Create World'): void {
    this.busy = busy;
    this.enterBtn.disabled = busy;
    this.createBtn.disabled = busy;
    this.enterBtn.textContent = enterLabel;
    this.createBtn.textContent = createLabel;
  }

  private async enter(): Promise<void> {
    if (this.busy) return;
    const playerName = this.nameInput.value.trim() || 'Player';
    this.setBusy(true, 'Entering…');
    this.setStatus('');
    try {
      await this.callbacks.onEnterWorld(playerName, this.selectedWorldId);
    } catch (e) {
      console.error('Failed to enter world:', e);
      this.setStatus('Could not enter the world. Is the server running?', true);
    } finally {
      this.setBusy(false);
    }
  }

  private async createWorld(): Promise<void> {
    if (this.busy || !this.callbacks.onCreateWorld) return;
    const name = this.createWorldInput.value.trim();
    if (!name) {
      this.setStatus('Type a name for the new world first.', true);
      this.createWorldInput.focus();
      return;
    }

    this.setBusy(true, 'Enter World', 'Creating…');
    this.setStatus(`Creating world "${name}"…`);
    try {
      const result = await this.callbacks.onCreateWorld(name);
      if (!result) {
        this.setStatus('The server could not create the world.', true);
        return;
      }
      this.createWorldInput.value = '';
      this.selectedWorldId = result.worldId;
      await this.refreshWorlds();
      this.setStatus(`World "${name}" created and selected. Press Enter World to start.`);
    } catch (e) {
      console.error('Failed to create world:', e);
      this.setStatus('Could not create the world. Is the server running?', true);
    } finally {
      this.setBusy(false);
    }
  }

  async refreshWorlds(): Promise<void> {
    if (!this.callbacks.fetchWorlds) return;

    try {
      const worlds = await this.callbacks.fetchWorlds();
      if (!Array.isArray(worlds)) throw new Error('Unexpected response');
      this.worldListEl.innerHTML = '';

      for (const world of worlds) {
        const item = document.createElement('div');
        item.className = 'lobby-world-item';
        if (world.id === this.selectedWorldId) {
          item.classList.add('selected');
        }
        item.dataset.worldId = world.id;

        const nameEl = document.createElement('span');
        nameEl.className = 'lobby-world-name';
        nameEl.textContent = world.name;
        const infoEl = document.createElement('span');
        infoEl.className = 'lobby-world-info';
        infoEl.textContent = `${world.cityCount} cities, ${world.totalPopulation} people`;
        item.append(nameEl, infoEl);

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
      // Keep the default world selectable, but say why the list is incomplete
      const info = this.worldListEl.querySelector('.lobby-world-info');
      if (info && info.textContent === 'Loading...') info.textContent = '';
      this.setStatus('Could not load the world list. You can still enter the default world.', true);
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
