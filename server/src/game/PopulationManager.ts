import { v4 as uuid } from 'uuid';
import {
  type Person,
  type PopulationSummary,
  type PlacedBuilding,
  type ZonePopulationEntry,
  LifeStage,
  MaslowNeed,
  MASLOW_NEEDS_ORDERED,
  MASLOW_LERP_RATE,
  BuildingType,
  isZone,
  getZoneLevelDef,
  getLifeStage,
  getPersonHappiness,
  createDefaultMaslow,
  getDeathProbability,
  adjustTargetsForLifeStage,
} from '@cityzen/shared';
import type { ZoneType } from '@cityzen/shared';

// ── Age distribution for generating initial population ──────
const AGE_DISTRIBUTION: Array<{ min: number; max: number; weight: number }> = [
  { min: 0, max: 12, weight: 0.15 },   // children
  { min: 13, max: 17, weight: 0.10 },   // teens
  { min: 18, max: 25, weight: 0.20 },   // young adults
  { min: 26, max: 59, weight: 0.45 },   // adults
  { min: 60, max: 75, weight: 0.10 },   // elders
];

function randomAge(): number {
  const roll = Math.random();
  let cumulative = 0;
  for (const bucket of AGE_DISTRIBUTION) {
    cumulative += bucket.weight;
    if (roll < cumulative) {
      return bucket.min + Math.floor(Math.random() * (bucket.max - bucket.min + 1));
    }
  }
  return 30; // fallback
}

// ── Compact serialization format ────────────────────────────
// [id, age, cityId, p, s, l, e, c, a, sa, birthTick, residenceZoneId?]
type SerializedPerson = [string, number, string | null, number, number, number, number, number, number, number, number, string | null | undefined];

function serializePerson(p: Person): SerializedPerson {
  return [
    p.id,
    p.age,
    p.cityId,
    p.maslow[MaslowNeed.PHYSIOLOGICAL],
    p.maslow[MaslowNeed.SAFETY],
    p.maslow[MaslowNeed.LOVE_BELONGING],
    p.maslow[MaslowNeed.ESTEEM],
    p.maslow[MaslowNeed.COGNITIVE],
    p.maslow[MaslowNeed.AESTHETIC],
    p.maslow[MaslowNeed.SELF_ACTUALIZATION],
    p.birthTick,
    p.residenceZoneId ?? null,
  ];
}

function deserializePerson(t: SerializedPerson): Person {
  return {
    id: t[0],
    age: t[1],
    cityId: t[2],
    residenceZoneId: t[11] ?? null,
    maslow: {
      [MaslowNeed.PHYSIOLOGICAL]: t[3],
      [MaslowNeed.SAFETY]: t[4],
      [MaslowNeed.LOVE_BELONGING]: t[5],
      [MaslowNeed.ESTEEM]: t[6],
      [MaslowNeed.COGNITIVE]: t[7],
      [MaslowNeed.AESTHETIC]: t[8],
      [MaslowNeed.SELF_ACTUALIZATION]: t[9],
    },
    birthTick: t[10],
  };
}

// ── PopulationManager ───────────────────────────────────────

export class PopulationManager {
  private persons: Map<string, Person> = new Map();
  private cityIndex: Map<string, Set<string>> = new Map();
  private unassigned: Set<string> = new Set();

  /** Generate the initial world population (unassigned to any city). */
  initWorldPopulation(count: number, tick: number): void {
    for (let i = 0; i < count; i++) {
      const person = this.createPerson(null, randomAge(), tick);
      this.persons.set(person.id, person);
      this.unassigned.add(person.id);
    }
  }

  /** Seed a city with people from the unassigned world pool. */
  seedCity(cityId: string, count: number): Person[] {
    const seeded: Person[] = [];
    const iter = this.unassigned.values();

    for (let i = 0; i < count; i++) {
      const next = iter.next();
      if (next.done) break;

      const personId = next.value;
      const person = this.persons.get(personId)!;
      person.cityId = cityId;
      this.unassigned.delete(personId);
      this.addToCityIndex(cityId, personId);
      seeded.push(person);
    }

    return seeded;
  }

  /** Create a new person born in a city. */
  birth(cityId: string, tick: number): Person {
    const person = this.createPerson(cityId, 0, tick);
    this.persons.set(person.id, person);
    this.addToCityIndex(cityId, person.id);
    return person;
  }

  /** Remove a person (death). */
  death(personId: string): void {
    const person = this.persons.get(personId);
    if (!person) return;

    if (person.cityId) {
      this.removeFromCityIndex(person.cityId, personId);
    } else {
      this.unassigned.delete(personId);
    }
    this.persons.delete(personId);
  }

  /** Age all persons by 1 year. */
  ageAll(): void {
    for (const person of this.persons.values()) {
      person.age += 1;
    }
  }

