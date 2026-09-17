import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { beginLogin, exchangeCode, loadPortfolio, nonce, environment, clientId } from './door43.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const sessions = new Map();
const pending = new Map();
const cookieName = 'tca_qa_session';
const loginCookie = 'tca_qa_login';
function cookie(req, name) { return (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1); }
function setCookie(res, name, value, age) { res.setHeader('set-cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}`); }
function json(res, status, body) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
function redirect(res, url) { res.writeHead(302, { location: url, 'cache-control': 'no-store' }); res.end(); }
function session(req) { const id = cookie(req, cookieName), value = sessions.get(id); if (!value || value.expiresAt <= Date.now()) { sessions.delete(id); return null; } return value; }
async function handle(req, res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');
  if (req.headers.host !== `127.0.0.1:${PORT}`) return json(res, 403, { error: 'Use the local tC Admin address.' });
  const url = new URL(req.url, ORIGIN);
  if (req.method === 'POST' && req.headers.origin !== ORIGIN) return json(res, 403, { error: 'Request origin rejected.' });
  if (req.method === 'POST' && url.pathname === '/api/oauth/start') {
    for (const [id, value] of pending) if (Date.now() - value.createdAt > 600000) pending.delete(id);
    const flow = await beginLogin(`${ORIGIN}/auth/callback`);
    flow.browserNonce = nonce(); pending.set(flow.state, flow);
    setCookie(res, loginCookie, flow.browserNonce, 600);
    return json(res, 200, { url: flow.url });
  }
  if (req.method === 'GET' && url.pathname === '/auth/callback') {
    const state = url.searchParams.get('state'), flow = pending.get(state);
    if (!flow || cookie(req, loginCookie) !== flow.browserNonce || Date.now() - flow.createdAt > 600000) return redirect(res, '/?auth_error=expired');
    pending.delete(state);
    if (url.searchParams.has('error') || !url.searchParams.get('code')) return redirect(res, '/?auth_error=cancelled');
    try {
      const value = await exchangeCode(flow, url.searchParams.get('code'));
      sessions.delete(cookie(req, cookieName)); const id = nonce(); sessions.set(id, value);
      setCookie(res, cookieName, id, 28800); return redirect(res, '/');
    } catch { return redirect(res, '/?auth_error=failed'); }
  }
  if (req.method === 'POST' && url.pathname === '/api/logout') {
    sessions.delete(cookie(req, cookieName)); setCookie(res, cookieName, '', 0); return json(res, 200, { connected: false });
  }
  if (req.method === 'GET' && url.pathname === '/api/session') return json(res, 200, { connected: Boolean(session(req)), user: session(req)?.user || null, environment, configured: Boolean(await clientId()) });
  if (req.method === 'GET' && url.pathname === '/api/portfolio') {
    const active = session(req);
    if (!active) return json(res, 401, { error: 'Sign in to Door43 to view your projects.' });
    try { return json(res, 200, await loadPortfolio(active)); }
    catch (error) { if (error.status === 401) sessions.delete(cookie(req, cookieName)); throw error; }
  }
  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'This operation is not available.' });
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
  const path = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!['index.html', 'prototype.js', 'prototype.css'].includes(path) && !path.startsWith('design-system/')) return json(res, 404, { error: 'Not found.' });
  const file = resolve(ROOT, path);
  if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) return json(res, 404, { error: 'Not found.' });
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' })[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(body);
  } catch { json(res, 404, { error: 'Not found.' }); }
}
export const server = createServer((req, res) => handle(req, res).catch(error => json(res, error.status || 502, { error: error.status ? error.message : 'Door43 is unavailable currently. Please refresh later.' })));
server.listen(PORT, '127.0.0.1', () => console.log(`tC Admin running at ${ORIGIN}`));
