import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import {
  S2C,
  type CityStatePayload,
  type WorldStatePayload,
  type BuildingPlacedPayload,
  type BuildingsPlacedPayload,
  type PlaceBuildingsPayload,
  type BuildingDemolishedPayload,
  type ResourcesUpdatePayload,
  type ZoneGrowthPayload,
  type ErrorPayload,
  type PopulationUpdatePayload,
  type MigrationEventPayload,
  type WorldTickPayload,
  type Position,
  type BuildingType,
  type ZoneDensity,
  type RoadOrientation,
  type ResourceState,
  type GameClock,
  type Player,
  type WorldState,
  type PopulationSummary,
  type TownSettings,
  type CityListItem,
} from '@cityzen/shared';
import type { CityConnection } from './CityConnection.js';

export interface GameCallbacks {
  onWorldState: (world: WorldState) => void;
  onCityState: (city: import('@cityzen/shared').CityState, players: Player[]) => void;
  onBuildingsPlaced: (payload: BuildingsPlacedPayload) => void;
  onBuildingDemolished: (payload: BuildingDemolishedPayload) => void;
  onResourcesUpdate: (resources: ResourceState, tick: number, clock: GameClock) => void;
  onZoneGrowth: (payload: ZoneGrowthPayload) => void;
  onPlayerJoined: (player: Player) => void;
  onPlayerLeft: (playerId: string) => void;
  onError: (error: ErrorPayload) => void;
  onSaved?: () => void;
  onPopulationUpdate?: (summary: PopulationSummary) => void;
  onMigrationEvent?: (payload: MigrationEventPayload) => void;
  onWorldTick?: (payload: WorldTickPayload) => void;
}

export class GameClient implements CityConnection {
  private serverUrl: string;
  private supabase!: SupabaseClient;
  private callbacks: GameCallbacks;
  private worldChannel!: RealtimeChannel;
  private cityChannel: RealtimeChannel | null = null;
  private joinedCityChannel: RealtimeChannel | null = null;

  static async create(serverUrl: string, callbacks: GameCallbacks): Promise<GameClient> {
    const client = new GameClient(serverUrl, callbacks);
    await client.init();
    return client;
  }

  private constructor(serverUrl: string, callbacks: GameCallbacks) {
    this.serverUrl = serverUrl;
    this.callbacks = callbacks;
  }

  private async init(): Promise<void> {
    // Fetch Supabase config from server
    const res = await fetch(`${this.serverUrl}/api/config`);
    const { supabaseUrl, supabaseAnonKey } = await res.json();
    this.supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Subscribe to world channel for global broadcasts
    this.worldChannel = this.supabase.channel('world');
    this.worldChannel
      .on('broadcast', { event: S2C.WORLD_STATE }, (msg) => {
        const payload = msg.payload as WorldStatePayload;
        // The channel carries every world's updates; only show the one we're in
        if (payload.world.id !== 'default') return;
        this.callbacks.onWorldState(payload.world);
      })
      .on('broadcast', { event: S2C.WORLD_TICK }, (msg) => {
        this.callbacks.onWorldTick?.(msg.payload as WorldTickPayload);
      })
      .subscribe();

    // Fetch initial world state via REST
    await this.fetchWorldState();
  }

