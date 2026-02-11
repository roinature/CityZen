import {
  type WorldState,
  type MigrationEventPayload,
  type ZonePopulationEntry,
  S2C,
  TICK_INTERVAL_MS,
  GAME_MS_PER_TICK,
  TICKS_PER_GAME_DAY,
  DAYS_PER_GAME_YEAR,
  MAX_GAME_SPEED,
  MaslowNeed,
  calculateHousingCapacity,
  calculateBirthCount,
  calculateCityMaslowCapacity,
  calculateBaseMaslowTargets,
  calculateBudgetPenalty,
  findConnectedCities,
  evaluateMigration,
} from '@cityzen/shared';
import type { GameRoom } from './GameRoom.js';
import type { PopulationManager } from './PopulationManager.js';
import { broadcastToAll, broadcastToChannel } from '../realtime/supabaseBroadcast.js';

export class WorldTickEngine {
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastGameYear: number;
  private lastGameDay: number;

  constructor(
    private worldState: WorldState,
    private getRooms: () => GameRoom[],
    private populationManager: PopulationManager,
  ) {
    this.lastGameYear = worldState.clock.gameYear;
    this.lastGameDay = worldState.clock.gameDay;
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

    // On day boundary: evaluate migration between connected cities
    if (dayChanged && clock.speed > 0) {
      this.processDailyMigration();
    }

    // Tick all active rooms: update Maslow → assign zones → compute summary → tick room
    const rooms = this.getRooms();
    for (const room of rooms) {
      // Update each person's Maslow satisfaction toward city-provided targets
      if (clock.speed > 0) {
        const maslowProfile = calculateCityMaslowCapacity(room.state);
        const popCount = this.populationManager.getCityPopulationCount(room.id);
        const baseTargets = calculateBaseMaslowTargets(maslowProfile, popCount);

        // Apply budget penalty: deficit reduces Maslow targets (cascading failure)
        const budgetMultiplier = calculateBudgetPenalty(room.state.resources.money);
        if (budgetMultiplier < 1.0) {
          for (const need of Object.keys(baseTargets) as Array<keyof typeof baseTargets>) {
            baseTargets[need] *= budgetMultiplier;
          }
        }

        this.populationManager.updateCityMaslow(room.id, baseTargets);

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
    broadcastToAll(S2C.WORLD_TICK, {
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
      broadcastToChannel(`city:${route.fromCityId}`, S2C.MIGRATION_EVENT, payload);
      broadcastToChannel(`city:${route.toCityId}`, S2C.MIGRATION_EVENT, payload);

      const fromName = this.worldState.cities.find(c => c.cityId === route.fromCityId)?.name ?? route.fromCityId;
      const toName = this.worldState.cities.find(c => c.cityId === route.toCityId)?.name ?? route.toCityId;
      console.log(`Migration: ${route.count} people moved from "${fromName}" to "${toName}"`);
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
