import { joinRoom, type Room, type RequestAction, type MessageAction } from 'trystero';
import {
  S2C,
  type BuildingDemolishedPayload,
  type BuildingPlacedPayload,
  type BuildingsPlacedPayload,
  type BuildingType,
  type CityListItem,
  type CityStatePayload,
  type MigrationEventPayload,
  type PlaceBuildingsPayload,
  type Player,
  type PopulationUpdatePayload,
  type Position,
  type ResourcesUpdatePayload,
  type RoadOrientation,
  type TownSettings,
  type WorldState,
  type WorldStatePayload,
  type WorldTickPayload,
  type ZoneDensity,
  type ZoneGrowthPayload,
} from '@cityzen/shared';
import type { GameCallbacks } from '../GameClient.js';
import type { CityConnection } from '../CityConnection.js';
import { HostCity, type CommandResult, type P2PSnapshot } from './HostCity.js';

const APP_ID = 'cityzen-p2p-v1';
/** How long a new peer listens for an existing host before hosting itself. */
const DISCOVERY_MS = 4_000;
/** How often the host copies the whole game to guests, so any of them can take over. */
const SNAPSHOT_INTERVAL_MS = 5_000;
const COMMAND_TIMEOUT_MS = 15_000;
const SAVE_PREFIX = 'cityzen_p2p_';

interface SnapshotMessage {
  hostSince: number;
  snapshot: P2PSnapshot;
}

interface CommandMessage {
  op: string;
  args: Record<string, unknown>;
  playerId: string;
}

interface JoinedCity {
  cityId: string;
  playerName: string;
  playerId: string;
}

function loadLocal(roomId: string): P2PSnapshot | null {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + roomId);
    const parsed = raw ? JSON.parse(raw) as P2PSnapshot : null;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function saveLocal(roomId: string, snapshot: P2PSnapshot): void {
  try {
    localStorage.setItem(SAVE_PREFIX + roomId, JSON.stringify(snapshot));
  } catch (err) {
    console.warn('Could not save the game in this browser:', err);
  }
}

/**
 * Plays a city with friends over WebRTC, without a game server.
 *
 * Peers find each other through Trystero's public Nostr relays (only connection
 * setup goes through them, encrypted with the room id). One browser is the
 * host: it runs the simulation with the same shared rules as the server, and
 * the others send it commands. The host copies the whole game to every guest
 * every few seconds, so when it leaves the guest with the lowest peer id takes
 * over from that copy. Every peer also keeps the latest copy in localStorage,
 * which is how a city survives when everyone has gone.
 */
export class P2PGameClient implements CityConnection {
  private room!: Room;
  private selfId = '';
  private hostId: string | null = null;
  private host: HostCity | null = null;
  private hostSince = 0;
  private replica: P2PSnapshot | null;
  private joined: JoinedCity | null = null;
  private events!: MessageAction<string>;
  private snapshots!: MessageAction<string>;
  private commands!: RequestAction<string, string>;
  private hostWaiters: Array<() => void> = [];
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private electionTimer: ReturnType<typeof setTimeout> | null = null;
  /** Host only: which player each connected guest joined as. */
  private peerPlayers = new Map<string, string>();

  static async create(roomId: string, callbacks: GameCallbacks): Promise<P2PGameClient> {
    const client = new P2PGameClient(roomId, callbacks);
    await client.init();
    return client;
  }

  private constructor(readonly roomId: string, private readonly callbacks: GameCallbacks) {
    this.replica = loadLocal(roomId);
  }

  get isHost(): boolean {
    return this.host !== null;
  }

  get peerCount(): number {
    return Object.keys(this.room.getPeers()).length;
  }

