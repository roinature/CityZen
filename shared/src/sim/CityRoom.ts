import { newId } from './id.js';
import type { CityState } from '../types/city.js';
import type { Player } from '../types/player.js';
import type { Position, UtilityLayer } from '../types/grid.js';
import type { GameClock } from '../types/time.js';
import type { PopulationSummary, TaxRates, ZonePopulationEntry } from '../types/resources.js';
import { type PlacedBuilding, type RoadOrientation, BuildingType, SERVICE_BUILDING_FLEETS, UTILITY_PUMP_LEVELS, ZoneDensity, isRoad, isUpgradableBuilding, isWaterfront, isZone } from '../types/building.js';
import { type PlaceBuildingsPayload, S2C } from '../types/events.js';
import { INITIAL_RESOURCES, MIN_TAX_RATE, MAX_TAX_RATE, DEFAULT_GAME_SPEED } from '../constants/simulation.js';
import { BUILDING_DEFS, ZONE_DENSITY_COSTS } from '../constants/buildings.js';
import {
  getBuildingTotalInvestedCost,
  getNextUpgradeTier,
  getUpgradeTierCost,
} from '../constants/upgrades.js';
import {
  canPlaceBuilding,
  clearGridBuilding,
  createEmptyGrid,
  findGridBuildingToDemolish,
  getPlacementCost,
  getReplacedBuildings,
  levelRoadTerrain,
  resolveWaterfrontOrientation,
  setGridBuilding,
} from '../logic/placement.js';
import { createStarterLayout } from '../logic/starterLayout.js';
import { planTown, type TownSettings } from '../logic/townPlan.js';
import { applySiteTerrain } from '../terrain/sites.js';
import { simulateCityTick } from '../logic/simulation.js';
import { validateLoanRequest, createLoan } from '../logic/loans.js';
import {
  calculatePlannedTownMoney,
  getAverageTaxRate,
  getEffectiveTaxRates,
} from '../logic/resources.js';
import { CITY_MILESTONES } from '../constants/economy.js';
import { evaluateCityUtilities } from '../logic/utilities.js';
import {
  EMERGENCY_AUTO_RESPONSE_TICKS,
  failEmergency,
  hasOperationalResponder,
  maybeSpawnEmergency,
  resolveEmergencyOutcome,
} from '../logic/emergencies.js';
import type { CityEmergency, CityEmergencyKind } from '../types/emergencies.js';
import type { PopulationManager } from './PopulationManager.js';

function createInitialClock(): GameClock {
  return {
    gameTimeMs: 0,
    speed: DEFAULT_GAME_SPEED,
    gameDay: 0,
    gameYear: 1,
  };
}

function createInitialResources(moneyOverride?: number) {
  return {
    ...INITIAL_RESOURCES,
    ...(moneyOverride !== undefined ? { money: moneyOverride } : {}),
    taxRates: { ...INITIAL_RESOURCES.taxRates },
    claimedMilestones: [] as string[],
    demand: { ...INITIAL_RESOURCES.demand },
  };
}

/** The parts of the message system a city room talks to. */
export interface CityMessageSink {
  updateCityState(cityId: string, state: CityState): void;
  createCustomMessage(
    type: string, category: string, priority: string, title: string, content: string,
    cityId?: string, playerId?: string, displayType?: string,
  ): unknown;
}

/**
 * The authoritative rules for one city: placement, demolition, budget, loans and
 * the per-tick update. It has no transport or storage of its own, so it runs the
 * same on the server and in a browser that hosts a peer-to-peer game.
 */
export class CityRoom {
  id: string;
  state: CityState;
  players: Map<string, { player: Player }> = new Map();
  unlimitedMoney = false;
  ownerName = 'Unknown';
  protected messageManager: CityMessageSink | null = null;
  private lastEmergencySpawnTick = 0;

