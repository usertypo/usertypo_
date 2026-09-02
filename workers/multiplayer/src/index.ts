import { MultiplayerHub } from './hub';
import type { Env } from './auth';

export { MultiplayerHub };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'usertypo-multiplayer-gateway' });
    }
    const id = env.MULTIPLAYER_HUB.idFromName('global');
    const stub = env.MULTIPLAYER_HUB.get(id);
    return stub.fetch(request);
  },
};