  /** Process deaths for a specific city. Returns removed persons. */
  processCityDeaths(cityId: string): Person[] {
    const personIds = this.cityIndex.get(cityId);
    if (!personIds) return [];

    const deceased: Person[] = [];
    for (const pid of Array.from(personIds)) {
      const person = this.persons.get(pid)!;
      const prob = getDeathProbability(person);
      if (prob >= 1 || Math.random() < prob) {
        deceased.push(person);
        this.death(pid);
      }
    }
    return deceased;
  }

  /** Process deaths for unassigned population. Returns removed persons. */
  processUnassignedDeaths(): Person[] {
    const deceased: Person[] = [];
    for (const pid of Array.from(this.unassigned)) {
      const person = this.persons.get(pid)!;
      const prob = getDeathProbability(person);
      if (prob >= 1 || Math.random() < prob) {
        deceased.push(person);
        this.death(pid);
      }
    }
    return deceased;
  }

  /** Move a person from one city to another. Clears zone assignment (re-assigned on next tick). */
  migrate(personId: string, fromCityId: string, toCityId: string): void {
    const person = this.persons.get(personId);
    if (!person || person.cityId !== fromCityId) return;

    this.removeFromCityIndex(fromCityId, personId);
    person.cityId = toCityId;
    person.residenceZoneId = null; // Will be re-assigned in next zone assignment pass
    this.addToCityIndex(toCityId, personId);
  }

  /** Get all persons in a city. */
  getCityPopulation(cityId: string): Person[] {
    const personIds = this.cityIndex.get(cityId);
    if (!personIds) return [];
    return Array.from(personIds).map(id => this.persons.get(id)!);
  }

  /** Get population count for a city. */
  getCityPopulationCount(cityId: string): number {
    return this.cityIndex.get(cityId)?.size ?? 0;
  }

  /** Compute demographic summary for a city. */
  getCityPopulationSummary(cityId: string): PopulationSummary {
    const persons = this.getCityPopulation(cityId);

    let children = 0, teens = 0, youngAdults = 0, adults = 0, elders = 0;
    let totalHappiness = 0;
    const avgMaslow = createDefaultMaslow();

    // Zero out the defaults before accumulating
    for (const need of MASLOW_NEEDS_ORDERED) {
      avgMaslow[need] = 0;
    }

    for (const p of persons) {
      const stage = getLifeStage(p.age);
      switch (stage) {
        case LifeStage.CHILD: children++; break;
        case LifeStage.TEEN: teens++; break;
        case LifeStage.YOUNG_ADULT: youngAdults++; break;
        case LifeStage.ADULT: adults++; break;
        case LifeStage.ELDER: elders++; break;
      }
      totalHappiness += getPersonHappiness(p.maslow);
      for (const need of MASLOW_NEEDS_ORDERED) {
        avgMaslow[need] += p.maslow[need];
      }
    }

    const total = persons.length;
    if (total > 0) {
      for (const need of MASLOW_NEEDS_ORDERED) {
        avgMaslow[need] = Math.round(avgMaslow[need] / total);
      }
    } else {
      // Reset to default 50 for empty cities
      for (const need of MASLOW_NEEDS_ORDERED) {
        avgMaslow[need] = 50;
      }
    }

    return {
      total,
      children,
      teens,
      youngAdults,
      adults,
      elders,
      averageHappiness: total > 0 ? Math.round(totalHappiness / total) : 50,
      averageMaslow: avgMaslow,
    };
  }

  /** Total persons in the world (all cities + unassigned). */
  getTotalPopulation(): number {
    return this.persons.size;
  }

  /** Number of unassigned persons in the world pool. */
  getUnassignedCount(): number {
    return this.unassigned.size;
  }

  /** Get fertile count (young adults + adults) for a city. */
  getCityFertileCount(cityId: string): number {
    const personIds = this.cityIndex.get(cityId);
    if (!personIds) return 0;
    let count = 0;
    for (const pid of personIds) {
      const person = this.persons.get(pid)!;
      const stage = getLifeStage(person.age);
      if (stage === LifeStage.YOUNG_ADULT || stage === LifeStage.ADULT) {
        count++;
      }
    }
    return count;
  }

  /** Get average Maslow need value for a city's population. */
  getCityAverageMaslowNeed(cityId: string, need: MaslowNeed): number {
    const personIds = this.cityIndex.get(cityId);
    if (!personIds || personIds.size === 0) return 50;
    let total = 0;
    for (const pid of personIds) {
      total += this.persons.get(pid)!.maslow[need];
    }
    return total / personIds.size;
  }

  /**
   * Lerp each person's Maslow satisfaction toward the city-provided targets.
   * Call once per tick — the lerp rate ensures gradual convergence.
   */
  updateCityMaslow(cityId: string, baseTargets: Record<MaslowNeed, number>): void {
    const personIds = this.cityIndex.get(cityId);
    if (!personIds) return;

    for (const pid of personIds) {
      const person = this.persons.get(pid)!;
      const lifeStage = getLifeStage(person.age);
      const targets = adjustTargetsForLifeStage(baseTargets, lifeStage);

      for (const need of MASLOW_NEEDS_ORDERED) {
        const current = person.maslow[need];
        const target = targets[need];
        // Lerp toward target
        person.maslow[need] = current + (target - current) * MASLOW_LERP_RATE;
      }
    }
  }

