import { v4 as uuid } from 'uuid';
import {
  type CityState,
  type Player,
  type PlacedBuilding,
  type Position,
  type GameClock,
  type PopulationSummary,
  type ZonePopulationEntry,
  type RoadOrientation,
  BuildingType,
  isZone,
  ZoneDensity,
  S2C,
  AUTO_SAVE_INTERVAL_MS,
  INITIAL_RESOURCES,
  MIN_TAX_RATE,
  MAX_TAX_RATE,
  DEFAULT_GAME_SPEED,
  BUILDING_DEFS,
  ZONE_DENSITY_COSTS,
  createStarterLayout,
  canPlaceBuilding,
  getEffectiveSize,
  simulateCityTick,
  validateLoanRequest,
  createLoan,
} from '@cityzen/shared';
import { loadCityState, saveCityState } from '../persistence/jsonStore.js';
import { broadcastToChannel } from '../realtime/supabaseBroadcast.js';
import { IS_SERVERLESS } from '../config.js';
import type { MessageManager } from '../services/MessageManager.js';

function createInitialClock(): GameClock {
  return {
    gameTimeMs: 0,
    speed: DEFAULT_GAME_SPEED,
    gameDay: 0,
    gameYear: 1,
  };
}

type CityBroadcast = (event: string, data: unknown) => void;

export class GameRoom {
  id: string;
  state: CityState;
  players: Map<string, { player: Player }> = new Map();
  private saveInterval: ReturnType<typeof setInterval> | null = null;
  private debouncedSaveTimer: ReturnType<typeof setTimeout> | null = null;
  unlimitedMoney = false;
  ownerName = 'Unknown';
  private messageManager: MessageManager | null = null;
  private persistedRevision?: number;

