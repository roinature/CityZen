import type { WorldState } from '../types/world.js';
import type { CityState } from '../types/city.js';
import type { GameClock } from '../types/time.js';
import type { PopulationSummary, ZonePopulationEntry } from '../types/resources.js';
import { type MigrationEventPayload, S2C } from '../types/events.js';
import {
  TICK_INTERVAL_MS, GAME_MS_PER_TICK, TICKS_PER_GAME_DAY, DAYS_PER_GAME_YEAR, MAX_GAME_SPEED,
  WORLD_POOL_RESERVE, WORLD_POOL_RESERVE_PER_CITY, WORLD_POOL_GROWTH_PER_CITY,
} from '../constants/simulation.js';
import { MaslowNeed } from '../types/person.js';
import { calculateHousingCapacity, calculateBudgetPenalty, calculateTaxPenalty } from '../logic/resources.js';
import { calculateBirthCount } from '../logic/birth.js';
import { calculateCityMaslowCapacity, calculateBaseMaslowTargets } from '../logic/maslow.js';
import { calculateImmigrationCount, calculateEmigrationCount } from '../logic/immigration.js';
import { findConnectedCities, evaluateMigration } from '../logic/migration.js';
import type { PopulationManager } from './PopulationManager.js';

/** What the tick engine needs from each city it drives. */
export interface TickRoom {
  id: string;
  state: CityState;
  worldTick(clock: GameClock, summary?: PopulationSummary, zonePopulations?: ZonePopulationEntry[]): void;
}

/** Where world-level events go: everyone, or one city's players. */
export interface WorldBroadcaster {
  toAll(event: string, payload: unknown): void;
  toCity(cityId: string, event: string, payload: unknown): void;
}

export class WorldTickEngine {
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastGameYear: number;
  private lastGameDay: number;

  constructor(
    private worldState: WorldState,
    private getRooms: () => TickRoom[],
    private populationManager: PopulationManager,
    private broadcaster: WorldBroadcaster,
  ) {
    this.lastGameYear = worldState.clock.gameYear;
    this.lastGameDay = worldState.clock.gameDay;
  }

