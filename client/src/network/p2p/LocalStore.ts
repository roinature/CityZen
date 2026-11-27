import type { CityState, GameClock, WorldCityEntry } from '@cityzen/shared';

const DB_NAME = 'cityzen_p2p_v2';
const DB_VERSION = 1;
const STORE_OWNED = 'ownedWorlds';
const STORE_PEER_CACHE = 'peerCache';
const LEGACY_SAVE_PREFIX = 'cityzen_p2p_';

export interface OwnedCityRecord {
  city: CityState;
  createdAt: number;
  savedAt: number;
}

export interface OwnedWorldRecord {
  version: 2;
  worldId: string;
  clock: GameClock;
  population: unknown[];
  cities: OwnedCityRecord[];
  savedAt: number;
}

export interface PeerCityCacheRecord {
  cacheKey: string; // `${worldId}:${cityId}`
  worldId: string;
  cityId: string;
  entry: WorldCityEntry;
  snapshot?: CityState;
  lastSeen: number;
}

export interface CityZenBackup {
  format: 'cityzen-p2p-backup';
  version: 2;
  exportedAt: number;
  worldId: string;
  owned: OwnedWorldRecord | null;
  peerCities: PeerCityCacheRecord[];
}

interface LegacyP2PSnapshot {
  version: 1;
  world?: { clock?: GameClock };
  city?: CityState | null;
  population?: unknown[];
  savedAt?: number;
}

function peerCacheKey(worldId: string, cityId: string): string {
  return `${worldId}:${cityId}`;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * Validate and parse a JSON backup string exported from CityZen P2P mode.
 * Returns null if the payload is malformed.
 */
export function parseBackupJson(raw: string): CityZenBackup | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CityZenBackup>;
    if (parsed?.format !== 'cityzen-p2p-backup' || parsed.version !== 2) return null;
    if (typeof parsed.worldId !== 'string' || !parsed.worldId) return null;
    const owned = parsed.owned ?? null;
    if (owned !== null) {
      if (owned.version !== 2 || !Array.isArray(owned.cities) || !Array.isArray(owned.population) || !owned.clock) {
        return null;
      }
    }
    const peerCities = Array.isArray(parsed.peerCities) ? parsed.peerCities : [];
    return {
      format: 'cityzen-p2p-backup',
      version: 2,
      exportedAt: typeof parsed.exportedAt === 'number' ? parsed.exportedAt : Date.now(),
      worldId: parsed.worldId,
      owned,
      peerCities,
    };
  } catch {
    return null;
  }
}

/**
 * Local-first IndexedDB store for distributed CityZen worlds.
 * Falls back cleanly to an in-memory map if IndexedDB is blocked or unavailable.
 */
export class LocalStore {
  private dbPromise: Promise<IDBDatabase | null>;
  private memOwned = new Map<string, OwnedWorldRecord>();
  private memPeerCache = new Map<string, PeerCityCacheRecord>();

  constructor() {
    this.dbPromise = this.openDb();
    void this.requestPersistentStorage();
  }

