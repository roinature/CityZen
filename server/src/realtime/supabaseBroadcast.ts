import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config.js';

const WORLD_CHANNEL = 'world';

let supabase: SupabaseClient;

export function initBroadcast(): void {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export async function broadcastToChannel(channel: string, event: string, payload: unknown): Promise<void> {
  await supabase.channel(channel).httpSend(event, payload);
}

export async function broadcastToAll(event: string, payload: unknown): Promise<void> {
  await broadcastToChannel(WORLD_CHANNEL, event, payload);
}