  /** Advance the world by one tick. start() calls this on a timer. */
  step(): void {
    this.tick();
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    console.log('World tick engine started');
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  setGameSpeed(speed: number): { success: boolean; error?: string } {
    if (speed < 0 || speed > MAX_GAME_SPEED || !Number.isInteger(speed)) {
      return { success: false, error: 'Invalid game speed' };
    }
    this.worldState.clock.speed = speed;
    return { success: true };
  }

  getGameSpeed(): number {
    return this.worldState.clock.speed;
  }

  private tick(): void {
    const prevYear = this.worldState.clock.gameYear;
    const prevDay = this.worldState.clock.gameDay;

    // Advance world clock
    this.advanceWorldClock();

    const clock = this.worldState.clock;
    const yearChanged = clock.gameYear !== prevYear;
    const dayChanged = clock.gameDay !== prevDay;

    // On year boundary: age all persons, process deaths, process births
    if (yearChanged && clock.speed > 0) {
      this.processYearBoundary();
    }

    // On day boundary: evaluate migration between connected cities,
    // then let people abandon cities that are making them miserable
    if (dayChanged && clock.speed > 0) {
      this.processDailyMigration();
      this.processDailyEmigration();
    }

    // Tick all active rooms: update Maslow → assign zones → compute summary → tick room
    const rooms = this.getRooms();

    if (clock.speed > 0) {
      this.growWorldPool(rooms.length);
    }
    for (const room of rooms) {
      // Update each person's Maslow satisfaction toward city-provided targets
      if (clock.speed > 0) {
        const maslowProfile = calculateCityMaslowCapacity(room.state);
        const popCount = this.populationManager.getCityPopulationCount(room.id);
        const baseTargets = calculateBaseMaslowTargets(maslowProfile, popCount);

        // Apply budget penalty: deficit reduces Maslow targets (cascading failure)
        // Tax penalty: rates above the comfort rate make everyone less satisfied
        const budgetMultiplier =
          calculateBudgetPenalty(room.state.resources.money) *
          calculateTaxPenalty(room.state.resources.taxRate);
        if (budgetMultiplier < 1.0) {
          for (const need of Object.keys(baseTargets) as Array<keyof typeof baseTargets>) {
            baseTargets[need] *= budgetMultiplier;
          }
        }

        this.populationManager.updateCityMaslow(room.id, baseTargets);

        // Immigration: vacant housing attracts people from the unassigned world pool
        const arrivals = calculateImmigrationCount(
          calculateHousingCapacity(room.state) - popCount,
          room.state.resources.happiness,
          this.populationManager.getUnassignedCount(),
        );
        if (arrivals > 0) {
          this.populationManager.seedCity(room.id, arrivals);
        }

        // Assign/reassign people to residential zones
        this.populationManager.assignPeopleToZones(room.id, room.state.buildings);
      }

      const summary = this.populationManager.getCityPopulationSummary(room.id);
      const zonePopulations = this.populationManager.getZonePopulations(room.id, room.state.buildings);
      room.worldTick(clock, summary, zonePopulations);

      // Update world city entry with latest population/happiness
      const cityEntry = this.worldState.cities.find(c => c.cityId === room.id);
      if (cityEntry) {
        cityEntry.population = summary.total;
        cityEntry.happiness = summary.averageHappiness;
      }
    }

    // Update world total population
    this.worldState.totalPopulation = this.populationManager.getTotalPopulation();

    // Broadcast world tick to all clients
    this.broadcaster.toAll(S2C.WORLD_TICK, {
      clock,
      totalPopulation: this.worldState.totalPopulation,
      citySummaries: this.worldState.cities.map(c => ({
        cityId: c.cityId,
        population: c.population,
        happiness: c.happiness,
      })),
    });
  }

  private processDailyMigration(): void {
    const cities = this.worldState.cities;
    if (cities.length < 2) return;

    // Aggregate migrations per route for broadcasting
    const migrationRoutes = new Map<string, { fromCityId: string; toCityId: string; count: number }>();

    for (const cityEntry of cities) {
      const connectedCities = findConnectedCities(cityEntry, cities);
      if (connectedCities.length === 0) continue;

      const persons = this.populationManager.getCityPopulation(cityEntry.cityId);
      const candidates = evaluateMigration(cityEntry, persons, connectedCities);

      for (const candidate of candidates) {
        this.populationManager.migrate(candidate.personId, candidate.fromCityId, candidate.toCityId);

        const routeKey = `${candidate.fromCityId}->${candidate.toCityId}`;
        const existing = migrationRoutes.get(routeKey);
        if (existing) {
          existing.count++;
        } else {
          migrationRoutes.set(routeKey, {
            fromCityId: candidate.fromCityId,
            toCityId: candidate.toCityId,
            count: 1,
          });
        }
      }
    }

    // Broadcast migration events to affected city channels
    for (const route of migrationRoutes.values()) {
      const payload: MigrationEventPayload = {
        personCount: route.count,
        fromCityId: route.fromCityId,
        toCityId: route.toCityId,
        reason: 'low_happiness',
      };
      this.broadcaster.toCity(route.fromCityId, S2C.MIGRATION_EVENT, payload);
      this.broadcaster.toCity(route.toCityId, S2C.MIGRATION_EVENT, payload);

      const fromName = this.worldState.cities.find(c => c.cityId === route.fromCityId)?.name ?? route.fromCityId;
      const toName = this.worldState.cities.find(c => c.cityId === route.toCityId)?.name ?? route.toCityId;
      console.log(`Migration: ${route.count} people moved from "${fromName}" to "${toName}"`);
    }
  }

  /**
   * The unclaimed population grows by itself up to a reserve, so there are always
   * newcomers for cities with vacant homes. Without this the world's starting
   * population was a hard cap on every city in it.
   */
  private growWorldPool(cityCount: number): void {
    const cities = Math.max(1, cityCount);
    const reserve = WORLD_POOL_RESERVE + WORLD_POOL_RESERVE_PER_CITY * cities;
    const missing = reserve - this.populationManager.getUnassignedCount();
    if (missing <= 0) return;

    this.populationManager.growWorldPool(
      Math.min(missing, WORLD_POOL_GROWTH_PER_CITY * cities),
      this.worldState.clock.gameTimeMs,
    );
  }

  /** Residents of very unhappy cities move back to the world pool, a few per game day. */
  private processDailyEmigration(): void {
    for (const room of this.getRooms()) {
      const population = this.populationManager.getCityPopulationCount(room.id);
      const leaving = calculateEmigrationCount(population, room.state.resources.happiness);
      if (leaving <= 0) continue;

      const left = this.populationManager.leaveCity(room.id, leaving);
      if (left > 0) {
        console.log(`Emigration: ${left} people left "${room.state.name}" (happiness ${Math.round(room.state.resources.happiness)})`);
      }
    }
  }

  private processYearBoundary(): void {
    // 1. Age everyone
    this.populationManager.ageAll();

    // 2. Process deaths in all cities
    const rooms = this.getRooms();
    let totalDeaths = 0;

    for (const room of rooms) {
      const deceased = this.populationManager.processCityDeaths(room.id);
      totalDeaths += deceased.length;
    }

    // Process deaths in unassigned pool too
    const unassignedDeceased = this.populationManager.processUnassignedDeaths();
    totalDeaths += unassignedDeceased.length;

    // 3. Process births in each city
    let totalBirths = 0;

    for (const room of rooms) {
      const fertileCount = this.populationManager.getCityFertileCount(room.id);
      const housingCapacity = calculateHousingCapacity(room.state);
      const currentPop = this.populationManager.getCityPopulationCount(room.id);
      const avgLoveBelonging = this.populationManager.getCityAverageMaslowNeed(
        room.id,
        MaslowNeed.LOVE_BELONGING,
      );

      const expectedBirths = calculateBirthCount(
        fertileCount,
        avgLoveBelonging,
        housingCapacity,
        currentPop,
      );

      // Integer part guaranteed, fractional part is probabilistic
      const guaranteed = Math.floor(expectedBirths);
      const fractional = expectedBirths - guaranteed;
      const actualBirths = guaranteed + (Math.random() < fractional ? 1 : 0);

      for (let i = 0; i < actualBirths; i++) {
        this.populationManager.birth(room.id, this.worldState.clock.gameTimeMs);
      }
      totalBirths += actualBirths;
    }

    if (totalBirths > 0 || totalDeaths > 0) {
      console.log(`Year ${this.worldState.clock.gameYear}: ${totalBirths} births, ${totalDeaths} deaths (world pop: ${this.populationManager.getTotalPopulation()})`);
    }
  }

  private advanceWorldClock(): void {
    const clock = this.worldState.clock;
    const speed = clock.speed;
    clock.gameTimeMs += GAME_MS_PER_TICK * speed;
    const totalDays = Math.floor(clock.gameTimeMs / (GAME_MS_PER_TICK * TICKS_PER_GAME_DAY));
    clock.gameDay = totalDays % DAYS_PER_GAME_YEAR;
    clock.gameYear = Math.floor(totalDays / DAYS_PER_GAME_YEAR) + 1;
  }
}
