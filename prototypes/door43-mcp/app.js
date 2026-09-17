const recipes = {
  whoami: { label: "Who am I?", description: "Read the logged-in Door43 identity.", tool: "execute", args: {}, fields: [] },
  "catalog-by-language": { label: "Catalog by language", description: "Find the latest production resources for a language.", tool: "execute", args: { lang: "en", stage: "prod" }, fields: [{ key: "lang", label: "Language", value: "en" }, { key: "stage", label: "Stage", value: "prod" }] },
  "latest-release-zip": { label: "Latest release + zip", description: "Locate the latest release metadata and its zipball.", tool: "execute", args: { owner: "unfoldingWord", repo: "en_ult" }, fields: [{ key: "owner", label: "Owner", value: "unfoldingWord" }, { key: "repo", label: "Repository", value: "en_ult" }] },
  "repo-tree-at-ref": { label: "Repository tree", description: "Walk a repository at a ref, recursively when useful.", tool: "execute", args: { owner: "unfoldingWord", repo: "en_ult", ref: "master", recursive: true }, fields: [{ key: "owner", label: "Owner", value: "unfoldingWord" }, { key: "repo", label: "Repository", value: "en_ult" }, { key: "ref", label: "Ref", value: "master" }], checkbox: { key: "recursive", label: "Recursive tree", value: true } },
  "page-through": { label: "Page through catalog", description: "Start a paged catalog read and follow its continuation token.", tool: "execute", args: { limit: 50 }, fields: [{ key: "limit", label: "Page size", value: 50, type: "number" }] },
  "read-file-at-pin": { label: "Read file at pin", description: "Read one file at an upstream sha you already hold.", tool: "execute", args: { owner: "unfoldingWord", repo: "en_ult", path: "README.md", sha: "" }, fields: [{ key: "owner", label: "Owner", value: "unfoldingWord" }, { key: "repo", label: "Repository", value: "en_ult" }, { key: "path", label: "File path", value: "README.md" }, { key: "sha", label: "Pinned sha", value: "" }] },
};

const cannedPrompts = [
  { recipe: "whoami", prompt: "Who am I signed in as?", label: "Check my identity", icon: "◉" },
  { recipe: "catalog-by-language", prompt: "Find the latest English resources.", label: "Find English resources", icon: "⌕" },
  { recipe: "latest-release-zip", prompt: "What’s the latest release of en_ult?", label: "Get latest release", icon: "↗" },
  { recipe: "repo-tree-at-ref", prompt: "Show me every file in en_ult.", label: "Explore a repository", icon: "⌘" },
  { recipe: "page-through", prompt: "Help me page through the catalog.", label: "Browse the catalog", icon: "↳" },
  { recipe: "read-file-at-pin", prompt: "Read a file from a pinned version.", label: "Read a pinned file", icon: "#" },
  { tool: "docs", mode: "map", prompt: "What can this Door43 server do?", label: "See what’s available", icon: "◌" },
  { tool: "telemetry", mode: "telemetry", prompt: "How is this server being used?", label: "Check server numbers", icon: "◒" },
];

const state = { active: "whoami", kind: "recipe", connected: false, health: null, busy: false };
const $ = (selector) => document.querySelector(selector);
const journeyList = $("#journey-list");
const promptList = $("#prompt-list");

function makeButton({ text, value, selected = false }) {
  const button = document.createElement("button");
  button.className = `nav-button${selected ? " selected" : ""}`;
  button.dataset.recipe = value;
  button.innerHTML = `<span class="nav-icon">${value === "whoami" ? "◉" : "↳"}</span><span><strong>${text}</strong><small>${recipes[value].tool} recipe</small></span>`;
  button.addEventListener("click", () => selectRecipe(value));
  return button;
}

Object.entries(recipes).forEach(([value, recipe]) => journeyList.append(makeButton({ text: recipe.label, value, selected: value === state.active })));

cannedPrompts.forEach((item) => {
  const button = document.createElement("button");
  button.className = "prompt-card";
  button.innerHTML = `<span class="prompt-icon">${item.icon}</span><span class="prompt-copy"><small>${item.prompt}</small><strong>${item.label}</strong></span><span class="prompt-arrow">↗</span>`;
  button.addEventListener("click", () => selectPrompt(item));
  promptList.append(button);
});

function inputField({ key, label, value = "", type = "text", full = false }) {
  return `<div class="field${full ? " full" : ""}"><label for="field-${key}">${label}</label><input id="field-${key}" name="${key}" type="${type}" value="${escapeHtml(value)}" /></div>`;
}

