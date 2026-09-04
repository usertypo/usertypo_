import type { Env, Profile } from './auth';
import {
  areBlocked,
  areFriends,
  authenticateHandshake,
  getProfile,
  hasBlocked,
} from './auth';
import { computeConsistencyFromSnapshots } from './consistency';
import {
  LIMITS,
  normalizeConfig,
  configKey,
  serializeConfig,
  clampInteger,
  type RaceConfig,
} from './config';
import { createPrompt, type Prompt } from './prompt';

type RoomState = 'waiting' | 'countdown' | 'racing' | 'finished' | 'disposed';

interface Player {
  userId: string;
  index: number;
  name: string;
  avatarUrl: string;
  level: number;
  percentToNext: number;
  joined: boolean;
  ready: boolean;
  status: string;
  sequence: number;
  completedWords: number;
  totalKeystrokes: number;
  correctChars: number;
  wpm: number;
  accuracy: number;
  finalStats: {
    validChars?: number;
    rawChars?: number;
    errorsMade?: number;
    extraChars?: number;
    displaySeconds?: number;
    consistency?: number;
  } | null;
  finishedAt: number | null;
  leftMidGame: boolean;
  snapshots: Array<[number, number, number, number]>;
  lastSnapshotAt: number;
  lastCursorAt?: number;
  lastPersistAt?: number;
}

interface BotPlayer {
  index: number;
  name: string;
  status: string;
  completedWords: number;
  correctChars: number;
  totalKeystrokes: number;
  wpm: number;
  accuracy: number;
  targetWpm: number;
  finishedAt: number | null;
  snapshots: Array<[number, number, number, number]>;
}

interface Room {
  id: string;
  type: string;
  config: RaceConfig;
  prompt: Prompt;
  players: Record<string, Player>;
  allowedUserIds: string[];
  hostUserId: string;
  maxPlayers: number;
  roomName: string;
  roomCode: string;
  bot: BotPlayer | null;
  state: RoomState;
  createdAt: number;
  startsAt: number | null;
  countdownEndsAt: number | null;
  lastResults: unknown[] | null;
  finishReason: string;
  opponentLeft: boolean;
  rematchVotes: string[];
  returnLobbyVotes: string[];
}

interface Listing {
  id: string;
  ownerUserId: string;
  ownerName: string;
  config: RaceConfig;
  key: string;
  status: string;
  createdAt: number;
  expiresAt: number;
  awaitingChoice: boolean;
}

interface AlarmEntry {
  at: number;
  payload: AlarmPayload;
}

interface Invite {
  id: string;
  fromUserId: string;
  toUserId: string;
  config: RaceConfig;
  createdAt: number;
  expiresAt: number;
}

interface HubSnapshot {
  profiles: Record<string, Profile>;
  listings: Listing[];
  invites: Invite[];
  rooms: Room[];
  userToRoom: Record<string, string>;
  roomCodes?: Record<string, string>;
}

interface AlarmPayload {
  kind: string;
  roomId?: string;
  listingId?: string;
  inviteId?: string;
  userId?: string;
  at?: number;
}

const ROOM_BOT_NAMES = [
  'TypeBot', 'KeyClaw', 'NeonType', 'SwiftKeys', 'PixelPace',
];

function shortId(bytes = 9): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function safeAck(ws: WebSocket, id: string | undefined, value: Record<string, unknown>) {
  if (!id) return;
  ws.send(JSON.stringify({ t: 'ack', id, ...value }));
}

export class MultiplayerHub implements DurableObject {
  private env: Env;
  private profiles = new Map<string, Profile>();
  private listings = new Map<string, Listing>();
  private invites = new Map<string, Invite>();
  private rooms = new Map<string, Room>();
  private userToRoom = new Map<string, string>();
  /** Lobby only: join code → roomId for custom rooms. */
  private roomCodes = new Map<string, string>();
  private wsToUser = new Map<WebSocket, string>();
  private userSockets = new Map<string, Set<WebSocket>>();
  private loaded = false;
  private alarmWriteChain: Promise<void> = Promise.resolve();
  /** lobby = matchmaking; race = one duel DO (idFromName room:{id}) */
  private role: 'lobby' | 'race' | 'unknown' = 'unknown';
  private boundRoomId = '';

