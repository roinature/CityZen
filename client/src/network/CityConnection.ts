import type {
  BuildingType, CityListItem, PlaceBuildingsPayload, Position, RoadOrientation, TownSettings, ZoneDensity,
} from '@cityzen/shared';

/**
 * What the game UI needs from its connection to a city. GameClient talks to the
 * CityZen server; P2PGameClient talks to friends over WebRTC with one browser
 * acting as the host.
 */
export interface CityConnection {
  fetchWorldState(): Promise<boolean>;
  listCities(): Promise<CityListItem[]>;
  claimPlot(siteId: string, cityName: string, playerName: string, playerId?: string): Promise<void>;
  joinCity(cityId: string, playerName: string, playerId?: string): Promise<void>;
  placeBuilding(position: Position, type: BuildingType, playerId?: string, density?: ZoneDensity, orientation?: RoadOrientation): Promise<void>;
  paintBuildings(stroke: PlaceBuildingsPayload, playerId: string): Promise<void>;
  demolish(position: Position, playerId?: string): Promise<void>;
  save(playerId?: string): Promise<void>;
  restart(playerId?: string): Promise<void>;
  generateTown(settings: TownSettings, playerId: string): Promise<boolean>;
  setTaxRate(taxRate: number, playerId?: string): Promise<void>;
  takeLoan(amount: number, termDays: number, playerId?: string): Promise<{ success: boolean; error?: string }>;
  repayLoan(loanId: string, playerId?: string): Promise<{ success: boolean; error?: string }>;
  setUnlimitedMoney(enabled: boolean, playerId?: string): Promise<void>;
  setGameSpeed(speed: number, playerId?: string): Promise<void>;
  leave(playerId?: string): Promise<void>;
  disconnect(): void;
  /** Optional local backup export (P2P mode). */
  exportBackup?(): Promise<string>;
  /** Optional local backup import (P2P mode). Returns true if applied. */
  importBackup?(rawJson: string): Promise<boolean>;
}