function textareaField({ key, label, value = "", full = true }) {
  return `<div class="field${full ? " full" : ""}"><label for="field-${key}">${label}</label><textarea id="field-${key}" name="${key}">${escapeHtml(value)}</textarea></div>`;
}

function renderRecipeForm(recipeName) {
  const recipe = recipes[recipeName];
  const fields = recipe.fields.map((field) => inputField(field)).join("");
  const checkbox = recipe.checkbox ? `<div class="field checkbox-field"><input id="field-${recipe.checkbox.key}" name="${recipe.checkbox.key}" type="checkbox" ${recipe.checkbox.value ? "checked" : ""} /><label for="field-${recipe.checkbox.key}">${recipe.checkbox.label}</label></div>` : "";
  $("#runner-form").innerHTML = `<div class="form-grid">${fields}${checkbox}<details class="advanced-form field full"><summary>Advanced options</summary><div class="field checkbox-field"><input id="dry-run" name="dry_run" type="checkbox" /><label for="dry-run">Preview cost only — don’t fetch the answer</label></div></details></div>`;
}

function renderDocsForm(mode) {
  const path = mode === "raw" ? "/catalog/search" : "";
  $("#runner-form").innerHTML = `<div class="form-grid"><div class="field"><label for="field-rung">What do you want to explore?</label><select id="field-rung" name="rung"><option value="map" ${mode === "map" ? "selected" : ""}>Browse available areas</option><option value="recipes" ${mode === "recipes" ? "selected" : ""}>See ready-made prompts</option><option value="raw" ${mode === "raw" ? "selected" : ""}>Inspect a specific path</option></select></div><div class="field"><label for="field-detail">Amount of detail</label><select id="field-detail" name="detail"><option value="compact">Quick summary</option><option value="full">Full explanation</option></select></div>${mode === "raw" ? inputField({ key: "path", label: "Door43 path", value: path }) : ""}<div class="field full"><label for="field-query">Search by keyword (optional)</label><input id="field-query" name="query" placeholder="catalog, releases, files…" /></div><details class="advanced-form field full"><summary>Advanced options</summary><div class="form-grid">${inputField({ key: "recipe", label: "Fill a named recipe", value: "" })}${textareaField({ key: "args", label: "Recipe values · one per line", value: "", full: false })}${inputField({ key: "fields", label: "Fields to keep · comma-separated", value: "" })}</div></details></div>`;
}

function renderRawForm() {
  $("#runner-form").innerHTML = `<div class="form-grid"><div class="field"><label for="field-method">Type of read</label><select id="field-method" name="method"><option value="GET">Get the result</option><option value="HEAD">Check it exists</option></select></div>${inputField({ key: "path", label: "Door43 path", value: "/user" })}${inputField({ key: "fields", label: "Fields to show · comma-separated", value: "login, id, full_name", full: true })}${textareaField({ key: "query", label: "Filters · one per line, such as lang=en", value: "", full: true })}<details class="advanced-form field full"><summary>Advanced options</summary><div class="form-grid">${textareaField({ key: "headers", label: "Request headers · one per line", value: "", full: false })}${inputField({ key: "continue", label: "Continue from token", value: "" })}${inputField({ key: "pin", label: "Pin to a commit", value: "" })}</div></details></div>`;
}

const telemetryQueries = {
  overview: "SELECT tool_name, COUNT(*) AS calls, AVG(duration_ms) AS avg_ms FROM door43mcp_telemetry GROUP BY tool_name ORDER BY calls DESC LIMIT 12",
  recent: "SELECT tool_name, status, duration_ms, created_at FROM door43mcp_telemetry ORDER BY created_at DESC LIMIT 20",
  errors: "SELECT tool_name, status, COUNT(*) AS occurrences FROM door43mcp_telemetry WHERE status >= 400 GROUP BY tool_name, status ORDER BY occurrences DESC LIMIT 20",
};

function renderTelemetryForm() {
  $("#runner-form").innerHTML = `<div class="form-grid one"><div class="field"><label for="field-metric">Show me</label><select id="field-metric" name="metric"><option value="overview">Calls and average speed by tool</option><option value="recent">Most recent activity</option><option value="errors">Recent problems</option></select></div><details class="advanced-form field full"><summary>Use a custom query</summary>${textareaField({ key: "sql", label: "Read-only query", value: "" })}</details></div>`;
}

