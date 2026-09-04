export const LIMITS = Object.freeze({
  maxPlayersPerRoom: 8,
  maxActiveRooms: 250,
  maxPublicListings: 250,
  maxInvites: 500,
  maxPayloadBytes: 1024,
  maxEventsPerWindow: 80,
  rateWindowMs: 10_000,
  inviteTtlMs: 30_000,
  listingTtlMs: 30_000,
  joinTtlMs: 60_000,
  reconnectGraceMs: 5_000,
  finishedRoomTtlMs: 60_000,
  roomInactivityMs: 600_000,
  minReadyToStart: 3,
  minReturnToLobby: 2,
  countdownSeconds: 5,
  maxRetainedSnapshots: 32,
  maxConnectionsPerIp: 20,
  maxConnectAttemptsPerIpWindow: 40,
  connectAttemptWindowMs: 60_000,
  maxSocketsPerUser: 8,
  maxBurstWpm: 280,
  maxSustainedWpm: 220,
});

export type Mode = 'time' | 'words';

export interface RaceConfig {
  mode: Mode;
  amount: number;
  lang: string;
  punct: boolean;
  nums: boolean;
}

export function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function normalizeConfig(input: unknown): RaceConfig {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const allowedAmounts = [15, 30, 60, 120];
  const parsed = Number.parseInt(String(raw.amount), 10);
  let amount = 30;
  if (Number.isFinite(parsed)) {
    amount = allowedAmounts.reduce((best, value) => (
      Math.abs(value - parsed) < Math.abs(best - parsed) ? value : best
    ), allowedAmounts[0]);
  }
  const language = String(raw.lang || raw.language || 'english')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 64) || 'english';

  return Object.freeze({
    mode: 'time',
    amount,
    lang: language,
    punct: raw.punct === true || raw.punct === 1 || raw.punct === '1',
    nums: raw.nums === true || raw.nums === 1 || raw.nums === '1',
  });
}

export function configKey(config: RaceConfig): string {
  return [
    config.mode,
    config.amount,
    config.lang,
    config.punct ? 1 : 0,
    config.nums ? 1 : 0,
  ].join(':');
}

/** Wire format expected by the SPA. */
export function serializeConfig(config: RaceConfig): [string, number, string, number, number] {
  return [
    config.mode,
    config.amount,
    config.lang,
    config.punct ? 1 : 0,
    config.nums ? 1 : 0,
  ];
}
