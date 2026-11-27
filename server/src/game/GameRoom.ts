import { type CityState, AUTO_SAVE_INTERVAL_MS, CityRoom } from '@cityzen/shared';
import { loadCityState, saveCityState } from '../persistence/jsonStore.js';
import { broadcastToChannel } from '../realtime/supabaseBroadcast.js';
import { IS_SERVERLESS } from '../config.js';

type CityBroadcast = (event: string, data: unknown) => void;

/**
 * A city hosted by the server: the shared CityRoom rules, delivered over
 * Supabase Realtime and saved to Postgres.
 */
export class GameRoom extends CityRoom {
  private saveInterval: ReturnType<typeof setInterval> | null = null;
  private debouncedSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private persistedRevision?: number;
  private collectBroadcast?: CityBroadcast;

  constructor(id: string, name: string, ownerId: string, ownerName: string, existingState?: CityState,
    collectBroadcast?: CityBroadcast, siteId?: string,
  ) {
    super(id, name, ownerId, ownerName, existingState, siteId);
    this.collectBroadcast = collectBroadcast;
    this.persistedRevision = existingState?.updatedAt;
  }

  start(): void {
    // Tick is now driven by WorldTickEngine — only auto-save here
    this.saveInterval = setInterval(() => {
      if (this.players.size > 0) {
        this.save();
      }
    }, AUTO_SAVE_INTERVAL_MS);
  }

  stop(): void {
    if (this.saveInterval) clearInterval(this.saveInterval);
    this.save();
  }

  async forceSave(): Promise<void> {
    await this.save();
  }

  syncPersistedState(state: CityState): void {
    if (this.persistedRevision !== undefined && this.persistedRevision >= state.updatedAt) return;
    this.persistedRevision = state.updatedAt;
    this.state = structuredClone(state);
  }

  protected override broadcast(event: string, data: unknown): void {
    if (this.collectBroadcast) {
      this.collectBroadcast(event, data);
      return;
    }
    broadcastToChannel(`city:${this.id}`, event, data);
  }

  protected override onMutated(): void {
    if (this.collectBroadcast) return;
    if (this.debouncedSaveTimer) clearTimeout(this.debouncedSaveTimer);
    this.debouncedSaveTimer = setTimeout(() => this.save(), 1000);
  }

  private isSaving = false;
  private savePending = false;

  private async save(): Promise<void> {
    if (this.isSaving) {
      this.savePending = true;
      return;
    }
    this.isSaving = true;
    try {
      const snapshot = IS_SERVERLESS ? structuredClone(this.state) : this.state;
      const revision = await saveCityState(this.id, snapshot, IS_SERVERLESS ? this.persistedRevision : undefined);
      if (revision !== null) {
        this.persistedRevision = Math.max(this.persistedRevision ?? 0, revision);
      } else {
        const latest = await loadCityState(this.id);
        if (latest) this.syncPersistedState(latest);
      }
    } catch (err) {
      console.error(`Failed to save city ${this.id}:`, err);
    } finally {
      this.isSaving = false;
      if (this.savePending) {
        this.savePending = false;
        this.save();
      }
    }
  }
}
