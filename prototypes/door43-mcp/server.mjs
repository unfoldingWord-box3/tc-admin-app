import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const MCP_URL = "https://door43.klappy.dev";
const MCP_ENDPOINT = `${MCP_URL}/mcp`;
const sessions = new Map();
const oauthStates = new Map();

const recipes = {
  whoami: {},
  "catalog-by-language": { lang: "en", stage: "prod" },
  "latest-release-zip": { owner: "unfoldingWord", repo: "en_ult" },
  "repo-tree-at-ref": { owner: "unfoldingWord", repo: "en_ult", ref: "master", recursive: true },
  "page-through": { limit: 50 },
  "read-file-at-pin": { owner: "unfoldingWord", repo: "en_ult", path: "README.md", sha: "" },
};

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

function html(res, status, body) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((item) => {
    const [key, ...value] = item.trim().split("=");
    return [key, decodeURIComponent(value.join("="))];
  }));
}

function sessionFor(req, res) {
  const cookies = parseCookies(req);
  let id = cookies.d43_session;
  if (!id || !sessions.has(id)) {
    id = randomBytes(18).toString("hex");
    sessions.set(id, { createdAt: Date.now(), mcpSessionId: null, token: null });
    res.setHeader("set-cookie", `d43_session=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax`);
  }
  return sessions.get(id);
}

function sessionId(req) {
  return parseCookies(req).d43_session;
}

function originFor(req) {
  const host = req.headers.host || `localhost:${PORT}`;
  return `http://${host}`;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(req) {
  const body = await readBody(req);
  return body ? JSON.parse(body) : {};
}

function formBody(values) {
  return new URLSearchParams(values).toString();
}

function parseMcpResponse(contentType, text) {
  if (contentType.includes("text/event-stream")) {
    const messages = text.split(/\n\n+/).flatMap((chunk) => {
      const data = chunk.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      if (!data || data === "[DONE]") return [];
      try { return [JSON.parse(data)]; } catch { return []; }
    });
    return messages.at(-1) || { jsonrpc: "2.0", result: {} };
  }
  try { return JSON.parse(text); } catch { return { jsonrpc: "2.0", result: { content: [{ type: "text", text }] } }; }
}

async function mcpPost(session, payload) {
  const headers = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2025-06-18",
    authorization: `Bearer ${session.token.access_token}`,
  };
  if (session.mcpSessionId) headers["mcp-session-id"] = session.mcpSessionId;

  const response = await fetch(MCP_ENDPOINT, { method: "POST", headers, body: JSON.stringify(payload) });
  const nextSessionId = response.headers.get("mcp-session-id");
  if (nextSessionId) session.mcpSessionId = nextSessionId;
  const body = parseMcpResponse(response.headers.get("content-type") || "", await response.text());
  if (!response.ok) {
    const error = new Error(body?.error?.message || `MCP request failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  if (body.error) {
    const error = new Error(body.error.message || "MCP request failed");
    error.status = 400;
    error.body = body;
    throw error;
  }
  return body.result ?? body;
}

async function ensureMcpSession(session) {
  if (session.mcpSessionId) return;
  const result = await mcpPost(session, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "door43-field-kit-poc", version: "0.1.0" },
    },
  });
  session.serverInfo = result.serverInfo;
  await mcpPost(session, { jsonrpc: "2.0", method: "notifications/initialized", params: {} });
}

async function callTool(session, name, args) {
  await ensureMcpSession(session);
  const result = await mcpPost(session, { jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } });
  const text = result?.content?.find((item) => item.type === "text")?.text;
  if (!text) return result;
  try { return JSON.parse(text); } catch { return text; }
}

async function registerClient(redirectUri) {
  const response = await fetch(`${MCP_URL}/register`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: "Door43 Field Kit POC",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "dcs:read",
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error_description || body.error || `Client registration failed (${response.status})`);
  return body;
}

async function startOAuth(req, res) {
  const redirectUri = `${originFor(req)}/auth/callback`;
  const client = await registerClient(redirectUri);
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(24).toString("base64url");
  const id = sessionId(req) || randomBytes(18).toString("hex");
  oauthStates.set(state, { verifier, clientId: client.client_id, redirectUri, sessionId: id });
  const url = new URL(`${MCP_URL}/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "dcs:read",
    state,
    resource: MCP_ENDPOINT,
  });
  json(res, 200, { url: url.toString() });
}

