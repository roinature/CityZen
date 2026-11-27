import {
  type CityState,
  type GameClock,
  type PlaceBuildingsPayload,
  type PlacedBuilding,
  type WorldCityEntry,
  type WorldState,
  CityRoom,
  DEFAULT_GRID_SIZE,
  EARTH_SITES,
  INITIAL_CITY_SEED,
  PopulationManager,
  S2C,
  WorldTickEngine,
  ZoneDensity,
  calculateEdgeConnections,
  getSite,
  isRoad,
  isZone,
  newId,
  normalizeTownSettings,
} from '@cityzen/shared';

/** Everything needed to resume a peer-to-peer game: saved locally and copied to every guest. */
export interface P2PSnapshot {
  version: 1;
  world: WorldState;
  city: CityState | null;
  population: unknown[];
  savedAt: number;
}

export type Emit = (event: string, data: unknown) => void;

export interface CommandResult {
  success: boolean;
  error?: string;
  code?: string;
  [key: string]: unknown;
}

/** One city whose broadcasts go to the host's peers instead of a server channel. */
class PeerCityRoom extends CityRoom {
  constructor(
    id: string, name: string, ownerId: string, ownerName: string, existing: CityState | undefined, siteId: string | undefined,
    private readonly emit: Emit,
  ) {
    super(id, name, ownerId, ownerName, existing, siteId);
  }

  protected override broadcast(event: string, data: unknown): void {
    this.emit(event, data);
  }
}