  private openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_OWNED)) {
            db.createObjectStore(STORE_OWNED, { keyPath: 'worldId' });
          }
          if (!db.objectStoreNames.contains(STORE_PEER_CACHE)) {
            const peerStore = db.createObjectStore(STORE_PEER_CACHE, { keyPath: 'cacheKey' });
            peerStore.createIndex('byWorld', 'worldId', { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          console.warn('[p2p] IndexedDB unavailable, using in-memory fallback:', req.error);
          resolve(null);
        };
      } catch (err) {
        console.warn('[p2p] IndexedDB open failed, using in-memory fallback:', err);
        resolve(null);
      }
    });
  }

  private async requestPersistentStorage(): Promise<void> {
    try {
      const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
      if (storage?.persisted && storage?.persist) {
        const already = await storage.persisted();
        if (!already) await storage.persist();
      }
    } catch {
      // Non-fatal: some browsers reject persist() without PWA install.
    }
  }

  /**
   * Load this player's owned cities and local population for a world.
   * Automatically imports any legacy v1 localStorage snapshot if present.
   */
  async loadOwnedWorld(worldId: string): Promise<OwnedWorldRecord | null> {
    const db = await this.dbPromise;
    let record: OwnedWorldRecord | null = null;

    if (db) {
      try {
        const tx = db.transaction(STORE_OWNED, 'readonly');
        const found = await reqToPromise(tx.objectStore(STORE_OWNED).get(worldId));
        record = (found as OwnedWorldRecord | undefined) ?? null;
      } catch (err) {
        console.warn('[p2p] Failed reading owned world from IndexedDB:', err);
      }
    } else {
      record = this.memOwned.get(worldId) ?? null;
    }

    if (record) return record;

    // One-time migration from prototype localStorage format if present
    const migrated = this.tryMigrateLegacySnapshot(worldId);
    if (migrated) {
      await this.saveOwnedWorld(migrated);
      return migrated;
    }
    return null;
  }

  private tryMigrateLegacySnapshot(worldId: string): OwnedWorldRecord | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(LEGACY_SAVE_PREFIX + worldId);
      if (!raw) return null;
      const legacy = JSON.parse(raw) as LegacyP2PSnapshot;
      if (legacy?.version !== 1 || !legacy.city) return null;
      return {
        version: 2,
        worldId,
        clock: legacy.world?.clock ?? legacy.city.clock ?? { gameTimeMs: 0, speed: 1, gameDay: 0, gameYear: 1 },
        population: Array.isArray(legacy.population) ? legacy.population : [],
        cities: [{
          city: legacy.city,
          createdAt: legacy.city.createdAt ?? legacy.savedAt ?? Date.now(),
          savedAt: legacy.savedAt ?? Date.now(),
        }],
        savedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  async saveOwnedWorld(record: OwnedWorldRecord): Promise<void> {
    this.memOwned.set(record.worldId, record);
    const db = await this.dbPromise;
    if (!db) return;
    try {
      const tx = db.transaction(STORE_OWNED, 'readwrite');
      tx.objectStore(STORE_OWNED).put(record);
      await txDone(tx);
    } catch (err) {
      console.warn('[p2p] Failed writing owned world to IndexedDB:', err);
    }
  }

  async loadPeerCities(worldId: string): Promise<PeerCityCacheRecord[]> {
    const db = await this.dbPromise;
    if (!db) {
      return Array.from(this.memPeerCache.values()).filter(r => r.worldId === worldId);
    }
    try {
      const tx = db.transaction(STORE_PEER_CACHE, 'readonly');
      const index = tx.objectStore(STORE_PEER_CACHE).index('byWorld');
      const rows = await reqToPromise(index.getAll(worldId));
      return (rows as PeerCityCacheRecord[]) ?? [];
    } catch (err) {
      console.warn('[p2p] Failed reading peer cache from IndexedDB:', err);
      return Array.from(this.memPeerCache.values()).filter(r => r.worldId === worldId);
    }
  }

  async savePeerCity(worldId: string, entry: WorldCityEntry, snapshot?: CityState): Promise<void> {
    const cacheKey = peerCacheKey(worldId, entry.cityId);
    const existing = await this.getPeerCity(worldId, entry.cityId);
    const record: PeerCityCacheRecord = {
      cacheKey,
      worldId,
      cityId: entry.cityId,
      entry: { ...entry, hasCachedSnapshot: Boolean(snapshot ?? existing?.snapshot) },
      snapshot: snapshot ?? existing?.snapshot,
      lastSeen: Date.now(),
    };
    this.memPeerCache.set(cacheKey, record);

    const db = await this.dbPromise;
    if (!db) return;
    try {
      const tx = db.transaction(STORE_PEER_CACHE, 'readwrite');
      tx.objectStore(STORE_PEER_CACHE).put(record);
      await txDone(tx);
    } catch (err) {
      console.warn('[p2p] Failed writing peer cache to IndexedDB:', err);
    }
  }

  async getPeerCity(worldId: string, cityId: string): Promise<PeerCityCacheRecord | null> {
    const cacheKey = peerCacheKey(worldId, cityId);
    const db = await this.dbPromise;
    if (!db) return this.memPeerCache.get(cacheKey) ?? null;
    try {
      const tx = db.transaction(STORE_PEER_CACHE, 'readonly');
      const found = await reqToPromise(tx.objectStore(STORE_PEER_CACHE).get(cacheKey));
      return (found as PeerCityCacheRecord | undefined) ?? this.memPeerCache.get(cacheKey) ?? null;
    } catch {
      return this.memPeerCache.get(cacheKey) ?? null;
    }
  }

  async deletePeerCity(worldId: string, cityId: string): Promise<void> {
    const cacheKey = peerCacheKey(worldId, cityId);
    this.memPeerCache.delete(cacheKey);
    const db = await this.dbPromise;
    if (!db) return;
    try {
      const tx = db.transaction(STORE_PEER_CACHE, 'readwrite');
      tx.objectStore(STORE_PEER_CACHE).delete(cacheKey);
      await txDone(tx);
    } catch {
      // Non-fatal
    }
  }

  async exportBackup(worldId: string): Promise<string> {
    const [owned, peerCities] = await Promise.all([
      this.loadOwnedWorld(worldId),
      this.loadPeerCities(worldId),
    ]);
    const backup: CityZenBackup = {
      format: 'cityzen-p2p-backup',
      version: 2,
      exportedAt: Date.now(),
      worldId,
      owned,
      peerCities,
    };
    return JSON.stringify(backup, null, 2);
  }

  async importBackup(raw: string, targetWorldId: string): Promise<CityZenBackup | null> {
    const backup = parseBackupJson(raw);
    if (!backup) return null;

    if (backup.owned) {
      await this.saveOwnedWorld({
        ...backup.owned,
        worldId: targetWorldId,
        savedAt: Date.now(),
      });
    }

    for (const peer of backup.peerCities) {
      await this.savePeerCity(targetWorldId, peer.entry, peer.snapshot);
    }
    return backup;
  }
}
