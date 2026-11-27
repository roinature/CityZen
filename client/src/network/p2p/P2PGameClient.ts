import { joinRoom, type Room, type RequestAction, type MessageAction } from 'trystero';
import {
  S2C,
  getEffectiveSize,
  isRoad,
  levelRoadTerrain,
  type BuildingDemolishedPayload,
  type BuildingPlacedPayload,
  type BuildingsPlacedPayload,
  type BuildingType,
  type CityListItem,
  type CityState,
  type CityStatePayload,
  type MigrationEventPayload,
  type PlaceBuildingsPayload,
  type PlacedBuilding,
  type Player,
  type PopulationUpdatePayload,
  type Position,
  type ResourcesUpdatePayload,
  type RoadOrientation,
  type SerializedPerson,
  type TownSettings,
  type WorldCityEntry,
  type WorldStatePayload,
  type WorldTickPayload,
  type ZoneDensity,
  type ZoneGrowthPayload,
} from '@cityzen/shared';
import type { GameCallbacks } from '../GameClient.js';
import type { CityConnection } from '../CityConnection.js';
import { LocalStore } from './LocalStore.js';
import { LocalCityHost, type CommandResult } from './LocalCityHost.js';
import { buildIceConfig } from './rtcConfig.js';

const APP_ID = 'cityzen-p2p-v2';
const COMMAND_TIMEOUT_MS = 15_000;
const MIGRATION_TIMEOUT_MS = 10_000;
const PEER_CITY_DISCOVERY_TIMEOUT_MS = 10_000;
const ANNOUNCE_THROTTLE_MS = 10_000;
const REMOTE_CACHE_SAVE_MS = 15_000;

interface AnnounceMessage {
  cities: WorldCityEntry[];
}

interface CommandMessage {
  cityId: string;
  op: string;
  args: Record<string, unknown>;
  playerId: string;
}

interface CityEventMessage {
  cityId: string;
  event: string;
  data: unknown;
}

interface MigrateRequest {
  fromCityId: string;
  toCityId: string;
  persons: SerializedPerson[];
}

interface MigrateReply {
  success: boolean;
  admitted: number;
}

interface PeerCityRecord {
  entry: WorldCityEntry;
  ownerPeerId: string | null;
}

interface ActiveVisit {
  cityId: string;
  playerName: string;
  playerId: string;
  mode: 'owned' | 'remote-live' | 'remote-readonly';
  ownerPeerId: string | null;
}

/**
 * Distributed, owner-authoritative WebRTC client for CityZen (zero central DB).
 *
 * - Each device owns and simulates its own city(ies) locally via `LocalCityHost`
 *   and persists them in IndexedDB (`LocalStore`).
 * - Online friends in the same `?world=<id>` connect over WebRTC (`trystero`)
 *   and exchange lightweight city summaries (`announce`), targeted city sessions
 *   for visiting/co-building (`cmd` + `evt`), and cross-city citizen migration
 *   (`migrate`).
 * - When a friend's device goes offline (or locks its phone screen), active
 *   visitors transition seamlessly into a Read-Only cached view and resume live
 *   co-building automatically when the owner reconnects.
 */
export class P2PGameClient implements CityConnection {
  private readonly store = new LocalStore();
  private host!: LocalCityHost;
  private room!: Room;
  private announceAction!: MessageAction<string>;
  private eventAction!: MessageAction<string>;
  private commandAction!: RequestAction<string, string>;
  private migrateAction!: RequestAction<string, string>;

  /** Known non-owned cities (online peers + offline IndexedDB cache). */
  private peerCities = new Map<string, PeerCityRecord>();
  /** Currently open city view on this device. */
  private activeVisit: ActiveVisit | null = null;
  /** Up-to-date local copy of the remote city currently being viewed (for offline caching). */
  private activeRemoteCity: CityState | null = null;
  private lastAnnounceAt = 0;
  private lastRemoteCacheAt = 0;
  private warnedSiteConflicts = new Set<string>();
  private cleanupListeners: Array<() => void> = [];
  private pendingCityWaiters = new Map<string, Array<(found: boolean) => void>>();

  static async create(worldId: string, playerId: string, callbacks: GameCallbacks): Promise<P2PGameClient> {
    const client = new P2PGameClient(worldId, playerId, callbacks);
    await client.init();
    return client;
  }

  private constructor(
    readonly worldId: string,
    private readonly playerId: string,
    private readonly callbacks: GameCallbacks,
  ) {}