async function finishOAuth(req, res, url) {
  const state = oauthStates.get(url.searchParams.get("state"));
  if (!state) return json(res, 400, { error: "Unknown or expired OAuth state" });
  oauthStates.delete(url.searchParams.get("state"));
  if (url.searchParams.get("error")) return html(res, 400, `<p>Door43 login was cancelled: ${url.searchParams.get("error_description") || url.searchParams.get("error")}</p><p><a href="/">Back to Field Kit</a></p>`);

  const response = await fetch(`${MCP_URL}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: formBody({
      grant_type: "authorization_code",
      code: url.searchParams.get("code"),
      client_id: state.clientId,
      redirect_uri: state.redirectUri,
      code_verifier: state.verifier,
    }),
  });
  const body = await response.json();
  if (!response.ok) return html(res, 400, `<p>Door43 token exchange failed.</p><pre>${escapeHtml(JSON.stringify(body, null, 2))}</pre><p><a href="/">Back to Field Kit</a></p>`);

  const id = state.sessionId || randomBytes(18).toString("hex");
  sessions.set(id, { createdAt: Date.now(), token: body, mcpSessionId: null });
  res.setHeader("set-cookie", `d43_session=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax`);
  redirect(res, "/?connected=1");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

async function proxyHealth(res) {
  const response = await fetch(`${MCP_URL}/health`);
  const body = await response.json();
  json(res, response.status, body);
}

async function handle(req, res) {
  const url = new URL(req.url, originFor(req));

  if (req.method === "GET" && url.pathname === "/api/session") {
    const session = sessionFor(req, res);
    return json(res, 200, { connected: Boolean(session.token), server: session.serverInfo || null });
  }

  if (req.method === "GET" && url.pathname === "/api/health") return proxyHealth(res);

  if (req.method === "GET" && url.pathname === "/api/oauth/start") {
    try { return await startOAuth(req, res); } catch (error) { return json(res, 502, { error: error.message }); }
  }

  if (req.method === "GET" && url.pathname === "/auth/callback") {
    try { return await finishOAuth(req, res, url); } catch (error) { return html(res, 502, `<p>OAuth callback failed.</p><pre>${escapeHtml(error.message)}</pre><p><a href="/">Back to Field Kit</a></p>`); }
  }

  if (req.method === "POST" && url.pathname === "/api/tool") {
    const session = sessionFor(req, res);
    if (!session.token) return json(res, 401, { error: "Connect a Door43 account first." });
    try {
      const input = await readJson(req);
      if (!["docs", "execute", "telemetry"].includes(input.name)) return json(res, 400, { error: "Only docs, execute, and telemetry are available." });
      const result = await callTool(session, input.name, input.args || {});
      return json(res, 200, { ok: true, tool: input.name, result });
    } catch (error) {
      if (error.status === 401) session.token = null;
      return json(res, error.status || 502, { error: error.message, detail: error.body || null });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/mcp-url") return json(res, 200, { url: MCP_ENDPOINT });

  if (req.method === "GET") {
    const requested = url.pathname === "/" ? "/index.html" : normalize(url.pathname);
    const filePath = join(ROOT, requested.replace(/^\/+/, ""));
    if (!filePath.startsWith(ROOT)) return json(res, 404, { error: "Not found" });
    try {
      const body = await readFile(filePath);
      const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" }[extname(filePath)] || "application/octet-stream";
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      return res.end(body);
    } catch { return json(res, 404, { error: "Not found" }); }
  }

  json(res, 405, { error: "Method not allowed" });
}

createServer((req, res) => handle(req, res).catch((error) => json(res, 500, { error: error.message }))).listen(PORT, () => {
  console.log(`Door43 Field Kit running at http://localhost:${PORT}`);
});