function createWorld(): WorldState {
  const clock: GameClock = { gameTimeMs: 0, speed: 1, gameDay: 0, gameYear: 1 };
  return {
    id: 'default',
    name: 'Earth',
    gridSize: 8,
    maxCities: EARTH_SITES.length,
    cities: [],
    clock,
    totalPopulation: 100,
    initialPopulation: 100,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

const SAVE_INTERVAL_MS = 10_000;

/**
 * The authoritative game, running in the host player's browser. It plays the
 * part of the server's WorldManager + GameRoom for a single city: guests send it
 * commands, it applies the shared rules and emits the same events the server does.
 */
export class HostCity {
  readonly world: WorldState;
  private room: PeerCityRoom | null = null;
  private readonly population: PopulationManager;
  private readonly engine: WorldTickEngine;
  private saveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    snapshot: P2PSnapshot | null,
    private readonly emit: Emit,
    private readonly persist: (snapshot: P2PSnapshot) => void,
  ) {
    this.world = snapshot?.world ? structuredClone(snapshot.world) : createWorld();
    if (snapshot?.population?.length) {
      this.population = PopulationManager.deserialize(snapshot.population);
    } else {
      this.population = new PopulationManager();
      this.population.initWorldPopulation(this.world.initialPopulation, this.world.clock.gameTimeMs);
    }
    if (snapshot?.city) {
      const city = structuredClone(snapshot.city);
      const entry = this.world.cities.find(c => c.cityId === city.id);
      this.room = this.createRoom(city.id, city.name, city.ownerId, entry?.ownerName ?? 'Unknown', city, city.siteId);
    }
    this.engine = new WorldTickEngine(this.world, () => (this.room ? [this.room] : []), this.population, {
      toAll: (event, payload) => this.emit(event, payload),
      toCity: (cityId, event, payload) => { if (this.room?.id === cityId) this.emit(event, payload); },
    });
  }

  get cityId(): string | null {
    return this.room?.id ?? null;
  }

  start(): void {
    this.engine.start();
    this.saveTimer = setInterval(() => this.save(), SAVE_INTERVAL_MS);
  }

  stop(): void {
    this.engine.stop();
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.saveTimer = null;
    this.save();
  }

  snapshot(): P2PSnapshot {
    return {
      version: 1,
      world: this.world,
      city: this.room?.state ?? null,
      population: this.population.serialize(),
      savedAt: Date.now(),
    };
  }

  save(): void {
    this.persist(this.snapshot());
  }

  /** A guest's connection dropped: take their player out of the city. */
  dropPlayer(playerId: string): void {
    this.room?.removePlayer(playerId);
  }

  /** Apply one command from a player (the host's own or a guest's). */
  handle(op: string, args: Record<string, any>, playerId: string, isHostPlayer: boolean): CommandResult {
    if (op === 'claim') return this.claim(args.siteId, args.cityName, playerId, args.playerName);
    if (op === 'speed') return this.engine.setGameSpeed(args.speed);

    const room = this.room;
    if (!room) return { success: false, error: 'Not in a city', code: 'NO_ROOM' };

    switch (op) {
      case 'join':
        if (args.cityId !== room.id) return { success: false, error: 'City not found', code: 'CITY_NOT_FOUND' };
        room.addPlayer(playerId, String(args.playerName || 'Player').slice(0, 40));
        return { success: true };
      case 'leave':
        room.removePlayer(playerId);
        return { success: true };
      case 'place': {
        const result = room.placeBuilding(playerId, args.position, args.type, args.density, args.orientation);
        if (result.success && isRoad(args.type)) this.publishEdges();
        return result.success ? { success: true } : { ...result, code: 'PLACEMENT_FAILED' };
      }
      case 'placeBatch': {
        const stroke = args as PlaceBuildingsPayload;
        if (!isValidStroke(stroke)) return { success: false, error: 'Invalid build stroke', code: 'PLACEMENT_FAILED' };
        const { success, buildings, error } = room.placeBuildings(playerId, stroke);
        if (success && isRoad(stroke.type)) this.publishEdges();
        return { success, error, placement: success ? { buildings, resources: room.state.resources } : undefined };
      }
      case 'demolish': {
        const cell = room.state.grid[args.position?.x]?.[args.position?.z];
        const building = cell?.buildingId
          ? room.state.buildings.find((b: PlacedBuilding) => b.id === cell.buildingId)
          : undefined;
        const result = room.demolishBuilding(args.position);
        if (result.success && building && isRoad(building.type)) this.publishEdges();
        return result.success ? { success: true } : { ...result, code: 'DEMOLISH_FAILED' };
      }
      case 'tax':
        return room.setTaxRate(args.taxRate);
      case 'loanTake':
        return room.takeLoan(Number(args.amount), Number(args.termDays));
      case 'loanRepay':
        return room.repayLoan(args.loanId);
      case 'unlimited':
        // Every player re-sends their own option on join; only the host's counts,
        // or guests would keep switching it back and forth.
        if (isHostPlayer) room.setUnlimitedMoney(args.enabled === true);
        return { success: true };
      case 'save':
        this.save();
        return { success: true };
      case 'restart':
        room.restart();
        this.publishEdges();
        return { success: true };
      case 'generate':
        room.generateTown(normalizeTownSettings(args.settings));
        this.publishEdges();
        return { success: true, city: room.state, players: room.getPlayerList() };
      default:
        return { success: false, error: `Unknown command: ${op}` };
    }
  }

  private claim(siteId: string, cityName: string, playerId: string, playerName: string): CommandResult {
    const site = getSite(siteId);
    if (!site) return { success: false, error: 'Choose an Earth site' };
    if (this.room) return { success: false, error: 'This game already has a city. Join it from the map.' };
    const name = String(cityName || 'New City').slice(0, 40);
    const ownerName = String(playerName || 'Player').slice(0, 40);
    const room = this.createRoom(newId(), name, playerId, ownerName, undefined, site.id);
    this.room = room;
    const entry: WorldCityEntry = {
      cityId: room.id, ownerId: playerId, ownerName, name, position: site.position, siteId: site.id,
      population: this.population.seedCity(room.id, INITIAL_CITY_SEED).length,
      happiness: 50,
      edgeConnections: calculateEdgeConnections(room.state.buildings),
    };
    this.world.cities = [entry];
    this.world.updatedAt = Date.now();
    this.emit(S2C.WORLD_STATE, { world: this.world });
    this.save();
    return { success: true, cityId: room.id };
  }

  private createRoom(
    id: string, name: string, ownerId: string, ownerName: string, existing: CityState | undefined, siteId: string | undefined,
  ): PeerCityRoom {
    // Saving happens on a timer (the tick changes the city constantly anyway).
    return new PeerCityRoom(id, name, ownerId, ownerName, existing, siteId, this.emit);
  }

  /** Keep the world map's edge roads in step with the city (roads link neighbouring cities). */
  private publishEdges(): void {
    const room = this.room;
    const entry = room && this.world.cities.find(c => c.cityId === room.id);
    if (!room || !entry) return;
    entry.edgeConnections = calculateEdgeConnections(room.state.buildings);
    this.world.updatedAt = Date.now();
    this.emit(S2C.WORLD_STATE, { world: this.world });
  }
}

function isValidStroke({ positions, type, density, orientation }: PlaceBuildingsPayload): boolean {
  return (isRoad(type) || isZone(type))
    && (density === undefined || Object.values(ZoneDensity).includes(density))
    && (orientation === undefined || orientation === 'NS' || orientation === 'EW')
    && Array.isArray(positions) && positions.length > 0 && positions.length <= DEFAULT_GRID_SIZE ** 2
    && positions.every(pos => Number.isInteger(pos?.x) && Number.isInteger(pos?.z)
      && pos.x >= 0 && pos.z >= 0 && pos.x < DEFAULT_GRID_SIZE && pos.z < DEFAULT_GRID_SIZE);
}