  // ── Zone Population Tracking ─────────────────────────────────

  /**
   * Assign city residents to residential zones based on capacity.
   * Clears invalid assignments (demolished zones) and fills unassigned people
   * into zones with available capacity.
   */
  assignPeopleToZones(cityId: string, buildings: PlacedBuilding[]): void {
    const personIds = this.cityIndex.get(cityId);
    if (!personIds || personIds.size === 0) return;

    // Build lookup of residential zones with their capacities
    const residentialZones: Array<{ id: string; capacity: number }> = [];
    for (const b of buildings) {
      if (isZone(b.type) && b.type === BuildingType.ZONE_RESIDENTIAL && b.developmentLevel && b.developmentLevel > 0) {
        const levelDef = getZoneLevelDef(b.type as ZoneType, b.density, b.developmentLevel);
        residentialZones.push({ id: b.id, capacity: levelDef.populationCapacity });
      }
    }

    const validZoneIds = new Set(residentialZones.map(z => z.id));
    const zoneCounts = new Map<string, number>();

    // First pass: validate existing assignments and count
    for (const pid of personIds) {
      const person = this.persons.get(pid)!;
      if (person.residenceZoneId && validZoneIds.has(person.residenceZoneId)) {
        zoneCounts.set(person.residenceZoneId, (zoneCounts.get(person.residenceZoneId) || 0) + 1);
      } else {
        person.residenceZoneId = null;
      }
    }

    // Second pass: assign unassigned people to zones with available capacity
    for (const pid of personIds) {
      const person = this.persons.get(pid)!;
      if (person.residenceZoneId) continue; // already assigned

      for (const zone of residentialZones) {
        const current = zoneCounts.get(zone.id) || 0;
        if (current < zone.capacity) {
          person.residenceZoneId = zone.id;
          zoneCounts.set(zone.id, current + 1);
          break;
        }
      }
    }
  }

  /**
   * Get zone population entries for all zones in a city (residential, commercial, industrial).
   * For residential: actual person count. For commercial/industrial: derived from development level.
   */
  getZonePopulations(cityId: string, buildings: PlacedBuilding[]): ZonePopulationEntry[] {
    const personIds = this.cityIndex.get(cityId);
    const entries: ZonePopulationEntry[] = [];

    // Count residential zone populations from person assignments
    const zoneCounts = new Map<string, number>();
    if (personIds) {
      for (const pid of personIds) {
        const person = this.persons.get(pid)!;
        if (person.residenceZoneId) {
          zoneCounts.set(person.residenceZoneId, (zoneCounts.get(person.residenceZoneId) || 0) + 1);
        }
      }
    }

    for (const b of buildings) {
      if (!isZone(b.type) || !b.developmentLevel || b.developmentLevel <= 0) continue;

      const levelDef = getZoneLevelDef(b.type as ZoneType, b.density, b.developmentLevel);

      if (b.type === BuildingType.ZONE_RESIDENTIAL) {
        entries.push({
          buildingId: b.id,
          population: zoneCounts.get(b.id) || 0,
          capacity: levelDef.populationCapacity,
        });
      } else {
        // Commercial/industrial: derive fill from development ratio
        const maxLevel = 3;
        const fillRatio = b.developmentLevel / maxLevel;
        entries.push({
          buildingId: b.id,
          population: Math.round(fillRatio * levelDef.populationCapacity),
          capacity: levelDef.populationCapacity,
        });
      }
    }

    return entries;
  }

  // ── Serialization ──────────────────────────────────────────

  serialize(): SerializedPerson[] {
    return Array.from(this.persons.values()).map(serializePerson);
  }

  static deserialize(data: unknown[]): PopulationManager {
    const pm = new PopulationManager();
    for (const tuple of data) {
      const person = deserializePerson(tuple as SerializedPerson);
      pm.persons.set(person.id, person);
      if (person.cityId) {
        pm.addToCityIndex(person.cityId, person.id);
      } else {
        pm.unassigned.add(person.id);
      }
    }
    return pm;
  }

  // ── Private helpers ────────────────────────────────────────

  private createPerson(cityId: string | null, age: number, tick: number): Person {
    return {
      id: uuid(),
      age,
      cityId,
      maslow: createDefaultMaslow(),
      birthTick: tick,
    };
  }

  private addToCityIndex(cityId: string, personId: string): void {
    let set = this.cityIndex.get(cityId);
    if (!set) {
      set = new Set();
      this.cityIndex.set(cityId, set);
    }
    set.add(personId);
  }

  private removeFromCityIndex(cityId: string, personId: string): void {
    const set = this.cityIndex.get(cityId);
    if (set) {
      set.delete(personId);
      if (set.size === 0) this.cityIndex.delete(cityId);
    }
  }
}
