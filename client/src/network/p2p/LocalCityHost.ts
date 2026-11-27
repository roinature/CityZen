import {
  type CityState,
  type GameClock,
  type PlaceBuildingsPayload,
  type PlacedBuilding,
  type SerializedPerson,
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
import type { OwnedCityRecord, OwnedWorldRecord } from './LocalStore.js';
import { resolveSiteConflicts } from './siteConflict.js';

export interface CommandResult {
  success: boolean;
  error?: string;
  code?: string;
  [key: string]: unknown;
}

export interface CityEventSink {
  /** Send an event to viewers of a specific owned city (or only `onlyPeerId` when set). */
  onCityEvent(cityId: string, event: string, data: unknown, onlyPeerId?: string | 'local'): void;
  /** Called whenever our owned world entries change (claim, road edge, summary). */
  onOwnedSummariesChanged(entries: WorldCityEntry[]): void;
  /** Called when residents of an owned city want to migrate to a remote peer's city. */
  onRemoteMigration(fromCityId: string, toCityId: string, personIds: string[]): void;
  /** Persist our owned world state to IndexedDB. */
  persist(record: OwnedWorldRecord): Promise<void>;
}

/** One owned city whose broadcasts route through LocalCityHost. */
class OwnedPeerCityRoom extends CityRoom {
  constructor(
    id: string,
    name: string,
    ownerId: string,
    ownerName: string,
    existing: CityState | undefined,
    siteId: string | undefined,
    private readonly onEvent: (event: string, data: unknown) => void,
    private readonly onDirty: () => void,
  ) {
    super(id, name, ownerId, ownerName, existing, siteId);
  }

  protected override broadcast(event: string, data: unknown): void {
    this.onEvent(event, data);
  }

  protected override onMutated(): void {
    this.onDirty();
  }
}

function createInitialClock(): GameClock {
  return { gameTimeMs: 0, speed: 1, gameDay: 0, gameYear: 1 };
}

function createWorldState(worldId: string, clock: GameClock): WorldState {
  return {
    id: worldId,
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

const SAVE_DEBOUNCE_MS = 2_000;
const PERIODIC_SAVE_TICKS = 5; // Save tick progress roughly every 10s when running

/**
 * Owner-authoritative local simulation host for one player's owned cities in a
 * distributed P2P world.
 *
 * Unlike a shared single-host server, each browser runs `LocalCityHost` only
 * for the cities it owns. Remote peers' cities are merged into `this.world` as
 * read-only neighbor entries so edge road links and citizen migration work
 * seamlessly across devices.
 */
export class LocalCityHost {
  readonly world: WorldState;
  private readonly rooms = new Map<string, OwnedPeerCityRoom>();
  private readonly createdAtByCity = new Map<string, number>();
  /** Remote visitors per owned city: cityId -> (peerId -> playerId). */
  private readonly visitors = new Map<string, Map<string, string>>();
  /** Non-owned cities (online peers + cached offline peers). */
  private remoteEntries = new Map<string, WorldCityEntry>();
  private readonly population: PopulationManager;
  private readonly engine: WorldTickEngine;

  private dirty = false;
  private ticksSinceSave = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Scopes CITY_STATE emitted inside CityRoom.addPlayer() solely to the joining peer. */
  private pendingJoinTarget: string | 'local' | null = null;

  constructor(
    private readonly worldId: string,
    private readonly ownerId: string,
    initialRecord: OwnedWorldRecord | null,
    private readonly sink: CityEventSink,
  ) {
    const clock = initialRecord?.clock ? structuredClone(initialRecord.clock) : createInitialClock();
    this.world = createWorldState(worldId, clock);

    if (initialRecord?.population?.length) {
      this.population = PopulationManager.deserialize(initialRecord.population);
    } else {
      this.population = new PopulationManager();
      this.population.initWorldPopulation(this.world.initialPopulation, clock.gameTimeMs);
    }

    for (const saved of initialRecord?.cities ?? []) {
      const city = structuredClone(saved.city);
      const room = this.createOwnedRoom(city.id, city.name, city.ownerId || ownerId, 'You', city, city.siteId);
      this.rooms.set(city.id, room);
      this.createdAtByCity.set(city.id, saved.createdAt || city.createdAt || Date.now());
    }

    this.rebuildWorldCities();

    this.engine = new WorldTickEngine(
      this.world,
      () => Array.from(this.rooms.values()),
      this.population,
      {
        toAll: (event, payload) => {
          if (event === S2C.WORLD_TICK && this.rooms.size > 0) {
            this.ticksSinceSave++;
            if (this.world.clock.speed > 0 && this.ticksSinceSave >= PERIODIC_SAVE_TICKS) {
              this.ticksSinceSave = 0;
              this.markDirty();
            }
            this.sink.onOwnedSummariesChanged(this.getOwnedEntries());
          }
          // Notify local UI about world ticks
          this.sink.onCityEvent('__world__', event, payload, 'local');
        },
        toCity: (cityId, event, payload) => {
          if (this.rooms.has(cityId)) {
            this.sink.onCityEvent(cityId, event, payload);
          }
        },
      },
      {
        onRemoteMigration: (fromCityId, toCityId, personIds) => {
          this.sink.onRemoteMigration(fromCityId, toCityId, personIds);
        },
      },
    );
  }

  start(): void {
    this.engine.start();
  }

  stop(): void {
    this.engine.stop();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    void this.flushSave();
  }

  ownsCity(cityId: string): boolean {
    return this.rooms.has(cityId);
  }

  getOwnedCityIds(): string[] {
    return Array.from(this.rooms.keys());
  }

  getOwnedCityState(cityId: string): CityState | null {
    return this.rooms.get(cityId)?.state ?? null;
  }

  getVisitorPeerIds(cityId: string): string[] {
    const map = this.visitors.get(cityId);
    return map ? Array.from(map.keys()) : [];
  }

  getVisitorCount(cityId: string): number {
    return this.visitors.get(cityId)?.size ?? 0;
  }

  /** Remove a disconnected remote peer from every owned city it was visiting. */
  dropPeer(peerId: string): void {
    for (const [cityId, map] of this.visitors.entries()) {
      const playerId = map.get(peerId);
      if (!playerId) continue;
      map.delete(peerId);
      this.rooms.get(cityId)?.removePlayer(playerId);
    }
  }

  /** Replace the known non-owned cities (online peers + offline IndexedDB cache). */
  setRemoteCities(entries: WorldCityEntry[]): { conflictingOwnedCityIds: string[] } {
    this.remoteEntries.clear();
    for (const entry of entries) {
      if (!this.rooms.has(entry.cityId)) {
        this.remoteEntries.set(entry.cityId, entry);
      }
    }
    return this.rebuildWorldCities();
  }

  /** Build lightweight summary entries for all cities owned by this device. */
  getOwnedEntries(): WorldCityEntry[] {
    const entries: WorldCityEntry[] = [];
    for (const room of this.rooms.values()) {
      const pop = this.population.getCityPopulationCount(room.id);
      const site = getSite(room.state.siteId);
      entries.push({
        cityId: room.id,
        siteId: room.state.siteId,
        ownerId: room.state.ownerId || this.ownerId,
        ownerName: room.ownerName,
        name: room.state.name,
        position: site?.position ?? { wx: 0, wz: 0 },
        population: pop,
        happiness: room.state.resources.happiness,
        edgeConnections: calculateEdgeConnections(room.state.buildings),
        online: true,
        hasCachedSnapshot: true,
        lastSeen: Date.now(),
        createdAt: this.createdAtByCity.get(room.id) ?? room.state.createdAt,
      });
    }
    return entries;
  }

  /** Build the persistable IndexedDB record for all owned cities + local population. */
  toOwnedWorldRecord(): OwnedWorldRecord {
    const now = Date.now();
    const cities: OwnedCityRecord[] = [];
    for (const room of this.rooms.values()) {
      cities.push({
        city: structuredClone(room.state),
        createdAt: this.createdAtByCity.get(room.id) ?? room.state.createdAt ?? now,
        savedAt: now,
      });
    }
    return {
      version: 2,
      worldId: this.worldId,
      clock: structuredClone(this.world.clock),
      population: this.population.serialize(),
      cities,
      savedAt: now,
    };
  }

  /** Immediately persist owned state to IndexedDB (safe to call on background/pagehide). */
  async flushSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.dirty = false;
    await this.sink.persist(this.toOwnedWorldRecord());
  }

  /** Claim a new Earth site locally and make this device its authoritative owner. */
  claimSite(siteId: string, cityName: string, playerId: string, playerName: string): CommandResult {
    const site = getSite(siteId);
    if (!site) return { success: false, error: 'Choose an Earth site' };

    const taken = this.world.cities.find(c => c.siteId === site.id);
    if (taken) {
      return { success: false, error: `${site.name} already has ${taken.name}. Enter it from the map.` };
    }

    const name = String(cityName || 'New City').slice(0, 40);
    const ownerName = String(playerName || 'Player').slice(0, 40);
    const cityId = newId();
    const room = this.createOwnedRoom(cityId, name, playerId || this.ownerId, ownerName, undefined, site.id);
    this.rooms.set(cityId, room);
    this.createdAtByCity.set(cityId, Date.now());
    this.population.seedCity(cityId, INITIAL_CITY_SEED);

    this.rebuildWorldCities();
    this.sink.onOwnedSummariesChanged(this.getOwnedEntries());
    void this.flushSave();
    return { success: true, cityId };
  }

  /** Relocate a conflicting owned city to another open site without losing buildings. */
  relocateCity(cityId: string, newSiteId: string): CommandResult {
    const room = this.rooms.get(cityId);
    if (!room) return { success: false, error: 'City not owned locally' };
    const site = getSite(newSiteId);
    if (!site) return { success: false, error: 'Unknown site' };
    if (this.world.cities.some(c => c.siteId === site.id && c.cityId !== cityId)) {
      return { success: false, error: `${site.name} is already claimed` };
    }
    room.state.siteId = site.id;
    this.rebuildWorldCities();
    this.sink.onOwnedSummariesChanged(this.getOwnedEntries());
    void this.flushSave();
    return { success: true };
  }

  /** Extract departing residents for peer-to-peer migration. */
  extractMigrants(fromCityId: string, personIds: string[]): SerializedPerson[] {
    if (!this.rooms.has(fromCityId)) return [];
    const extracted = this.population.extractCityPersons(fromCityId, personIds);
    if (extracted.length > 0) this.markDirty();
    return extracted;
  }

  /** Admit migrants received over WebRTC (or roll back failed outbound transfers). */
  admitMigrants(toCityId: string, persons: unknown[], fromCityId?: string): number {
    if (!this.rooms.has(toCityId)) return 0;
    const count = this.population.admitPersons(toCityId, persons);
    if (count > 0) {
      this.markDirty();
      if (fromCityId && fromCityId !== toCityId) {
        this.sink.onCityEvent(toCityId, S2C.MIGRATION_EVENT, {
          personCount: count,
          fromCityId,
          toCityId,
          reason: 'low_happiness',
        });
      }
    }
    return count;
  }

  /** Notify local viewers of an owned city that residents migrated out to a remote city. */
  notifyOutboundMigration(fromCityId: string, toCityId: string, count: number): void {
    if (count <= 0 || !this.rooms.has(fromCityId)) return;
    this.sink.onCityEvent(fromCityId, S2C.MIGRATION_EVENT, {
      personCount: count,
      fromCityId,
      toCityId,
      reason: 'low_happiness',
    });
  }

  /**
   * Apply a command to one of this device's owned cities.
   * `sourcePeerId` is `'local'` for the owner's own UI, or a WebRTC peerId for a visitor.
   */
  handleCommand(
    cityId: string,
    op: string,
    args: Record<string, any>,
    playerId: string,
    sourcePeerId: string | 'local',
  ): CommandResult {
    const isOwner = sourcePeerId === 'local';
    if (op === 'speed') {
      if (!isOwner) return { success: false, error: 'Only the city owner can change game speed', code: 'FORBIDDEN' };
      return this.engine.setGameSpeed(args.speed);
    }

    const room = this.rooms.get(cityId);
    if (!room) return { success: false, error: 'City not found on this host', code: 'CITY_NOT_FOUND' };

    switch (op) {
      case 'join': {
        const cleanName = String(args.playerName || 'Player').slice(0, 40);
        if (isOwner && room.ownerName === 'You' && cleanName !== 'Player') {
          room.ownerName = cleanName;
        }
        if (sourcePeerId !== 'local') {
          let map = this.visitors.get(cityId);
          if (!map) {
            map = new Map();
            this.visitors.set(cityId, map);
          }
          map.set(sourcePeerId, playerId);
        }
        this.pendingJoinTarget = sourcePeerId;
        try {
          room.addPlayer(playerId, cleanName);
        } finally {
          this.pendingJoinTarget = null;
        }
        return { success: true };
      }
      case 'leave': {
        if (sourcePeerId !== 'local') {
          this.visitors.get(cityId)?.delete(sourcePeerId);
        }
        room.removePlayer(playerId);
        return { success: true };
      }
      case 'place': {
        const result = room.placeBuilding(playerId, args.position, args.type, args.density, args.orientation);
        if (result.success) {
          this.markDirty();
          if (isRoad(args.type)) this.publishEdges();
        }
        return result.success ? { success: true } : { ...result, code: 'PLACEMENT_FAILED' };
      }
      case 'placeBatch': {
        const stroke = args as PlaceBuildingsPayload;
        if (!isValidStroke(stroke)) return { success: false, error: 'Invalid build stroke', code: 'PLACEMENT_FAILED' };
        const { success, buildings, error } = room.placeBuildings(playerId, stroke);
        if (success) {
          this.markDirty();
          if (isRoad(stroke.type)) this.publishEdges();
        }
        return { success, error, placement: success ? { buildings, resources: room.state.resources } : undefined };
      }
      case 'demolish': {
        const cell = room.state.grid[args.position?.x]?.[args.position?.z];
        const building = cell?.buildingId
          ? room.state.buildings.find((b: PlacedBuilding) => b.id === cell.buildingId)
          : undefined;
        const result = room.demolishBuilding(args.position);
        if (result.success) {
          this.markDirty();
          if (building && isRoad(building.type)) this.publishEdges();
        }
        return result.success ? { success: true } : { ...result, code: 'DEMOLISH_FAILED' };
      }
      case 'tax': {
        const res = room.setTaxRate(args.taxRate);
        if (res.success) this.markDirty();
        return res;
      }
      case 'loanTake': {
        const res = room.takeLoan(Number(args.amount), Number(args.termDays));
        if (res.success) this.markDirty();
        return res;
      }
      case 'loanRepay': {
        const res = room.repayLoan(args.loanId);
        if (res.success) this.markDirty();
        return res;
      }
      case 'unlimited': {
        if (isOwner) room.setUnlimitedMoney(args.enabled === true);
        return { success: true };
      }
      case 'save': {
        void this.flushSave();
        return { success: true };
      }
      case 'restart': {
        if (!isOwner) return { success: false, error: 'Only the city owner can restart this city', code: 'FORBIDDEN' };
        room.restart();
        this.markDirty();
        this.publishEdges();
        return { success: true };
      }
      case 'generate': {
        if (!isOwner) return { success: false, error: 'Only the city owner can run Town Planner', code: 'FORBIDDEN' };
        room.generateTown(normalizeTownSettings(args.settings));
        this.markDirty();
        this.publishEdges();
        return { success: true, city: room.state, players: room.getPlayerList() };
      }
      default:
        return { success: false, error: `Unknown command: ${op}` };
    }
  }

  private createOwnedRoom(
    id: string,
    name: string,
    ownerId: string,
    ownerName: string,
    existing: CityState | undefined,
    siteId: string | undefined,
  ): OwnedPeerCityRoom {
    return new OwnedPeerCityRoom(
      id,
      name,
      ownerId,
      ownerName,
      existing,
      siteId,
      (event, data) => {
        // Send initial CITY_STATE on join solely to the joining peer to avoid
        // flooding existing visitors with redundant full snapshots.
        const onlyTarget = event === S2C.CITY_STATE && this.pendingJoinTarget ? this.pendingJoinTarget : undefined;
        this.sink.onCityEvent(id, event, data, onlyTarget);
      },
      () => this.markDirty(),
    );
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dirty) void this.flushSave();
    }, SAVE_DEBOUNCE_MS);
  }

  private publishEdges(): void {
    this.rebuildWorldCities();
    this.sink.onOwnedSummariesChanged(this.getOwnedEntries());
  }

  private rebuildWorldCities(): { conflictingOwnedCityIds: string[] } {
    const combined = [...this.getOwnedEntries(), ...Array.from(this.remoteEntries.values())];
    const { winners, losers } = resolveSiteConflicts(combined);

    // Keep losing cities accessible as unslotted ("original") cities rather than dropping them
    const preservedLosers = losers.map(entry => ({ ...entry, siteId: undefined }));
    this.world.cities = [...winners, ...preservedLosers];
    this.world.updatedAt = Date.now();

    const conflictingOwnedCityIds = losers
      .filter(entry => this.rooms.has(entry.cityId))
      .map(entry => entry.cityId);

    return { conflictingOwnedCityIds };
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
