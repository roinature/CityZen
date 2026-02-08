import type { GameClock } from './time.js';

export interface WorldPosition {
  wx: number;
  wz: number;
}

export interface WorldCityEntry {
  cityId: string;
  ownerId: string;
  ownerName: string;
  name: string;
  position: WorldPosition;
  population: number;
}

export interface WorldState {
  id: string;
  name: string;
  gridSize: number;
  cities: WorldCityEntry[];
  clock: GameClock;
  createdAt: number;
  updatedAt: number;
}
