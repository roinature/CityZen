import { io, Socket } from 'socket.io-client';
import {
  C2S,
  S2C,
  type CityStatePayload,
  type BuildingPlacedPayload,
  type BuildingDemolishedPayload,
  type ResourcesUpdatePayload,
  type ZoneGrowthPayload,
  type ErrorPayload,
  type Position,
  type BuildingType,
  type ResourceState,
  type GameClock,
  type Player,
} from '@cityzen/shared';

export interface GameCallbacks {
  onCityState: (city: import('@cityzen/shared').CityState, players: Player[]) => void;
  onBuildingPlaced: (payload: BuildingPlacedPayload) => void;
  onBuildingDemolished: (payload: BuildingDemolishedPayload) => void;
  onResourcesUpdate: (resources: ResourceState, tick: number, clock: GameClock) => void;
  onZoneGrowth: (payload: ZoneGrowthPayload) => void;
  onPlayerJoined: (player: Player) => void;
  onPlayerLeft: (playerId: string) => void;
  onError: (error: ErrorPayload) => void;
  onSaved?: () => void;
}

export class SocketClient {
  private socket: Socket;
  private callbacks: GameCallbacks;

  constructor(serverUrl: string, callbacks: GameCallbacks) {
    this.callbacks = callbacks;
    this.socket = io(serverUrl);
    this.setupListeners();
  }

  private setupListeners(): void {
    this.socket.on(S2C.CITY_STATE, (payload: CityStatePayload) => {
      this.callbacks.onCityState(payload.city, payload.players);
    });

    this.socket.on(S2C.BUILDING_PLACED, (payload: BuildingPlacedPayload) => {
      this.callbacks.onBuildingPlaced(payload);
    });

    this.socket.on(S2C.BUILDING_DEMOLISHED, (payload: BuildingDemolishedPayload) => {
      this.callbacks.onBuildingDemolished(payload);
    });

    this.socket.on(S2C.RESOURCES_UPDATE, (payload: ResourcesUpdatePayload) => {
      this.callbacks.onResourcesUpdate(payload.resources, payload.tick, payload.clock);
    });

    this.socket.on(S2C.ZONE_GROWTH, (payload: ZoneGrowthPayload) => {
      this.callbacks.onZoneGrowth(payload);
    });

    this.socket.on(S2C.PLAYER_JOINED, (payload: { player: Player }) => {
      this.callbacks.onPlayerJoined(payload.player);
    });

    this.socket.on(S2C.PLAYER_LEFT, (payload: { playerId: string }) => {
      this.callbacks.onPlayerLeft(payload.playerId);
    });

    this.socket.on(S2C.ERROR, (payload: ErrorPayload) => {
      this.callbacks.onError(payload);
    });

    this.socket.on(S2C.SAVE_OK, () => {
      this.callbacks.onSaved?.();
    });
  }

  createCity(cityName: string, playerName: string, playerId?: string): void {
    this.socket.emit(C2S.CREATE_CITY, { cityName, playerName, playerId });
  }

  joinCity(cityId: string, playerName: string, playerId?: string): void {
    this.socket.emit(C2S.JOIN_CITY, { cityId, playerName, playerId });
  }

  placeBuilding(position: Position, type: BuildingType): void {
    this.socket.emit(C2S.PLACE_BUILDING, { position, type });
  }

  demolish(position: Position): void {
    this.socket.emit(C2S.DEMOLISH, { position });
  }

  save(): void {
    this.socket.emit(C2S.SAVE);
  }

  restart(): void {
    this.socket.emit(C2S.RESTART);
  }

  setTaxRate(taxRate: number): void {
    this.socket.emit(C2S.SET_TAX_RATE, { taxRate });
  }

  setUnlimitedMoney(enabled: boolean): void {
    this.socket.emit(C2S.SET_UNLIMITED_MONEY, { enabled });
  }

  setGameSpeed(speed: number): void {
    this.socket.emit(C2S.SET_GAME_SPEED, { speed });
  }

  leave(): void {
    this.socket.emit(C2S.LEAVE);
  }

  disconnect(): void {
    this.socket.disconnect();
  }
}
