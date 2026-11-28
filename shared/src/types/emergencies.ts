import type { Position } from './grid.js';

export type CityEmergencyKind = 'robbery' | 'fire' | 'medical' | 'sewage_overflow';

export interface CityEmergency {
  id: string;
  kind: CityEmergencyKind;
  /** Target building where the incident is occurring. */
  buildingId: string;
  position: Position;
  /** City tick when the emergency started. */
  startedAtTick: number;
  /** City tick when the emergency will fail if no service vehicle arrives in time. */
  deadlineTick: number;
  /** Set once a service vehicle reaches the scene and starts handling it. */
  respondingAtTick?: number;
}

export interface CityEmergencyOutcome {
  emergency: CityEmergency;
  resolution: 'resolved' | 'failed';
  /** Number of citizens who died as a consequence of an unhandled incident. */
  deaths: number;
  /** Treasury loss (stolen funds, emergency cleanup, etc.). */
  moneyLost: number;
  /** Building destroyed completely (e.g. non-zone building burned down). */
  destroyedBuildingId?: string;
  /** Zone lot razed back to level 0 (e.g. zoned building burned down). */
  razedZoneId?: string;
  /** Zone lot downgraded by 1 development level (e.g. robbery / sewage damage). */
  damagedZoneId?: string;
  /** Human-readable summary of what happened. */
  summary: string;
}
