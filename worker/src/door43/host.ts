// The Door43 hosts tC Admin connects to, carried over from the prototype.
// Each Worker environment names one in `DOOR43_ORIGIN` (wrangler.jsonc); any
// other origin is refused, so a build never talks to a host it was not
// configured for.

export interface Door43Host {
  origin: string;
  name: 'QA' | 'Production';
  development: boolean;
}

const KNOWN_HOSTS: readonly Door43Host[] = [
  { origin: 'https://qa.door43.org', name: 'QA', development: true },
  { origin: 'https://git.door43.org', name: 'Production', development: false },
];

/** The configured host; throws for an origin that is not QA or production Door43. */
export function door43Host(origin: string): Door43Host {
  const normalized = origin.replace(/\/+$/, '');
  const host = KNOWN_HOSTS.find(known => known.origin === normalized);
  if (!host) throw new Error(`DOOR43_ORIGIN must be https://qa.door43.org or https://git.door43.org, got "${origin}".`);
  return host;
}