function selectRecipe(name) {
  state.active = name; state.kind = "recipe";
  document.querySelectorAll(".nav-button[data-recipe]").forEach((button) => button.classList.toggle("selected", button.dataset.recipe === name));
  const recipe = recipes[name];
  $("#workflow-title").textContent = recipe.label;
  $("#workflow-description").textContent = recipe.description;
  $("#active-prompt").textContent = `“${cannedPrompts.find((item) => item.recipe === name)?.prompt || recipe.label}”`;
  $("#tool-badge").textContent = "safe read";
  $("#crumb").textContent = `Journeys / ${recipe.label}`;
  $("#run-button").innerHTML = "Run this prompt <span>↗</span>";
  renderRecipeForm(name); updatePreview();
}

function selectTool(tool, mode) {
  state.active = mode; state.kind = tool;
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.remove("selected"));
  const titles = { map: ["What’s available?", "See the areas this Door43 server can read.", "guide"], recipes: ["Ready-made prompts", "See every shortcut the server already knows.", "guide"], raw: [tool === "docs" ? "Explain a Door43 path" : "Advanced read", tool === "docs" ? "Learn what a specific Door43 path returns." : "Build a precise read with friendly controls.", tool === "docs" ? "guide" : "advanced"], telemetry: ["Server activity", "See usage, speed, or recent problems.", "server stats"] };
  const [title, description, badge] = titles[mode];
  $("#workflow-title").textContent = title; $("#workflow-description").textContent = description; $("#active-prompt").textContent = mode === "telemetry" ? "“How is this server being used?”" : `“${title}”`; $("#tool-badge").textContent = badge; $("#crumb").textContent = `Direct tools / ${title}`; $("#run-button").innerHTML = "Run live read <span>↗</span>";
  if (tool === "docs") renderDocsForm(mode); else if (tool === "execute") renderRawForm(); else renderTelemetryForm();
  updatePreview();
}

function selectPrompt(item) {
  if (item.recipe) selectRecipe(item.recipe);
  else { selectTool(item.tool, item.mode); $("#active-prompt").textContent = `“${item.prompt}”`; }
  showBanner(`Loaded “${item.prompt}” — review the preview, then run it.`, true);
}

function formArgs() {
  const form = new FormData($("#runner-form"));
  if (state.kind === "recipe") {
    const args = {};
    for (const field of recipes[state.active].fields) { const value = form.get(field.key); args[field.key] = field.type === "number" ? Number(value) : value; }
    if (recipes[state.active].checkbox) args[recipes[state.active].checkbox.key] = form.get(recipes[state.active].checkbox.key) === "on";
    return { recipe: state.active, args, dry_run: form.get("dry_run") === "on" };
  }
  if (state.kind === "docs") {
    const args = { rung: form.get("rung"), detail: form.get("detail") };
    if (form.get("path")) args.path = form.get("path");
    if (form.get("query")) args.query = form.get("query");
    if (form.get("recipe")) args.recipe = form.get("recipe");
    const recipeArgs = parsePairs(form.get("args"));
    const fields = parseList(form.get("fields"));
    if (Object.keys(recipeArgs).length) args.args = recipeArgs;
    if (fields.length) args.fields = fields;
    return args;
  }
  if (state.kind === "telemetry") return { sql: form.get("sql")?.trim() || telemetryQueries[form.get("metric")] };
  const args = { method: form.get("method"), path: form.get("path") };
  const query = parsePairs(form.get("query"));
  const fields = parseList(form.get("fields"));
  const headers = parsePairs(form.get("headers"));
  if (Object.keys(query).length) args.query = query;
  if (fields.length) args.fields = fields;
  if (Object.keys(headers).length) args.headers = headers;
  for (const key of ["continue", "pin"]) if (form.get(key)) args[key] = key === "pin" ? { sha: form.get(key) } : form.get(key);
  return args;
}

function parsePairs(value = "") {
  return String(value).split(/\n|,/).map((line) => line.trim()).filter(Boolean).reduce((out, line) => {
    const at = line.indexOf("=");
    if (at < 1) return out;
    const key = line.slice(0, at).trim();
    const raw = line.slice(at + 1).trim();
    out[key] = raw === "true" ? true : raw === "false" ? false : raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
    return out;
  }, {});
}

function parseList(value = "") { return String(value).split(",").map((item) => item.trim()).filter(Boolean); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }

