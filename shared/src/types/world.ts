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
  siteId?: string;
  cityId: string;
  ownerId: string;
  ownerName: string;
  name: string;
  position: WorldPosition;
  population: number;
  happiness: number;
  edgeConnections?: EdgeConnection[]; // Roads at plot edges
  /** Optional distributed P2P presence metadata (ignored by central server). */
  online?: boolean;
  /** True when a local read-only cached snapshot exists for an offline peer's city. */
  hasCachedSnapshot?: boolean;
  /** Last timestamp (ms) when this city's summary was heard from its owner. */
  lastSeen?: number;
  /** Creation timestamp (ms), used for deterministic tie-breaking on offline site claims. */
  createdAt?: number;
}

export interface WorldState {
  id: string;
  name: string;
  gridSize: number;
  maxCities: number;
  cities: WorldCityEntry[];
  clock: GameClock;
  totalPopulation: number;
  initialPopulation: number;
  createdAt: number;
  updatedAt: number;
}