  async fetchWorldState(): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverUrl}/api/world/state`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as WorldStatePayload;
      this.callbacks.onWorldState(data.world);
      return true;
    } catch (err) {
      console.error('Failed to fetch world state:', err);
      return false;
    }
  }

  async listCities(): Promise<CityListItem[]> {
    const res = await fetch(`${this.serverUrl}/api/cities`);
    return res.json();
  }

  private async subscribeToCityChannel(cityId: string): Promise<void> {
    // Unsubscribe from previous city channel
    this.unsubscribeFromCityChannel();

    const channel = this.supabase.channel(`city:${cityId}`);
    this.cityChannel = channel;

    await new Promise<void>((resolve) => {
      channel
        .on('broadcast', { event: S2C.CITY_STATE }, (msg) => {
          const payload = msg.payload as CityStatePayload;
          if (this.joinedCityChannel !== channel) return;
          this.callbacks.onCityState(payload.city, payload.players);
        })
        .on('broadcast', { event: S2C.BUILDING_PLACED }, (msg) => {
          if (this.joinedCityChannel !== channel) return;
          const { building, resources } = msg.payload as BuildingPlacedPayload;
          this.callbacks.onBuildingsPlaced({ buildings: [building], resources });
        })
        .on('broadcast', { event: S2C.BUILDINGS_PLACED }, (msg) => {
          if (this.joinedCityChannel !== channel) return;
          this.callbacks.onBuildingsPlaced(msg.payload as BuildingsPlacedPayload);
        })
        .on('broadcast', { event: S2C.BUILDING_DEMOLISHED }, (msg) => {
          this.callbacks.onBuildingDemolished(msg.payload as BuildingDemolishedPayload);
        })
        .on('broadcast', { event: S2C.RESOURCES_UPDATE }, (msg) => {
          const payload = msg.payload as ResourcesUpdatePayload;
          this.callbacks.onResourcesUpdate(payload.resources, payload.tick, payload.clock);
        })
        .on('broadcast', { event: S2C.ZONE_GROWTH }, (msg) => {
          this.callbacks.onZoneGrowth(msg.payload as ZoneGrowthPayload);
        })
        .on('broadcast', { event: S2C.PLAYER_JOINED }, (msg) => {
          const payload = msg.payload as { player: Player };
          this.callbacks.onPlayerJoined(payload.player);
        })
        .on('broadcast', { event: S2C.PLAYER_LEFT }, (msg) => {
          const payload = msg.payload as { playerId: string };
          this.callbacks.onPlayerLeft(payload.playerId);
        })
        .on('broadcast', { event: S2C.POPULATION_UPDATE }, (msg) => {
          const payload = msg.payload as PopulationUpdatePayload;
          this.callbacks.onPopulationUpdate?.(payload.summary);
        })
        .on('broadcast', { event: S2C.MIGRATION_EVENT }, (msg) => {
          this.callbacks.onMigrationEvent?.(msg.payload as MigrationEventPayload);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
        });
    });
  }

  private unsubscribeFromCityChannel(): void {
    if (this.cityChannel) {
      this.supabase.removeChannel(this.cityChannel);
      this.cityChannel = null;
      this.joinedCityChannel = null;
    }
  }

  private async post(path: string, body: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${this.serverUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async claimPlot(siteId: string, cityName: string, playerName: string, playerId?: string): Promise<void> {
    const result = await this.post('/api/world/claim', {
      siteId, cityName, playerName, playerId,
    });
    if (result.success && result.cityId) {
      // The server broadcasts the new city's state before we can subscribe to
      // its channel, so that message is lost. Join explicitly (subscribe first,
      // then ask for the state again) or the player is left on the world map.
      await this.joinCity(result.cityId, playerName, playerId);
    } else if (!result.success) {
      await this.fetchWorldState();
      this.callbacks.onError({ message: result.error || 'Failed to claim plot', code: 'CLAIM_FAILED' });
    }
  }

  async joinCity(cityId: string, playerName: string, playerId?: string): Promise<void> {
    const subscribed = this.subscribeToCityChannel(cityId);
    const channel = this.cityChannel;
    const [, result] = await Promise.all([
      subscribed,
      this.post('/api/city/join', { cityId, playerName, playerId }),
    ]);
    if (this.cityChannel !== channel) return;
    if (!result.success) {
      this.unsubscribeFromCityChannel();
      this.callbacks.onError({ message: result.error || 'Failed to join city', code: result.code || 'JOIN_FAILED' });
      return;
    }
    // The join response establishes the session for edits. An earlier
    // realtime broadcast can arrive before the browser receives that session.
    this.joinedCityChannel = channel;
    if (result.city) this.callbacks.onCityState(result.city, result.players ?? []);
  }

  async placeBuilding(position: Position, type: BuildingType, playerId?: string, density?: ZoneDensity, orientation?: RoadOrientation): Promise<void> {
    const result = await this.post('/api/building/place', { position, type, playerId, density, orientation });
    if (!result.success) {
      this.callbacks.onError({ message: result.error || 'Placement failed', code: 'PLACEMENT_FAILED' });
    }
  }

  async paintBuildings(stroke: PlaceBuildingsPayload, playerId: string): Promise<void> {
    const channel = this.joinedCityChannel;
    if (!channel) return;

    try {
      const result = await this.post('/api/building/place-batch', { ...stroke, playerId });
      if (this.joinedCityChannel !== channel) return;
      // Apply the committed stroke even if realtime delivery is delayed.
      if (result.placement) this.callbacks.onBuildingsPlaced(result.placement);
      if (!result.success || result.error) {
        const message = !result.success && result.error === 'Cell occupied'
          ? 'The selected tiles are occupied'
          : result.error || 'Placement failed';
        this.callbacks.onError({ message, code: 'PLACEMENT_FAILED' });
      }
    } catch {
      if (this.joinedCityChannel === channel) {
        this.callbacks.onError({ message: 'Could not confirm the build stroke', code: 'PLACEMENT_FAILED' });
      }
    }
  }

  async demolish(position: Position, playerId?: string): Promise<void> {
    const result = await this.post('/api/building/demolish', { position, playerId });
    if (!result.success) {
      this.callbacks.onError({ message: result.error || 'Demolish failed', code: 'DEMOLISH_FAILED' });
    }
  }

  async save(playerId?: string): Promise<void> {
    const result = await this.post('/api/city/save', { playerId });
    if (result.success) {
      this.callbacks.onSaved?.();
    }
  }

  async restart(playerId?: string): Promise<void> {
    await this.post('/api/city/restart', { playerId });
  }

  async generateTown(settings: TownSettings, playerId: string): Promise<boolean> {
    const channel = this.joinedCityChannel;
    if (!channel) return false;
    try {
      const result = await this.post('/api/city/generate', { settings, playerId });
      if (this.joinedCityChannel !== channel) return false;
      if (result.success) {
        this.callbacks.onCityState(result.city, result.players ?? []);
        return true;
      }
      this.callbacks.onError({ message: result.error || 'Could not plan the town', code: 'GENERATE_FAILED' });
    } catch {
      this.callbacks.onError({ message: 'Could not reach the server', code: 'GENERATE_FAILED' });
    }
    return false;
  }

  async setTaxRate(taxRate: number, playerId?: string): Promise<void> {
    await this.post('/api/city/tax-rate', { taxRate, playerId });
  }

  async takeLoan(amount: number, termDays: number, playerId?: string): Promise<{ success: boolean; error?: string }> {
    return this.post('/api/city/loan/take', { amount, termDays, playerId });
  }

  async repayLoan(loanId: string, playerId?: string): Promise<{ success: boolean; error?: string }> {
    return this.post('/api/city/loan/repay', { loanId, playerId });
  }

  async setUnlimitedMoney(enabled: boolean, playerId?: string): Promise<void> {
    await this.post('/api/city/unlimited-money', { enabled, playerId });
  }

  async setGameSpeed(speed: number, playerId?: string): Promise<void> {
    await this.post('/api/city/game-speed', { speed, playerId });
  }

  async leave(playerId?: string): Promise<void> {
    this.unsubscribeFromCityChannel();
    await this.post('/api/city/leave', { playerId });
  }

  disconnect(): void {
    this.unsubscribeFromCityChannel();
    this.supabase.removeChannel(this.worldChannel);
  }
}