function requestSummary(args) {
  if (state.kind === "recipe") {
    const summaries = {
      whoami: "We’ll check which Door43 account is connected.",
      "catalog-by-language": `We’ll find ${args.args.lang || "matching"} resources in the ${args.args.stage || "selected"} catalog.`,
      "latest-release-zip": `We’ll find the latest ${args.args.owner}/${args.args.repo} release and download link.`,
      "repo-tree-at-ref": `We’ll list ${args.args.owner}/${args.args.repo} files at ${args.args.ref || "master"}.`,
      "page-through": `We’ll fetch the first ${args.args.limit || 50} catalog entries and include a next-page button when available.`,
      "read-file-at-pin": `We’ll read ${args.args.path || "the file"} from the exact pinned version.`,
    };
    return `${summaries[state.active]}${args.dry_run ? " First, we’ll preview the cost without fetching." : ""}`;
  }
  if (state.kind === "docs") return args.path ? `We’ll explain what ${args.path} returns and how to use it.` : "We’ll show what this Door43 server can help you find.";
  if (state.kind === "telemetry") return "We’ll summarize the server activity you selected. No Door43 content is changed.";
  return `We’ll ${args.method === "HEAD" ? "check" : "read"} ${args.path || "the selected Door43 path"} and show only the fields you chose.`;
}

function updatePreview() {
  const args = formArgs();
  const preview = { tool: state.kind === "recipe" ? "execute" : state.kind, arguments: args };
  $("#request-summary").textContent = requestSummary(args);
  $("#request-preview").textContent = JSON.stringify(preview, null, 2);
  $("#price-label").textContent = state.kind === "recipe" && args.dry_run ? "preview only" : "advanced";
}

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

async function refreshSession() {
  const session = await api("/api/session");
  state.connected = session.connected;
  $("#connection-label").textContent = state.connected ? "Door43 connected" : "Not connected";
  $("#connection-dot").className = `status-dot${state.connected ? " live" : ""}`;
  $("#connect-button").textContent = state.connected ? "Reconnect Door43" : "Connect Door43";
  $("#run-hint").textContent = state.connected ? "Read-only MCP call · server session active." : "Requires a Door43 login.";
}

async function refreshHealth() {
  try {
    const started = performance.now(); const health = await api("/api/health"); const latency = Math.round(performance.now() - started);
    state.health = health; $("#health-label").textContent = `${health.upstream.host} · reachable`; $("#upstream-version").textContent = health.upstream.version; $("#upstream-latency").textContent = `${latency} ms`; $("#pulse-icon").title = `Observed ${health.observed_at}`;
  } catch (error) { $("#health-label").textContent = "Upstream health unavailable"; $("#connection-dot").className = "status-dot warn"; }
}

function showBanner(message, success = false) { const banner = $("#status-banner"); banner.textContent = message; banner.className = `status-banner${success ? " success" : ""}`; }

function humanize(key) {
  return String(key).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function friendlyScalar(value) {
  if (value == null || value === "") return '<span class="empty-value">Not provided</span>';
  if (typeof value === "boolean") return `<span class="boolean-pill ${value ? "yes" : "no"}">${value ? "Yes" : "No"}</span>`;
  if (typeof value === "number") return escapeHtml(value.toLocaleString());
  const text = String(value);
  if (/^https?:\/\//.test(text)) return `<a class="result-link" href="${escapeHtml(text)}" target="_blank" rel="noreferrer">Open link ↗</a>`;
  if (text.length > 900) return `<div class="long-text">${escapeHtml(text.slice(0, 4000))}${text.length > 4000 ? "…" : ""}</div>`;
  return escapeHtml(text);
}

function decodeContent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.encoding !== "base64" || typeof value.content !== "string") return value;
  try {
    const bytes = Uint8Array.from(atob(value.content.replace(/\s/g, "")), (char) => char.charCodeAt(0));
    return { ...value, content: new TextDecoder().decode(bytes), encoding: "Decoded from base64" };
  } catch { return value; }
}

