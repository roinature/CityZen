import { io, Socket } from 'socket.io-client';
import {
  C2S,
  S2C,
  type CityState,
  type CityStatePayload,
  type BuildingPlacedPayload,
  type BuildingDemolishedPayload,
  type ErrorPayload,
  type Position,
  type BuildingType,
  type ResourceState,
  type Player,
  type CityListItem,
} from '@cityzen/shared';

export interface GameCallbacks {
  onCityState: (city: CityState, players: Player[]) => void;
  onBuildingPlaced: (payload: BuildingPlacedPayload) => void;
  onBuildingDemolished: (payload: BuildingDemolishedPayload) => void;
  onResourcesUpdate: (resources: ResourceState, tick: number) => void;
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

    this.socket.on(S2C.RESOURCES_UPDATE, (payload: { resources: ResourceState; tick: number }) => {
      this.callbacks.onResourcesUpdate(payload.resources, payload.tick);
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

  createCity(cityName: string, playerName: string): void {
    this.socket.emit(C2S.CREATE_CITY, { cityName, playerName });
  }

  joinCity(cityId: string, playerName: string): void {
    this.socket.emit(C2S.JOIN_CITY, { cityId, playerName });
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

  leave(): void {
    this.socket.emit(C2S.LEAVE);
  }

  disconnect(): void {
    this.socket.disconnect();
  }
}
