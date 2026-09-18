import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// The Door43 host comes from DOOR43_ORIGIN in the root .env file (loaded by `npm start`). QA is the default.
const KNOWN_ORIGINS = { 'https://qa.door43.org': { name: 'QA', development: true }, 'https://git.door43.org': { name: 'Production', development: false } };
export const DCS_ORIGIN = (process.env.DOOR43_ORIGIN || 'https://qa.door43.org').replace(/\/+$/, '');
if (!KNOWN_ORIGINS[DCS_ORIGIN]) throw new Error(`DOOR43_ORIGIN must be https://qa.door43.org or https://git.door43.org, got "${DCS_ORIGIN}".`);
export const environment = { ...KNOWN_ORIGINS[DCS_ORIGIN], host: new URL(DCS_ORIGIN).host, origin: DCS_ORIGIN };
const ENV = environment.name;
export const nonce = () => randomBytes(32).toString('base64url');
export class Door43Error extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
export async function clientId() {
  if (process.env.DOOR43_CLIENT_ID) return process.env.DOOR43_CLIENT_ID;
  if (process.env.DOOR43_QA_CLIENT_ID) return process.env.DOOR43_QA_CLIENT_ID;
  try { return JSON.parse(await readFile(new URL('./qa-client.json', import.meta.url), 'utf8')).clientId || ''; }
  catch { return ''; }
}
// Present for a confidential client; absent for a public (PKCE-only) client. Never sent to the browser.
export function clientSecret() { return process.env.DOOR43_CLIENT_SECRET || ''; }
async function request(url, options = {}) {
  if (new URL(url).origin !== DCS_ORIGIN) throw new Door43Error(`This build only connects to ${environment.host}.`);
  return fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000) });
}
export async function beginLogin(redirectUri) {
  const id = await clientId();
  if (!id) throw new Door43Error(`${ENV} sign-in is not configured yet. Set DOOR43_CLIENT_ID in .env.`, 503);
  const verifier = nonce(), state = nonce();
  const url = new URL('/login/oauth/authorize', DCS_ORIGIN);
  url.search = new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: redirectUri, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', scope: 'read:user read:repository read:organization', state });
  return { verifier, state, clientId: id, redirectUri, url: url.href, createdAt: Date.now() };
}
export async function exchangeCode(pending, code) {
  const response = await request(`${DCS_ORIGIN}/login/oauth/access_token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: pending.clientId, ...(clientSecret() ? { client_secret: clientSecret() } : {}), redirect_uri: pending.redirectUri, code_verifier: pending.verifier }),
  });
  if (!response.ok) throw new Door43Error(`${ENV} sign-in could not be completed (${response.status}). Please sign in again.`);
  const token = await response.json();
  if (!token.access_token) throw new Door43Error(`Door43 ${ENV} did not return a valid session.`);
  return { token: token.access_token, expiresAt: Date.now() + Math.min(Number(token.expires_in) || 3600, 28800) * 1000 };
}
export async function readDoor43(session, path, query = {}) {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Door43Error('Invalid Door43 API path.');
  const url = new URL('/api/v1' + path, DCS_ORIGIN);
  url.search = new URLSearchParams(Object.entries(query).map(([key,value]) => [key,String(value)]));
  const response = await request(url.href, { headers: { accept: 'application/json', authorization: `Bearer ${session.token}` } });
  if (response.status === 401) throw new Door43Error(`Your ${ENV} session expired. Please sign in again.`, 401);
  if (!response.ok) throw new Door43Error(`Door43 ${ENV} could not read this resource (${response.status}).`, response.status === 403 ? 403 : 502);
  return response.json();
}
export async function readPages(session, path, query = {}) {
  const items = [];
  const seenPages = new Set();
  for (let page = 1; page <= 2000; page++) {
    const body = await readDoor43(session, path, { ...query, page, limit: 50 });
    const batch = Array.isArray(body) ? body : body.data;
    if (!Array.isArray(batch)) throw new Door43Error('Door43 returned an unexpected repository list.');
    const signature = JSON.stringify(batch.map(item => item.id));
    if (batch.length && seenPages.has(signature)) throw new Door43Error('Door43 repeated a result page. Please refresh later.');
    seenPages.add(signature);
    items.push(...batch);
    if (batch.length === 0) return items;
  }
  throw new Door43Error('This portfolio exceeds the current read limit. No partial portfolio was substituted.');
}
const bookIds = new Set('gen exo lev num deu jos jdg rut 1sa 2sa 1ki 2ki 1ch 2ch ezr neh est job psa pro ecc sng isa jer lam ezk dan hos jol amo oba jon mic nam hab zep hag zec mal mat mrk luk jhn act rom 1co 2co gal eph php col 1th 2th 1ti 2ti tit phm heb jas 1pe 2pe 1jn 2jn 3jn jud rev'.split(' '));
export function projectFromRepository(repo) {
  const type = repo.subject === 'Bible' || repo.subject === 'Aligned Bible' ? 'Bible' : repo.subject === 'Open Bible Stories' ? 'OBS' : 'Unsupported';
  const ingredients = repo.ingredients;
  const present = Array.isArray(ingredients) ? [...new Set(ingredients.filter(i => i.exists === true).map(i => String(i.identifier).toLowerCase()).filter(id => type === 'Bible' ? bookIds.has(id) : type === 'OBS' && /^\d{2}$/.test(id) && +id >= 1 && +id <= 50))] : null;
  const health = type === 'Unsupported' ? 'unsupported' : ({ success: 'healthy', warning: 'warning', error: 'failing', info: 'info' }[repo.healthcheck_severity] || 'never_checked');
  const owner = repo.owner?.login || repo.owner?.username || repo.full_name?.split('/')[0];
  if (!owner || !repo.name || !repo.id) throw new Door43Error('Door43 returned incomplete repository metadata.');
  return { id: repo.id, title: repo.title || repo.name, repo: repo.name, org: owner, lang: repo.language_title || repo.language || 'Not specified', code: repo.language || '—', type, count: type === 'OBS' && present?.length === 0 && ingredients?.length ? null : present?.length ?? null, ingredients: Array.isArray(ingredients) ? ingredients.filter(i => i.exists === true).map(i => ({ title: i.title || i.identifier, path: i.path, identifier: i.identifier })) : [], health, issues: null, version: null, updated: repo.updated_at || '', defaultBranch: repo.default_branch || '', subject: repo.subject || 'Not specified', description: repo.description || '', url: `${DCS_ORIGIN}/${encodeURIComponent(owner)}/${encodeURIComponent(repo.name)}`, live: true };
}
export async function loadPortfolio(session) {
  const user = await readDoor43(session, '/user');
  if (!user.login || !user.id) throw new Door43Error('Door43 did not return a signed-in account.');
  session.user = { login: user.login, name: user.full_name || user.login };
  const repositories = await readPages(session, '/repos/search', { uid: user.id, exclusive: false, private: true });
  const projects = [...new Map(repositories.filter(r => !r.archived && (r.permissions?.push === true || r.permissions?.admin === true)).map(r => [r.id, r])).values()].map(projectFromRepository);
  return { user: { login: user.login, name: user.full_name || user.login }, projects, loadedAt: new Date().toISOString() };
}
