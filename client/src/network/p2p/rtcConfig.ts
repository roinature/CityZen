import type { TurnServerConfig } from 'trystero';

const DEFAULT_STUN_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export interface P2PIceConfig {
  rtcConfig: RTCConfiguration;
  turnConfig: TurnServerConfig[];
  hasTurn: boolean;
}

export interface IceEnvLike {
  VITE_ICE_SERVERS?: string;
  VITE_TURN_URL?: string;
  VITE_TURN_USERNAME?: string;
  VITE_TURN_CREDENTIAL?: string;
}

function isTurnUrl(url: string): boolean {
  return /^turns?:/i.test(url.trim());
}

function isTurnServer(server: RTCIceServer): boolean {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  return urls.some(u => typeof u === 'string' && isTurnUrl(u));
}

function toTurnConfig(server: RTCIceServer): TurnServerConfig {
  return {
    urls: server.urls,
    ...(server.username ? { username: server.username } : {}),
    ...(typeof server.credential === 'string' ? { credential: server.credential } : {}),
  };
}

/**
 * Parse optional STUN/TURN configuration from Vite environment variables.
 *
 * Mobile cellular networks (4G/5G CGNAT) frequently block direct peer-to-peer
 * WebRTC connections unless a TURN relay is configured. Set either:
 *   - VITE_ICE_SERVERS='[{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]'
 *   - or VITE_TURN_URL, VITE_TURN_USERNAME, VITE_TURN_CREDENTIAL
 *
 * When no TURN env vars are set, falls back cleanly to free public STUN servers.
 */
export function buildIceConfig(env: IceEnvLike = import.meta.env): P2PIceConfig {
  const customServers: RTCIceServer[] = [];

  if (env.VITE_ICE_SERVERS) {
    try {
      const parsed = JSON.parse(env.VITE_ICE_SERVERS);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && (typeof item.urls === 'string' || Array.isArray(item.urls))) {
            customServers.push(item as RTCIceServer);
          }
        }
      }
    } catch (err) {
      console.warn('[p2p] Invalid VITE_ICE_SERVERS JSON; falling back to default STUN:', err);
    }
  }

  if (env.VITE_TURN_URL) {
    const urls = env.VITE_TURN_URL.split(',').map(s => s.trim()).filter(Boolean);
    if (urls.length > 0) {
      customServers.push({
        urls: urls.length === 1 ? urls[0] : urls,
        ...(env.VITE_TURN_USERNAME ? { username: env.VITE_TURN_USERNAME } : {}),
        ...(env.VITE_TURN_CREDENTIAL ? { credential: env.VITE_TURN_CREDENTIAL } : {}),
      });
    }
  }

  const turnConfig = customServers.filter(isTurnServer).map(toTurnConfig);
  const iceServers: RTCIceServer[] = [...DEFAULT_STUN_SERVERS, ...customServers];

  return {
    rtcConfig: { iceServers },
    turnConfig,
    hasTurn: turnConfig.length > 0,
  };
}