  get peerCount(): number {
    return this.room ? Object.keys(this.room.getPeers()).length : 0;
  }

  get isReadOnly(): boolean {
    return this.activeVisit?.mode === 'remote-readonly';
  }

  private async init(): Promise<void> {
    const [ownedRecord, cachedPeers] = await Promise.all([
      this.store.loadOwnedWorld(this.worldId),
      this.store.loadPeerCities(this.worldId),
    ]);

    for (const cached of cachedPeers) {
      this.peerCities.set(cached.cityId, {
        entry: {
          ...cached.entry,
          online: false,
          hasCachedSnapshot: Boolean(cached.snapshot),
          lastSeen: cached.lastSeen,
        },
        ownerPeerId: null,
      });
    }

    this.host = this.createHost(ownedRecord);
    this.syncRemoteCitiesToHost();
    this.host.start();

    // Immediately deliver locally available world state (works even 100% offline).
    this.callbacks.onWorldState(clone(this.host.world));

    this.connectRoom();
    this.bindLifecycleHandlers();
  }

  private createHost(ownedRecord: Awaited<ReturnType<LocalStore['loadOwnedWorld']>>): LocalCityHost {
    return new LocalCityHost(this.worldId, this.playerId, ownedRecord, {
      onCityEvent: (cityId, event, data, onlyTarget) => {
        this.routeOwnedCityEvent(cityId, event, data, onlyTarget);
      },
      onOwnedSummariesChanged: () => {
        this.callbacks.onWorldState(clone(this.host.world));
        this.announceOwned(false);
      },
      onRemoteMigration: (fromCityId, toCityId, personIds) => {
        void this.sendRemoteMigration(fromCityId, toCityId, personIds);
      },
      persist: async (record) => {
        await this.store.saveOwnedWorld(record);
      },
    });
  }

  private connectRoom(): void {
    const ice = buildIceConfig();
    this.room = joinRoom(
      {
        appId: APP_ID,
        password: this.worldId,
        rtcConfig: ice.rtcConfig,
        ...(ice.hasTurn ? { turnConfig: ice.turnConfig } : {}),
      },
      this.worldId,
    );

    this.announceAction = this.room.makeAction<string>('ann');
    this.eventAction = this.room.makeAction<string>('evt');
    this.commandAction = this.room.makeAction<string, string>('cmd', { kind: 'request' });
    this.migrateAction = this.room.makeAction<string, string>('mig', { kind: 'request' });

    this.announceAction.onMessage((wire, { peerId }) => {
      try {
        const msg = JSON.parse(wire) as AnnounceMessage;
        if (Array.isArray(msg?.cities)) this.onPeerAnnounce(peerId, msg.cities);
      } catch (err) {
        console.warn('[p2p] Malformed announce message:', err);
      }
    });

    this.eventAction.onMessage((wire, { peerId }) => {
      try {
        const msg = JSON.parse(wire) as CityEventMessage;
        this.onRemoteCityEvent(peerId, msg);
      } catch (err) {
        console.warn('[p2p] Malformed city event:', err);
      }
    });

    this.commandAction.onRequest((wire, { peerId }) => {
      try {
        const { cityId, op, args, playerId } = JSON.parse(wire) as CommandMessage;
        if (!this.host.ownsCity(cityId)) {
          return JSON.stringify({ success: false, error: 'City not hosted on this peer', code: 'CITY_NOT_FOUND' });
        }
        return JSON.stringify(this.host.handleCommand(cityId, op, args ?? {}, playerId, peerId));
      } catch (err) {
        console.warn('[p2p] Malformed command request:', err);
        return JSON.stringify({ success: false, error: 'Malformed command', code: 'BAD_REQUEST' });
      }
    });

    this.migrateAction.onRequest((wire) => {
      try {
        const { fromCityId, toCityId, persons } = JSON.parse(wire) as MigrateRequest;
        if (!this.host.ownsCity(toCityId) || !Array.isArray(persons)) {
          return JSON.stringify({ success: false, admitted: 0 } satisfies MigrateReply);
        }
        const admitted = this.host.admitMigrants(toCityId, persons, fromCityId);
        return JSON.stringify({ success: admitted > 0, admitted } satisfies MigrateReply);
      } catch {
        return JSON.stringify({ success: false, admitted: 0 } satisfies MigrateReply);
      }
    });

    this.room.onPeerJoin(({ peerId }) => {
      this.callbacks.onPeerStatusChange?.(this.peerCount);
      this.announceOwned(true, peerId);
    });

    this.room.onPeerLeave(({ peerId }) => {
      this.onPeerLeave(peerId);
    });

    this.room.onError((error) => {
      if (error.code === 'peer-connect-failed' && !error.turnConfigured) {
        console.warn(
          '[p2p] Peer connection failed without TURN configured. On 4G/5G cellular networks, set VITE_ICE_SERVERS or VITE_TURN_URL.',
        );
      } else {
        console.warn('[p2p] Room error:', error);
      }
    });

    this.announceOwned(true);
  }