  constructor(id: string, name: string, ownerId: string, ownerName: string, existingState?: CityState,
    private collectBroadcast?: CityBroadcast,
  ) {
    this.id = id;
    this.ownerName = ownerName;
    this.persistedRevision = existingState?.updatedAt;
    this.state = existingState ?? {
      id,
      name,
      ownerId,
      ...createStarterLayout(id, ownerId),
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
  worldTick(worldClock: GameClock, populationSummary?: PopulationSummary, zonePopulations?: ZonePopulationEntry[]): void {
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

    // Attach zone populations for client rendering
    if (zonePopulations) {
      this.state.resources.zonePopulations = zonePopulations;
    }

    // Generate messages based on state changes
    if (this.messageManager) {
      this.messageManager.updateCityState(this.id, this.state);
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

    // Generate first city message for new players
    if (this.messageManager && this.players.size === 1) {
      this.messageManager.createCustomMessage(
        'first_city',
        'achievement',
        'medium',
        'Welcome to CityZen!',
        `Welcome ${playerName}! You've founded ${this.state.name}. Begin your urban adventure!`,
        this.id,
        playerId,
        'banner'
      );
    }

    return player;
  }

  removePlayer(playerId: string): void {
    const entry = this.players.get(playerId);
    if (!entry) return;
    this.players.delete(playerId);
    this.broadcast(S2C.PLAYER_LEFT, { playerId });
  }

  placeBuilding(playerId: string, position: Position, type: BuildingType, density?: ZoneDensity, orientation?: RoadOrientation): { success: boolean; error?: string } {
    const result = canPlaceBuilding(
      this.state.grid, position, type, this.state.resources,
      this.unlimitedMoney, this.state.buildings, density, orientation,
    );
    if (!result.valid) {
      return { success: false, error: result.reason };
    }

    const def = BUILDING_DEFS[type];
    const cost = isZone(type) && density ? ZONE_DENSITY_COSTS[density] : def.cost;
    const building: PlacedBuilding = {
      id: uuid(),
      type,
      position,
      placedBy: playerId,
      placedAt: this.state.tick,
      ...(isZone(type) ? { developmentLevel: 0, density: density ?? ZoneDensity.MEDIUM } : {}),
      ...(orientation ? { orientation } : {}),
    };

    // Update grid
    const { w, d } = getEffectiveSize(type, orientation);
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        this.state.grid[position.x + dx][position.z + dz].buildingId = building.id;
      }
    }

    // Update state
    this.state.buildings.push(building);
    if (!this.unlimitedMoney) {
      this.state.resources.money -= cost;
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
    const { w, d } = getEffectiveSize(building.type, building.orientation);

    // Clear grid cells
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        this.state.grid[building.position.x + dx][building.position.z + dz].buildingId = null;
      }
    }

    // Remove building, refund half of what was actually paid (zones are priced by density)
    this.state.buildings = this.state.buildings.filter((b: PlacedBuilding) => b.id !== buildingId);
    if (!this.unlimitedMoney) {
      const paid = isZone(building.type) && building.density ? ZONE_DENSITY_COSTS[building.density] : def.cost;
      this.state.resources.money += Math.floor(paid / 2);
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

  /** Borrow money: the principal lands in the treasury now and is repaid every tick. */
  takeLoan(amount: number, termDays: number): { success: boolean; error?: string } {
    const check = validateLoanRequest(this.state, amount, termDays);
    if (!check.valid) {
      return { success: false, error: check.reason };
    }

    const loan = createLoan(uuid(), amount, termDays, this.state.tick);
    this.state.resources.loans = [...(this.state.resources.loans ?? []), loan];
    this.state.resources.money += amount;
    this.state.updatedAt = Date.now();

    this.broadcastResources();
    this.saveAfterMutation();
    return { success: true };
  }

  /** Pay off the whole remaining balance of one loan. */
  repayLoan(loanId: string): { success: boolean; error?: string } {
    const loans = this.state.resources.loans ?? [];
    const loan = loans.find(l => l.id === loanId);
    if (!loan) {
      return { success: false, error: 'Loan not found' };
    }
    if (!this.unlimitedMoney && this.state.resources.money < loan.remaining) {
      return { success: false, error: 'Not enough money to repay this loan' };
    }

    if (!this.unlimitedMoney) {
      this.state.resources.money -= loan.remaining;
    }
    this.state.resources.loans = loans.filter(l => l.id !== loanId);
    this.state.updatedAt = Date.now();

    this.broadcastResources();
    this.saveAfterMutation();
    return { success: true };
  }

  private broadcastResources(): void {
    this.broadcast(S2C.RESOURCES_UPDATE, {
      resources: this.state.resources,
      tick: this.state.tick,
      clock: this.state.clock,
    });
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
      ...createStarterLayout(this.id, this.state.ownerId),
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

  syncPersistedState(state: CityState): void {
    if (this.persistedRevision !== undefined && this.persistedRevision >= state.updatedAt) return;
    this.persistedRevision = state.updatedAt;
    this.state = structuredClone(state);
  }

  private broadcast(event: string, data: unknown): void {
    if (this.collectBroadcast) {
      this.collectBroadcast(event, data);
      return;
    }
    broadcastToChannel(`city:${this.id}`, event, data);
  }

  private saveAfterMutation(): void {
    if (this.collectBroadcast) return;
    if (this.debouncedSaveTimer) clearTimeout(this.debouncedSaveTimer);
    this.debouncedSaveTimer = setTimeout(() => this.save(), 1000);
  }

  // Set message manager for this room
  setMessageManager(messageManager: MessageManager): void {
    this.messageManager = messageManager;
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
      const snapshot = IS_SERVERLESS ? structuredClone(this.state) : this.state;
      const revision = await saveCityState(this.id, snapshot, IS_SERVERLESS ? this.persistedRevision : undefined);
      if (revision !== null) {
        this.persistedRevision = Math.max(this.persistedRevision ?? 0, revision);
      } else {
        const latest = await loadCityState(this.id);
        if (latest) this.syncPersistedState(latest);
      }
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