  constructor(id: string, name: string, ownerId: string, ownerName: string, existingState?: CityState, siteId?: string) {
    this.id = id;
    this.ownerName = ownerName;
    this.state = existingState ?? {
      id,
      name,
      ownerId,
      siteId,
      ...createStarterLayout(id, ownerId, siteId),
      resources: createInitialResources(),
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

  /** Called by WorldTickEngine each world tick with the shared clock. */
  worldTick(
    worldClock: GameClock,
    populationSummary?: PopulationSummary,
    zonePopulations?: ZonePopulationEntry[],
    populationManager?: PopulationManager,
  ): void {
    // Copy world clock to city state
    this.state.clock = { ...worldClock };

    // Snapshot development levels before tick
    const prevLevels = new Map<string, number>();
    for (const b of this.state.buildings) {
      if (isZone(b.type)) {
        prevLevels.set(b.id, b.developmentLevel ?? 0);
      }
    }

    // Sync population from PopulationManager before simulating so demand,
    // growth budgets, taxes and happiness use the current tick's demographics.
    if (populationSummary) {
      this.state.resources.population = populationSummary.total;
      this.state.resources.populationSummary = populationSummary;
    }

    const prevMilestones = new Set(this.state.resources.claimedMilestones ?? []);
    this.state = simulateCityTick(this.state);

    // Notify players when a new population milestone charter grant is awarded
    if (this.messageManager) {
      for (const id of this.state.resources.claimedMilestones ?? []) {
        if (!prevMilestones.has(id)) {
          const m = CITY_MILESTONES.find(item => item.id === id);
          if (m) {
            this.messageManager.createCustomMessage(
              'milestone',
              'achievement',
              'high',
              `${m.label} Reached!`,
              `${this.state.name} reached ${m.population.toLocaleString()} citizens and received a $${m.grant.toLocaleString()} municipal grant!`,
              this.id,
              undefined,
              'banner',
            );
          }
        }
      }
    }

    // Process active city emergencies & spawn new ones when unpaused
    if (worldClock.speed > 0) {
      this.tickEmergencies(populationManager);
    }

    // Refresh population summary if an emergency caused casualties
    if (populationManager) {
      const latestSummary = populationManager.getCityPopulationSummary(this.id);
      this.state.resources.population = latestSummary.total;
      this.state.resources.populationSummary = latestSummary;
      this.state.resources.zonePopulations = populationManager.getZonePopulations(this.id, this.state.buildings);
    } else if (zonePopulations) {
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

    // Detect zone growth (or downgrade/razing from disasters) and broadcast
    const changedZones: Array<{ id: string; developmentLevel: number; developedAt: number }> = [];
    for (const b of this.state.buildings) {
      if (isZone(b.type)) {
        const prevLevel = prevLevels.get(b.id) ?? 0;
        const currLevel = b.developmentLevel ?? 0;
        if (currLevel !== prevLevel) {
          changedZones.push({
            id: b.id,
            developmentLevel: currLevel,
            developedAt: b.developedAt ?? this.state.tick,
          });
        }
      }
    }

    if (changedZones.length > 0) {
      this.broadcast(S2C.ZONE_GROWTH, { buildings: changedZones });
      this.onMutated();
    }
  }

  /** Advance active emergencies, fail expired ones, and occasionally trigger a new incident. */
  protected tickEmergencies(populationManager?: PopulationManager): void {
    const active = this.state.emergencies ? [...this.state.emergencies] : [];
    const remaining: CityEmergency[] = [];
    let mutated = false;
    const utilities = active.length > 0 ? evaluateCityUtilities(this.state) : undefined;

    for (const em of active) {
      // If the target building was manually bulldozed, drop the incident quietly
      const targetBuilding = this.state.buildings.find(b => b.id === em.buildingId);
      if (!targetBuilding) {
        mutated = true;
        continue;
      }

      // Headless fallback: if no visual client is connected to drive 3D cars, let an operational
      // responder building resolve the incident before the deadline.
      if (
        this.players.size === 0 &&
        !em.respondingAtTick &&
        this.state.tick - em.startedAtTick >= EMERGENCY_AUTO_RESPONSE_TICKS &&
        hasOperationalResponder(this.state, em.kind, utilities)
      ) {
        const outcome = resolveEmergencyOutcome(em);
        this.broadcast(S2C.EMERGENCY_OUTCOME, { outcome, resources: this.state.resources });
        mutated = true;
        continue;
      }

      // A responder already on scene holds off the deadline while working; safety-cap at +12 ticks
      const effectiveDeadline = em.respondingAtTick ? em.respondingAtTick + 12 : em.deadlineTick;
      if (this.state.tick >= effectiveDeadline) {
        if (em.respondingAtTick) {
          const outcome = resolveEmergencyOutcome(em);
          this.broadcast(S2C.EMERGENCY_OUTCOME, { outcome, resources: this.state.resources });
        } else {
          const prevPos = { ...targetBuilding.position };
          const outcome = failEmergency(this.state, em, populationManager);
          if (outcome.destroyedBuildingId) {
            this.state.resources.utilities = evaluateCityUtilities(this.state).summary;
            this.broadcast(S2C.BUILDING_DEMOLISHED, {
              position: prevPos,
              buildingId: outcome.destroyedBuildingId,
              resources: this.state.resources,
            });
          }
          this.broadcast(S2C.EMERGENCY_OUTCOME, { outcome, resources: this.state.resources });
        }
        mutated = true;
        continue;
      }

      remaining.push(em);
    }

    this.state.emergencies = remaining;

    const spawned = maybeSpawnEmergency(this.state, this.lastEmergencySpawnTick);
    if (spawned) {
      this.lastEmergencySpawnTick = this.state.tick;
      this.state.emergencies = [...remaining, spawned];
      this.broadcast(S2C.EMERGENCY_STARTED, { emergency: spawned });
      mutated = true;
    }

    if (mutated) {
      this.state.updatedAt = Date.now();
      this.onMutated();
    }
  }

  /** Manually spawn an emergency (used by tests and debug tools). */
  spawnEmergency(kind: CityEmergencyKind, buildingId: string): CityEmergency | null {
    const b = this.state.buildings.find(item => item.id === buildingId);
    if (!b) return null;
    const em: CityEmergency = {
      id: newId(),
      kind,
      buildingId: b.id,
      position: { ...b.position },
      startedAtTick: this.state.tick,
      deadlineTick: this.state.tick + 24,
    };
    this.state.emergencies = [...(this.state.emergencies ?? []), em];
    this.lastEmergencySpawnTick = this.state.tick;
    this.broadcast(S2C.EMERGENCY_STARTED, { emergency: em });
    this.onMutated();
    return em;
  }

  /** Called when a service vehicle arrives on scene and begins handling the incident. */
  markEmergencyResponding(emergencyId: string): { success: boolean } {
    const list = this.state.emergencies;
    if (!list) return { success: false };
    const em = list.find(e => e.id === emergencyId);
    if (!em) return { success: false };
    if (!em.respondingAtTick) {
      em.respondingAtTick = this.state.tick;
      this.state.updatedAt = Date.now();
      this.broadcast(S2C.EMERGENCY_RESPONDING, {
        emergencyId: em.id,
        respondingAtTick: em.respondingAtTick,
      });
      this.onMutated();
    }
    return { success: true };
  }

  /** Called when a service vehicle finishes working at the scene and resolves the incident. */
  resolveEmergency(emergencyId: string): { success: boolean } {
    const list = this.state.emergencies;
    if (!list) return { success: false };
    const em = list.find(e => e.id === emergencyId);
    if (!em) return { success: false };
    this.state.emergencies = list.filter(e => e.id !== emergencyId);
    this.state.updatedAt = Date.now();
    const outcome = resolveEmergencyOutcome(em);
    this.broadcast(S2C.EMERGENCY_OUTCOME, { outcome, resources: this.state.resources });
    this.onMutated();
    return { success: true };
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
    const result = this.addBuilding(playerId, position, type, density, orientation);
    if (!result.success) return result;

    this.state.resources.utilities = evaluateCityUtilities(this.state).summary;
    this.broadcast(S2C.BUILDING_PLACED, { building: result.building, resources: this.state.resources });
    this.onMutated();
    return { success: true };
  }

  placeBuildings(playerId: string, { positions, type, density, orientation }: PlaceBuildingsPayload): {
    success: boolean; buildings: PlacedBuilding[]; error?: string;
  } {
    const buildings: PlacedBuilding[] = [];
    let error: string | undefined;
    for (const position of positions) {
      const result = this.addBuilding(playerId, position, type, density, orientation);
      if (result.success) {
        buildings.push(result.building);
      } else if (result.error === 'Not enough money') {
        error = result.error;
        break;
      } else {
        error ??= result.error;
      }
    }

    if (buildings.length) {
      this.state.resources.utilities = evaluateCityUtilities(this.state).summary;
      // Keep realtime messages small even for a stroke covering the whole city.
      for (let start = 0; start < buildings.length; start += 128) {
        this.broadcast(S2C.BUILDINGS_PLACED, {
          buildings: buildings.slice(start, start + 128),
          resources: this.state.resources,
        });
      }
      this.onMutated();
    }
    return { success: buildings.length > 0, buildings, error };
  }

  protected addBuilding(
    playerId: string, position: Position, type: BuildingType, density?: ZoneDensity, orientation?: RoadOrientation,
  ): { success: true; building: PlacedBuilding } | { success: false; error?: string } {
    const effOrientation = !orientation && isWaterfront(type)
      ? resolveWaterfrontOrientation(this.state.grid, position, type, this.state.buildings)
      : orientation;
    const result = canPlaceBuilding(
      this.state.grid, position, type, this.state.resources,
      this.unlimitedMoney, this.state.buildings, density, effOrientation,
    );
    if (!result.valid) {
      return { success: false, error: result.reason };
    }

    // Quote total cost (including road grading) before leveling clears steep terrain.
    const { totalCost: cost } = getPlacementCost(
      this.state.grid, position, type, density, effOrientation,
    );

    // A roundabout replaces the roads under it; non-zone surface buildings replace zoned tiles.
    for (const replaced of getReplacedBuildings(this.state.grid, position, type, this.state.buildings, effOrientation)) {
      this.demolishBuilding(replaced.position, 'surface');
    }

    const building: PlacedBuilding = {
      id: newId(),
      type,
      position,
      placedBy: playerId,
      placedAt: this.state.tick,
      ...(isZone(type) ? { developmentLevel: 0, density: density ?? ZoneDensity.MEDIUM } : {}),
      ...(effOrientation ? { orientation: effOrientation } : {}),
    };

    // Grade steep terrain under and 1 tile alongside roads so the road never breaks
    // and adjacent lots become buildable.
    if (isRoad(type)) {
      levelRoadTerrain(this.state.grid, position, type, effOrientation);
    }

    // Update grid layer slot(s)
    setGridBuilding(this.state.grid, building);

    // Update state
    this.state.buildings.push(building);
    if (!this.unlimitedMoney) {
      this.state.resources.money -= cost;
    }
    this.state.updatedAt = Date.now();

    return { success: true, building };
  }

  demolishBuilding(position: Position, layer: UtilityLayer = 'surface'): { success: boolean; error?: string } {
    const building = findGridBuildingToDemolish(this.state.grid, this.state.buildings, position, layer);
    if (!building) {
      return { success: false, error: 'No building here' };
    }

    const buildingId = building.id;
    const def = BUILDING_DEFS[building.type];

    // Clear grid layer slot(s)
    clearGridBuilding(this.state.grid, building);

    // Remove building, refund half of what was actually paid (including any purchased upgrades)
    this.state.buildings = this.state.buildings.filter((b: PlacedBuilding) => b.id !== buildingId);
    if (!this.unlimitedMoney) {
      const paid = getBuildingTotalInvestedCost(building);
      this.state.resources.money += Math.floor(paid / 2);
    }
    this.state.resources.utilities = evaluateCityUtilities(this.state).summary;
    this.state.updatedAt = Date.now();

    this.broadcast(S2C.BUILDING_DEMOLISHED, {
      position,
      buildingId,
      resources: this.state.resources,
    });

    this.onMutated();
    return { success: true };
  }

  setBuildingFleetSize(buildingId: string, fleetSize: number): { success: boolean; building?: PlacedBuilding; error?: string } {
    const building = this.state.buildings.find(b => b.id === buildingId);
    if (!building) {
      return { success: false, error: 'Building not found' };
    }
    const cfg = SERVICE_BUILDING_FLEETS[building.type];
    if (!cfg) {
      return { success: false, error: 'This building does not operate a vehicle fleet' };
    }
    if (!Number.isFinite(fleetSize)) {
      return { success: false, error: 'Invalid fleet size' };
    }
    const clamped = Math.max(0, Math.min(cfg.maxFleet, Math.round(fleetSize)));
    if (clamped === cfg.defaultFleet) {
      delete building.fleetSize;
    } else {
      building.fleetSize = clamped;
    }
    this.state.updatedAt = Date.now();
    this.broadcast(S2C.BUILDING_UPDATED, {
      building,
      resources: this.state.resources,
    });
    this.onMutated();
    return { success: true, building };
  }

  setBuildingPumpLevel(buildingId: string, pumpLevel: number): { success: boolean; building?: PlacedBuilding; error?: string } {
    const building = this.state.buildings.find(b => b.id === buildingId);
    if (!building) {
      return { success: false, error: 'Building not found' };
    }
    const cfg = UTILITY_PUMP_LEVELS[building.type];
    if (!cfg) {
      return { success: false, error: 'This building does not have adjustable pump power levels' };
    }
    if (!Number.isFinite(pumpLevel)) {
      return { success: false, error: 'Invalid pump power level' };
    }
    const clamped = Math.max(1, Math.min(cfg.maxLevel, Math.round(pumpLevel)));
    if (clamped === cfg.defaultLevel) {
      delete building.pumpLevel;
    } else {
      building.pumpLevel = clamped;
    }
    this.state.updatedAt = Date.now();
    this.broadcast(S2C.BUILDING_UPDATED, {
      building,
      resources: this.state.resources,
    });
    this.onMutated();
    return { success: true, building };
  }

  upgradeBuilding(buildingId: string): { success: boolean; building?: PlacedBuilding; error?: string } {
    const idx = this.state.buildings.findIndex(b => b.id === buildingId);
    if (idx === -1) {
      return { success: false, error: 'Building not found' };
    }
    const building = this.state.buildings[idx];
    if (!isUpgradableBuilding(building.type)) {
      return { success: false, error: 'This building cannot be upgraded' };
    }
    const nextTier = getNextUpgradeTier(building);
    if (!nextTier) {
      return { success: false, error: 'Building is already at maximum upgrade level' };
    }
    const cost = getUpgradeTierCost(building.type, nextTier.tier);
    if (!this.unlimitedMoney && this.state.resources.money < cost) {
      return { success: false, error: `Insufficient funds (need $${cost.toLocaleString()})` };
    }

    if (!this.unlimitedMoney) {
      this.state.resources.money -= cost;
    }

    // Replace object reference so persistence diffs detect the updated building row
    const updated: PlacedBuilding = {
      ...building,
      upgradeLevel: nextTier.tier,
    };
    this.state.buildings[idx] = updated;
    this.state.resources.utilities = evaluateCityUtilities(this.state).summary;
    this.state.updatedAt = Date.now();

    this.broadcast(S2C.BUILDING_UPDATED, {
      building: updated,
      resources: this.state.resources,
    });
    this.onMutated();
    return { success: true, building: updated };
  }

  setTaxRate(rate: number): { success: boolean; error?: string } {
    return this.setTaxRates({ residential: rate, commercial: rate, industrial: rate });
  }

  setTaxRates(partial: Partial<TaxRates>): { success: boolean; error?: string } {
    const current = getEffectiveTaxRates(this.state.resources);
    const next: TaxRates = {
      residential: partial.residential ?? current.residential,
      commercial: partial.commercial ?? current.commercial,
      industrial: partial.industrial ?? current.industrial,
    };

    for (const rate of [next.residential, next.commercial, next.industrial]) {
      if (rate < MIN_TAX_RATE || rate > MAX_TAX_RATE || !Number.isInteger(rate)) {
        return { success: false, error: 'Invalid tax rate' };
      }
    }

    this.state.resources.taxRates = next;
    this.state.resources.taxRate = getAverageTaxRate(next);
    this.state.updatedAt = Date.now();

    this.broadcast(S2C.RESOURCES_UPDATE, {
      resources: this.state.resources,
      tick: this.state.tick,
      clock: this.state.clock,
    });

    this.onMutated();
    return { success: true };
  }

  /** Borrow money: the principal lands in the treasury now and is repaid every tick. */
  takeLoan(amount: number, termDays: number): { success: boolean; error?: string } {
    const check = validateLoanRequest(this.state, amount, termDays);
    if (!check.valid) {
      return { success: false, error: check.reason };
    }

    const loan = createLoan(newId(), amount, termDays, this.state.tick, this.state);
    this.state.resources.loans = [...(this.state.resources.loans ?? []), loan];
    this.state.resources.money += amount;
    this.state.updatedAt = Date.now();

    this.broadcastResources();
    this.onMutated();
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
    this.onMutated();
    return { success: true };
  }

  protected broadcastResources(): void {
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
    this.lastEmergencySpawnTick = 0;
    this.state = {
      ...this.state,
      ...createStarterLayout(this.id, this.state.ownerId, this.state.siteId),
      resources: createInitialResources(),
      clock: createInitialClock(),
      tick: 0,
      emergencies: [],
      updatedAt: Date.now(),
    };

    // Broadcast fresh state to all players via channel
    this.broadcast(S2C.CITY_STATE, {
      city: this.state,
      players: this.getPlayerList(),
    });

    this.onMutated();
  }

  /** Replace the city with a planned town. */
  generateTown(settings: TownSettings): void {
    this.lastEmergencySpawnTick = 0;
    const terrain = createEmptyGrid();
    applySiteTerrain(terrain, this.state.siteId);
    const plan = planTown(terrain, settings, newId(), this.state.ownerId);
    this.state = {
      ...this.state,
      ...plan,
      resources: createInitialResources(calculatePlannedTownMoney(plan.buildings)),
      clock: createInitialClock(),
      tick: 0,
      emergencies: [],
      updatedAt: Date.now(),
    };
    this.state.resources.utilities = evaluateCityUtilities(this.state).summary;

    this.broadcast(S2C.CITY_STATE, {
      city: this.state,
      players: this.getPlayerList(),
    });

    this.onMutated();
  }

  getPlayerList(): Player[] {
    return Array.from(this.players.values()).map(e => e.player);
  }

  // Set message manager for this room
  setMessageManager(messageManager: CityMessageSink): void {
    this.messageManager = messageManager;
  }

  /** Sends an event to everyone in this city. Subclasses pick the transport. */
  protected broadcast(_event: string, _data: unknown): void {}

  /** Called after any change worth persisting. Subclasses decide how to save. */
  protected onMutated(): void {}
}
