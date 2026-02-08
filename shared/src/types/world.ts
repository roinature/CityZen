import type { GameClock } from './time.js';

export interface WorldPosition {
  wx: number;
  wz: number;
}

// Edge directions for road connections between city plots
export type EdgeDirection = 'north' | 'south' | 'east' | 'west';

// Represents roads at a specific edge of a city plot
export interface EdgeConnection {
  direction: EdgeDirection;
  positions: number[]; // Grid positions along the edge where roads exist
}

export interface WorldCityEntry {
  cityId: string;
  ownerId: string;
  ownerName: string;
  name: string;
  position: WorldPosition;
  population: number;
  edgeConnections?: EdgeConnection[]; // Roads at plot edges
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
