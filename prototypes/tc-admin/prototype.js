// PROTOTYPE ONLY. Question: which portfolio layout best supports project managers?
// A: organization cards; B: compact registry; C: health lanes. Live read-only Door43 data.
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={healthy:'Healthy',warning:'Warning',failing:'Failing',never_checked:'Never checked',checking:'Checking',door43_unavailable:'Door43 unavailable',health_error:'Health-check error',unsupported:'Unsupported type',info:'Information'};
const projects=[];

let variant=['A','B','C'].includes(new URLSearchParams(location.search).get('variant'))?new URLSearchParams(location.search).get('variant'):'A';
let page='portfolio',current=1,tab='Overview',org='',query='',health='',language='',type='',sort='activity',showState=false,modal=null,release=null,draft={},upload=[],lastFocus=null;
let history=[];
const p=()=>projects.find(x=>x.id===current);
const btn=(label,action,cls='')=>`<button class="${cls}" onclick="${action}">${label}</button>`;
const badge=x=>`<span class="badge ${x.health}">${x.health==='healthy'?'✓':'○'} ${labels[x.health]}${x.issues?` <b>· ${x.issues}</b>`:''}</span>`;
function toast(t){$('#toast').textContent=t;$('#toast').style.display='block';clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('#toast').style.display='none',6000)}
function filtered(){return projects.filter(x=>(!org||x.org===org)&&(!health||(health==='attention'?['warning','failing','health_error','info'].includes(x.health):x.health===health))&&(!language||x.lang===language)&&(!type||x.type===type)&&`${x.title} ${x.repo} ${x.lang}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>sort==='language'?a.lang.localeCompare(b.lang):Date.parse(b.updated||0)-Date.parse(a.updated||0))}
function setFilter(k,v){({org:v=>org=v,health:v=>health=v,language:v=>language=v,type:v=>type=v,sort:v=>sort=v})[k](v);render()}
function search(v){query=v;const pos=$('#search').selectionStart;render();$('#search').focus();$('#search').setSelectionRange(pos,pos)}
function cycle(n){variant=['A','B','C'][(['A','B','C'].indexOf(variant)+n+3)%3];const url=new URL(location.href);url.searchParams.set('variant',variant);window.history.replaceState({},'',url);render()}
function go(id){current=id;page='detail';tab='Overview';render();window.scrollTo(0,0)}
function home(){page='portfolio';render()}
function options(items,value,all){return `<option value="">${all}</option>`+items.map(x=>`<option ${x===value?'selected':''} value="${esc(x)}">${esc(x)}</option>`).join('')}
function render(){
$('#app').innerHTML=`<header data-on="dark"><div class="brand"><img src="design-system/assets/translationcore-logo.png" alt="translationCore"><span>translationCore<sup>®</sup></span><em>Admin</em></div><nav class="topnav" aria-label="Main navigation">${btn('Projects','home()',page!=='releases'?'active':'')}</nav><span class="environment-badge" title="Development build · qa.door43.org">QA <span>· DEVELOPMENT</span></span><div class="spacer"></div>${accountMarkup()}</header><div class="shell">${connected&&!loading&&!loadError&&page==='portfolio'&&variant==='A'?sidebar():''}<main>${!connected?signInView():loading||loadError?liveStatus():page==='portfolio'?portfolio():liveDetail()}</main></div><div class="switcher" aria-label="Prototype layout switcher"><small>PROTOTYPE</small>${btn('←','cycle(-1)')}<span>${variant} · ${{A:'Organization cards',B:'Project registry',C:'Health overview'}[variant]}</span>${btn('→','cycle(1)')}${btn('State',"showState=!showState;render()",'state-toggle')}</div>${showState?`<pre class="state">${esc(JSON.stringify({variant,page,project:page==='detail'&&p()?p().repo:null,filters:{org,health,language,type,query},account,connected,loading},null,2))}</pre>`:''}`;
}
function sidebar(){return `<aside><section><div class="overline">Portfolio</div><div class="side-list">${btn(`All projects <span class="count">${projects.length}</span>`,"org='';health='';render()",!org&&!health?'active':'')}${btn(`Needs attention <span class="count">${projects.filter(x=>['warning','failing','health_error','info'].includes(x.health)).length}</span>`,"health='attention';render()",health==='attention'?'active':'')}</div></section><section><div class="overline">Organizations / owners</div><div class="side-list">${[...new Set(projects.map(x=>x.org))].map(o=>`<button class="${org===o?'active':''}" data-org="${esc(o)}" onclick="setFilter('org',this.dataset.org)">${esc(o)}<span class="count">${projects.filter(x=>x.org===o).length}</span></button>`).join('')}</div></section><section><div class="overline">Your access</div><p style="font-size:12px;margin:14px 10px">Showing repositories where @${esc(account.login)} has write access.</p></section></aside>`}

function portfolio(){const list=filtered();return `<div class="heading"><div><div class="overline" style="margin-bottom:10px">Your translation portfolio</div><h1>Projects</h1><p>A clear view of your projects. A confident next step.</p></div><div class="row">${btn('Refresh projects','loadLiveProjects()')}</div></div>${variant==='C'?`<div class="banner"><div><h2>Every project, with a clear next step.</h2><p>Review findings, check new projects, and release selected content.</p></div><strong>${projects.length} projects</strong></div>`:`<div class="stats"><div class="stat"><strong>${projects.length}</strong><span><i>Writable projects</i>Across ${new Set(projects.map(x=>x.org)).size} owners / organizations</span></div><div class="stat"><strong>${projects.filter(x=>x.health==='healthy').length}</strong><span><i>Healthy</i>Latest check passed</span></div><div class="stat"><strong>${projects.filter(x=>['warning','failing','health_error','info'].includes(x.health)).length}</strong><span><i>Need attention</i>Review health findings</span></div><div class="stat"><strong>${projects.filter(x=>['never_checked','checking'].includes(x.health)).length}</strong><span><i>Awaiting a check</i>Health not yet known</span></div></div>`}<div class="filters"><input id="search" aria-label="Search projects" placeholder="Search projects or languages…" value="${esc(query)}" oninput="search(this.value)">${variant!=='A'?`<select aria-label="Organization" onchange="setFilter('org',this.value)">${options([...new Set(projects.map(x=>x.org))],org,'All organizations')}</select>`:''}<select aria-label="Language" onchange="setFilter('language',this.value)">${options([...new Set(projects.map(x=>x.lang))].sort(),language,'All languages')}</select><select aria-label="Project type" onchange="setFilter('type',this.value)">${options(['Bible','OBS','Unsupported'],type,'All project types')}</select><select aria-label="Health state" onchange="setFilter('health',this.value)"><option value="">All health states</option><option value="attention" ${health==='attention'?'selected':''}>Needs attention</option>${Object.entries(labels).map(([k,v])=>`<option value="${k}" ${health===k?'selected':''}>${v}</option>`).join('')}</select><select class="sort" aria-label="Sort projects" onchange="setFilter('sort',this.value)"><option value="activity">Recent activity</option><option value="language" ${sort==='language'?'selected':''}>Language A–Z</option></select></div>${!list.length?`<div class="empty"><h2>${projects.length?'No matching projects':'No writable projects found'}</h2><p>${projects.length?'Try another language, organization, or health state.':'Your Door43 account has no writable repositories available in this view.'}</p>${btn('Clear filters',"org=health=language=type=query='';render()",'ghost')}</div>`:variant==='C'?`<div class="board">${[['Healthy','healthy'],['Needs attention','attention'],['Check needed','unknown']].map(([title,key])=>{const a=list.filter(x=>key==='healthy'?x.health==='healthy':key==='attention'?['warning','failing','health_error','info'].includes(x.health):!['healthy','warning','failing','health_error','info'].includes(x.health));return `<section class="lane"><h3>${title} <span class="muted">· ${a.length}</span></h3>${a.map(card).join('')||'<p class="muted">No projects in this state.</p>'}</section>`}).join('')}</div>`:[...new Set(list.map(x=>x.org))].map(o=>`<section><div class="orgheading"><div class="orgmark">${esc(o==='unfoldingWord'?'uW':o.slice(0,2).toUpperCase())}</div><h2>${esc(o)}</h2><span>· ${list.filter(x=>x.org===o).length} projects</span></div>${variant==='A'?`<div class="grid">${list.filter(x=>x.org===o).map(card).join('')}</div>`:projectTable(list.filter(x=>x.org===o))}</section>`).join('')}<p class="helptext">Coverage shows books or stories present in the repository, not translation completeness.</p>`}
function card(x){return liveCard(x)}
function projectTable(list){return liveTable(list)}
let account = null, connected = false, loading = true, loadError = '', loadEpoch = 0, configured = false;
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const body = await response.json();
  if (!response.ok) { const error = new Error(body.error || 'Unable to load Door43.'); error.status = response.status; throw error; }
  return body;
}
async function connectDoor43() {
  loading = true; loadError = ''; render();
  try { const result = await api('/api/oauth/start', { method: 'POST' }); location.assign(result.url); }
  catch (error) { loading = false; loadError = error.message; render(); }
}
async function signOut() {
  loadEpoch++;
  try { await api('/api/logout', { method: 'POST' }); account = null; connected = false; projects.splice(0); page = 'portfolio'; loading = false; loadError = ''; render(); }
  catch (error) { toast(error.message); }
}
async function loadLiveProjects() {
  const epoch = ++loadEpoch;
  loading = true; loadError = ''; render();
  const profilePoll = setInterval(async () => { try { const state = await api('/api/session'); if (epoch === loadEpoch && state.user && !account) { account = state.user; render(); } } catch {} }, 1500);
  try {
    const result = await api('/api/portfolio');
    if (epoch !== loadEpoch) return;
    account = result.user; projects.splice(0, projects.length, ...result.projects);
    if (page === 'detail' && !projects.some(x => x.id === current)) page = 'portfolio';
  } catch (error) {
    if (epoch !== loadEpoch) return;
    projects.splice(0); page = 'portfolio'; loadError = error.message;
    if (error.status === 401) { connected = false; account = null; }
  } finally { clearInterval(profilePoll); if (epoch === loadEpoch) { loading = false; render(); } }
}
async function bootstrap() {
  try {
    const session = await api('/api/session'); connected = session.connected; configured = session.configured;
    if (connected) return await loadLiveProjects();
    if (new URLSearchParams(location.search).has('auth_error')) loadError = 'Sign-in was cancelled or expired. Please try again.';
  } catch { loadError = 'Start the tC Admin server to connect to Door43.'; }
  loading = false; render();
}
function accountMarkup() {
  if (!account) return connected ? '<span class="muted">Loading your account…</span>' : '';
  const initials = (account.name || account.login).split(/\s+/).map(n => n[0]).slice(0,2).join('').toUpperCase();
  return `<div class="account"><div class="account-name"><strong>${esc(account.name)}</strong><span>@${esc(account.login)}</span></div><div class="avatar" title="${esc(account.login)}">${esc(initials)}</div>${btn('Sign out','signOut()','signout')}</div>`;
}
function signInView() {
  return `<section class="signin panel"><img src="design-system/assets/translationcore-logo.png" alt="" width="56" height="56"><div class="overline">Your translation portfolio</div><h1>Your projects.<br>A clearer perspective.</h1><p>Sign in with Door43 QA to see the projects you can manage, organized around your team.</p>${loadError?`<div class="callout error" role="alert">${esc(loadError)}</div>`:''}<button class="primary" onclick="connectDoor43()" ${loading||!configured?'disabled':''}>${loading?'Connecting…':'Sign in with Door43 QA →'}</button><p class="muted">${configured?'Connected to qa.door43.org · Only read access is requested.':'QA sign-in is being configured.'}<br>Development environment · QA data may be reset.</p></section>`;
}
function liveStatus() {
  return `<div class="heading"><div><div class="overline">Your translation portfolio</div><h1>Projects</h1><p>${loading?'Loading your writable Door43 QA projects…':'Your portfolio could not be loaded.'}</p></div></div>${loadError?`<div class="callout error" role="alert">${esc(loadError)}</div>${btn('Retry','loadLiveProjects()','primary')}`:'<div class="panel"><p>Your account permissions determine which projects appear here.</p></div>'}`;
}
function coverageText(x) { return x.count === null || x.type === 'Unsupported' ? 'Not available' : `${x.count} / ${x.type==='Bible'?66:50} ${x.type==='Bible'?'books':'stories'}`; }
function updatedText(x) { return x.updated && Number.isFinite(Date.parse(x.updated)) ? new Date(x.updated).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : 'Not provided'; }
function liveCard(x) {
  return `<article class="project"><div class="projecttop"><div class="tile ${x.type==='OBS'?'obs':''}">${esc(x.type==='OBS'?'OBS':x.code.toUpperCase().slice(0,4))}</div>${badge(x)}</div><div><h3>${esc(x.title)}</h3><div class="repo">${esc(x.org)}/${esc(x.repo)}</div></div><div class="projectmeta"><span>${esc(x.lang)}</span><span>·</span><span>${esc(x.subject)}</span></div><div class="coverage"><div class="row"><span>Repository coverage</span><strong>${coverageText(x)}</strong></div>${x.count!==null&&x.type!=='Unsupported'?`<div class="track"><span style="width:${Math.min(100,x.count/(x.type==='Bible'?66:50)*100)}%"></span></div>`:''}</div><div class="cardfoot"><span>Updated ${updatedText(x)}</span>${btn('Open →',`go(${x.id})`,'ghost')}</div></article>`;
}
function liveTable(list) {
  return `<div class="tablewrap"><table><thead><tr><th>Project</th><th>Language</th><th>Health</th><th>Coverage</th><th>Updated</th><th></th></tr></thead><tbody>${list.map(x=>`<tr><td><strong>${esc(x.title)}</strong><span class="repo">${esc(x.repo)}</span></td><td>${esc(x.lang)}</td><td>${badge(x)}</td><td>${coverageText(x)}</td><td>${updatedText(x)}</td><td>${btn('Open →',`go(${x.id})`,'ghost')}</td></tr>`).join('')}</tbody></table></div>`;
}
function liveDetail() {
  const x=p();
  return `${btn('← All projects','home()','ghost')}<div class="heading" style="margin-top:18px"><div><div class="row"><h1>${esc(x.title)}</h1>${badge(x)}</div><p>${esc(x.org)} / <span class="repo">${esc(x.repo)}</span> · ${esc(x.lang)}</p></div><a class="button-link" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">Open in Door43 →</a></div><div class="detail-grid"><div><section class="panel"><h2>Repository overview</h2><p>${esc(x.description||'No description provided.')}</p><dl><dt>Subject</dt><dd>${esc(x.subject)}</dd><dt>Coverage</dt><dd>${coverageText(x)}</dd><dt>Updated</dt><dd>${updatedText(x)}</dd></dl></section><section class="panel"><h2>Books & stories present</h2>${x.ingredients.length?`<div class="books">${x.ingredients.map(i=>`<div class="book"><strong>${esc(i.title)}</strong><span class="repo">${esc(i.path)}</span></div>`).join('')}</div>`:'<p>Door43 has not provided recognized content entries for this repository.</p>'}</section><section class="panel"><h2>Health</h2>${badge(x)}<p style="margin-top:12px">${x.health==='never_checked'?'No health-check result was supplied by Door43.':x.health==='unsupported'?'This subject is outside the supported Bible and Open Bible Stories project types.':'Latest health status reported by Door43. Refresh the portfolio to read updated results.'}</p></section></div><div><section class="panel"><h2>Project details</h2><dl><dt>Organization / owner</dt><dd>${esc(x.org)}</dd><dt>Language</dt><dd>${esc(x.lang)}</dd><dt>Default branch</dt><dd>${esc(x.defaultBranch||'Not provided')}</dd><dt>Your access</dt><dd>Write</dd></dl></section><section class="panel"><div class="overline">Connected to Door43 QA</div><p style="margin-top:12px">This view reads your real repository. Manage files and releases in Door43.</p><p class="muted" style="margin-top:12px">Editing and release preparation in tC Admin are not connected yet.</p></section></div></div>`;
}

document.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,select,[contenteditable]'))return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();cycle(e.key==='ArrowRight'?1:-1)}});
render();
bootstrap();
