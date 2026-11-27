import type { WorldCityEntry } from '@cityzen/shared';

export interface SiteConflictResult {
  /** Authoritative entries displayed on sites (at most one per siteId). */
  winners: WorldCityEntry[];
  /** Conflicting entries that claimed an already-taken siteId while offline. */
  losers: WorldCityEntry[];
}

/**
 * Deterministic tie-breaker for offline Earth site claims.
 *
 * When two peers independently claim the same siteId while disconnected, the
 * city created earliest wins the site (tie-broken lexicographically by cityId).
 * Losing cities are preserved (never deleted) so their owner can relocate them.
 */
export function resolveSiteConflicts(entries: WorldCityEntry[]): SiteConflictResult {
  const bySite = new Map<string, WorldCityEntry[]>();
  const winners: WorldCityEntry[] = [];
  const losers: WorldCityEntry[] = [];

  for (const entry of entries) {
    if (!entry.siteId) {
      winners.push(entry);
      continue;
    }
    const list = bySite.get(entry.siteId);
    if (list) list.push(entry);
    else bySite.set(entry.siteId, [entry]);
  }

  for (const group of bySite.values()) {
    if (group.length === 1) {
      winners.push(group[0]);
      continue;
    }
    const sorted = [...group].sort((a, b) => {
      const aTime = a.createdAt ?? Number.MAX_SAFE_INTEGER;
      const bTime = b.createdAt ?? Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return a.cityId.localeCompare(b.cityId);
    });
    winners.push(sorted[0]);
    for (let i = 1; i < sorted.length; i++) {
      losers.push(sorted[i]);
    }
  }

  return { winners, losers };
}
