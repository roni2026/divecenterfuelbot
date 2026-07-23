let currentRows = [];
let liveInterval = null;
let editingId = null;         // null = adding a new entry
let activeType = 'petrol';

// Coral Boat dive centre only (Maafushivaru boats are not tracked here).
const BOATS = [
  'Sea Explorer', 'Jetski', 'Gonzo', 'Chill Time', 'Fish Stalker', 'Arya',
];
const PETROL_BOATS = new Set(['Sea Explorer', 'Jetski', 'Gonzo']);

const $ = sel => document.querySelector(sel);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) { showLogin(); throw new Error('unauthorized'); }
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) throw new Error((data && data.error) || 'Request failed');
  return data;
}

function showLogin() {
  $('#loginScreen').style.display = 'flex';
  $('#dashboard').style.display = 'none';
}
function showDashboard() {
  $('#loginScreen').style.display = 'none';
  $('#dashboard').style.display = 'block';
  setDefaultRangeIfEmpty();
  populateBoatList();
  loadLogs();
}

function localYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function setDefaultRangeIfEmpty() {
  const now = new Date();
  if (!$('#startDate').value) $('#startDate').value = localYmd(new Date(now.getFullYear(), now.getMonth(), 1));
  if (!$('#endDate').value) $('#endDate').value = localYmd(now);
}
function populateBoatList() {
  $('#boatList').innerHTML = BOATS.map(b => `<option value="${b}">`).join('');
}

async function init() {
  try {
    const { loggedIn } = await api('/api/me');
    if (loggedIn) showDashboard(); else showLogin();
  } catch { showLogin(); }
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#loginError').textContent = '';
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('#username').value, password: $('#password').value }),
    });
    showDashboard();
  } catch {
    $('#loginError').textContent = 'Invalid username or password';
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  showLogin();
});

function dateQuery() {
  const start = $('#startDate').value;
  const end = $('#endDate').value;
  const params = new URLSearchParams();
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  return params.toString();
}
function exportQuery() {
  const params = new URLSearchParams(dateQuery());
  if (activeType && activeType !== 'all') params.set('type', activeType);
  return params.toString();
}

async function loadLogs() {
  const rows = await api('/api/logs?' + dateQuery());
  currentRows = rows;
  renderActive();
}

function fmt(n) {
  if (n === null || n === undefined || n === '') return '';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function renderActive() {
  const rows = activeType === 'all' ? currentRows : currentRows.filter(r => r.fuel_type === activeType);
  renderRows(rows);
  const total = rows.reduce((s, r) => s + Number(r.quantity || 0), 0);
  const label = activeType === 'all' ? 'All fuel' : activeType.charAt(0).toUpperCase() + activeType.slice(1);
  const start = $('#startDate').value || '(earliest)';
  const end = $('#endDate').value || '(latest)';
  $('#sheetSummary').textContent = rows.length
    ? `${label} · ${start} → ${end} — ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} · total ${fmt(total)} L`
    : `${label} · ${start} → ${end} — no entries in this range.`;
  $('#printRange').textContent = `${label} — Period: ${start} to ${end}`;
}

function renderRows(rows) {
  const body = $('#logBody');
  body.innerHTML = '';
  rows.forEach(r => {
    const icon = r.fuel_type === 'petrol' ? '🟢' : '🔵';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.log_date}</td>
      <td>${r.boat_name}</td>
      <td>${icon} ${r.fuel_type}</td>
      <td>${fmt(r.quantity)}</td>
      <td>${r.unit || 'Ltrs'}</td>
      <td>${r.section || ''}</td>
      <td class="no-print">
        <button class="editBtn" data-id="${r.id}">Edit</button>
        <button class="delBtn" data-id="${r.id}">Delete</button>
      </td>`;
    body.appendChild(tr);
  });
  document.querySelectorAll('.editBtn').forEach(b => b.addEventListener('click', () => openEdit(b.dataset.id)));
  document.querySelectorAll('.delBtn').forEach(b => b.addEventListener('click', () => onDelete(b.dataset.id)));
}

function openAdd() {
  editingId = null;
  $('#editTitle').textContent = 'Add Entry';
  $('#editDate').value = localYmd(new Date());
  $('#editBoat').value = '';
  $('#editType').value = activeType === 'diesel' ? 'diesel' : 'petrol';
  $('#editQty').value = '';
  $('#editUnit').value = 'Ltrs';
  $('#editSection').value = '';
  $('#editModal').style.display = 'flex';
}

function openEdit(id) {
  const row = currentRows.find(r => String(r.id) === String(id));
  if (!row) return;
  editingId = id;
  $('#editTitle').textContent = 'Edit Entry';
  $('#editDate').value = row.log_date;
  $('#editBoat').value = row.boat_name;
  $('#editType').value = row.fuel_type;
  $('#editQty').value = row.quantity ?? '';
  $('#editUnit').value = row.unit || 'Ltrs';
  $('#editSection').value = row.section || '';
  $('#editModal').style.display = 'flex';
}

// Auto-pick fuel type from the boat name when adding.
$('#editBoat').addEventListener('change', () => {
  const b = $('#editBoat').value.trim();
  if (BOATS.includes(b)) $('#editType').value = PETROL_BOATS.has(b) ? 'petrol' : 'diesel';
});

$('#cancelEdit').addEventListener('click', () => { $('#editModal').style.display = 'none'; });

$('#saveEdit').addEventListener('click', async () => {
  const payload = {
    log_date: $('#editDate').value,
    boat_name: $('#editBoat').value.trim(),
    fuel_type: $('#editType').value,
    quantity: $('#editQty').value === '' ? 0 : Number($('#editQty').value),
    unit: $('#editUnit').value || 'Ltrs',
    section: $('#editSection').value || null,
  };
  if (!payload.log_date || !payload.boat_name) { alert('Date and boat name are required.'); return; }
  if (editingId === null) {
    await api('/api/logs', { method: 'POST', body: JSON.stringify(payload) });
  } else {
    await api(`/api/logs/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
  }
  $('#editModal').style.display = 'none';
  loadLogs();
});

async function onDelete(id) {
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  await api(`/api/logs/${id}`, { method: 'DELETE' });
  loadLogs();
}

$('#applyFilter').addEventListener('click', loadLogs);
$('#addBtn').addEventListener('click', openAdd);

document.querySelectorAll('#sheetTabs .tab').forEach(btn => {
  btn.addEventListener('click', () => {
    activeType = btn.dataset.type;
    document.querySelectorAll('#sheetTabs .tab').forEach(b => b.classList.toggle('active', b === btn));
    renderActive();
  });
});

$('#exportExcel').addEventListener('click', () => window.open('/api/export/excel?' + exportQuery(), '_blank'));
$('#exportPdf').addEventListener('click', () => window.open('/api/export/pdf?' + exportQuery(), '_blank'));
$('#printBtn').addEventListener('click', () => window.print());

$('#liveToggle').addEventListener('change', e => {
  if (e.target.checked) liveInterval = setInterval(loadLogs, 8000);
  else if (liveInterval) clearInterval(liveInterval);
});

init();