  private async init(): Promise<void> {
    this.room = joinRoom({ appId: APP_ID, password: this.roomId }, this.roomId);
    this.events = this.room.makeAction<string>('evt');
    this.snapshots = this.room.makeAction<string>('snap');
    this.commands = this.room.makeAction<string, string>('cmd', { kind: 'request' });

    this.events.onMessage((wire, { peerId }) => {
      if (peerId !== this.hostId) return;
      const { event, data } = JSON.parse(wire) as { event: string; data: any };
      this.dispatch(event, data);
    });
    this.snapshots.onMessage((wire, { peerId }) => {
      this.onSnapshot(JSON.parse(wire) as SnapshotMessage, peerId);
    });
    this.commands.onRequest((wire, { peerId }) => {
      if (!this.host) return JSON.stringify({ success: false, error: 'Not the host', code: 'NOT_HOST' });
      const { op, args, playerId } = JSON.parse(wire) as CommandMessage;
      if (op === 'join') this.peerPlayers.set(peerId, playerId);
      return JSON.stringify(this.host.handle(op, args, playerId, false));
    });
    this.room.onPeerJoin(({ peerId }) => {
      if (this.host) this.sendSnapshot(peerId);
    });
    this.room.onPeerLeave(({ peerId }) => this.onPeerLeave(peerId));
    this.room.onError((error) => console.warn('P2P room error:', error));
    window.addEventListener('beforeunload', () => this.host?.save());

    this.selfId = (await this.room.getSelf()).peerId;
    if (this.replica) this.callbacks.onWorldState(this.replica.world);
    await this.discoverHost();
  }

