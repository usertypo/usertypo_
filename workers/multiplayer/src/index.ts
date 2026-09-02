import { MultiplayerHub } from './hub';
import type { Env } from './auth';

export { MultiplayerHub };

function raceRoomName(roomId: string): string {
  return `room:${String(roomId || '').trim()}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'usertypo-multiplayer-gateway' });
    }

    // One Durable Object per duel: /ws?room=<id> (or /race/<id>/ws) → room:{id}
    // Lobby / matchmaking: /ws → lobby
    let roomId = String(url.searchParams.get('room') || '').trim();
    const racePath = url.pathname.match(/^\/race\/([^/]+)\/ws\/?$/);
    if (!roomId && racePath) roomId = decodeURIComponent(racePath[1] || '').trim();

    const doName = roomId ? raceRoomName(roomId) : 'lobby';
    const id = env.MULTIPLAYER_HUB.idFromName(doName);
    const stub = env.MULTIPLAYER_HUB.get(id);

    // Forward room id so the DO can bind role without relying on opaque ctx.id.
    if (roomId && !url.searchParams.get('room')) {
      url.searchParams.set('room', roomId);
      return stub.fetch(new Request(url.toString(), request));
    }
    return stub.fetch(request);
  },
};
