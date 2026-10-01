// The tC Admin Worker: `/api/` is the operation catalog; everything else is
// the built web app from the static-assets binding (wrangler.jsonc).

import type { Env } from './env';
import { handleApi } from './http/app';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
