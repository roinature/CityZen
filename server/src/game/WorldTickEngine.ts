import {
  type WorldState,
  type PopulationSummary,
  S2C,
  TICK_INTERVAL_MS,
  GAME_MS_PER_TICK,
  TICKS_PER_GAME_DAY,
  DAYS_PER_GAME_YEAR,
  MAX_GAME_SPEED,
  MaslowNeed,
  calculateHousingCapacity,
  calculateBirthCount,
} from '@cityzen/shared';
import type { GameRoom } from './GameRoom.js';
import type { PopulationManager } from './PopulationManager.js';
import { broadcastToAll } from '../realtime/supabaseBroadcast.js';

export class WorldTickEngine {
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastGameYear: number;

  constructor(
    private worldState: WorldState,
    private getRooms: () => GameRoom[],
    private populationManager: PopulationManager,
  ) {
    this.lastGameYear = worldState.clock.gameYear;
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

    // Advance world clock
    this.advanceWorldClock();

    const clock = this.worldState.clock;
    const yearChanged = clock.gameYear !== prevYear;

    // On year boundary: age all persons, process deaths, process births
    if (yearChanged && clock.speed > 0) {
      this.processYearBoundary();
    }

    // Tick all active rooms and sync population
    const rooms = this.getRooms();
    for (const room of rooms) {
      const summary = this.populationManager.getCityPopulationSummary(room.id);
      room.worldTick(clock, summary);

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
