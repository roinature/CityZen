import { v4 as uuid } from 'uuid';
import {
  type CityState,
  type Player,
  type PlacedBuilding,
  type Position,
  type GameClock,
  type PopulationSummary,
  BuildingType,
  isZone,
  S2C,
  AUTO_SAVE_INTERVAL_MS,
  INITIAL_RESOURCES,
  MIN_TAX_RATE,
  MAX_TAX_RATE,
  DEFAULT_GAME_SPEED,
  BUILDING_DEFS,
  createEmptyGrid,
  canPlaceBuilding,
  simulateCityTick,
} from '@cityzen/shared';
import { saveCityState } from '../persistence/jsonStore.js';
import { broadcastToChannel } from '../realtime/supabaseBroadcast.js';

function createInitialClock(): GameClock {
  return {
    gameTimeMs: 0,
    speed: DEFAULT_GAME_SPEED,
    gameDay: 0,
    gameYear: 1,
  };
}

export class GameRoom {
  id: string;
  state: CityState;
  players: Map<string, { player: Player }> = new Map();
  private saveInterval: ReturnType<typeof setInterval> | null = null;
  private debouncedSaveTimer: ReturnType<typeof setTimeout> | null = null;
  unlimitedMoney = false;
  ownerName = 'Unknown';

  constructor(id: string, name: string, ownerId: string, ownerName: string, existingState?: CityState) {
    this.id = id;
    this.ownerName = ownerName;
    this.state = existingState ?? {
      id,
      name,
      ownerId,
      grid: createEmptyGrid(),
      buildings: [],
      resources: { ...INITIAL_RESOURCES },
      clock: createInitialClock(),
      tick: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    // Ensure existing states have clock and ownerId
    if (!this.state.clock) {
      this.state.clock = createInitialClock();
    }
    if (!this.state.ownerId) {
      this.state.ownerId = ownerId;
    }
  }

  start(): void {
    // Tick is now driven by WorldTickEngine — only auto-save here
    this.saveInterval = setInterval(() => {
      if (this.players.size > 0) {
        this.save();
      }
    }, AUTO_SAVE_INTERVAL_MS);
  }

  /** Called by WorldTickEngine each world tick with the shared clock. */
  worldTick(worldClock: GameClock, populationSummary?: PopulationSummary): void {
    // Copy world clock to city state
    this.state.clock = { ...worldClock };

    // Snapshot development levels before tick
    const prevLevels = new Map<string, number>();
    for (const b of this.state.buildings) {
      if (isZone(b.type)) {
        prevLevels.set(b.id, b.developmentLevel ?? 0);
      }
    }

    this.state = simulateCityTick(this.state);

    // Sync population from PopulationManager (overrides legacy growth)
    if (populationSummary) {
      this.state.resources.population = populationSummary.total;
      this.state.resources.populationSummary = populationSummary;
    }

    // Broadcast resources with clock
    this.broadcast(S2C.RESOURCES_UPDATE, {
      resources: this.state.resources,
      tick: this.state.tick,
      clock: this.state.clock,
    });

    // Detect zone growth and broadcast
    const grownBuildings: Array<{ id: string; developmentLevel: number; developedAt: number }> = [];
    for (const b of this.state.buildings) {
      if (isZone(b.type)) {
        const prevLevel = prevLevels.get(b.id) ?? 0;
        const currLevel = b.developmentLevel ?? 0;
        if (currLevel > prevLevel) {
          grownBuildings.push({
            id: b.id,
            developmentLevel: currLevel,
            developedAt: b.developedAt!,
          });
        }
      }
    }

    if (grownBuildings.length > 0) {
      this.broadcast(S2C.ZONE_GROWTH, { buildings: grownBuildings });
      this.saveAfterMutation();
    }
  }

  stop(): void {
    if (this.saveInterval) clearInterval(this.saveInterval);
    this.save();
  }

  addPlayer(playerId: string, playerName: string): Player {
    const player: Player = {
      id: playerId,
      name: playerName,
      joinedAt: Date.now(),
    };
    this.players.set(playerId, { player });

    // Broadcast full state to the channel (new player will receive it via subscription)
    this.broadcast(S2C.CITY_STATE, {
      city: this.state,
      players: this.getPlayerList(),
    });

    // Notify about new player
    this.broadcast(S2C.PLAYER_JOINED, { player });

    return player;
  }

  removePlayer(playerId: string): void {
    const entry = this.players.get(playerId);
    if (!entry) return;
    this.players.delete(playerId);
    this.broadcast(S2C.PLAYER_LEFT, { playerId });
  }

  placeBuilding(playerId: string, position: Position, type: BuildingType): { success: boolean; error?: string } {
    const result = canPlaceBuilding(
      this.state.grid, position, type, this.state.resources,
      this.unlimitedMoney, this.state.buildings,
    );
    if (!result.valid) {
      return { success: false, error: result.reason };
    }

    const def = BUILDING_DEFS[type];
    const building: PlacedBuilding = {
      id: uuid(),
      type,
      position,
      placedBy: playerId,
      placedAt: this.state.tick,
      ...(isZone(type) ? { developmentLevel: 0 } : {}),
    };

    // Update grid
    for (let dx = 0; dx < def.size.w; dx++) {
      for (let dz = 0; dz < def.size.d; dz++) {
        this.state.grid[position.x + dx][position.z + dz].buildingId = building.id;
      }
    }

    // Update state
    this.state.buildings.push(building);
    if (!this.unlimitedMoney) {
      this.state.resources.money -= def.cost;
    }
    this.state.updatedAt = Date.now();

    // Broadcast to all players in room
    this.broadcast(S2C.BUILDING_PLACED, {
      building,
      resources: this.state.resources,
    });

    this.saveAfterMutation();
    return { success: true };
  }

  demolishBuilding(position: Position): { success: boolean; error?: string } {
    const cell = this.state.grid[position.x]?.[position.z];
    if (!cell || !cell.buildingId) {
      return { success: false, error: 'No building here' };
    }

    const buildingId = cell.buildingId;
    const building = this.state.buildings.find((b: PlacedBuilding) => b.id === buildingId);
    if (!building) {
      return { success: false, error: 'Building not found' };
    }

    const def = BUILDING_DEFS[building.type];

    // Clear grid cells
    for (let dx = 0; dx < def.size.w; dx++) {
      for (let dz = 0; dz < def.size.d; dz++) {
        this.state.grid[building.position.x + dx][building.position.z + dz].buildingId = null;
      }
    }

    // Remove building, refund half cost
    this.state.buildings = this.state.buildings.filter((b: PlacedBuilding) => b.id !== buildingId);
    if (!this.unlimitedMoney) {
      this.state.resources.money += Math.floor(def.cost / 2);
    }
    this.state.updatedAt = Date.now();

    this.broadcast(S2C.BUILDING_DEMOLISHED, {
      position,
      buildingId,
      resources: this.state.resources,
    });

    this.saveAfterMutation();
    return { success: true };
  }

  setTaxRate(rate: number): { success: boolean; error?: string } {
    if (rate < MIN_TAX_RATE || rate > MAX_TAX_RATE || !Number.isInteger(rate)) {
      return { success: false, error: 'Invalid tax rate' };
    }

    this.state.resources.taxRate = rate;
    this.state.updatedAt = Date.now();

    this.broadcast(S2C.RESOURCES_UPDATE, {
      resources: this.state.resources,
      tick: this.state.tick,
      clock: this.state.clock,
    });

    this.saveAfterMutation();
    return { success: true };
  }

  setUnlimitedMoney(enabled: boolean): void {
    this.unlimitedMoney = enabled;
    this.broadcast(S2C.RESOURCES_UPDATE, {
      resources: this.state.resources,
      tick: this.state.tick,
      clock: this.state.clock,
    });
  }

  restart(): void {
    this.state = {
      ...this.state,
      grid: createEmptyGrid(),
      buildings: [],
      resources: { ...INITIAL_RESOURCES },
      clock: createInitialClock(),
      tick: 0,
      updatedAt: Date.now(),
    };

    // Broadcast fresh state to all players via channel
    this.broadcast(S2C.CITY_STATE, {
      city: this.state,
      players: this.getPlayerList(),
    });

    this.saveAfterMutation();
  }

  async forceSave(): Promise<void> {
    await this.save();
  }

  getPlayerList(): Player[] {
    return Array.from(this.players.values()).map(e => e.player);
  }

  private broadcast(event: string, data: unknown): void {
    broadcastToChannel(`city:${this.id}`, event, data);
  }

  private saveAfterMutation(): void {
    if (this.debouncedSaveTimer) clearTimeout(this.debouncedSaveTimer);
    this.debouncedSaveTimer = setTimeout(() => this.save(), 1000);
  }

  private isSaving = false;
  private savePending = false;

  private async save(): Promise<void> {
    if (this.isSaving) {
      this.savePending = true;
      return;
    }
    this.isSaving = true;
    try {
      await saveCityState(this.id, this.state);
    } catch (err) {
      console.error(`Failed to save city ${this.id}:`, err);
    } finally {
      this.isSaving = false;
      if (this.savePending) {
        this.savePending = false;
        this.save();
      }
    }
  }
}