  private bindLifecycleHandlers(): void {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void this.host.flushSave();
        this.persistActiveRemoteCache(true);
      } else if (document.visibilityState === 'visible') {
        this.announceOwned(true);
        this.callbacks.onPeerStatusChange?.(this.peerCount);
        this.tryResumeReadOnlyVisit();
      }
    };
    const onPageHide = () => {
      void this.host.flushSave();
      this.persistActiveRemoteCache(true);
    };
    const onOnline = () => {
      this.announceOwned(true);
      this.tryResumeReadOnlyVisit();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    window.addEventListener('online', onOnline);

    this.cleanupListeners.push(
      () => document.removeEventListener('visibilitychange', onVisibility),
      () => window.removeEventListener('pagehide', onPageHide),
      () => window.removeEventListener('beforeunload', onPageHide),
      () => window.removeEventListener('online', onOnline),
    );
  }

  // ── World presence & routing ────────────────────────────────

  private announceOwned(force: boolean, targetPeerId?: string): void {
    if (!this.announceAction) return;
    const now = Date.now();
    if (!force && !targetPeerId && now - this.lastAnnounceAt < ANNOUNCE_THROTTLE_MS) return;
    if (!targetPeerId) this.lastAnnounceAt = now;

    const cities = this.host.getOwnedEntries();
    const wire = JSON.stringify({ cities } satisfies AnnounceMessage);
    void this.announceAction.send(wire, targetPeerId ? { target: targetPeerId } : undefined);
  }

  private onPeerAnnounce(peerId: string, announcedCities: WorldCityEntry[]): void {
    const now = Date.now();
    const announcedIds = new Set<string>();

    for (const raw of announcedCities) {
      if (!raw?.cityId || this.host.ownsCity(raw.cityId)) continue;
      announcedIds.add(raw.cityId);

      const prev = this.peerCities.get(raw.cityId);
      const entry: WorldCityEntry = {
        ...raw,
        online: true,
        hasCachedSnapshot: prev?.entry.hasCachedSnapshot ?? false,
        lastSeen: now,
      };
      this.peerCities.set(raw.cityId, { entry, ownerPeerId: peerId });
      void this.store.savePeerCity(this.worldId, entry);
      const waiters = this.pendingCityWaiters.get(raw.cityId);
      if (waiters) {
        this.pendingCityWaiters.delete(raw.cityId);
        for (const resolve of waiters) resolve(true);
      }
    }

    // If this peer previously announced another city that they no longer own, mark it offline
    for (const [cityId, record] of this.peerCities.entries()) {
      if (record.ownerPeerId === peerId && !announcedIds.has(cityId)) {
        record.ownerPeerId = null;
        record.entry = { ...record.entry, online: false };
      }
    }

    this.syncRemoteCitiesToHost();
    this.callbacks.onWorldState(clone(this.host.world));

    // If we were viewing one of these cities in read-only cached mode, seamlessly resume live co-building!
    if (this.activeVisit?.mode === 'remote-readonly' && announcedIds.has(this.activeVisit.cityId)) {
      void this.joinCity(this.activeVisit.cityId, this.activeVisit.playerName, this.activeVisit.playerId);
    }
  }

  private onPeerLeave(peerId: string): void {
    this.host.dropPeer(peerId);
    this.callbacks.onPeerStatusChange?.(this.peerCount);

    let changed = false;
    for (const record of this.peerCities.values()) {
      if (record.ownerPeerId === peerId) {
        record.ownerPeerId = null;
        record.entry = { ...record.entry, online: false, lastSeen: Date.now() };
        changed = true;
      }
    }

    if (changed) {
      this.syncRemoteCitiesToHost();
      this.callbacks.onWorldState(clone(this.host.world));
    }

    // Owner left while we were visiting/co-building → switch smoothly into Read-Only cached view
    if (this.activeVisit?.mode === 'remote-live' && this.activeVisit.ownerPeerId === peerId) {
      this.persistActiveRemoteCache(true);
      this.activeVisit = {
        ...this.activeVisit,
        mode: 'remote-readonly',
        ownerPeerId: null,
      };
      this.callbacks.onReadOnlyChange?.(true, 'Owner went offline — viewing cached city (read-only)');
    }
  }

  private syncRemoteCitiesToHost(): void {
    const remoteEntries = Array.from(this.peerCities.values()).map(r => r.entry);
    const { conflictingOwnedCityIds } = this.host.setRemoteCities(remoteEntries);

    for (const cityId of conflictingOwnedCityIds) {
      if (this.warnedSiteConflicts.has(cityId)) continue;
      this.warnedSiteConflicts.add(cityId);
      const city = this.host.getOwnedCityState(cityId);
      if (city) {
        this.callbacks.onError({
          message: `Another friend claimed that Earth site earlier. "${city.name}" is still safe under original cities on the map.`,
          code: 'SITE_CONFLICT',
        });
      }
    }
  }

  private tryResumeReadOnlyVisit(): void {
    if (this.activeVisit?.mode !== 'remote-readonly') return;
    const record = this.peerCities.get(this.activeVisit.cityId);
    if (record?.ownerPeerId) {
      void this.joinCity(this.activeVisit.cityId, this.activeVisit.playerName, this.activeVisit.playerId);
    }
  }

  // ── Owned city event fan-out ────────────────────────────────

  private routeOwnedCityEvent(
    cityId: string,
    event: string,
    data: unknown,
    onlyTarget?: string | 'local',
  ): void {
    if (cityId === '__world__') {
      if (event === S2C.WORLD_TICK) {
        this.callbacks.onWorldTick?.(clone(data) as WorldTickPayload);
      }
      return;
    }

    const sendLocal = (onlyTarget === undefined || onlyTarget === 'local')
      && this.activeVisit?.mode === 'owned'
      && this.activeVisit.cityId === cityId;

    if (sendLocal) {
      this.dispatchToUI(event, clone(data));
    }

    if (onlyTarget === 'local' || !this.eventAction) return;

    const visitorPeers = onlyTarget
      ? [onlyTarget]
      : this.host.getVisitorPeerIds(cityId);

    if (visitorPeers.length === 0) return;

    const wire = JSON.stringify({ cityId, event, data } satisfies CityEventMessage);
    void this.eventAction.send(wire, { target: visitorPeers.length === 1 ? visitorPeers[0] : visitorPeers });
  }

  // ── Remote city event reception & local caching ─────────────

  private onRemoteCityEvent(fromPeerId: string, msg: CityEventMessage): void {
    if (!this.activeVisit || this.activeVisit.mode !== 'remote-live') return;
    if (this.activeVisit.cityId !== msg.cityId || this.activeVisit.ownerPeerId !== fromPeerId) return;

    this.applyRemoteEventToCache(msg.event, msg.data);
    this.dispatchToUI(msg.event, msg.data);
  }

  private applyRemoteEventToCache(event: string, data: any): void {
    if (event === S2C.CITY_STATE) {
      const payload = data as CityStatePayload;
      this.activeRemoteCity = clone(payload.city);
      this.persistActiveRemoteCache(true);
      return;
    }
    if (!this.activeRemoteCity) return;

    switch (event) {
      case S2C.BUILDING_PLACED: {
        const { building, resources } = data as BuildingPlacedPayload;
        this.mergeCachedBuildings([building], resources);
        break;
      }
      case S2C.BUILDINGS_PLACED: {
        const { buildings, resources } = data as BuildingsPlacedPayload;
        this.mergeCachedBuildings(buildings, resources);
        break;
      }
      case S2C.BUILDING_DEMOLISHED: {
        const { buildingId, resources } = data as BuildingDemolishedPayload;
        const target = this.activeRemoteCity.buildings.find((b: PlacedBuilding) => b.id === buildingId);
        if (target) {
          const { w, d } = getEffectiveSize(target.type, target.orientation);
          for (let dx = 0; dx < w; dx++) {
            for (let dz = 0; dz < d; dz++) {
              const cell = this.activeRemoteCity.grid[target.position.x + dx]?.[target.position.z + dz];
              if (cell && cell.buildingId === target.id) cell.buildingId = null;
            }
          }
        }
        this.activeRemoteCity.buildings = this.activeRemoteCity.buildings.filter(b => b.id !== buildingId);
        this.activeRemoteCity.resources = clone(resources);
        this.persistActiveRemoteCache(false);
        break;
      }
      case S2C.RESOURCES_UPDATE: {
        const { resources, tick, clock } = data as ResourcesUpdatePayload;
        this.activeRemoteCity.resources = clone(resources);
        this.activeRemoteCity.tick = tick;
        this.activeRemoteCity.clock = clone(clock);
        this.persistActiveRemoteCache(false);
        break;
      }
      case S2C.ZONE_GROWTH: {
        const { buildings } = data as ZoneGrowthPayload;
        for (const u of buildings) {
          const b = this.activeRemoteCity.buildings.find(x => x.id === u.id);
          if (b) {
            b.developmentLevel = u.developmentLevel;
            b.developedAt = u.developedAt;
          }
        }
        this.persistActiveRemoteCache(false);
        break;
      }
    }
  }

  private mergeCachedBuildings(buildings: PlacedBuilding[], resources: CityState['resources']): void {
    if (!this.activeRemoteCity) return;
    const existingIds = new Set(this.activeRemoteCity.buildings.map(b => b.id));
    for (const building of buildings) {
      if (existingIds.has(building.id)) continue;
      this.activeRemoteCity.buildings.push(clone(building));
      if (isRoad(building.type)) {
        levelRoadTerrain(this.activeRemoteCity.grid, building.position, building.type, building.orientation);
      }
      const { w, d } = getEffectiveSize(building.type, building.orientation);
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < d; dz++) {
          const cell = this.activeRemoteCity.grid[building.position.x + dx]?.[building.position.z + dz];
          if (cell) cell.buildingId = building.id;
        }
      }
    }
    this.activeRemoteCity.resources = clone(resources);
    this.persistActiveRemoteCache(false);
  }

  private persistActiveRemoteCache(force: boolean): void {
    if (!this.activeVisit || this.activeVisit.mode === 'owned' || !this.activeRemoteCity) return;
    const now = Date.now();
    if (!force && now - this.lastRemoteCacheAt < REMOTE_CACHE_SAVE_MS) return;
    this.lastRemoteCacheAt = now;

    const record = this.peerCities.get(this.activeVisit.cityId);
    if (!record) return;
    record.entry = { ...record.entry, hasCachedSnapshot: true };
    void this.store.savePeerCity(this.worldId, record.entry, clone(this.activeRemoteCity));
  }

  // ── Cross-city peer migration ───────────────────────────────

  private async sendRemoteMigration(fromCityId: string, toCityId: string, personIds: string[]): Promise<void> {
    const targetRecord = this.peerCities.get(toCityId);
    if (!targetRecord?.ownerPeerId || !this.migrateAction) return;

    const persons = this.host.extractMigrants(fromCityId, personIds);
    if (persons.length === 0) return;

    try {
      const replyRaw = await this.migrateAction.request(
        JSON.stringify({ fromCityId, toCityId, persons } satisfies MigrateRequest),
        { target: targetRecord.ownerPeerId, timeoutMs: MIGRATION_TIMEOUT_MS },
      );
      const reply = JSON.parse(replyRaw) as MigrateReply;
      if (reply.success && reply.admitted > 0) {
        this.host.notifyOutboundMigration(fromCityId, toCityId, reply.admitted);
        return;
      }
    } catch (err) {
      console.warn('[p2p] Remote migration failed; keeping citizens local:', err);
    }

    // Roll back on failure so no citizens are ever lost in transit
    this.host.admitMigrants(fromCityId, persons);
  }

  // ── Command dispatch (local owned vs remote owner) ──────────

  private async sendCityCommand(op: string, args: Record<string, unknown>, playerId = this.playerId): Promise<CommandResult> {
    if (!this.activeVisit) {
      return { success: false, error: 'Not in a city', code: 'NO_ROOM' };
    }

    const { cityId, mode, ownerPeerId } = this.activeVisit;
    if (mode === 'owned') {
      return clone(this.host.handleCommand(cityId, op, args, playerId, 'local'));
    }

    if (mode === 'remote-readonly' || !ownerPeerId) {
      if (op === 'leave' || op === 'save') return { success: true };
      return { success: false, error: 'Owner is offline — this city is read-only right now', code: 'READ_ONLY' };
    }

    try {
      const msg: CommandMessage = { cityId, op, args, playerId };
      const reply = await this.commandAction.request(JSON.stringify(msg), {
        target: ownerPeerId,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
      return JSON.parse(reply) as CommandResult;
    } catch {
      // Connection to owner dropped mid-request → flip cleanly to Read-Only cached view
      this.persistActiveRemoteCache(true);
      this.activeVisit = { ...this.activeVisit, mode: 'remote-readonly', ownerPeerId: null };
      this.callbacks.onReadOnlyChange?.(true, 'Lost connection to owner — viewing cached city (read-only)');
      return { success: false, error: 'Lost connection to city owner', code: 'HOST_UNREACHABLE' };
    }
  }

  private dispatchToUI(event: string, data: any): void {
    const cb = this.callbacks;
    if (event === S2C.WORLD_STATE) {
      cb.onWorldState((data as WorldStatePayload).world);
      return;
    }
    if (event === S2C.WORLD_TICK) {
      cb.onWorldTick?.(data as WorldTickPayload);
      return;
    }
    if (!this.activeVisit) return;

    switch (event) {
      case S2C.CITY_STATE: {
        const payload = data as CityStatePayload;
        cb.onCityState(payload.city, payload.players);
        break;
      }
      case S2C.BUILDING_PLACED: {
        const { building, resources } = data as BuildingPlacedPayload;
        cb.onBuildingsPlaced({ buildings: [building], resources });
        break;
      }
      case S2C.BUILDINGS_PLACED:
        cb.onBuildingsPlaced(data as BuildingsPlacedPayload);
        break;
      case S2C.BUILDING_DEMOLISHED:
        cb.onBuildingDemolished(data as BuildingDemolishedPayload);
        break;
      case S2C.RESOURCES_UPDATE: {
        const payload = data as ResourcesUpdatePayload;
        cb.onResourcesUpdate(payload.resources, payload.tick, payload.clock);
        break;
      }
      case S2C.ZONE_GROWTH:
        cb.onZoneGrowth(data as ZoneGrowthPayload);
        break;
      case S2C.PLAYER_JOINED:
        cb.onPlayerJoined((data as { player: Player }).player);
        break;
      case S2C.PLAYER_LEFT:
        cb.onPlayerLeft((data as { playerId: string }).playerId);
        break;
      case S2C.POPULATION_UPDATE:
        cb.onPopulationUpdate?.((data as PopulationUpdatePayload).summary);
        break;
      case S2C.MIGRATION_EVENT:
        cb.onMigrationEvent?.(data as MigrationEventPayload);
        break;
    }
  }

  // ── CityConnection ──────────────────────────────────────────

  async fetchWorldState(): Promise<boolean> {
    this.callbacks.onWorldState(clone(this.host.world));
    return true;
  }

  async listCities(): Promise<CityListItem[]> {
    return this.host.world.cities.map((entry) => {
      const ownedState = this.host.getOwnedCityState(entry.cityId);
      const isOwned = ownedState !== null;
      return {
        id: entry.cityId,
        name: entry.name,
        ownerName: isOwned ? `${entry.ownerName} (You)` : entry.ownerName,
        playerCount: isOwned
          ? this.host.getVisitorCount(entry.cityId) + 1
          : entry.online ? 1 : 0,
        buildingCount: ownedState?.buildings.length ?? 0,
      };
    });
  }

  async claimPlot(siteId: string, cityName: string, playerName: string, playerId = this.playerId): Promise<void> {
    const result = this.host.claimSite(siteId, cityName, playerId, playerName);
    if (result.success && typeof result.cityId === 'string') {
      this.announceOwned(true);
      await this.joinCity(result.cityId, playerName, playerId);
    } else {
      await this.fetchWorldState();
      this.callbacks.onError({ message: result.error || 'Failed to claim site', code: 'CLAIM_FAILED' });
    }
  }

  async joinCity(cityId: string, playerName: string, playerId = this.playerId): Promise<void> {
    // 1. Owned locally → zero-latency local session
    if (this.host.ownsCity(cityId)) {
      this.activeRemoteCity = null;
      this.activeVisit = { cityId, playerName, playerId, mode: 'owned', ownerPeerId: null };
      this.callbacks.onReadOnlyChange?.(false);
      const result = this.host.handleCommand(cityId, 'join', { playerName }, playerId, 'local');
      if (!result.success) {
        this.activeVisit = null;
        this.callbacks.onError({ message: result.error || 'Failed to open city', code: result.code || 'JOIN_FAILED' });
      }
      return;
    }

    // 2. Online friend owns this city → connect directly to ownerPeerId
    let remote = this.peerCities.get(cityId);
    if (!remote?.ownerPeerId) {
      const cached = await this.store.getPeerCity(this.worldId, cityId);
      if (cached?.snapshot) {
        this.activeRemoteCity = clone(cached.snapshot);
        this.activeVisit = { cityId, playerName, playerId, mode: 'remote-readonly', ownerPeerId: null };
        this.callbacks.onReadOnlyChange?.(true, 'Owner is offline — viewing cached city (read-only)');
        this.callbacks.onCityState(clone(cached.snapshot), []);
        return;
      }

      // Deep-linking into a peer's city before WebRTC peers have announced: wait briefly for discovery.
      if (!remote && await this.waitForPeerCity(cityId, PEER_CITY_DISCOVERY_TIMEOUT_MS)) {
        remote = this.peerCities.get(cityId);
      }
    }

    if (remote?.ownerPeerId) {
      this.activeRemoteCity = null;
      this.activeVisit = {
        cityId,
        playerName,
        playerId,
        mode: 'remote-live',
        ownerPeerId: remote.ownerPeerId,
      };
      this.callbacks.onReadOnlyChange?.(false);
      const result = await this.sendCityCommand('join', { playerName }, playerId);
      if (result.success) return;
      // Fall through to cached read-only copy if the owner just went offline
      const cached = await this.store.getPeerCity(this.worldId, cityId);
      if (cached?.snapshot) {
        this.activeRemoteCity = clone(cached.snapshot);
        this.activeVisit = { cityId, playerName, playerId, mode: 'remote-readonly', ownerPeerId: null };
        this.callbacks.onReadOnlyChange?.(true, 'Owner is offline — viewing cached city (read-only)');
        this.callbacks.onCityState(clone(cached.snapshot), []);
        return;
      }
    }

    this.activeVisit = null;
    this.callbacks.onReadOnlyChange?.(false);
    this.callbacks.onError({
      message: remote
        ? `${remote.entry.name}'s owner is offline and you haven't visited it yet.`
        : 'City not found in this world.',
      code: 'JOIN_FAILED',
    });
  }

  private waitForPeerCity(cityId: string, timeoutMs: number): Promise<boolean> {
    if (this.peerCities.get(cityId)?.ownerPeerId) return Promise.resolve(true);
    return new Promise((resolve) => {
      const list = this.pendingCityWaiters.get(cityId) ?? [];
      const timer = setTimeout(() => {
        const current = this.pendingCityWaiters.get(cityId);
        if (current) {
          const next = current.filter((fn) => fn !== finish);
          if (next.length > 0) this.pendingCityWaiters.set(cityId, next);
          else this.pendingCityWaiters.delete(cityId);
        }
        resolve(false);
      }, timeoutMs);
      const finish = (found: boolean) => {
        clearTimeout(timer);
        resolve(found);
      };
      list.push(finish);
      this.pendingCityWaiters.set(cityId, list);
    });
  }

  async placeBuilding(
    position: Position,
    type: BuildingType,
    playerId = this.playerId,
    density?: ZoneDensity,
    orientation?: RoadOrientation,
  ): Promise<void> {
    const result = await this.sendCityCommand('place', { position, type, density, orientation }, playerId);
    if (!result.success) {
      this.callbacks.onError({ message: result.error || 'Placement failed', code: 'PLACEMENT_FAILED' });
    }
  }

  async paintBuildings(stroke: PlaceBuildingsPayload, playerId: string): Promise<void> {
    if (!this.activeVisit) return;
    const result = await this.sendCityCommand('placeBatch', { ...stroke }, playerId);
    if (result.placement) this.callbacks.onBuildingsPlaced(result.placement as BuildingsPlacedPayload);
    if (!result.success || result.error) {
      const message = !result.success && result.error === 'Cell occupied'
        ? 'The selected tiles are occupied'
        : result.error || 'Placement failed';
      this.callbacks.onError({ message, code: 'PLACEMENT_FAILED' });
    }
  }

  async demolish(position: Position, playerId = this.playerId): Promise<void> {
    const result = await this.sendCityCommand('demolish', { position }, playerId);
    if (!result.success) {
      this.callbacks.onError({ message: result.error || 'Demolish failed', code: 'DEMOLISH_FAILED' });
    }
  }

  async save(playerId = this.playerId): Promise<void> {
    if (this.activeVisit?.mode === 'owned') {
      await this.host.flushSave();
      this.callbacks.onSaved?.();
      return;
    }
    this.persistActiveRemoteCache(true);
    const result = await this.sendCityCommand('save', {}, playerId);
    if (result.success) this.callbacks.onSaved?.();
  }

  async restart(playerId = this.playerId): Promise<void> {
    const result = await this.sendCityCommand('restart', {}, playerId);
    if (!result.success) {
      this.callbacks.onError({ message: result.error || 'Restart failed', code: result.code || 'RESTART_FAILED' });
    }
  }

  async generateTown(settings: TownSettings, playerId: string): Promise<boolean> {
    if (!this.activeVisit) return false;
    const result = await this.sendCityCommand('generate', { settings }, playerId);
    if (result.success) {
      this.callbacks.onCityState(result.city as CityStatePayload['city'], (result.players as Player[]) ?? []);
      return true;
    }
    this.callbacks.onError({ message: result.error || 'Could not plan the town', code: 'GENERATE_FAILED' });
    return false;
  }

  async setTaxRate(taxRate: number, playerId = this.playerId): Promise<void> {
    const result = await this.sendCityCommand('tax', { taxRate }, playerId);
    if (!result.success && result.error) {
      this.callbacks.onError({ message: result.error, code: result.code || 'TAX_FAILED' });
    }
  }

  async takeLoan(amount: number, termDays: number, playerId = this.playerId): Promise<{ success: boolean; error?: string }> {
    return this.sendCityCommand('loanTake', { amount, termDays }, playerId);
  }

  async repayLoan(loanId: string, playerId = this.playerId): Promise<{ success: boolean; error?: string }> {
    return this.sendCityCommand('loanRepay', { loanId }, playerId);
  }

  async setUnlimitedMoney(enabled: boolean, playerId = this.playerId): Promise<void> {
    if (this.activeVisit?.mode === 'owned') {
      this.host.handleCommand(this.activeVisit.cityId, 'unlimited', { enabled }, playerId, 'local');
    }
  }

  async setGameSpeed(speed: number, playerId = this.playerId): Promise<void> {
    const result = await this.sendCityCommand('speed', { speed }, playerId);
    if (!result.success && result.error && result.code !== 'NO_ROOM') {
      this.callbacks.onError({ message: result.error, code: result.code || 'SPEED_FAILED' });
    }
  }

  async leave(playerId = this.playerId): Promise<void> {
    if (!this.activeVisit) return;
    this.persistActiveRemoteCache(true);
    if (this.activeVisit.mode === 'owned' || this.activeVisit.mode === 'remote-live') {
      await this.sendCityCommand('leave', {}, playerId);
    }
    this.activeVisit = null;
    this.activeRemoteCity = null;
    this.callbacks.onReadOnlyChange?.(false);
  }

  async exportBackup(): Promise<string> {
    await this.host.flushSave();
    this.persistActiveRemoteCache(true);
    return this.store.exportBackup(this.worldId);
  }

  async importBackup(rawJson: string): Promise<boolean> {
    const imported = await this.store.importBackup(rawJson, this.worldId);
    if (!imported) return false;

    const [ownedRecord, cachedPeers] = await Promise.all([
      this.store.loadOwnedWorld(this.worldId),
      this.store.loadPeerCities(this.worldId),
    ]);

    this.host.stop();
    this.peerCities.clear();
    for (const cached of cachedPeers) {
      this.peerCities.set(cached.cityId, {
        entry: { ...cached.entry, online: false, hasCachedSnapshot: Boolean(cached.snapshot), lastSeen: cached.lastSeen },
        ownerPeerId: null,
      });
    }
    this.host = this.createHost(ownedRecord);
    this.syncRemoteCitiesToHost();
    this.host.start();
    this.callbacks.onWorldState(clone(this.host.world));
    this.announceOwned(true);
    return true;
  }

  disconnect(): void {
    for (const cleanup of this.cleanupListeners) cleanup();
    this.cleanupListeners = [];
    for (const waiters of this.pendingCityWaiters.values()) {
      for (const resolve of waiters) resolve(false);
    }
    this.pendingCityWaiters.clear();
    this.persistActiveRemoteCache(true);
    this.host?.stop();
    void this.room?.leave();
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
