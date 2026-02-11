import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import {
  S2C,
  type CityStatePayload,
  type WorldStatePayload,
  type BuildingPlacedPayload,
  type BuildingDemolishedPayload,
  type ResourcesUpdatePayload,
  type ZoneGrowthPayload,
  type ErrorPayload,
  type PopulationUpdatePayload,
  type MigrationEventPayload,
  type WorldTickPayload,
  type Position,
  type BuildingType,
  type ResourceState,
  type GameClock,
  type Player,
  type WorldState,
  type WorldPosition,
  type PopulationSummary,
} from '@cityzen/shared';

export interface GameCallbacks {
  onWorldState: (world: WorldState) => void;
  onCityState: (city: import('@cityzen/shared').CityState, players: Player[]) => void;
  onBuildingPlaced: (payload: BuildingPlacedPayload) => void;
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

export class GameClient {
  private serverUrl: string;
  private supabase!: SupabaseClient;
  private callbacks: GameCallbacks;
  private worldChannel!: RealtimeChannel;
  private cityChannel: RealtimeChannel | null = null;
  private currentCityId: string | null = null;

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
        this.callbacks.onWorldState(payload.world);
      })
      .on('broadcast', { event: S2C.WORLD_TICK }, (msg) => {
        this.callbacks.onWorldTick?.(msg.payload as WorldTickPayload);
      })
      .subscribe();

    // Fetch initial world state via REST
    await this.fetchWorldState();
  }

  private async fetchWorldState(): Promise<void> {
    try {
      const res = await fetch(`${this.serverUrl}/api/world/state`);
      const data = await res.json() as WorldStatePayload;
      this.callbacks.onWorldState(data.world);
    } catch (err) {
      console.error('Failed to fetch world state:', err);
    }
  }

  private async subscribeToCityChannel(cityId: string): Promise<void> {
    // Unsubscribe from previous city channel
    this.unsubscribeFromCityChannel();

    this.currentCityId = cityId;
    this.cityChannel = this.supabase.channel(`city:${cityId}`);

    await new Promise<void>((resolve) => {
      this.cityChannel!
        .on('broadcast', { event: S2C.CITY_STATE }, (msg) => {
          const payload = msg.payload as CityStatePayload;
          this.callbacks.onCityState(payload.city, payload.players);
        })
        .on('broadcast', { event: S2C.BUILDING_PLACED }, (msg) => {
          this.callbacks.onBuildingPlaced(msg.payload as BuildingPlacedPayload);
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
      this.currentCityId = null;
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

  async claimPlot(position: WorldPosition, cityName: string, playerName: string, playerId?: string): Promise<void> {
    const result = await this.post('/api/world/claim', { position, cityName, playerName, playerId });
    if (result.success && result.cityId) {
      await this.subscribeToCityChannel(result.cityId);
    } else if (!result.success) {
      this.callbacks.onError({ message: result.error || 'Failed to claim plot', code: 'CLAIM_FAILED' });
    }
  }

  async createCity(cityName: string, playerName: string, playerId?: string): Promise<void> {
    const result = await this.post('/api/city/create', { cityName, playerName, playerId });
    if (result.success && result.cityId) {
      await this.subscribeToCityChannel(result.cityId);
    } else if (!result.success) {
      this.callbacks.onError({ message: result.error || 'Failed to create city', code: 'CREATE_FAILED' });
    }
  }

  async joinCity(cityId: string, playerName: string, playerId?: string): Promise<void> {
    // Subscribe to the city channel first so we receive the state broadcast
    await this.subscribeToCityChannel(cityId);
    const result = await this.post('/api/city/join', { cityId, playerName, playerId });
    if (!result.success) {
      this.unsubscribeFromCityChannel();
      this.callbacks.onError({ message: result.error || 'Failed to join city', code: result.code || 'JOIN_FAILED' });
    }
  }

  async placeBuilding(position: Position, type: BuildingType, playerId?: string): Promise<void> {
    const result = await this.post('/api/building/place', { position, type, playerId });
    if (!result.success) {
      this.callbacks.onError({ message: result.error || 'Placement failed', code: 'PLACEMENT_FAILED' });
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

  async setTaxRate(taxRate: number, playerId?: string): Promise<void> {
    await this.post('/api/city/tax-rate', { taxRate, playerId });
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
