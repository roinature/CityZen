export function getAdminPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CityZen Admin</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e1e4e8; min-height: 100vh; }

  /* Login */
  .login-container { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .login-box { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 32px; width: 360px; }
  .login-box h1 { font-size: 20px; margin-bottom: 20px; color: #58a6ff; }
  .login-box input { width: 100%; padding: 10px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #e1e4e8; font-size: 14px; margin-bottom: 12px; }
  .login-box input:focus { outline: none; border-color: #58a6ff; }
  .login-error { color: #f85149; font-size: 13px; margin-bottom: 8px; display: none; }

  /* Layout */
  .app { display: none; }
  header { background: #161b22; border-bottom: 1px solid #30363d; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; }
  header h1 { font-size: 18px; color: #58a6ff; }
  nav { display: flex; gap: 2px; background: #161b22; padding: 0 24px; border-bottom: 1px solid #30363d; }
  nav button { background: none; border: none; color: #8b949e; padding: 10px 16px; cursor: pointer; font-size: 14px; border-bottom: 2px solid transparent; transition: all 0.15s; }
  nav button:hover { color: #e1e4e8; }
  nav button.active { color: #58a6ff; border-bottom-color: #58a6ff; }
  main { padding: 24px; max-width: 1400px; margin: 0 auto; }

  /* Buttons */
  .btn { padding: 8px 16px; border-radius: 6px; border: 1px solid #30363d; cursor: pointer; font-size: 13px; transition: all 0.15s; }
  .btn-primary { background: #238636; border-color: #238636; color: #fff; }
  .btn-primary:hover { background: #2ea043; }
  .btn-danger { background: #da3633; border-color: #da3633; color: #fff; }
  .btn-danger:hover { background: #f85149; }
  .btn-sm { padding: 4px 10px; font-size: 12px; }
  .btn-ghost { background: none; color: #8b949e; }
  .btn-ghost:hover { color: #e1e4e8; background: #21262d; }

  /* Stats cards */
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
  .stat-card .label { font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-card .value { font-size: 28px; font-weight: 600; margin-top: 4px; color: #e1e4e8; }

  /* Tables */
  .toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
  .toolbar input { padding: 8px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #e1e4e8; font-size: 14px; width: 260px; }
  .toolbar input:focus { outline: none; border-color: #58a6ff; }
  table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
  th { text-align: left; padding: 10px 14px; font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; background: #1c2128; border-bottom: 1px solid #30363d; }
  td { padding: 10px 14px; font-size: 14px; border-bottom: 1px solid #21262d; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #1c2128; }
  .actions { display: flex; gap: 6px; }
  .mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; color: #8b949e; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; }
  .badge-green { background: #23362e; color: #3fb950; }
  .badge-yellow { background: #3d2e00; color: #d29922; }
  .badge-red { background: #3d1a1a; color: #f85149; }

  /* Pagination */
  .pagination { display: flex; gap: 8px; align-items: center; justify-content: center; margin-top: 16px; }
  .pagination button { background: #21262d; border: 1px solid #30363d; color: #e1e4e8; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .pagination button:disabled { opacity: 0.4; cursor: default; }
  .pagination span { color: #8b949e; font-size: 13px; }

  /* Modal */
  .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 100; align-items: center; justify-content: center; }
  .modal-overlay.open { display: flex; }
  .modal { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 24px; width: 440px; max-width: 90vw; }
  .modal h3 { margin-bottom: 16px; color: #e1e4e8; }
  .modal label { display: block; font-size: 13px; color: #8b949e; margin-bottom: 4px; margin-top: 12px; }
  .modal input { width: 100%; padding: 8px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #e1e4e8; font-size: 14px; }
  .modal input:focus { outline: none; border-color: #58a6ff; }
  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }

  .tab-content { display: none; }
  .tab-content.active { display: block; }
  .empty { text-align: center; padding: 40px; color: #8b949e; }
</style>
</head>
<body>

<!-- Login Screen -->
<div class="login-container" id="loginScreen">
  <div class="login-box">
    <h1>CityZen Admin</h1>
    <div class="login-error" id="loginError"></div>
    <input type="password" id="loginPassword" placeholder="Admin password" autofocus>
    <button class="btn btn-primary" style="width:100%" onclick="doLogin()">Login</button>
  </div>
</div>

<!-- App -->
<div class="app" id="app">
  <header>
    <h1>CityZen Admin</h1>
    <button class="btn btn-ghost btn-sm" onclick="doLogout()">Logout</button>
  </header>
  <nav>
    <button class="active" onclick="switchTab('dashboard', this)">Dashboard</button>
    <button onclick="switchTab('players', this)">Players</button>
    <button onclick="switchTab('cities', this)">Cities</button>
    <button onclick="switchTab('worlds', this)">Worlds</button>
    <button onclick="switchTab('messages', this)">Messages</button>
  </nav>
  <main>
    <!-- Dashboard -->
    <div class="tab-content active" id="tab-dashboard">
      <div class="stats-grid" id="statsGrid"></div>
    </div>

    <!-- Players -->
    <div class="tab-content" id="tab-players">
      <div class="toolbar">
        <input type="text" placeholder="Search players..." id="playerSearch" oninput="debounce(loadPlayers, 300)()">
      </div>
      <div id="playersTable"></div>
      <div class="pagination" id="playersPagination"></div>
    </div>

    <!-- Cities -->
    <div class="tab-content" id="tab-cities">
      <div id="citiesTable"></div>
      <div class="pagination" id="citiesPagination"></div>
    </div>

    <!-- Worlds -->
    <div class="tab-content" id="tab-worlds">
      <div id="worldsTable"></div>
    </div>

    <!-- Messages -->
    <div class="tab-content" id="tab-messages">
      <div class="toolbar">
        <button class="btn btn-ghost btn-sm" onclick="cleanupMessages()">Cleanup expired</button>
      </div>
      <div id="messagesTable"></div>
      <div class="pagination" id="messagesPagination"></div>
    </div>
  </main>
</div>

<!-- Edit City Modal -->
<div class="modal-overlay" id="cityModal">
  <div class="modal">
    <h3>Edit City</h3>
    <input type="hidden" id="editCityId">
    <label>Name</label>
    <input type="text" id="editCityName">
    <label>Money</label>
    <input type="number" id="editCityMoney">
    <label>Population</label>
    <input type="number" id="editCityPopulation">
    <label>Happiness (0-100)</label>
    <input type="number" id="editCityHappiness" min="0" max="100">
    <label>Tax Rate (1-25)</label>
    <input type="number" id="editCityTaxRate" min="1" max="25">
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal('cityModal')">Cancel</button>
      <button class="btn btn-primary" onclick="saveCityEdit()">Save</button>
    </div>
  </div>
</div>

<!-- Edit Player Modal -->
<div class="modal-overlay" id="playerModal">
  <div class="modal">
    <h3>Edit Player</h3>
    <input type="hidden" id="editPlayerId">
    <label>Name</label>
    <input type="text" id="editPlayerName">
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal('playerModal')">Cancel</button>
      <button class="btn btn-primary" onclick="savePlayerEdit()">Save</button>
    </div>
  </div>
</div>

<!-- Edit World Modal -->
<div class="modal-overlay" id="worldModal">
  <div class="modal">
    <h3>Edit World</h3>
    <input type="hidden" id="editWorldId">
    <label>Name</label>
    <input type="text" id="editWorldName">
    <label>Grid Size</label>
    <input type="number" id="editWorldGridSize">
    <label>Max Cities</label>
    <input type="number" id="editWorldMaxCities">
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal('worldModal')">Cancel</button>
      <button class="btn btn-primary" onclick="saveWorldEdit()">Save</button>
    </div>
  </div>
</div>

<script>
const API = '/api/admin';
let currentPlayersPage = 1;
let currentCitiesPage = 1;
let currentMessagesPage = 1;

// ── Auth ──────────────────────────────────────────────────

async function checkSession() {
  try {
    const r = await fetch(API + '/session');
    if (r.ok) { showApp(); return; }
  } catch {}
  showLogin();
}

async function doLogin() {
  const pw = document.getElementById('loginPassword').value;
  const r = await fetch(API + '/login', {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({password: pw})
  });
  if (r.ok) { showApp(); }
  else {
    const err = document.getElementById('loginError');
    err.textContent = 'Invalid password';
    err.style.display = 'block';
  }
}

async function doLogout() {
  await fetch(API + '/logout', { method: 'POST' });
  showLogin();
}

document.getElementById('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  loadDashboard();
}

// ── Tabs ──────────────────────────────────────────────────

function switchTab(name, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');

  if (name === 'dashboard') loadDashboard();
  else if (name === 'players') loadPlayers();
  else if (name === 'cities') loadCities();
  else if (name === 'worlds') loadWorlds();
  else if (name === 'messages') loadMessages();
}

// ── Dashboard ─────────────────────────────────────────────

async function loadDashboard() {
  const r = await fetch(API + '/stats');
  const d = await r.json();
  document.getElementById('statsGrid').innerHTML = [
    statCard('Players', d.players),
    statCard('Cities', d.cities),
    statCard('Worlds', d.worlds),
    statCard('Buildings', d.buildings),
    statCard('Active Rooms', d.activeRooms),
    statCard('Online Players', d.activePlayers),
    statCard('Messages', d.messages),
  ].join('');
}

function statCard(label, value) {
  return '<div class="stat-card"><div class="label">' + label + '</div><div class="value">' + value + '</div></div>';
}

// ── Players ───────────────────────────────────────────────

async function loadPlayers() {
  const search = document.getElementById('playerSearch').value;
  const r = await fetch(API + '/players?page=' + currentPlayersPage + '&limit=20&search=' + encodeURIComponent(search));
  const d = await r.json();

  if (d.players.length === 0) {
    document.getElementById('playersTable').innerHTML = '<div class="empty">No players found</div>';
    document.getElementById('playersPagination').innerHTML = '';
    return;
  }

  let html = '<table><tr><th>Name</th><th>ID</th><th>Owned City</th><th>Created</th><th>Actions</th></tr>';
  for (const p of d.players) {
    html += '<tr><td>' + esc(p.name) + '</td><td class="mono">' + esc(p.id.slice(0,8)) + '...</td>'
      + '<td class="mono">' + (p.ownedCityId ? esc(p.ownedCityId.slice(0,8)) + '...' : '-') + '</td>'
      + '<td>' + fmtDate(p.createdAt) + '</td>'
      + '<td class="actions">'
      + '<button class="btn btn-ghost btn-sm" onclick="openEditPlayer(\\'' + esc(p.id) + '\\',\\'' + esc(p.name) + '\\')">Edit</button>'
      + '<button class="btn btn-danger btn-sm" onclick="deletePlayer(\\'' + esc(p.id) + '\\')">Delete</button>'
      + '</td></tr>';
  }
  html += '</table>';
  document.getElementById('playersTable').innerHTML = html;
  renderPagination('playersPagination', d.page, d.total, d.limit, p => { currentPlayersPage = p; loadPlayers(); });
}

function openEditPlayer(id, name) {
  document.getElementById('editPlayerId').value = id;
  document.getElementById('editPlayerName').value = name;
  document.getElementById('playerModal').classList.add('open');
}

async function savePlayerEdit() {
  const id = document.getElementById('editPlayerId').value;
  const name = document.getElementById('editPlayerName').value;
  await fetch(API + '/players/' + id, {
    method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name})
  });
  closeModal('playerModal');
  loadPlayers();
}

async function deletePlayer(id) {
  if (!confirm('Delete this player? This will also delete their messages.')) return;
  await fetch(API + '/players/' + id, { method: 'DELETE' });
  loadPlayers();
}

// ── Cities ────────────────────────────────────────────────

async function loadCities() {
  const r = await fetch(API + '/cities?page=' + currentCitiesPage + '&limit=20');
  const d = await r.json();

  if (d.cities.length === 0) {
    document.getElementById('citiesTable').innerHTML = '<div class="empty">No cities found</div>';
    document.getElementById('citiesPagination').innerHTML = '';
    return;
  }

  let html = '<table><tr><th>Name</th><th>Owner</th><th>Money</th><th>Population</th><th>Happiness</th><th>Tax</th><th>Buildings</th><th>Status</th><th>Actions</th></tr>';
  for (const c of d.cities) {
    const status = c.isActive
      ? '<span class="badge badge-green">' + c.activePlayers + ' online</span>'
      : '<span class="badge badge-yellow">idle</span>';
    const cityLink = '/?cityId=' + encodeURIComponent(c.id);
    html += '<tr><td><a href="' + cityLink + '" target="_blank" style="color:#58a6ff;text-decoration:none" title="Open city in game">' + esc(c.name) + ' &#8599;</a></td><td class="mono">' + esc(c.ownerId.slice(0,8)) + '...</td>'
      + '<td>' + fmtNum(c.money) + '</td><td>' + Math.floor(c.population) + '</td>'
      + '<td>' + Math.floor(c.happiness) + '%</td><td>' + c.taxRate + '%</td>'
      + '<td>' + c.buildingCount + '</td><td>' + status + '</td>'
      + '<td class="actions">'
      + '<button class="btn btn-ghost btn-sm" onclick="openEditCity(\\'' + esc(c.id) + '\\')">Edit</button>'
      + '<button class="btn btn-ghost btn-sm" onclick="restartCity(\\'' + esc(c.id) + '\\')">Restart</button>'
      + '<button class="btn btn-danger btn-sm" onclick="deleteCity(\\'' + esc(c.id) + '\\')">Delete</button>'
      + '</td></tr>';
  }
  html += '</table>';
  document.getElementById('citiesTable').innerHTML = html;
  renderPagination('citiesPagination', d.page, d.total, d.limit, p => { currentCitiesPage = p; loadCities(); });
}

async function openEditCity(id) {
  const r = await fetch(API + '/cities/' + id);
  const c = await r.json();
  document.getElementById('editCityId').value = c.id;
  document.getElementById('editCityName').value = c.name;
  document.getElementById('editCityMoney').value = Math.floor(c.liveMoney ?? c.money);
  document.getElementById('editCityPopulation').value = Math.floor(c.livePopulation ?? c.population);
  document.getElementById('editCityHappiness').value = Math.floor(c.liveHappiness ?? c.happiness);
  document.getElementById('editCityTaxRate').value = c.taxRate;
  document.getElementById('cityModal').classList.add('open');
}

async function saveCityEdit() {
  const id = document.getElementById('editCityId').value;
  await fetch(API + '/cities/' + id, {
    method: 'PATCH',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      name: document.getElementById('editCityName').value,
      money: Number(document.getElementById('editCityMoney').value),
      population: Number(document.getElementById('editCityPopulation').value),
      happiness: Number(document.getElementById('editCityHappiness').value),
      taxRate: Number(document.getElementById('editCityTaxRate').value),
    })
  });
  closeModal('cityModal');
  loadCities();
}

async function restartCity(id) {
  if (!confirm('Restart this city? All buildings will be removed and resources reset.')) return;
  await fetch(API + '/cities/' + id + '/restart', { method: 'POST' });
  loadCities();
}

async function deleteCity(id) {
  if (!confirm('Permanently delete this city? This cannot be undone.')) return;
  await fetch(API + '/cities/' + id, { method: 'DELETE' });
  loadCities();
}

// ── Worlds ────────────────────────────────────────────────

async function loadWorlds() {
  const r = await fetch(API + '/worlds');
  const d = await r.json();

  if (d.worlds.length === 0) {
    document.getElementById('worldsTable').innerHTML = '<div class="empty">No worlds found</div>';
    return;
  }

  let html = '<table><tr><th>Name</th><th>ID</th><th>Grid Size</th><th>Max Cities</th><th>Total Pop</th><th>Cities</th><th>Actions</th></tr>';
  for (const w of d.worlds) {
    const cities = Array.isArray(w.cities) ? w.cities.length : 0;
    html += '<tr><td>' + esc(w.name) + '</td><td class="mono">' + esc(w.id.slice(0,12)) + '</td>'
      + '<td>' + w.gridSize + '</td><td>' + w.maxCities + '</td>'
      + '<td>' + w.totalPopulation + '</td><td>' + cities + '</td>'
      + '<td class="actions">'
      + '<button class="btn btn-ghost btn-sm" onclick="openEditWorld(\\'' + esc(w.id) + '\\',\\'' + esc(w.name) + '\\',' + w.gridSize + ',' + w.maxCities + ')">Edit</button>'
      + '</td></tr>';
  }
  html += '</table>';
  document.getElementById('worldsTable').innerHTML = html;
}

function openEditWorld(id, name, gridSize, maxCities) {
  document.getElementById('editWorldId').value = id;
  document.getElementById('editWorldName').value = name;
  document.getElementById('editWorldGridSize').value = gridSize;
  document.getElementById('editWorldMaxCities').value = maxCities;
  document.getElementById('worldModal').classList.add('open');
}

async function saveWorldEdit() {
  const id = document.getElementById('editWorldId').value;
  await fetch(API + '/worlds/' + id, {
    method: 'PATCH',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      name: document.getElementById('editWorldName').value,
      gridSize: Number(document.getElementById('editWorldGridSize').value),
      maxCities: Number(document.getElementById('editWorldMaxCities').value),
    })
  });
  closeModal('worldModal');
  loadWorlds();
}

// ── Messages ──────────────────────────────────────────────

async function loadMessages() {
  const r = await fetch(API + '/messages?page=' + currentMessagesPage + '&limit=20');
  const d = await r.json();

  if (d.messages.length === 0) {
    document.getElementById('messagesTable').innerHTML = '<div class="empty">No messages</div>';
    document.getElementById('messagesPagination').innerHTML = '';
    return;
  }

  let html = '<table><tr><th>Type</th><th>Category</th><th>Priority</th><th>Title</th><th>City</th><th>Created</th><th>Read</th><th>Actions</th></tr>';
  for (const m of d.messages) {
    const pClass = m.priority === 'critical' ? 'badge-red' : m.priority === 'high' ? 'badge-yellow' : 'badge-green';
    html += '<tr><td>' + esc(m.type) + '</td><td>' + esc(m.category) + '</td>'
      + '<td><span class="badge ' + pClass + '">' + esc(m.priority) + '</span></td>'
      + '<td>' + esc(m.title) + '</td>'
      + '<td class="mono">' + (m.cityId ? esc(m.cityId.slice(0,8)) + '...' : '-') + '</td>'
      + '<td>' + fmtDate(m.createdAt) + '</td>'
      + '<td>' + (m.isRead ? 'Yes' : 'No') + '</td>'
      + '<td class="actions">'
      + '<button class="btn btn-danger btn-sm" onclick="deleteMessage(\\'' + esc(m.id) + '\\')">Delete</button>'
      + '</td></tr>';
  }
  html += '</table>';
  document.getElementById('messagesTable').innerHTML = html;
  renderPagination('messagesPagination', d.page, d.total, d.limit, p => { currentMessagesPage = p; loadMessages(); });
}

async function deleteMessage(id) {
  await fetch(API + '/messages/' + id, { method: 'DELETE' });
  loadMessages();
}

async function cleanupMessages() {
  const r = await fetch(API + '/messages/cleanup', { method: 'POST' });
  const d = await r.json();
  alert('Cleaned up ' + (d.deleted || 0) + ' expired messages');
  loadMessages();
}

// ── Utilities ─────────────────────────────────────────────

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
function fmtDate(d) { if (!d) return '-'; return new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); }
function fmtNum(n) { return Math.floor(n).toLocaleString(); }

function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
});

function renderPagination(containerId, page, total, limit, onPage) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) { document.getElementById(containerId).innerHTML = ''; return; }
  const el = document.getElementById(containerId);
  el.innerHTML = '';

  const prev = document.createElement('button');
  prev.textContent = 'Prev';
  prev.disabled = page <= 1;
  prev.onclick = () => onPage(page - 1);
  el.appendChild(prev);

  const info = document.createElement('span');
  info.textContent = 'Page ' + page + ' of ' + pages + ' (' + total + ' total)';
  el.appendChild(info);

  const next = document.createElement('button');
  next.textContent = 'Next';
  next.disabled = page >= pages;
  next.onclick = () => onPage(page + 1);
  el.appendChild(next);
}

let debounceTimers = {};
function debounce(fn, ms) {
  return function() {
    clearTimeout(debounceTimers[fn.name]);
    debounceTimers[fn.name] = setTimeout(fn, ms);
  };
}

// ── Init ──────────────────────────────────────────────────
checkSession();
</script>
</body>
</html>`;
}