  constructor(private ctx: DurableObjectState, env: Env) {
    this.env = env;
    // Keep hibernating sockets alive without waking the DO on every ping.
    try {
      this.ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair('ping', 'pong'),
      );
    } catch { /* older runtimes */ }
  }

  private lobbyStub() {
    return this.env.MULTIPLAYER_HUB.get(this.env.MULTIPLAYER_HUB.idFromName('lobby'));
  }

  private raceStub(roomId: string) {
    return this.env.MULTIPLAYER_HUB.get(
      this.env.MULTIPLAYER_HUB.idFromName(`room:${String(roomId || '').trim()}`),
    );
  }

  private async fetchRaceMeta(roomId: string): Promise<{
    roomId: string;
    state: string;
    type?: string;
    allowedUserIds: string[];
    maxPlayers?: number;
    occupiedSlots?: number;
    roomCode?: string;
    roomName?: string;
    hostUserId?: string;
    config?: RaceConfig;
    playerStatuses?: Record<string, string>;
  } | null> {
    try {
      const res = await this.raceStub(roomId).fetch('https://race-do/internal/meta');
      if (!res.ok) return null;
      return await res.json() as {
        roomId: string;
        state: string;
        type?: string;
        allowedUserIds: string[];
        maxPlayers?: number;
        occupiedSlots?: number;
        roomCode?: string;
        roomName?: string;
        hostUserId?: string;
        config?: RaceConfig;
        playerStatuses?: Record<string, string>;
      };
    } catch {
      return null;
    }
  }

  private async notifyLobbyRoomDisposed(room: Room) {
    try {
      await this.lobbyStub().fetch('https://lobby-do/internal/room-disposed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roomId: room.id,
          userIds: room.allowedUserIds,
          roomCode: room.roomCode || undefined,
        }),
      });
    } catch {
      /* best-effort */
    }
  }

  private async notifyLobbyMembershipClear(roomId: string, userIds: string[]) {
    try {
      await this.lobbyStub().fetch('https://lobby-do/internal/room-disposed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId, userIds }),
      });
    } catch {
      /* best-effort */
    }
  }

  private async ensureLoaded() {
    if (this.loaded) return;
    const snap = await this.ctx.storage.get<HubSnapshot>('snapshot');
    if (snap) {
      for (const [k, v] of Object.entries(snap.profiles || {})) this.profiles.set(k, v);
      for (const listing of snap.listings || []) this.listings.set(listing.id, listing);
      for (const invite of snap.invites || []) this.invites.set(invite.id, invite);
      for (const room of snap.rooms || []) {
        if (!room.rematchVotes) room.rematchVotes = [];
        if (!room.returnLobbyVotes) room.returnLobbyVotes = [];
        for (const player of Object.values(room.players || {})) {
          if (player.correctChars == null) player.correctChars = 0;
          if (!player.snapshots) player.snapshots = [];
          if (player.lastSnapshotAt == null) player.lastSnapshotAt = 0;
          if (player.lastCursorAt == null) player.lastCursorAt = 0;
        }
        if (room.bot && !room.bot.snapshots) room.bot.snapshots = [];
        this.rooms.set(room.id, room);
      }
      for (const [k, v] of Object.entries(snap.userToRoom || {})) this.userToRoom.set(k, v);
      for (const [k, v] of Object.entries(snap.roomCodes || {})) this.roomCodes.set(k, v);
    }
    if (this.rooms.size === 1 && this.listings.size === 0) {
      const only = [...this.rooms.values()][0];
      if (only) {
        this.role = 'race';
        this.boundRoomId = only.id;
      }
    } else if (this.listings.size > 0 || this.invites.size > 0 || this.rooms.size === 0) {
      if (this.role === 'unknown') this.role = 'lobby';
    }
    this.rebuildSocketRegistry();
    this.loaded = true;
  }

  private rebuildSocketRegistry() {
    this.wsToUser.clear();
    this.userSockets.clear();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as { userId?: string } | null;
      if (attachment?.userId) {
        this.attachSocket(ws, attachment.userId);
      }
    }
  }

  private attachSocket(ws: WebSocket, userId: string) {
    this.wsToUser.set(ws, userId);
    if (!this.userSockets.has(userId)) this.userSockets.set(userId, new Set());
    this.userSockets.get(userId)!.add(ws);
  }

  private async persist() {
    const snapshot: HubSnapshot = {
      profiles: Object.fromEntries(this.profiles),
      listings: [...this.listings.values()],
      invites: [...this.invites.values()],
      rooms: [...this.rooms.values()],
      userToRoom: Object.fromEntries(this.userToRoom),
      roomCodes: Object.fromEntries(this.roomCodes),
    };
    await this.ctx.storage.put('snapshot', snapshot);
  }

  private async scheduleAlarm(whenMs: number, payload: AlarmPayload) {
    const run = async () => {
      const at = Date.now() + whenMs;
      const pending = await this.ctx.storage.get<AlarmEntry[]>('pendingAlarms') || [];
      pending.push({ at, payload });
      pending.sort((a, b) => a.at - b.at);
      await this.ctx.storage.put('pendingAlarms', pending);
      await this.ctx.storage.setAlarm(pending[0].at);
    };
    // Serialize alarm writes — concurrent scheduleAlarm calls can clobber each other.
    this.alarmWriteChain = this.alarmWriteChain.then(run, run);
    await this.alarmWriteChain;
  }

  async alarm() {
    await this.ensureLoaded();
    const pending = await this.ctx.storage.get<AlarmEntry[]>('pendingAlarms') || [];
    if (!pending.length) return;
    const now = Date.now();
    const due = pending.filter((entry) => entry.at <= now);
    const remaining = pending.filter((entry) => entry.at > now);
    await this.ctx.storage.put('pendingAlarms', remaining);
    for (const entry of due) {
      await this.handleAlarmPayload(entry.payload);
    }
    // Handlers may have scheduled more alarms (e.g. next bot-tick). Always
    // re-read storage — using the pre-handler `remaining` list overwrites the
    // DO alarm clock and drops those follow-up ticks.
    const after = await this.ctx.storage.get<AlarmEntry[]>('pendingAlarms') || [];
    if (after.length) {
      after.sort((a, b) => a.at - b.at);
      await this.ctx.storage.put('pendingAlarms', after);
      await this.ctx.storage.setAlarm(after[0].at);
    }
  }

  private async handleAlarmPayload(payload: AlarmPayload) {
    if (payload.kind === 'invite-expire' && payload.inviteId) {
      const invite = this.invites.get(payload.inviteId);
      if (invite) {
        this.invites.delete(payload.inviteId);
        this.emitToUser(invite.fromUserId, 'duel:expired', [invite.id, invite.toUserId]);
        this.emitToUser(invite.toUserId, 'duel:expired', [invite.id, invite.fromUserId]);
        await this.persist();
      }
    } else if (payload.kind === 'listing-search-timeout' && payload.listingId) {
      this.promptListingChoice(payload.listingId);
    } else if (payload.kind === 'listing-expire' && payload.listingId) {
      this.removeListing(payload.listingId);
    } else if (payload.kind === 'room-join-expire' && payload.roomId) {
      const room = this.rooms.get(payload.roomId);
      if (room && room.state === 'waiting') this.disposeRoom(payload.roomId);
    } else if (payload.kind === 'room-dispose' && payload.roomId) {
      this.disposeRoom(payload.roomId);
    } else if (payload.kind === 'countdown-tick' && payload.roomId) {
      await this.handleCountdownTick(payload.roomId);
    } else if (payload.kind === 'race-end' && payload.roomId) {
      // Short grace so final progress packets can land, then show stats (~1s total).
      await this.scheduleAlarm(800, { kind: 'race-end-finish', roomId: payload.roomId });
    } else if (payload.kind === 'race-end-finish' && payload.roomId) {
      await this.finishRoomById(payload.roomId, 'time');
    } else if (payload.kind === 'bot-tick' && payload.roomId) {
      await this.handleBotTick(payload.roomId);
    }
  }

  private promptListingChoice(listingId: string) {
    const listing = this.listings.get(listingId);
    if (!listing || listing.status !== 'waiting') return;
    listing.awaitingChoice = true;
    this.emitToUser(listing.ownerUserId, 'duel:search-timeout', {
      listingId: listing.id,
      config: listing.config,
    });
    void this.persist();
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureLoaded();
    const url = new URL(request.url);
    const roomParam = String(url.searchParams.get('room') || '').trim();
    if (roomParam) {
      this.role = 'race';
      this.boundRoomId = roomParam;
    }

    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        service: 'usertypo-multiplayer',
        role: this.role === 'unknown' ? (roomParam ? 'race' : 'lobby') : this.role,
        roomId: this.boundRoomId || null,
      });
    }

    if (url.pathname === '/internal/init-room' && request.method === 'POST') {
      const room = await request.json() as Room;
      if (!room || !room.id) return Response.json({ ok: false, error: 'invalid_room' }, { status: 400 });
      if (!room.rematchVotes) room.rematchVotes = [];
      if (!room.returnLobbyVotes) room.returnLobbyVotes = [];
      this.role = 'race';
      this.boundRoomId = room.id;
      this.rooms.clear();
      this.userToRoom.clear();
      this.rooms.set(room.id, room);
      for (const uid of room.allowedUserIds) this.userToRoom.set(uid, room.id);
      for (const player of Object.values(room.players || {})) {
        if (player.correctChars == null) player.correctChars = 0;
        if (!player.snapshots) player.snapshots = [];
        if (player.lastSnapshotAt == null) player.lastSnapshotAt = 0;
        if (player.lastCursorAt == null) player.lastCursorAt = 0;
      }
      if (room.type !== 'custom') {
        this.scheduleAlarm(LIMITS.joinTtlMs, { kind: 'room-join-expire', roomId: room.id });
      }
      await this.persist();
      return Response.json({ ok: true, roomId: room.id });
    }

    if (url.pathname === '/internal/meta') {
      const room = this.boundRoomId
        ? this.rooms.get(this.boundRoomId)
        : [...this.rooms.values()][0];
      if (!room) return Response.json({ ok: false, error: 'missing' }, { status: 404 });
      const playerStatuses: Record<string, string> = {};
      for (const [uid, player] of Object.entries(room.players || {})) {
        playerStatuses[uid] = player.status;
      }
      return Response.json({
        ok: true,
        roomId: room.id,
        state: room.state,
        type: room.type,
        allowedUserIds: room.allowedUserIds,
        maxPlayers: room.maxPlayers,
        occupiedSlots: this.occupiedSlots(room),
        roomCode: room.roomCode,
        roomName: room.roomName,
        hostUserId: room.hostUserId,
        config: room.config,
        playerStatuses,
      });
    }

    if (url.pathname === '/internal/room-add-player' && request.method === 'POST') {
      const body = await request.json() as {
        userId?: string;
        profile?: {
          userId?: string;
          name?: string;
          avatarUrl?: string;
          level?: number;
          percentToNext?: number;
        };
      };
      const userId = String(body.userId || '').trim();
      if (!userId) return Response.json({ ok: false, error: 'invalid_user' }, { status: 400 });
      const room = this.boundRoomId
        ? this.rooms.get(this.boundRoomId)
        : [...this.rooms.values()][0];
      if (!room || room.type !== 'custom' || room.state === 'disposed') {
        return Response.json({ ok: false, error: 'room_not_found' }, { status: 404 });
      }
      if (body.profile) {
        this.profiles.set(userId, {
          userId,
          name: String(body.profile.name || 'Player'),
          avatarUrl: String(body.profile.avatarUrl || ''),
          level: Number(body.profile.level) || 1,
          percentToNext: Number(body.profile.percentToNext) || 0,
        } as Profile);
      }
      const existing = room.players[userId];
      if (!existing) {
        if (this.occupiedSlots(room) >= room.maxPlayers) {
          return Response.json({ ok: false, error: 'room_full' }, { status: 400 });
        }
        if (!room.allowedUserIds.includes(userId)) room.allowedUserIds.push(userId);
        room.players[userId] = this.createPlayer(userId, this.nextPlayerIndex(room));
      } else if (existing.status === 'left') {
        if (this.occupiedSlots(room) >= room.maxPlayers) {
          return Response.json({ ok: false, error: 'room_full' }, { status: 400 });
        }
        if (!room.allowedUserIds.includes(userId)) room.allowedUserIds.push(userId);
        room.players[userId] = this.createPlayer(userId, existing.index);
      }
      this.userToRoom.set(userId, room.id);
      this.emitRoomState(room);
      await this.persist();
      return Response.json({ ok: true, roomId: room.id });
    }

    if (url.pathname === '/internal/room-disposed' && request.method === 'POST') {
      this.role = 'lobby';
      const body = await request.json() as {
        roomId?: string;
        userIds?: string[];
        roomCode?: string;
      };
      const roomId = String(body.roomId || '');
      const userIds = Array.isArray(body.userIds) ? body.userIds : [];
      for (const uid of userIds) {
        if (this.userToRoom.get(String(uid)) === roomId) this.userToRoom.delete(String(uid));
      }
      const code = String(body.roomCode || '').trim();
      if (code) {
        this.roomCodes.delete(code);
        for (const [c, id] of [...this.roomCodes.entries()]) {
          if (id === roomId) this.roomCodes.delete(c);
        }
      }
      this.rooms.delete(roomId);
      await this.persist();
      return Response.json({ ok: true });
    }

    if (url.pathname === '/internal/player-abandon' && request.method === 'POST') {
      const body = await request.json() as { userId?: string };
      const userId = String(body.userId || '');
      const room = this.boundRoomId
        ? this.rooms.get(this.boundRoomId)
        : [...this.rooms.values()][0];
      if (room && userId && room.players[userId]) {
        const player = room.players[userId];
        if (room.state !== 'racing') {
          player.status = 'left';
          player.joined = false;
          this.userToRoom.delete(userId);
          await this.persist();
        }
      }
      return Response.json({ ok: true });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return Response.json({
        ok: true,
        service: 'usertypo-multiplayer',
        hint: 'Connect via WebSocket at /ws (lobby) or /ws?room=<id> (duel)',
        role: this.role,
      });
    }

    if (roomParam) {
      this.role = 'race';
      this.boundRoomId = roomParam;
      if (!this.rooms.has(roomParam)) {
        return Response.json({ ok: false, error: 'room_unavailable' }, { status: 404 });
      }
    } else if (this.role === 'unknown') {
      this.role = 'lobby';
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    await this.ensureLoaded();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(String(message));
    } catch {
      return;
    }
    const type = String(parsed.t || '');
    if (type === 'auth') {
      await this.handleAuth(ws, (parsed.p || {}) as { token?: string; guestId?: string });
      return;
    }
    let userId = this.wsToUser.get(ws);
    if (!userId) {
      const attachment = ws.deserializeAttachment() as { userId?: string } | null;
      if (attachment?.userId) {
        userId = attachment.userId;
        this.attachSocket(ws, userId);
      }
    }
    if (!userId) {
      ws.close(4401, 'unauthorized');
      return;
    }
    if (type === 'req') {
      await this.handleRequest(ws, userId, String(parsed.e || ''), parsed.p, String(parsed.id || ''));
    } else if (type === 'emit') {
      await this.handleEmit(ws, userId, String(parsed.e || ''), parsed.p);
    }
  }

  async webSocketClose(ws: WebSocket) {
    const userId = this.wsToUser.get(ws);
    if (!userId) return;
    this.wsToUser.delete(ws);
    const set = this.userSockets.get(userId);
    if (set) {
      set.delete(ws);
      if (!set.size) {
        this.userSockets.delete(userId);
        if (this.role !== 'race') {
          this.broadcastAll('multiplayer:presence', [userId, 0]);
        }
      }
    }
  }

  private async handleAuth(ws: WebSocket, auth: { token?: string; guestId?: string }) {
    try {
      const session = await authenticateHandshake(this.env, auth);
      const userId = session.userId;

      if (this.role === 'race') {
        const room = this.rooms.get(this.boundRoomId) || [...this.rooms.values()][0];
        const allowed = !!(room && (
          room.allowedUserIds.includes(userId)
          || !!room.players[userId]
        ));
        if (!room || !allowed) {
          ws.close(4403, 'forbidden');
          return;
        }
        this.boundRoomId = room.id;
      } else if (this.role === 'unknown') {
        this.role = 'lobby';
      }

      ws.serializeAttachment({ userId });
      if (!this.userSockets.has(userId)) this.userSockets.set(userId, new Set());
      const sockets = this.userSockets.get(userId)!;
      if (sockets.size >= LIMITS.maxSocketsPerUser) {
        const oldest = sockets.values().next().value;
        if (oldest) {
          oldest.send(JSON.stringify({ t: 'ev', e: 'multiplayer:error', p: ['session_replaced'] }));
          oldest.close(4000, 'replaced');
          sockets.delete(oldest);
          this.wsToUser.delete(oldest);
        }
      }
      this.attachSocket(ws, userId);
      if (this.role !== 'race') this.cleanStaleMembership(userId);

      // Race sockets must authenticate quickly — avoid Supabase profile fetches + persist.
      if (this.role === 'race') {
        const room = this.rooms.get(this.boundRoomId)!;
        const player = room.players[userId];
        let profile = this.profiles.get(userId);
        if (!profile) {
          profile = {
            userId,
            name: player?.name || 'Player',
            avatarUrl: player?.avatarUrl || '',
            level: player?.level ?? 1,
            percentToNext: player?.percentToNext ?? 0,
          };
          this.profiles.set(userId, profile);
        }

        ws.send(JSON.stringify({
          t: 'ev',
          e: 'connect',
          p: null,
        }));
        ws.send(JSON.stringify({
          t: 'ev',
          e: 'multiplayer:ready',
          p: {
            userId,
            profile,
            listings: [],
            search: null,
            outgoingChallenges: [],
            raceRoomId: this.boundRoomId,
          },
        }));
        return;
      }

      const profile = await getProfile(this.env, userId);
      this.profiles.set(userId, profile);

      ws.send(JSON.stringify({
        t: 'ev',
        e: 'connect',
        p: null,
      }));

      const ownListing = [...this.listings.values()].find((l) => l.ownerUserId === userId && l.status === 'waiting');
      const outgoingChallenges = [...this.invites.values()]
        .filter((i) => i.fromUserId === userId)
        .map((invite) => ({
          inviteId: invite.id,
          targetUserId: invite.toUserId,
          targetName: (this.profiles.get(invite.toUserId) || { name: 'your friend' }).name,
          config: invite.config,
          createdAt: invite.createdAt,
        }));
      ws.send(JSON.stringify({
        t: 'ev',
        e: 'multiplayer:ready',
        p: {
          userId,
          profile,
          listings: this.serializeListings(),
          search: ownListing ? {
            listingId: ownListing.id,
            config: ownListing.config,
            createdAt: ownListing.createdAt,
          } : null,
          outgoingChallenges,
        },
      }));
      this.broadcastAll('multiplayer:presence', [userId, 1]);
      await this.persist();
    } catch (error) {
      console.error('[multiplayer] auth failed:', error);
      ws.close(4401, 'unauthorized');
    }
  }

  private isOnline(userId: string): boolean {
    const set = this.userSockets.get(userId);
    return !!(set && set.size);
  }

  private emitToUser(userId: string, event: string, payload: unknown) {
    const set = this.userSockets.get(userId);
    if (!set) return;
    const msg = JSON.stringify({ t: 'ev', e: event, p: payload });
    for (const ws of set) {
      try { ws.send(msg); } catch { /* ignore */ }
    }
  }

  private broadcastAll(event: string, payload: unknown) {
    const msg = JSON.stringify({ t: 'ev', e: event, p: payload });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch { /* ignore */ }
    }
  }

  broadcastToUsers(event: string, payload: unknown, userIds?: string[]) {
    if (!userIds) {
      this.broadcastAll(event, payload);
      return;
    }
    for (const uid of userIds) this.emitToUser(uid, event, payload);
  }

  private emitRoom(room: Room, event: string, payload: unknown) {
    for (const uid of room.allowedUserIds) this.emitToUser(uid, event, payload);
  }

  private serializeListings(): Array<[string, string, ReturnType<typeof serializeConfig>, number]> {
    return [...this.listings.values()]
      .filter((l) => l.status === 'waiting')
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((listing) => {
        const owner = this.profiles.get(listing.ownerUserId);
        const ownerName = listing.ownerName
          || owner?.name
          || 'Player';
        return [
          listing.id,
          ownerName,
          serializeConfig(listing.config),
          listing.createdAt,
        ];
      });
  }

  private broadcastListings() {
    const rows = this.serializeListings();
    this.broadcastAll('duel:listings', rows);
  }

  private removeListing(listingId: string) {
    if (!this.listings.delete(listingId)) return;
    this.broadcastListings();
    void this.persist();
  }

  private disposeRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const uid of room.allowedUserIds) {
      if (this.userToRoom.get(uid) === roomId) this.userToRoom.delete(uid);
    }
    this.rooms.delete(roomId);
    if (this.role === 'race') {
      void this.notifyLobbyRoomDisposed(room);
    }
    void this.persist();
  }

  private createPlayer(userId: string, index: number): Player {
    const profile = this.profiles.get(userId);
    return {
      userId,
      index,
      name: profile?.name || 'Player',
      avatarUrl: profile?.avatarUrl || '',
      level: profile?.level ?? 1,
      percentToNext: profile?.percentToNext ?? 0,
      joined: false,
      ready: false,
      status: 'waiting',
      sequence: 0,
      completedWords: 0,
      totalKeystrokes: 0,
      correctChars: 0,
      wpm: 0,
      accuracy: 100,
      finalStats: null,
      finishedAt: null,
      leftMidGame: false,
      snapshots: [],
      lastSnapshotAt: 0,
      lastCursorAt: 0,
    };
  }

  private occupiedSlots(room: Room): number {
    const humans = Object.values(room.players).filter((p) => p.status !== 'left').length;
    return humans + (room.bot ? 1 : 0);
  }

  private nextPlayerIndex(room: Room): number {
    let max = -1;
    for (const player of Object.values(room.players)) {
      if (player.index > max) max = player.index;
    }
    if (room.bot && room.bot.index > max) max = room.bot.index;
    return max + 1;
  }

  private createCustomRoomBot(room: Room): BotPlayer {
    return {
      index: this.nextPlayerIndex(room),
      name: ROOM_BOT_NAMES[Math.floor(Math.random() * ROOM_BOT_NAMES.length)],
      status: 'waiting',
      completedWords: 0,
      correctChars: 0,
      totalKeystrokes: 0,
      wpm: 0,
      accuracy: 97 + Math.floor(Math.random() * 4),
      targetWpm: 55 + Math.floor(Math.random() * 61),
      finishedAt: null,
      snapshots: [],
    };
  }

  private emitRoomState(room: Room) {
    this.emitRoom(room, 'room:state', this.publicRoomPayload(room, 'custom'));
  }

  private remainingCustomPlayers(room: Room): Player[] {
    return Object.values(room.players).filter((p) => p.status !== 'left');
  }

  private emitReturnLobbyState(room: Room) {
    if (room.type !== 'custom') return;
    const remaining = this.remainingCustomPlayers(room);
    const votes = room.returnLobbyVotes || [];
    const agreed = remaining.filter((p) => votes.includes(p.userId));
    const needed = Math.min(LIMITS.minReturnToLobby, Math.max(1, remaining.length));
    this.emitRoom(room, 'room:return-lobby-state', [
      room.id,
      agreed.length,
      needed,
      agreed.map((p) => p.userId),
    ]);
  }

  private async resetCustomRoomToLobby(room: Room) {
    if (room.type !== 'custom' || room.state === 'disposed') return;
    await this.cancelAlarmsForRoom(room.id);
    room.state = 'waiting';
    room.prompt = await createPrompt(this.env.PUBLIC_SITE_URL || 'https://dev.usertypo.com', room.config);
    room.startsAt = null;
    room.countdownEndsAt = null;
    room.opponentLeft = false;
    room.lastResults = null;
    room.finishReason = '';
    room.returnLobbyVotes = [];
    room.bot = null;
    for (const [uid, player] of Object.entries(room.players)) {
      if (player.status === 'left') {
        delete room.players[uid];
        room.allowedUserIds = room.allowedUserIds.filter((id) => id !== uid);
        this.userToRoom.delete(uid);
      }
    }
    Object.values(room.players).forEach((item, index) => { item.index = index; });
    for (const player of this.remainingCustomPlayers(room)) {
      this.resetPlayerForLobby(player);
      player.joined = true;
      this.userToRoom.set(player.userId, room.id);
    }
    this.emitRoomState(room);
    this.emitRoom(room, 'room:returned-to-lobby', this.publicRoomPayload(room, 'custom'));
    await this.persist();
  }

  private async maybeReturnCustomRoomToLobby(room: Room) {
    if (room.type !== 'custom' || room.state !== 'finished') return;
    const remaining = this.remainingCustomPlayers(room);
    if (!remaining.length) {
      room.bot = null;
      this.emitRoom(room, 'room:closed', [room.id, 'empty', room.roomCode || '']);
      this.disposeRoom(room.id);
      return;
    }
    const votes = room.returnLobbyVotes || [];
    const agreed = remaining.filter((p) => votes.includes(p.userId));
    const needed = Math.min(LIMITS.minReturnToLobby, Math.max(1, remaining.length));
    if (agreed.length >= needed) {
      await this.resetCustomRoomToLobby(room);
    }
  }

  private allocateRoomCode(): string {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      if (!this.roomCodes.has(code)) return code;
    }
    throw new Error('server_capacity');
  }

  private closeCustomRoom(room: Room, reason: string, excludeUserId?: string) {
    if (room.type !== 'custom' || room.state === 'disposed') return;
    const payload = [room.id, reason || 'closed', room.roomCode || ''];
    for (const uid of room.allowedUserIds) {
      if (excludeUserId && uid === excludeUserId) continue;
      this.emitToUser(uid, 'room:closed', payload);
    }
    this.disposeRoom(room.id);
  }

  private async handleCustomRaceLeave(userId: string, room: Room, explicit: boolean) {
    const player = room.players[userId];
    if (!player || player.status === 'left') {
      this.userToRoom.delete(userId);
      await this.notifyLobbyMembershipClear(room.id, [userId]);
      if (!this.remainingCustomPlayers(room).length) {
        room.bot = null;
        this.closeCustomRoom(room, 'empty');
      }
      return;
    }

    if (room.state === 'finished') {
      player.status = 'left';
      player.joined = false;
      if (room.returnLobbyVotes) {
        room.returnLobbyVotes = room.returnLobbyVotes.filter((id) => id !== userId);
      }
      this.userToRoom.delete(userId);
      await this.notifyLobbyMembershipClear(room.id, [userId]);
      if (userId === room.hostUserId) {
        this.closeCustomRoom(room, 'host-left', userId);
        return;
      }
      delete room.players[userId];
      room.allowedUserIds = room.allowedUserIds.filter((id) => id !== userId);
      Object.values(room.players).forEach((item, index) => { item.index = index; });
      this.emitReturnLobbyState(room);
      await this.maybeReturnCustomRoomToLobby(room);
      if (this.rooms.has(room.id) && !this.remainingCustomPlayers(room).length) {
        room.bot = null;
        this.closeCustomRoom(room, 'empty');
      }
      return;
    }

    if (room.state === 'waiting' || room.state === 'countdown') {
      player.status = 'left';
      player.joined = false;
      this.userToRoom.delete(userId);
      await this.notifyLobbyMembershipClear(room.id, [userId]);
      if (userId === room.hostUserId) {
        this.closeCustomRoom(room, 'host-left', userId);
        return;
      }
      if (room.state === 'countdown') {
        await this.cancelAlarmsForRoom(room.id, 'countdown-tick');
        room.state = 'waiting';
        room.countdownEndsAt = null;
        room.startsAt = null;
      }
      delete room.players[userId];
      room.allowedUserIds = room.allowedUserIds.filter((id) => id !== userId);
      Object.values(room.players).forEach((item, index) => { item.index = index; });
      this.emitRoomState(room);
      if (!this.remainingCustomPlayers(room).length) {
        room.bot = null;
        this.closeCustomRoom(room, 'empty');
      }
      return;
    }

    // racing
    player.status = 'left';
    player.leftMidGame = true;
    player.joined = false;
    room.opponentLeft = true;
    this.userToRoom.delete(userId);
    await this.notifyLobbyMembershipClear(room.id, [userId]);
    this.emitRoom(room, 'race:player-left', [
      room.id,
      player.index,
      explicit ? 'left' : 'disconnected',
    ]);
    const remaining = this.remainingCustomPlayers(room);
    if (!remaining.length) {
      room.bot = null;
      this.closeCustomRoom(room, 'empty');
    } else {
      await this.maybeFinishRoom(room);
    }
  }

  private publicRoomPayload(room: Room, reason?: string) {
    return {
      roomId: room.id,
      reason: reason || room.type,
      config: room.config,
      roomName: room.roomName,
      roomCode: room.roomCode,
      hostUserId: room.hostUserId,
      maxPlayers: room.maxPlayers,
      state: room.state,
      players: Object.values(room.players).map((p) => ({
        userId: p.userId,
        name: p.name,
        avatarUrl: p.avatarUrl,
        level: p.level,
        percentToNext: p.percentToNext,
        index: p.index,
        joined: p.joined,
        ready: p.ready,
        status: p.status,
      })),
      bot: room.bot ? {
        name: room.bot.name,
        avatarUrl: '',
        index: room.bot.index,
        isBot: true,
        ready: true,
        status: room.bot.status,
      } : null,
    };
  }

  private raceStartPayload(room: Room) {
    const endsAt = room.config.mode === 'time' && room.startsAt
      ? room.startsAt + (room.config.amount * 1000)
      : null;
    return {
      roomId: room.id,
      startsAt: room.startsAt,
      startsInMs: room.startsAt ? Math.max(0, room.startsAt - Date.now()) : 0,
      endsAt,
      config: room.config,
      words: room.prompt.words,
      textHash: room.prompt.textHash,
      players: Object.values(room.players).map((p) => ({
        index: p.index,
        userId: p.userId,
        name: p.name,
        avatarUrl: p.avatarUrl,
        level: p.level ?? 1,
        percentToNext: p.percentToNext ?? 0,
      })),
      bot: room.bot ? { index: room.bot.index, name: room.bot.name, isBot: true } : null,
    };
  }

  private async createRoom(
    type: string,
    config: RaceConfig,
    allowedUserIds: string[],
    extra?: {
      hostUserId?: string;
      maxPlayers?: number;
      bot?: BotPlayer | null;
      roomCode?: string;
      roomName?: string;
    },
  ): Promise<Room> {
    const activeRooms = new Set(this.userToRoom.values()).size;
    if (activeRooms >= LIMITS.maxActiveRooms) throw new Error('server_capacity');
    const [, prompt] = await Promise.all([
      Promise.all(allowedUserIds.map(async (uid) => {
        const profile = await getProfile(this.env, uid);
        this.profiles.set(uid, profile);
      })),
      createPrompt(this.env.PUBLIC_SITE_URL || 'https://dev.usertypo.com', config),
    ]);
    const id = shortId();
    const players: Record<string, Player> = {};
    allowedUserIds.forEach((uid, index) => {
      players[uid] = this.createPlayer(uid, index);
    });
    const room: Room = {
      id,
      type,
      config,
      prompt,
      players,
      allowedUserIds,
      hostUserId: extra?.hostUserId || allowedUserIds[0],
      maxPlayers: extra?.maxPlayers || allowedUserIds.length,
      roomName: extra?.roomName || '',
      roomCode: extra?.roomCode || '',
      bot: extra?.bot || null,
      state: 'waiting',
      createdAt: Date.now(),
      startsAt: null,
      countdownEndsAt: null,
      lastResults: null,
      finishReason: '',
      opponentLeft: false,
      rematchVotes: [],
      returnLobbyVotes: [],
    };

    // One DO per duel: race state lives on room:{id}, lobby only tracks membership.
    if (this.role !== 'race') {
      const initRes = await this.raceStub(id).fetch('https://race-do/internal/init-room', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(room),
      });
      if (!initRes.ok) throw new Error('race_init_failed');
      for (const uid of allowedUserIds) this.userToRoom.set(uid, id);
      if (type === 'custom' && room.roomCode) {
        this.roomCodes.set(room.roomCode, room.id);
      }
      await this.persist();
      return room;
    }

    this.rooms.set(id, room);
    for (const uid of allowedUserIds) this.userToRoom.set(uid, id);
    if (type === 'custom' && room.roomCode) {
      this.roomCodes.set(room.roomCode, room.id);
    } else if (type !== 'custom') {
      this.scheduleAlarm(LIMITS.joinTtlMs, { kind: 'room-join-expire', roomId: id });
    }
    await this.persist();
    return room;
  }

  private notifyMatchReady(room: Room, reason: string) {
    const base = this.publicRoomPayload(room, reason);
    for (const uid of room.allowedUserIds) {
      this.emitToUser(uid, 'duel:ready', base);
    }
  }

  private requiredPlayersJoined(room: Room): boolean {
    return Object.values(room.players).every((p) => p.joined && p.status !== 'left');
  }

  private async startCountdown(room: Room) {
    if (room.state !== 'waiting') return;
    room.state = 'countdown';
    let seconds = LIMITS.countdownSeconds;
    room.countdownEndsAt = Date.now() + seconds * 1000;
    this.emitRoom(room, 'race:countdown', [room.id, seconds, room.countdownEndsAt]);
    await this.scheduleAlarm(1000, { kind: 'countdown-tick', roomId: room.id });
    await this.persist();
  }

  private async handleCountdownTick(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room || room.state !== 'countdown' || !room.countdownEndsAt) return;
    const seconds = Math.max(0, Math.ceil((room.countdownEndsAt - Date.now()) / 1000));
    if (seconds > 0) {
      this.emitRoom(room, 'race:countdown', [room.id, seconds, room.countdownEndsAt]);
      await this.scheduleAlarm(1000, { kind: 'countdown-tick', roomId });
      return;
    }
    this.emitRoom(room, 'race:countdown', [room.id, 0, room.countdownEndsAt]);
    await this.beginRace(room);
  }

  private async beginRace(room: Room) {
    if (room.state !== 'countdown') return;
    room.state = 'racing';
    room.startsAt = Date.now();
    for (const p of Object.values(room.players)) {
      if (p.status !== 'left') p.status = 'racing';
    }
    this.emitRoom(room, 'race:start', this.raceStartPayload(room));
    if (room.bot) {
      room.bot.status = 'racing';
      await this.scheduleAlarm(500, { kind: 'bot-tick', roomId: room.id });
    }
    if (room.config.mode === 'time') {
      const delay = room.config.amount * 1000 + 200;
      await this.scheduleAlarm(delay, { kind: 'race-end', roomId: room.id });
    }
    await this.persist();
  }

  private async handleBotTick(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room || room.state !== 'racing' || !room.bot || !room.startsAt) return;
    const bot = room.bot;
    if (!bot.snapshots) bot.snapshots = [];
    const elapsedMinutes = Math.max((Date.now() - room.startsAt) / 60_000, 1 / 120);
    const targetChars = Math.floor(bot.targetWpm * 5 * elapsedMinutes);
    let words = bot.completedWords;
    while (words < room.prompt.targetWordCount) {
      const chars = this.cumulativeCorrectChars(room, words + 1);
      if (chars > targetChars) break;
      words += 1;
    }
    bot.completedWords = words;
    bot.correctChars = this.cumulativeCorrectChars(room, words);
    bot.totalKeystrokes = Math.ceil(bot.correctChars / (bot.accuracy / 100));
    bot.wpm = (bot.correctChars / 5) / elapsedMinutes;
    bot.snapshots.push([0, bot.completedWords, bot.totalKeystrokes, Date.now()]);
    if (bot.snapshots.length > LIMITS.maxRetainedSnapshots) bot.snapshots.shift();
    const progress = room.config.mode === 'words'
      ? Math.round((words / room.prompt.targetWordCount) * 100)
      : Math.round(((Date.now() - room.startsAt) / (room.config.amount * 1000)) * 100);
    const finished = room.config.mode === 'words' && words >= room.prompt.targetWordCount;
    this.emitRoom(room, 'race:progress', [
      bot.index,
      bot.wpm,
      Math.min(100, progress),
      finished ? 1 : 0,
      bot.completedWords,
    ]);
    if (finished) {
      bot.status = 'finished';
      bot.finishedAt = Date.now();
      await this.persist();
      await this.maybeFinishRoom(room);
      return;
    }
    await this.scheduleAlarm(1000, { kind: 'bot-tick', roomId });
    await this.persist();
  }

  private cumulativeCorrectChars(room: Room, wordCount: number): number {
    let total = 0;
    for (let i = 0; i < wordCount && i < room.prompt.words.length; i += 1) {
      total += room.prompt.words[i].length + 1;
    }
    return total;
  }

  private async maybeFinishRoom(room: Room) {
    if (room.state !== 'racing') return;
    const active = Object.values(room.players).filter((p) => p.status !== 'left');
    const everyoneDone = active.length > 0 && active.every((p) => p.status === 'finished');
    if (everyoneDone && (!room.bot || room.bot.status === 'finished')) {
      await this.finishRoom(room, 'complete');
    }
  }

  private async cancelAlarmsForRoom(roomId: string, kind?: string) {
    const run = async () => {
      const pending = await this.ctx.storage.get<AlarmEntry[]>('pendingAlarms') || [];
      const filtered = pending.filter((entry) => {
        if (entry.payload.roomId !== roomId) return true;
        if (kind && entry.payload.kind !== kind) return true;
        return false;
      });
      await this.ctx.storage.put('pendingAlarms', filtered);
      if (filtered.length) {
        filtered.sort((a, b) => a.at - b.at);
        await this.ctx.storage.setAlarm(filtered[0].at);
      }
    };
    this.alarmWriteChain = this.alarmWriteChain.then(run, run);
    await this.alarmWriteChain;
  }

  private resetPlayerForLobby(player: Player) {
    player.ready = false;
    player.status = 'waiting';
    player.sequence = 0;
    player.completedWords = 0;
    player.correctChars = 0;
    player.totalKeystrokes = 0;
    player.wpm = 0;
    player.accuracy = 100;
    player.finalStats = null;
    player.finishedAt = null;
    player.leftMidGame = false;
    player.snapshots = [];
    player.lastSnapshotAt = 0;
  }

  private remainingDualHumans(room: Room): Player[] {
    return Object.values(room.players).filter((p) => p.status !== 'left');
  }

  private emitRematchState(room: Room) {
    if (room.type === 'custom' || room.state !== 'finished') return;
    const votes = room.rematchVotes || [];
    this.emitRoom(room, 'race:rematch-state', [
      room.id,
      votes.length,
      Math.max(1, this.remainingDualHumans(room).length),
      votes.slice(),
    ]);
  }

  private async startDualRematch(room: Room) {
    if (room.type === 'custom' || room.state !== 'finished') return;
    await this.cancelAlarmsForRoom(room.id, 'room-dispose');
    room.state = 'waiting';
    room.prompt = await createPrompt(this.env.PUBLIC_SITE_URL || 'https://dev.usertypo.com', room.config);
    room.startsAt = null;
    room.countdownEndsAt = null;
    room.opponentLeft = false;
    room.lastResults = null;
    room.finishReason = '';
    room.rematchVotes = [];
    room.bot = null;
    for (const player of this.remainingDualHumans(room)) {
      this.resetPlayerForLobby(player);
      player.joined = true;
      this.userToRoom.set(player.userId, room.id);
    }
    this.emitRoom(room, 'race:rematch-start', {
      roomId: room.id,
      reason: room.type,
      config: room.config,
    });
    this.startCountdown(room);
    await this.persist();
  }

  private playerResult(player: Player, room: Room): Array<string | number> {
    const progress = room.config.mode === 'words'
      ? Math.min(100, Math.round((player.completedWords / room.prompt.targetWordCount) * 100))
      : Math.min(100, Math.round(((Date.now() - (room.startsAt || Date.now())) / (room.config.amount * 1000)) * 100));
    const fs = player.finalStats;
    const validChars = fs?.validChars ?? player.correctChars ?? 0;
    const rawChars = fs?.rawChars ?? player.totalKeystrokes ?? 0;
    const errorsMade = fs?.errorsMade ?? Math.max(0, rawChars - validChars);
    const extraChars = fs?.extraChars ?? 0;
    const displaySeconds = fs?.displaySeconds ?? (
      player.finishedAt && room.startsAt
        ? Math.floor((player.finishedAt - room.startsAt) / 1000)
        : 0
    );
    // Match live race:progress WPM (continuous elapsed). Floored seconds inflated finals vs LB.
    const elapsedMinutes = (player.finishedAt && room.startsAt)
      ? Math.max((player.finishedAt - room.startsAt) / 60_000, 1 / 120)
      : (fs?.displaySeconds != null
        ? Math.max(displaySeconds / 60, 2 / 60)
        : Math.max(displaySeconds / 60, 1 / 120));
    const exactWpm = (validChars / 5) / elapsedMinutes;
    const exactRawWpm = (rawChars / 5) / elapsedMinutes;
    const accuracy = rawChars > 0
      ? Math.max(0, ((rawChars - errorsMade) / rawChars) * 100)
      : 100;
    const consistency = fs?.consistency != null && Number.isFinite(fs.consistency)
      ? Math.max(0, Math.min(100, Math.round(fs.consistency)))
      : computeConsistencyFromSnapshots(player.snapshots);
    return [
      player.index,
      player.userId,
      player.name,
      Math.max(0, Math.round(exactWpm)),
      Math.max(0, Math.min(100, Math.round(accuracy * 10) / 10)),
      progress,
      player.status,
      player.finishedAt || 0,
      validChars,
      rawChars,
      Math.max(0, Math.round(exactRawWpm)),
      consistency,
      displaySeconds,
      errorsMade,
      extraChars,
    ];
  }

  private botResult(bot: BotPlayer, room: Room): Array<string | number> {
    const progress = room.config.mode === 'words'
      ? Math.min(100, Math.round((bot.completedWords / room.prompt.targetWordCount) * 100))
      : Math.min(100, Math.round(((Date.now() - (room.startsAt || Date.now())) / (room.config.amount * 1000)) * 100));
    const displaySeconds = bot.finishedAt && room.startsAt
      ? Math.floor((bot.finishedAt - room.startsAt) / 1000)
      : (room.startsAt ? Math.max(0, Math.floor((Date.now() - room.startsAt) / 1000)) : 0);
    const elapsedMinutes = (bot.finishedAt && room.startsAt)
      ? Math.max((bot.finishedAt - room.startsAt) / 60_000, 1 / 120)
      : Math.max(displaySeconds / 60, 1 / 120);
    const validChars = bot.correctChars || 0;
    const rawChars = bot.totalKeystrokes || 0;
    const errorsMade = Math.max(0, rawChars - validChars);
    return [
      bot.index,
      'bot',
      bot.name,
      Math.max(0, Math.round((validChars / 5) / elapsedMinutes)),
      Math.max(0, Math.min(100, Math.round(bot.accuracy * 10) / 10)),
      progress,
      bot.status,
      bot.finishedAt || 0,
      validChars,
      rawChars,
      Math.max(0, Math.round((rawChars / 5) / elapsedMinutes)),
      computeConsistencyFromSnapshots(bot.snapshots || []),
      displaySeconds,
      errorsMade,
      0,
    ];
  }

  private async finishRoom(room: Room, reason: string) {
    room.state = 'finished';
    room.finishReason = reason;
    room.rematchVotes = [];
    const results = Object.values(room.players).map((p) => this.playerResult(p, room));
    if (room.bot) {
      results.push(this.botResult(room.bot, room));
    }
    results.sort((a, b) => {
      const aFinished = a[6] === 'finished' ? 1 : 0;
      const bFinished = b[6] === 'finished' ? 1 : 0;
      if (aFinished !== bFinished) return bFinished - aFinished;
      const aWpm = Number(a[3]) || 0;
      const bWpm = Number(b[3]) || 0;
      if (bWpm !== aWpm) return bWpm - aWpm;
      const aAcc = Number(a[4]) || 0;
      const bAcc = Number(b[4]) || 0;
      if (bAcc !== aAcc) return bAcc - aAcc;
      return (Number(a[7]) || 0) - (Number(b[7]) || 0);
    });
    room.lastResults = results;
    room.bot = null;
    this.emitRoom(room, 'race:finished', [
      room.id,
      reason,
      results,
      room.opponentLeft ? 1 : 0,
      room.type,
    ]);
    if (room.type === 'custom') {
      room.returnLobbyVotes = [];
      this.emitReturnLobbyState(room);
      await this.persist();
      return;
    }
    this.scheduleAlarm(LIMITS.finishedRoomTtlMs, { kind: 'room-dispose', roomId: room.id });
    await this.persist();
  }

  private async finishRoomById(roomId: string, reason: string) {
    const room = this.rooms.get(roomId);
    if (!room || room.state !== 'racing') return;
    for (const p of Object.values(room.players)) {
      if (p.status === 'racing') {
        p.status = 'finished';
        p.finishedAt = Date.now();
      }
    }
    if (room.bot && room.bot.status === 'racing') {
      room.bot.status = 'finished';
      room.bot.finishedAt = Date.now();
    }
    await this.finishRoom(room, reason);
  }

  private async abandonStuckMembership(userId: string) {
    const roomId = this.userToRoom.get(userId);
    if (!roomId) return;
    if (this.role === 'race') {
      const room = this.rooms.get(roomId);
      if (!room || room.state === 'racing') return;
      this.userToRoom.delete(userId);
      return;
    }
    const meta = await this.fetchRaceMeta(roomId);
    if (meta && meta.state === 'racing') return;
    this.userToRoom.delete(userId);
    try {
      await this.raceStub(roomId).fetch('https://race-do/internal/player-abandon', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
    } catch { /* best-effort */ }
  }

  private cleanStaleMembership(userId: string) {
    const roomId = this.userToRoom.get(userId);
    if (!roomId) return;
    if (this.role === 'race') {
      const room = this.rooms.get(roomId);
      if (!room || room.state === 'finished' || room.state === 'disposed') {
        this.userToRoom.delete(userId);
        return;
      }
      if (room.state === 'waiting' && !this.isOnline(userId)) {
        this.userToRoom.delete(userId);
      }
      return;
    }
    // Lobby: membership is authoritative here; race DO holds live state.
    // Drop only if race DO is gone / finished.
    void this.fetchRaceMeta(roomId).then((meta) => {
      if (!meta || meta.state === 'finished' || meta.state === 'disposed') {
        if (this.userToRoom.get(userId) === roomId) {
          this.userToRoom.delete(userId);
          void this.persist();
        }
      }
    });
  }

  private purgeStaleListings() {
    const now = Date.now();
    for (const listing of [...this.listings.values()]) {
      if (this.userToRoom.has(listing.ownerUserId)) {
        this.removeListing(listing.id);
        continue;
      }
      if (!this.isOnline(listing.ownerUserId)) {
        if (now - listing.createdAt < 8000) continue;
        this.removeListing(listing.id);
      }
    }
  }

  private async handleRequest(ws: WebSocket, userId: string, event: string, payload: unknown, reqId: string) {
    try {
      const lobbyRoomEvents = new Set([
        'room:create',
        'room:join-code',
        'room:invite',
      ]);
      const raceRoomEvents = new Set([
        'room:ready',
        'room:update-config',
        'room:add-bot',
        'room:remove-player',
        'room:start',
        'room:return-lobby',
      ]);
      const isRaceEvent = event.startsWith('match:')
        || event.startsWith('race:')
        || raceRoomEvents.has(event);
      const isLobbyEvent = event.startsWith('duel:') || lobbyRoomEvents.has(event);
      if (this.role === 'lobby' && isRaceEvent) {
        throw new Error('connect_race_socket');
      }
      if (this.role === 'race' && isLobbyEvent) {
        throw new Error('use_lobby_socket');
      }
      if (event === 'duel:list') {
        safeAck(ws, reqId, { ok: true, listings: this.serializeListings() });
        return;
      }
      if (event === 'duel:create') {
        await this.abandonStuckMembership(userId);
        this.purgeStaleListings();
        for (const l of this.listings.values()) {
          if (l.ownerUserId === userId) throw new Error('already_searching');
        }
        const config = normalizeConfig(payload);
        const profile = this.profiles.get(userId) || await getProfile(this.env, userId);
        this.profiles.set(userId, profile);
        for (const listing of [...this.listings.values()]) {
          if (
            listing.ownerUserId !== userId
            && listing.status === 'waiting'
            && listing.key === configKey(config)
          ) {
            if (this.userToRoom.has(listing.ownerUserId)) {
              this.removeListing(listing.id);
              continue;
            }
            if (!this.isOnline(listing.ownerUserId)) {
              if (Date.now() - listing.createdAt < 8000) continue;
              this.removeListing(listing.id);
              continue;
            }
            this.removeListing(listing.id);
            const room = await this.createRoom('public', config, [listing.ownerUserId, userId]);
            this.notifyMatchReady(room, 'auto-match');
            safeAck(ws, reqId, { ok: true, roomId: room.id });
            await this.persist();
            return;
          }
        }
        const listing: Listing = {
          id: shortId(),
          ownerUserId: userId,
          ownerName: profile.name,
          config,
          key: configKey(config),
          status: 'waiting',
          createdAt: Date.now(),
          expiresAt: Date.now() + LIMITS.listingTtlMs,
          awaitingChoice: false,
        };
        this.listings.set(listing.id, listing);
        this.scheduleAlarm(LIMITS.listingTtlMs, { kind: 'listing-search-timeout', listingId: listing.id });
        this.broadcastListings();
        safeAck(ws, reqId, { ok: true, listingId: listing.id });
        await this.persist();
        return;
      }
      if (event === 'duel:extend-search') {
        const listingId = String(payload || '');
        const listing = this.listings.get(listingId);
        if (!listing || listing.ownerUserId !== userId || listing.status !== 'waiting') {
          throw new Error('listing_unavailable');
        }
        listing.awaitingChoice = false;
        listing.expiresAt = Date.now() + LIMITS.listingTtlMs;
        this.scheduleAlarm(LIMITS.listingTtlMs, { kind: 'listing-search-timeout', listingId: listing.id });
        this.broadcastListings();
        safeAck(ws, reqId, { ok: true, listingId: listing.id });
        await this.persist();
        return;
      }
      if (event === 'duel:cancel') {
        for (const [id, l] of this.listings) {
          if (l.ownerUserId === userId) this.removeListing(id);
        }
        safeAck(ws, reqId, { ok: true, removed: true });
        return;
      }
      if (event === 'duel:join-listing') {
        const listingId = String(payload || '');
        const listing = this.listings.get(listingId);
        if (!listing || listing.status !== 'waiting') throw new Error('listing_unavailable');
        if (listing.ownerUserId === userId) throw new Error('own_listing');
        if (await areBlocked(this.env, userId, listing.ownerUserId)) throw new Error('blocked');
        await this.abandonStuckMembership(userId);
        if (!this.isOnline(listing.ownerUserId)) {
          this.removeListing(listing.id);
          throw new Error('listing_unavailable');
        }
        if (this.userToRoom.has(listing.ownerUserId)) {
          const ownerRoomId = this.userToRoom.get(listing.ownerUserId)!;
          const meta = await this.fetchRaceMeta(ownerRoomId);
          if (!meta || meta.state === 'racing') {
            this.removeListing(listing.id);
            throw new Error('listing_unavailable');
          }
          this.userToRoom.delete(listing.ownerUserId);
        }
        this.removeListing(listing.id);
        const room = await this.createRoom('public', listing.config, [listing.ownerUserId, userId]);
        this.notifyMatchReady(room, 'listing');
        safeAck(ws, reqId, { ok: true, roomId: room.id });
        return;
      }
      if (event === 'duel:play-bot') {
        const listingId = String(payload || '');
        const listing = this.listings.get(listingId);
        if (!listing || listing.ownerUserId !== userId) throw new Error('listing_unavailable');
        this.removeListing(listing.id);
        await this.abandonStuckMembership(userId);
        const bot: BotPlayer = {
          index: 1,
          name: ROOM_BOT_NAMES[Math.floor(Math.random() * ROOM_BOT_NAMES.length)],
          status: 'waiting',
          completedWords: 0,
          correctChars: 0,
          totalKeystrokes: 0,
          wpm: 0,
          accuracy: 97 + Math.floor(Math.random() * 4),
          targetWpm: 55 + Math.floor(Math.random() * 61),
          finishedAt: null,
          snapshots: [],
        };
        const room = await this.createRoom('public', listing.config, [userId], { bot });
        this.notifyMatchReady(room, 'bot');
        safeAck(ws, reqId, { ok: true, roomId: room.id });
        return;
      }
      if (event === 'match:join' || event === 'match:resume') {
        if (this.role !== 'race') {
          throw new Error('connect_race_socket');
        }
        const roomId = String(payload || '');
        const room = this.rooms.get(roomId);
        if (!room || !room.allowedUserIds.includes(userId)) throw new Error('room_unavailable');
        const player = room.players[userId];
        if (!player || player.status === 'left') throw new Error('room_unavailable');
        player.joined = true;
        player.status = player.status === 'left' ? 'waiting' : player.status;
        this.userToRoom.set(userId, room.id);

        // Refresh levels/names for anyone still stuck at the level-1 stub.
        const needsRefresh = Object.values(room.players).filter((p) => (
          p.status !== 'left' && (!p.level || p.level <= 1)
        ));
        if (needsRefresh.length) {
          await Promise.all(needsRefresh.map(async (p) => {
            try {
              const profile = await getProfile(this.env, p.userId);
              this.profiles.set(p.userId, profile);
              if (profile.name) p.name = profile.name;
              if (profile.avatarUrl) p.avatarUrl = profile.avatarUrl;
              if (profile.level > 1 || (p.level || 1) <= 1) {
                p.level = profile.level;
                p.percentToNext = profile.percentToNext;
              }
            } catch {
              /* keep existing stub */
            }
          }));
        }

        const base = this.publicRoomPayload(room, room.type);
        if (room.state === 'countdown' || room.state === 'racing' || room.state === 'finished') {
          safeAck(ws, reqId, {
            ok: true,
            room: base,
            state: room.state,
            countdown: room.state === 'countdown'
              ? Math.max(0, Math.ceil(((room.countdownEndsAt || 0) - Date.now()) / 1000))
              : null,
            countdownEndsAt: room.state === 'countdown' ? room.countdownEndsAt : null,
            race: (room.state === 'countdown' || room.state === 'racing')
              ? this.raceStartPayload(room)
              : null,
            results: room.state === 'finished' ? room.lastResults : null,
            finishReason: room.state === 'finished' ? room.finishReason : null,
            opponentLeft: room.state === 'finished' ? (room.opponentLeft ? 1 : 0) : 0,
          });
          return;
        }
        safeAck(ws, reqId, {
          ok: true,
          room: base,
          state: 'waiting',
          countdown: null,
          race: null,
        });
        this.emitRoom(room, 'race:joined', [room.id, player.index, Object.keys(room.players).length]);
        if (room.type === 'custom') {
          this.emitRoomState(room);
        }
        if (room.type !== 'custom' && this.requiredPlayersJoined(room)) {
          this.startCountdown(room);
        }
        await this.persist();
        return;
      }
      if (event === 'race:leave') {
        const roomId = String(payload || '');
        const rid = roomId || this.userToRoom.get(userId) || '';
        const room = this.rooms.get(rid);
        if (room && room.type === 'custom') {
          await this.handleCustomRaceLeave(userId, room, true);
          safeAck(ws, reqId, { ok: true });
          await this.persist();
          return;
        }
        if (room) {
          const player = room.players[userId];
          if (player) {
            player.status = 'left';
            player.leftMidGame = room.state === 'racing';
          }
          this.userToRoom.delete(userId);
          if (room.state === 'racing') room.opponentLeft = true;
        }
        if (this.role === 'race' && rid) {
          await this.notifyLobbyMembershipClear(rid, [userId]);
        }
        safeAck(ws, reqId, { ok: true });
        await this.persist();
        return;
      }
      if (event === 'race:consistency') {
        const arr = Array.isArray(payload) ? payload : [];
        const room = this.rooms.get(String(arr[0] || ''));
        if (!room || room.state !== 'racing') throw new Error('race_not_active');
        const player = room.players[userId];
        if (!player || player.status === 'left') throw new Error('player_not_active');
        const consistency = Number(arr[1]);
        if (!Number.isFinite(consistency)) throw new Error('invalid_payload');
        if (!player.finalStats) player.finalStats = {};
        player.finalStats.consistency = Math.max(0, Math.min(100, Math.round(consistency)));
        safeAck(ws, reqId, { ok: true });
        await this.persist();
        return;
      }
      if (event === 'race:progress') {
        const arr = Array.isArray(payload) ? payload : [];
        const room = this.rooms.get(String(arr[0] || ''));
        if (!room || room.state !== 'racing') throw new Error('race_not_active');
        const player = room.players[userId];
        if (!player || player.status === 'left') throw new Error('player_not_active');
        const sequence = Number(arr[1]);
        const completedWords = Number(arr[2]);
        const totalKeystrokes = Number(arr[3]);
        const isFinal = Number(arr[4]) === 1;
        const finalStatsPayload = Array.isArray(arr[5]) ? arr[5] : null;
        if (player.status === 'finished' && !isFinal) {
          safeAck(ws, reqId, { ok: true, ignored: true });
          return;
        }
        if (player.status !== 'racing' && player.status !== 'finished') {
          throw new Error('player_not_active');
        }
        if (
          sequence === player.sequence
          && completedWords === player.completedWords
          && totalKeystrokes === player.totalKeystrokes
        ) {
          safeAck(ws, reqId, { ok: true, duplicate: true });
          return;
        }
        if (!Number.isInteger(sequence) || sequence <= player.sequence) throw new Error('invalid_sequence');
        if (!Number.isInteger(completedWords) || completedWords < player.completedWords) {
          throw new Error('invalid_progress');
        }
        if (!Number.isInteger(totalKeystrokes) || totalKeystrokes < player.totalKeystrokes) {
          throw new Error('invalid_keystrokes');
        }
        if (completedWords > room.prompt.targetWordCount) throw new Error('target_overflow');
        const now = Date.now();
        if (room.startsAt && now < room.startsAt) throw new Error('early_progress');
        const deltaWords = completedWords - player.completedWords;
        if (room.type === 'custom') {
          if (!isFinal && (now - player.lastSnapshotAt) < 450) {
            safeAck(ws, reqId, { ok: true, throttled: true });
            return;
          }
          if (deltaWords < 0) throw new Error('invalid_progress');
        }
        if (Array.isArray(finalStatsPayload)) {
          if (finalStatsPayload.length >= 6) {
            const consistency = Number(finalStatsPayload[5]);
            if (Number.isFinite(consistency)) {
              if (!player.finalStats) player.finalStats = {};
              player.finalStats.consistency = Math.max(0, Math.min(100, Math.round(consistency)));
            }
          }
          if (isFinal && finalStatsPayload.length >= 4) {
            const validChars = Number(finalStatsPayload[0]);
            const rawChars = Number(finalStatsPayload[1]);
            const errorsMade = Number(finalStatsPayload[2]);
            const extraChars = Number(finalStatsPayload[3]);
            const displaySeconds = Number(finalStatsPayload[4]);
            if (
              Number.isFinite(validChars)
              && Number.isFinite(rawChars)
              && Number.isFinite(errorsMade)
              && Number.isFinite(extraChars)
            ) {
              const reportedConsistency = finalStatsPayload.length >= 6
                ? Number(finalStatsPayload[5])
                : NaN;
              player.finalStats = {
                validChars: Math.max(0, Math.floor(validChars)),
                rawChars: Math.max(0, Math.floor(rawChars)),
                errorsMade: Math.max(0, Math.floor(errorsMade)),
                extraChars: Math.max(0, Math.floor(extraChars)),
                displaySeconds: Number.isFinite(displaySeconds) && displaySeconds >= 0
                  ? Math.floor(displaySeconds)
                  : undefined,
                consistency: Number.isFinite(reportedConsistency)
                  ? Math.max(0, Math.min(100, Math.round(reportedConsistency)))
                  : player.finalStats?.consistency,
              };
            }
          }
        }
        player.sequence = sequence;
        player.completedWords = completedWords;
        player.totalKeystrokes = totalKeystrokes;
        player.correctChars = this.cumulativeCorrectChars(room, completedWords);
        player.wpm = (player.correctChars / 5) / Math.max((Date.now() - (room.startsAt || Date.now())) / 60_000, 1 / 120);
        player.accuracy = totalKeystrokes > 0
          ? (player.correctChars / totalKeystrokes) * 100
          : 100;
        player.snapshots.push([sequence, completedWords, totalKeystrokes, now]);
        if (player.snapshots.length > LIMITS.maxRetainedSnapshots) {
          player.snapshots.shift();
        }
        player.lastSnapshotAt = now;
        if (isFinal) {
          player.status = 'finished';
          player.finishedAt = Date.now();
          await this.maybeFinishRoom(room);
        }
        const elapsed = room.startsAt ? Math.max((Date.now() - room.startsAt) / 60_000, 1 / 120) : 1;
        const wpm = (player.correctChars / 5) / elapsed;
        const progress = room.config.mode === 'words'
          ? Math.round((completedWords / room.prompt.targetWordCount) * 100)
          : Math.round(((Date.now() - (room.startsAt || Date.now())) / (room.config.amount * 1000)) * 100);
        this.emitRoom(room, 'race:progress', [
          player.index,
          wpm,
          Math.min(100, progress),
          isFinal ? 1 : 0,
          completedWords,
        ]);
        // Ack immediately so clients do not time out during typing.
        safeAck(ws, reqId, { ok: true });
        if (isFinal || (now - (player.lastPersistAt || 0)) > 2500) {
          player.lastPersistAt = now;
          await this.persist();
        }
        return;
      }
      if (event === 'duel:challenge') {
        if (String(userId).startsWith('guest_')) throw new Error('unauthorized');
        const body = payload as { toUserId?: string; config?: unknown };
        const toUserId = String(body?.toUserId || '');
        if (!toUserId || toUserId === userId) throw new Error('invalid_target');
        if (!this.isOnline(toUserId)) throw new Error('friend_offline');
        await this.abandonStuckMembership(userId);
        if (this.userToRoom.has(toUserId)) throw new Error('already_in_match');
        if (await areBlocked(this.env, userId, toUserId)) throw new Error('blocked');
        if (!(await areFriends(this.env, userId, toUserId))) throw new Error('not_friends');
        const config = normalizeConfig(body?.config);
        const invite: Invite = {
          id: shortId(),
          fromUserId: userId,
          toUserId,
          config,
          createdAt: Date.now(),
          expiresAt: Date.now() + LIMITS.inviteTtlMs,
        };
        this.invites.set(invite.id, invite);
        this.scheduleAlarm(LIMITS.inviteTtlMs, { kind: 'invite-expire', inviteId: invite.id });
        const from = this.profiles.get(userId) || { name: 'Player', avatarUrl: '' };
        let fromAvatarUrl = from.avatarUrl || '';
        if (fromAvatarUrl && await hasBlocked(this.env, userId, toUserId)) fromAvatarUrl = '';
        this.emitToUser(toUserId, 'duel:incoming', {
          inviteId: invite.id,
          fromUserId: userId,
          fromName: from.name,
          fromAvatarUrl,
          config,
          createdAt: invite.createdAt,
        });
        safeAck(ws, reqId, { ok: true, inviteId: invite.id });
        await this.persist();
        return;
      }
      if (event === 'duel:respond') {
        const arr = Array.isArray(payload) ? payload : [];
        const inviteId = String(arr[0] || '');
        const accepted = Number(arr[1]) === 1;
        const invite = this.invites.get(inviteId);
        if (!invite || invite.toUserId !== userId) throw new Error('invite_not_found');
        this.invites.delete(inviteId);
        if (!accepted) {
          this.emitToUser(invite.fromUserId, 'duel:rejected', [inviteId, userId, (this.profiles.get(userId) || {}).name]);
          safeAck(ws, reqId, { ok: true, accepted: false });
          await this.persist();
          return;
        }
        const room = await this.createRoom('friend', invite.config, [invite.fromUserId, invite.toUserId]);
        this.notifyMatchReady(room, 'friend-accepted');
        safeAck(ws, reqId, { ok: true, accepted: true, roomId: room.id });
        await this.persist();
        return;
      }
      if (event === 'duel:cancel-invite') {
        const inviteId = String(payload || '');
        const invite = this.invites.get(inviteId);
        if (!invite || invite.fromUserId !== userId) throw new Error('invite_not_found');
        this.invites.delete(inviteId);
        this.emitToUser(invite.toUserId, 'duel:expired', [inviteId, userId]);
        safeAck(ws, reqId, { ok: true });
        await this.persist();
        return;
      }
      if (event === 'race:rematch') {
        const roomId = String(payload || '');
        const room = this.rooms.get(roomId);
        if (!room || room.type === 'custom' || room.state !== 'finished') {
          throw new Error('rematch_unavailable');
        }
        const player = room.players[userId];
        if (!player || player.status === 'left') throw new Error('rematch_unavailable');
        if (!room.rematchVotes) room.rematchVotes = [];
        if (!room.rematchVotes.includes(userId)) room.rematchVotes.push(userId);
        await this.cancelAlarmsForRoom(room.id, 'room-dispose');
        this.scheduleAlarm(LIMITS.finishedRoomTtlMs, { kind: 'room-dispose', roomId: room.id });
        this.emitRematchState(room);
        const needed = Math.max(1, this.remainingDualHumans(room).length);
        if (room.rematchVotes.length >= needed) await this.startDualRematch(room);
        safeAck(ws, reqId, { ok: true });
        await this.persist();
        return;
      }
      if (event === 'room:create') {
        await this.abandonStuckMembership(userId);
        const body = (payload && typeof payload === 'object')
          ? payload as Record<string, unknown>
          : {};
        const config = normalizeConfig(body.config);
        const maxPlayers = clampInteger(body.maxPlayers, 2, LIMITS.maxPlayersPerRoom, 8);
        const roomCode = this.allocateRoomCode();
        const roomName = String(body.name || body.roomName || 'Private Room').slice(0, 48);
        const room = await this.createRoom('custom', config, [userId], {
          hostUserId: userId,
          maxPlayers,
          roomCode,
          roomName,
        });
        safeAck(ws, reqId, { ok: true, roomId: room.id, roomCode, roomName: room.roomName });
        await this.persist();
        return;
      }
      if (event === 'room:join-code') {
        const roomCodeValue = String(payload || '').trim();
        const existingRoomId = this.userToRoom.get(userId);
        if (existingRoomId) {
          const meta = await this.fetchRaceMeta(existingRoomId);
          if (
            meta
            && meta.type === 'custom'
            && meta.roomCode === roomCodeValue
          ) {
            safeAck(ws, reqId, { ok: true, roomId: existingRoomId });
            return;
          }
          await this.abandonStuckMembership(userId);
        }
        const roomId = this.roomCodes.get(roomCodeValue);
        if (!roomId) throw new Error('room_not_found');
        const profile = await getProfile(this.env, userId);
        this.profiles.set(userId, profile);
        const addRes = await this.raceStub(roomId).fetch('https://race-do/internal/room-add-player', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            userId,
            profile: {
              userId,
              name: profile.name,
              avatarUrl: profile.avatarUrl,
              level: profile.level,
              percentToNext: profile.percentToNext,
            },
          }),
        });
        const addBody = await addRes.json().catch(() => ({})) as { ok?: boolean; error?: string; roomId?: string };
        if (!addRes.ok || !addBody.ok) {
          throw new Error(addBody.error || (addRes.status === 404 ? 'room_not_found' : 'room_full'));
        }
        this.userToRoom.set(userId, roomId);
        safeAck(ws, reqId, { ok: true, roomId });
        await this.persist();
        return;
      }
      if (event === 'room:invite') {
        const body = (payload && typeof payload === 'object')
          ? payload as { roomId?: string; toUserId?: string }
          : {};
        const roomId = String(body.roomId || '');
        const toUserId = String(body.toUserId || '');
        const meta = await this.fetchRaceMeta(roomId);
        if (!meta || meta.type !== 'custom' || meta.state !== 'waiting') {
          throw new Error('room_not_found');
        }
        if (!meta.allowedUserIds.includes(userId)) throw new Error('forbidden');
        if (!toUserId || toUserId === userId) throw new Error('invalid_target');
        const targetStatus = meta.playerStatuses?.[toUserId];
        if (targetStatus && targetStatus !== 'left') throw new Error('already_in_room');
        if (this.userToRoom.has(toUserId)) throw new Error('already_in_match');
        if (!this.isOnline(toUserId)) throw new Error('friend_offline');
        if ((meta.occupiedSlots || 0) >= (meta.maxPlayers || LIMITS.maxPlayersPerRoom)) {
          throw new Error('room_full');
        }
        if (!(await areFriends(this.env, userId, toUserId))) throw new Error('not_friends');
        const from = this.profiles.get(userId) || { name: 'Player', avatarUrl: '' };
        this.emitToUser(toUserId, 'room:invite', {
          roomId: meta.roomId,
          roomCode: meta.roomCode,
          roomName: meta.roomName,
          fromUserId: userId,
          fromName: from.name,
          config: meta.config,
        });
        safeAck(ws, reqId, { ok: true });
        return;
      }
      if (event === 'room:ready') {
        const room = this.rooms.get(String(payload || ''));
        const player = room && room.players[userId];
        if (!room || room.type !== 'custom' || room.state !== 'waiting' || !player) {
          throw new Error('room_not_found');
        }
        player.ready = true;
        this.emitRoomState(room);
        safeAck(ws, reqId, { ok: true });
        if (userId === room.hostUserId) {
          for (const [uid, item] of Object.entries(room.players)) {
            if (uid !== userId && item.status !== 'left') {
              this.emitToUser(uid, 'room:host-ready', {
                roomId: room.id,
                roomName: room.roomName,
                hostName: player.name,
              });
            }
          }
        }
        await this.persist();
        return;
      }
      if (event === 'room:return-lobby') {
        const room = this.rooms.get(String(payload || ''));
        const player = room && room.players[userId];
        if (!room || room.type !== 'custom' || room.state !== 'finished' || !player || player.status === 'left') {
          throw new Error('room_not_found');
        }
        if (!room.returnLobbyVotes) room.returnLobbyVotes = [];
        if (!room.returnLobbyVotes.includes(userId)) room.returnLobbyVotes.push(userId);
        this.emitReturnLobbyState(room);
        await this.maybeReturnCustomRoomToLobby(room);
        safeAck(ws, reqId, { ok: true });
        await this.persist();
        return;
      }
      if (event === 'room:add-bot') {
        const room = this.rooms.get(String(payload || ''));
        if (!room || room.type !== 'custom' || room.state !== 'waiting') {
          throw new Error('room_not_found');
        }
        if (room.hostUserId !== userId) throw new Error('forbidden');
        if (room.bot) throw new Error('bot_already_added');
        if (this.occupiedSlots(room) >= room.maxPlayers) throw new Error('room_full');
        room.bot = this.createCustomRoomBot(room);
        this.emitRoomState(room);
        safeAck(ws, reqId, { ok: true, bot: this.publicRoomPayload(room, 'custom').bot });
        await this.persist();
        return;
      }
      if (event === 'room:update-config') {
        const body = (payload && typeof payload === 'object')
          ? payload as { roomId?: string; config?: unknown }
          : {};
        const room = this.rooms.get(String(body.roomId || ''));
        if (!room || room.type !== 'custom' || room.state !== 'waiting') {
          throw new Error('room_not_found');
        }
        if (room.hostUserId !== userId) throw new Error('forbidden');
        const newConfig = normalizeConfig(body.config);
        room.config = newConfig;
        room.prompt = await createPrompt(this.env.PUBLIC_SITE_URL || 'https://dev.usertypo.com', newConfig);
        for (const player of Object.values(room.players)) player.ready = false;
        this.emitRoomState(room);
        safeAck(ws, reqId, { ok: true });
        await this.persist();
        return;
      }
      if (event === 'room:remove-player') {
        const body = (payload && typeof payload === 'object')
          ? payload as { roomId?: string; targetUserId?: string }
          : {};
        const room = this.rooms.get(String(body.roomId || ''));
        if (!room || room.type !== 'custom' || room.state !== 'waiting') {
          throw new Error('room_not_found');
        }
        if (room.hostUserId !== userId) throw new Error('forbidden');
        const targetUserId = String(body.targetUserId || '');
        if (!targetUserId || targetUserId === userId) throw new Error('invalid_target');
        if (targetUserId === 'bot') {
          if (!room.bot) throw new Error('bot_not_found');
          room.bot = null;
          this.emitRoomState(room);
          if (!this.remainingCustomPlayers(room).length) {
            this.closeCustomRoom(room, 'empty');
          }
          safeAck(ws, reqId, { ok: true });
          await this.persist();
          return;
        }
        const target = room.players[targetUserId];
        if (!target || target.status === 'left') throw new Error('player_not_found');
        this.emitToUser(targetUserId, 'room:kicked', {
          roomId: room.id,
          roomCode: room.roomCode || '',
          byUserId: userId,
        });
        target.status = 'left';
        target.joined = false;
        this.userToRoom.delete(targetUserId);
        await this.notifyLobbyMembershipClear(room.id, [targetUserId]);
        delete room.players[targetUserId];
        room.allowedUserIds = room.allowedUserIds.filter((id) => id !== targetUserId);
        Object.values(room.players).forEach((item, index) => { item.index = index; });
        this.emitRoomState(room);
        if (!this.remainingCustomPlayers(room).length) {
          room.bot = null;
          this.closeCustomRoom(room, 'empty');
        }
        safeAck(ws, reqId, { ok: true });
        await this.persist();
        return;
      }
      if (event === 'room:start') {
        const body = (payload && typeof payload === 'object')
          ? payload as { roomId?: string; force?: boolean }
          : { roomId: String(payload || ''), force: false };
        const roomId = String(body.roomId || '');
        const force = !!body.force;
        const room = this.rooms.get(roomId);
        if (!room || room.type !== 'custom') throw new Error('room_not_found');
        if (room.hostUserId !== userId) throw new Error('forbidden');
        if (room.state === 'countdown' || room.state === 'racing') {
          safeAck(ws, reqId, { ok: true, alreadyStarted: true });
          return;
        }
        if (room.state !== 'waiting') throw new Error('race_not_active');
        const readyPlayers = Object.values(room.players).filter(
          (item) => item.ready && item.status !== 'left',
        );
        const readyCount = readyPlayers.length + (room.bot ? 1 : 0);
        if (readyCount < LIMITS.minReadyToStart) throw new Error('not_enough_ready');
        if (!force) {
          const activePlayers = Object.values(room.players).filter((item) => item.status !== 'left');
          const allReady = activePlayers.length >= 2
            && activePlayers.every((item) => item.joined && item.ready);
          if (!allReady) throw new Error('players_not_ready');
        }
        this.startCountdown(room);
        safeAck(ws, reqId, { ok: true });
        await this.persist();
        return;
      }
      safeAck(ws, reqId, { ok: false, error: 'not_implemented' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'request_failed';
      safeAck(ws, reqId, { ok: false, error: message });
    }
  }

  private async handleEmit(_ws: WebSocket, userId: string, event: string, payload: unknown) {
    if (event !== 'race:cursor') return;
    if (this.role === 'lobby') return;
    const arr = Array.isArray(payload) ? payload : [];
    const room = this.rooms.get(String(arr[0] || ''));
    if (!room || room.state !== 'racing') return;
    const player = room.players[userId];
    if (!player || player.status !== 'racing') return;
    const now = Date.now();
    if (now < (room.startsAt || 0)) return;
    let wordIndex = Math.max(0, Math.floor(Number(arr[2]) || 0));
    let charIndex = Math.max(0, Math.floor(Number(arr[3]) || 0));
    const lastWord = Math.max(0, room.prompt.words.length - 1);
    wordIndex = Math.min(wordIndex, lastWord);
    const maxChar = room.prompt.words[wordIndex]
      ? room.prompt.words[wordIndex].length + 12
      : 12;
    charIndex = Math.min(charIndex, maxChar);
    player.lastCursorAt = now;
    this.emitRoom(room, 'race:cursor', [
      player.index,
      Math.max(0, Math.round(Number(arr[1]) || 0)),
      wordIndex,
      charIndex,
    ]);
  }
}
