// The tC Admin Worker: `/api/` is the operation catalog; everything else is
// the built web app from the static-assets binding (wrangler.jsonc).

import { app } from './http/app';

export default app;