  private discoverHost(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.hostId) this.becomeHost(this.replica);
        resolve();
      }, DISCOVERY_MS);
      this.hostWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  // ── Host role ───────────────────────────────────────────────

  private becomeHost(snapshot: P2PSnapshot | null): void {
    if (this.host) return;
    if (this.electionTimer) clearTimeout(this.electionTimer);
    console.log(`[p2p] hosting room ${this.roomId}`);
    this.host = new HostCity(
      snapshot,
      (event, data) => this.broadcast(event, data),
      (saved) => saveLocal(this.roomId, saved),
    );
    this.hostId = this.selfId;
    this.hostSince = Date.now();
    this.peerPlayers.clear();
    this.host.start();
    this.snapshotTimer = setInterval(() => this.sendSnapshot(), SNAPSHOT_INTERVAL_MS);
    this.sendSnapshot();
    this.callbacks.onWorldState(clone(this.host.world));
    if (this.joined) this.host.handle('join', { ...this.joined }, this.joined.playerId, true);
    this.notifyHostKnown();
  }

  private stepDown(): void {
    if (!this.host) return;
    console.log('[p2p] another host was here first; joining it');
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.snapshotTimer = null;
    this.host.stop();
    this.host = null;
    this.peerPlayers.clear();
  }

  private sendSnapshot(target?: string): void {
    if (!this.host) return;
    const message: SnapshotMessage = { hostSince: this.hostSince, snapshot: this.host.snapshot() };
    void this.snapshots.send(JSON.stringify(message), target ? { target } : undefined);
  }

  /** Host: send an event to every guest and handle it here too, the same way. */
  private broadcast(event: string, data: unknown): void {
    const wire = JSON.stringify({ event, data });
    void this.events.send(wire);
    // Parse our own copy: the UI edits what it receives, and must never touch the host's state.
    const local = JSON.parse(wire) as { event: string; data: any };
    this.dispatch(local.event, local.data);
  }

  // ── Guest role ──────────────────────────────────────────────

  private onSnapshot(message: SnapshotMessage, from: string): void {
    if (this.host) {
      // Two peers hosted at once (they joined together). The earlier one wins.
      const theyWin = message.hostSince < this.hostSince
        || (message.hostSince === this.hostSince && from < this.selfId);
      if (!theyWin) {
        this.sendSnapshot(from);
        return;
      }
      this.stepDown();
    }

    const newHost = this.hostId !== from;
    this.hostId = from;
    this.replica = message.snapshot;
    saveLocal(this.roomId, message.snapshot);
    if (!newHost) return;

    if (this.electionTimer) clearTimeout(this.electionTimer);
    console.log(`[p2p] host is ${from}`);
    this.callbacks.onWorldState(message.snapshot.world);
    this.notifyHostKnown();
    // A new host doesn't know us yet: join again so it adds us and sends the city.
    if (this.joined) void this.joinCity(this.joined.cityId, this.joined.playerName, this.joined.playerId);
  }

  private onPeerLeave(peerId: string): void {
    if (this.host) {
      const playerId = this.peerPlayers.get(peerId);
      if (playerId) this.host.dropPlayer(playerId);
      this.peerPlayers.delete(peerId);
      return;
    }
    if (peerId !== this.hostId) return;

    // The host left. Everyone picks the same successor: the lowest peer id still here.
    this.hostId = null;
    const candidates = [this.selfId, ...Object.keys(this.room.getPeers())].filter(id => id !== peerId).sort();
    if (candidates[0] === this.selfId) {
      this.becomeHost(this.replica);
    } else {
      // If the chosen peer never announces itself, take over rather than wait forever.
      this.electionTimer = setTimeout(() => {
        if (!this.hostId) this.becomeHost(this.replica);
      }, DISCOVERY_MS * 2);
    }
  }

  private notifyHostKnown(): void {
    const waiters = this.hostWaiters;
    this.hostWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private waitForHost(): Promise<boolean> {
    if (this.hostId) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), COMMAND_TIMEOUT_MS);
      this.hostWaiters.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /** Run a command on the host: here if we are it, otherwise over the data channel. */
  private async request(op: string, args: Record<string, unknown>, playerId = ''): Promise<CommandResult> {
    if (!await this.waitForHost()) {
      return { success: false, error: 'No host is connected', code: 'HOST_UNREACHABLE' };
    }
    if (this.host) return clone(this.host.handle(op, args, playerId, true));
    try {
      const message: CommandMessage = { op, args, playerId };
      const reply = await this.commands.request(JSON.stringify(message), {
        target: this.hostId!, timeoutMs: COMMAND_TIMEOUT_MS,
      });
      return JSON.parse(reply) as CommandResult;
    } catch {
      return { success: false, error: 'Lost the connection to the host', code: 'HOST_UNREACHABLE' };
    }
  }

  // ── Events → UI (same callbacks as the server client) ──────

  private dispatch(event: string, data: any): void {
    const cb = this.callbacks;
    if (event === S2C.WORLD_STATE) {
      cb.onWorldState((data as WorldStatePayload).world);
      return;
    }
    if (event === S2C.WORLD_TICK) {
      cb.onWorldTick?.(data as WorldTickPayload);
      return;
    }
    if (!this.joined) return;
    switch (event) {
      case S2C.CITY_STATE: {
        const payload = data as CityStatePayload;
        cb.onCityState(payload.city, payload.players);
        break;
      }
      case S2C.BUILDING_PLACED: {
        const { building, resources } = data as BuildingPlacedPayload;
        cb.onBuildingsPlaced({ buildings: [building], resources });
        break;
      }
      case S2C.BUILDINGS_PLACED:
        cb.onBuildingsPlaced(data as BuildingsPlacedPayload);
        break;
      case S2C.BUILDING_DEMOLISHED:
        cb.onBuildingDemolished(data as BuildingDemolishedPayload);
        break;
      case S2C.RESOURCES_UPDATE: {
        const payload = data as ResourcesUpdatePayload;
        cb.onResourcesUpdate(payload.resources, payload.tick, payload.clock);
        break;
      }
      case S2C.ZONE_GROWTH:
        cb.onZoneGrowth(data as ZoneGrowthPayload);
        break;
      case S2C.PLAYER_JOINED:
        cb.onPlayerJoined((data as { player: Player }).player);
        break;
      case S2C.PLAYER_LEFT:
        cb.onPlayerLeft((data as { playerId: string }).playerId);
        break;
      case S2C.POPULATION_UPDATE:
        cb.onPopulationUpdate?.((data as PopulationUpdatePayload).summary);
        break;
      case S2C.MIGRATION_EVENT:
        cb.onMigrationEvent?.(data as MigrationEventPayload);
        break;
    }
  }

  private currentWorld(): WorldState | null {
    return this.host ? this.host.world : this.replica?.world ?? null;
  }

  // ── CityConnection ──────────────────────────────────────────

  async fetchWorldState(): Promise<boolean> {
    await this.waitForHost();
    const world = this.currentWorld();
    if (world) this.callbacks.onWorldState(clone(world));
    return world !== null;
  }

  async listCities(): Promise<CityListItem[]> {
    const world = this.currentWorld();
    const city = this.host ? this.host.snapshot().city : this.replica?.city;
    return (world?.cities ?? []).map(entry => ({
      id: entry.cityId,
      name: entry.name,
      ownerName: entry.ownerName,
      playerCount: this.peerCount + 1,
      buildingCount: city?.id === entry.cityId ? city.buildings.length : 0,
    }));
  }

  async claimPlot(siteId: string, cityName: string, playerName: string, playerId?: string): Promise<void> {
    const result = await this.request('claim', { siteId, cityName, playerName }, playerId);
    if (result.success && typeof result.cityId === 'string') {
      await this.joinCity(result.cityId, playerName, playerId);
    } else {
      await this.fetchWorldState();
      this.callbacks.onError({ message: result.error || 'Failed to claim plot', code: 'CLAIM_FAILED' });
    }
  }

  async joinCity(cityId: string, playerName: string, playerId = ''): Promise<void> {
    this.joined = { cityId, playerName, playerId };
    const result = await this.request('join', { cityId, playerName }, playerId);
    if (!result.success) {
      this.joined = null;
      this.callbacks.onError({ message: result.error || 'Failed to join city', code: result.code || 'JOIN_FAILED' });
    }
  }

  async placeBuilding(position: Position, type: BuildingType, playerId?: string, density?: ZoneDensity, orientation?: RoadOrientation): Promise<void> {
    const result = await this.request('place', { position, type, density, orientation }, playerId);
    if (!result.success) {
      this.callbacks.onError({ message: result.error || 'Placement failed', code: 'PLACEMENT_FAILED' });
    }
  }

  async paintBuildings(stroke: PlaceBuildingsPayload, playerId: string): Promise<void> {
    if (!this.joined) return;
    const result = await this.request('placeBatch', { ...stroke }, playerId);
    if (result.placement) this.callbacks.onBuildingsPlaced(result.placement as BuildingsPlacedPayload);
    if (!result.success || result.error) {
      const message = !result.success && result.error === 'Cell occupied'
        ? 'The selected tiles are occupied'
        : result.error || 'Placement failed';
      this.callbacks.onError({ message, code: 'PLACEMENT_FAILED' });
    }
  }

  async demolish(position: Position, playerId?: string): Promise<void> {
    const result = await this.request('demolish', { position }, playerId);
    if (!result.success) {
      this.callbacks.onError({ message: result.error || 'Demolish failed', code: 'DEMOLISH_FAILED' });
    }
  }

  async save(playerId?: string): Promise<void> {
    const result = await this.request('save', {}, playerId);
    if (result.success) this.callbacks.onSaved?.();
  }

  async restart(playerId?: string): Promise<void> {
    await this.request('restart', {}, playerId);
  }

  async generateTown(settings: TownSettings, playerId: string): Promise<boolean> {
    if (!this.joined) return false;
    const result = await this.request('generate', { settings }, playerId);
    if (result.success) {
      this.callbacks.onCityState(result.city as CityStatePayload['city'], (result.players as Player[]) ?? []);
      return true;
    }
    this.callbacks.onError({ message: result.error || 'Could not plan the town', code: 'GENERATE_FAILED' });
    return false;
  }

  async setTaxRate(taxRate: number, playerId?: string): Promise<void> {
    await this.request('tax', { taxRate }, playerId);
  }

  async takeLoan(amount: number, termDays: number, playerId?: string): Promise<{ success: boolean; error?: string }> {
    return this.request('loanTake', { amount, termDays }, playerId);
  }

  async repayLoan(loanId: string, playerId?: string): Promise<{ success: boolean; error?: string }> {
    return this.request('loanRepay', { loanId }, playerId);
  }

  async setUnlimitedMoney(enabled: boolean, playerId?: string): Promise<void> {
    await this.request('unlimited', { enabled }, playerId);
  }

  async setGameSpeed(speed: number, playerId?: string): Promise<void> {
    await this.request('speed', { speed }, playerId);
  }

  async leave(playerId?: string): Promise<void> {
    if (!this.joined) return;
    await this.request('leave', {}, playerId);
    this.joined = null;
  }

  disconnect(): void {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    if (this.electionTimer) clearTimeout(this.electionTimer);
    this.host?.stop();
    this.host = null;
    void this.room.leave();
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
