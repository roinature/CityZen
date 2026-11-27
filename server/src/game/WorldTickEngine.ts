import { type WorldState, type TickRoom, PopulationManager, WorldTickEngine as SharedWorldTickEngine } from '@cityzen/shared';
import { broadcastToAll, broadcastToChannel } from '../realtime/supabaseBroadcast.js';

/** The shared world tick, delivered over Supabase Realtime. */
export class WorldTickEngine extends SharedWorldTickEngine {
  constructor(worldState: WorldState, getRooms: () => TickRoom[], populationManager: PopulationManager) {
    super(worldState, getRooms, populationManager, {
      toAll: (event, payload) => { void broadcastToAll(event, payload); },
      toCity: (cityId, event, payload) => { void broadcastToChannel(`city:${cityId}`, event, payload); },
    });
  }
}