function renderFriendly(value, depth = 0) {
  value = decodeContent(value);
  if (value == null || typeof value !== "object") return friendlyScalar(value);
  if (Array.isArray(value)) {
    if (!value.length) return '<div class="empty-state compact"><p>No matching items were returned.</p></div>';
    const objectRows = value.every((item) => item && typeof item === "object" && !Array.isArray(item));
    if (objectRows) {
      const columns = [...new Set(value.flatMap((item) => Object.keys(item)))].slice(0, 6);
      return `<div class="result-table-wrap"><table class="result-table"><thead><tr>${columns.map((key) => `<th>${humanize(key)}</th>`).join("")}</tr></thead><tbody>${value.map((row) => `<tr>${columns.map((key) => `<td>${renderFriendly(row[key], depth + 1)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    return `<ul class="result-list">${value.map((item) => `<li>${renderFriendly(item, depth + 1)}</li>`).join("")}</ul>`;
  }
  const entries = Object.entries(value).filter(([, item]) => item != null && item !== "" && !(Array.isArray(item) && !item.length) && !(typeof item === "object" && !Array.isArray(item) && !Object.keys(item).length));
  if (!entries.length) return '<span class="empty-value">Nothing else to show</span>';
  return `<dl class="friendly-grid${depth ? " nested" : ""}">${entries.map(([key, item]) => `<div><dt>${humanize(key)}</dt><dd>${renderFriendly(item, depth + 1)}</dd></div>`).join("")}</dl>`;
}

function showFriendlyResult(result) {
  const payload = result?.body ?? result?.data ?? result;
  $("#response-output").innerHTML = renderFriendly(payload);
  $("#response-json").textContent = JSON.stringify(result, null, 2);
  $("#response-raw").classList.remove("hidden");
  $("#response-raw").open = false;
}

async function connect() {
  $("#connect-button").disabled = true; $("#connect-button").textContent = "Preparing login…";
  try { const { url } = await api("/api/oauth/start"); window.location.href = url; } catch (error) { showBanner(error.message); $("#connect-button").disabled = false; $("#connect-button").textContent = "Connect Door43"; }
}

async function run() {
  if (!state.connected) { showBanner("Connect your Door43 account before running a live read."); return; }
  state.busy = true; $("#run-button").disabled = true; $("#run-button").innerHTML = "Reading…"; $("#response-title").textContent = "Waiting for envelope"; $("#response-status").textContent = "…";
  try {
    const input = formArgs(); const name = state.kind === "recipe" ? "execute" : state.kind; const body = await api("/api/tool", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, args: input }) });
    let result = body.result;
    const plannedCalls = state.kind === "recipe" && !input.dry_run ? result?.body?.plan?.calls : null;
    if (Array.isArray(plannedCalls) && plannedCalls.length) {
      const completed = [];
      for (const call of plannedCalls) {
        const callArgs = {};
        for (const key of ["method", "path", "query", "fields", "headers", "pin"]) if (call[key] != null) callArgs[key] = call[key];
        const next = await api("/api/tool", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "execute", args: callArgs }) });
        completed.push(next.result);
      }
      result = completed.length === 1 ? completed[0] : { status: completed.every((item) => item.status < 400) ? 200 : 207, body: completed.map((item, index) => ({ step: index + 1, answer: item.body })), cost: { upstream_ms: completed.reduce((sum, item) => sum + (item.cost?.upstream_ms || 0), 0) } };
    }
    $("#response-title").textContent = "Your answer is ready"; $("#response-status").textContent = result?.status >= 400 ? "Needs attention" : "Ready"; $("#response-meta").classList.remove("hidden");
    const chips = []; if (result?.request?.path) chips.push(`Source: ${result.request.path}`); if (result?.cost?.upstream_ms != null) chips.push(`${result.cost.upstream_ms} ms`); if (result?.truncated) chips.push("More results available"); $("#response-meta").innerHTML = chips.map((chip) => `<span class="meta-chip">${escapeHtml(chip)}</span>`).join("");
    showFriendlyResult(result); showBanner("Done — the answer is formatted below.", true);
  } catch (error) { $("#response-title").textContent = "We couldn’t finish that request"; $("#response-status").textContent = "Try again"; $("#response-output").innerHTML = `<div class="empty-state error-state"><span>!</span><p>${escapeHtml(error.message)}</p></div>`; $("#response-raw").classList.add("hidden"); showBanner(error.message); if (error.message.includes("login")) state.connected = false; }
  finally { state.busy = false; $("#run-button").disabled = false; $("#run-button").innerHTML = state.kind === "recipe" ? "Run this prompt <span>↗</span>" : "Run live read <span>↗</span>"; }
}

$("#runner-form").addEventListener("input", updatePreview);
$("#runner-form").addEventListener("change", updatePreview);
$("#run-button").addEventListener("click", run);
$("#connect-button").addEventListener("click", connect);
$("#copy-mcp").addEventListener("click", async () => { await navigator.clipboard.writeText("https://door43.klappy.dev/mcp"); showBanner("MCP URL copied. Add it to any OAuth-capable MCP client.", true); });
document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => selectTool(button.dataset.tool, button.dataset.mode)));

selectRecipe(state.active);
await Promise.all([refreshSession(), refreshHealth()]);
if (new URLSearchParams(location.search).get("connected") === "1") { history.replaceState({}, "", "/"); showBanner("Door43 connected. Pick a journey and run a read.", true); }
