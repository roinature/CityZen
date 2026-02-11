import {
  type WorldState,
  type GameClock,
  S2C,
  TICK_INTERVAL_MS,
  GAME_MS_PER_TICK,
  TICKS_PER_GAME_DAY,
  DAYS_PER_GAME_YEAR,
  MAX_GAME_SPEED,
} from '@cityzen/shared';
import type { GameRoom } from './GameRoom.js';
import { broadcastToAll } from '../realtime/supabaseBroadcast.js';

export class WorldTickEngine {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private worldState: WorldState,
    private getRooms: () => GameRoom[],
  ) {}

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
    // Advance world clock
    this.advanceWorldClock();

    const clock = this.worldState.clock;

    // Tick all active rooms
    const rooms = this.getRooms();
    for (const room of rooms) {
      room.worldTick(clock);
    }

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

  private advanceWorldClock(): void {
    const clock = this.worldState.clock;
    const speed = clock.speed;
    clock.gameTimeMs += GAME_MS_PER_TICK * speed;
    const totalDays = Math.floor(clock.gameTimeMs / (GAME_MS_PER_TICK * TICKS_PER_GAME_DAY));
    clock.gameDay = totalDays % DAYS_PER_GAME_YEAR;
    clock.gameYear = Math.floor(totalDays / DAYS_PER_GAME_YEAR) + 1;
  }
}
