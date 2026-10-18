// ===================== DATA ACCESS =====================
// Persistence lives in store.js (IndexedDB) and sync.js (server). `db` is a live view.
const db = {
  get businesses() { return Store.data.businesses; },
  get shops() { return Store.data.shops; },
  get rentPayments() { return Store.data.rentPayments; },
  get roznamcha() { return Store.data.roznamcha; },
  get activeBizId() { return Store.activeBizId; }
};

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function getBiz() { return db.businesses.find(b => b.id === db.activeBizId); }
// ---- Rent due for a given month (handles pro-rata first month and manual adjustments) ----
function daysInMonth(m) { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); }
function rentInfo(shop, month) {
  const full = Number(shop.monthlyRent) || 0;
  const adj = shop.rentAdjust?.[month];
  if (adj !== undefined && adj !== null && adj !== '') return { due: Number(adj) || 0, type: 'adjusted', full };
  const sd = shop.startDate;
  if (sd) {
    const sm = sd.slice(0, 7);
    if (month < sm) return { due: 0, type: 'notstarted', full };
    const day = Number(sd.slice(8, 10));
    if (month === sm && shop.prorate !== false && day > 1) {
      const dim = daysInMonth(month), days = dim - day + 1;
      return { due: Math.round(full * days / dim), type: 'prorated', days, dim, full };
    }
  }
  return { due: full, type: 'full', full };
}
const rentDueFor = (shop, month) => rentInfo(shop, month).due;
const rentNote = i => i.type === 'prorated' ? `pro-rata: ${i.days} of ${i.dim} days` : i.type === 'adjusted' ? 'changed by you' : '';

// Rent for one month across active shops: expected - collected. (Earlier months are assumed paid.)
function monthTotals(month) {
  const active = getShops().filter(s => s.status === 'active');
  const expected = active.reduce((t, s) => t + rentDueFor(s, month), 0);
  const collected = active.reduce((t, s) => t + paidFor(s.id, month), 0);
  return { expected, collected, remaining: expected - collected };
}

// ---- Shop ordering: automatic (natural shop-number order) or the owner's own order ----
const shopCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });   // S-2 before S-10
function shopSortMode() { try { return localStorage.getItem('shopSort') || 'number'; } catch (e) { return 'number'; } }
function setShopSort(v) { try { localStorage.setItem('shopSort', v); } catch (e) {} renderShops(); }
function orderShops(list, mode = shopSortMode()) {
  const byNum = (x, y) => shopCollator.compare(x.shopNum || '', y.shopNum || '');
  const a = [...list];
  if (mode === 'name') a.sort((x, y) => shopCollator.compare(x.tenantName || '', y.tenantName || '') || byNum(x, y));
  else if (mode === 'rent') a.sort((x, y) => (Number(y.monthlyRent) || 0) - (Number(x.monthlyRent) || 0) || byNum(x, y));
  else if (mode === 'custom') a.sort((x, y) => ((x.order ?? 1e9) - (y.order ?? 1e9)) || byNum(x, y));
  else a.sort(byNum);
  return a;
}
function getShops() { return orderShops(db.shops.filter(s => s.bizId === db.activeBizId)); }
function getRent() { return db.rentPayments.filter(r => r.bizId === db.activeBizId); }
function getRoz() { return db.roznamcha.filter(r => r.bizId === db.activeBizId); }

// ===================== NAVIGATION =====================
let currentSection = 'dashboard';

function navigate(sec, el) {
  document.querySelectorAll('.section').forEach(s => { s.classList.remove('active'); s.style.display = ''; });
  document.getElementById('no-biz').hidden = true;
  document.querySelectorAll('[data-section]').forEach(a => a.classList.toggle('active', a.dataset.section === sec));
  document.getElementById('s-' + sec).classList.add('active');
  document.getElementById('content').scrollTop = 0;
  currentSection = sec;
  const titles = {
    dashboard: 'Home', shops: 'Shops & Tenants', deposits: 'Deposits (Security)',
    rent: 'Collect Rent', roznamcha: 'Daily Book (Roz Namcha)', parties: 'Party Accounts', reports: 'Backup & Reports'
  };
  document.getElementById('topbar-title').textContent = titles[sec] || sec;
  renderSection(sec);
  return false;
}

// On phones tables become cards: copy each column heading onto its cells.
function labelTables() {
  document.querySelectorAll('table').forEach(t => {
    const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent);
    t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => {
      if (heads[i] && td.colSpan === 1) td.setAttribute('data-label', heads[i]);
    }));
  });
}

function renderSection(sec) {
  try { renderSectionInner(sec); } finally { labelTables(); }
}

function renderSectionInner(sec) {
  if (sec === 'reports') { renderOfflineStatus(); renderAccount(); }
  if (sec === 'dashboard') renderDashboard();
  else if (sec === 'shops') renderShops();
  else if (sec === 'deposits') renderDeposits();
  else if (sec === 'rent') renderRent();
  else if (sec === 'roznamcha') renderRoznamcha();
  else if (sec === 'parties') renderParties();
}

// ===================== BUSINESS =====================
function renderBizDropdown() {
  const dd = document.getElementById('biz-dropdown');
  dd.innerHTML = db.businesses.length
    ? db.businesses.map(b => `<option value="${b.id}" ${b.id===db.activeBizId?'selected':''}>${esc(b.name)}</option>`).join('')
    : '<option value="">-- No Business --</option>';
  const m = document.getElementById('biz-dropdown-m');
  m.innerHTML = dd.innerHTML;
  m.style.display = db.businesses.length > 1 ? '' : 'none';
  const biz = getBiz();
  document.getElementById('sidebar-biz-name').textContent = biz ? biz.name : 'No business selected';
}

async function switchBusiness(id) {
  await Store.setActiveBiz(id);
  renderBizDropdown();
  renderSection(currentSection);
}

function openAddBusiness() {
  const first = !db.businesses.length;
  document.getElementById('biz-modal-title').textContent = first ? 'Welcome! Let\'s get started' : 'Add Business';
  document.getElementById('biz-modal-help').textContent = first
    ? 'First, give your business a name (for example "Main Market Shops"). You can add more businesses later.'
    : 'Each business keeps its own shops, rent and daily book.';
  document.getElementById('biz-name-input').value = '';
  document.getElementById('biz-addr-input').value = '';
  openModal('modal-biz');
}

async function saveBusiness() {
  const name = document.getElementById('biz-name-input').value.trim();
  if (!name) return notify('Enter business name', 'error');
  const biz = { id: Store.uid(), name, address: document.getElementById('biz-addr-input').value.trim() };
  await Store.put('businesses', biz);
  await Store.setActiveBiz(biz.id);
  closeModal('modal-biz');
  renderBizDropdown();
  renderSection(currentSection);
  notify('Business added: ' + name, 'success');
}

// ===================== DASHBOARD =====================
function renderDashboard() {
  if (!requireBiz()) return;
  const shops = getShops();
  const rent = getRent();
  const roz = getRoz();
  const totalDeposit = shops.reduce((s, sh) => s + (Number(sh.depositPaid)||0), 0);
  const thisMonth = new Date().toISOString().slice(0,7);
  const totalRent = shops.filter(s => s.status === 'active').reduce((t, sh) => t + rentDueFor(sh, thisMonth), 0);
  const rentThisMonth = rent.filter(r => r.forMonth === thisMonth).reduce((s,r) => s+(Number(r.amount)||0), 0);
  const active = shops.filter(s => s.status === 'active').length;

  document.getElementById('dash-stats').innerHTML = `
    <div class="stat-card blue"><div class="label">Shops Rented Out</div><div class="value">${active}</div></div>
    <div class="stat-card green"><div class="label">Rent Expected This Month</div><div class="value">${fmt(totalRent)}</div></div>
    <div class="stat-card orange"><div class="label">Rent Received This Month</div><div class="value">${fmt(rentThisMonth)}</div></div>
    <div class="stat-card red"><div class="label">Total Rent Still Remaining</div><div class="value">${fmt(monthTotals(thisMonth).remaining)}</div><div class="sub">Expected ${fmt(monthTotals(thisMonth).expected)} − Collected ${fmt(monthTotals(thisMonth).collected)}</div></div>
    <div class="stat-card red"><div class="label">Security Deposits Held</div><div class="value">${fmt(totalDeposit)}</div></div>
    <div class="stat-card green" onclick="navigate('parties')" style="cursor:pointer"><div class="label">Parties Owe You</div><div class="value">${fmt(partyTotals().receive)}</div></div>
    <div class="stat-card orange" onclick="navigate('parties')" style="cursor:pointer"><div class="label">You Need To Pay</div><div class="value">${fmt(partyTotals().pay)}</div></div>
  `;

  // Rent due
  const due = shops.filter(s => s.status === 'active').map(s => {
    const paid = rent.filter(r => r.shopId === s.id && r.forMonth === thisMonth).reduce((x,r) => x+(Number(r.amount)||0), 0);
    const due = rentDueFor(s, thisMonth) - paid;
    return { ...s, paid, due };
  }).filter(s => s.due > 0);

  document.getElementById('dash-due').innerHTML = due.length ? due.map(s => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
      <div><div style="font-weight:600;font-size:13px">${esc(s.shopNum)} - ${esc(s.tenantName)}</div><div style="font-size:11px;color:var(--muted)">Paid: ${fmt(s.paid)}</div></div>
      <button class="btn btn-success btn-sm" onclick="collectRent('${s.id}',${s.due})">Collect ${fmt(s.due)}</button>
    </div>`).join('') :
    '<div class="empty-state" style="padding:24px"><div class="es-icon">✅</div><p>All rent collected for this month</p></div>';

  // Recent roz
  const recent = [...roz].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 5);
  document.getElementById('dash-txn').innerHTML = recent.length ? recent.map(r => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
      <div><div style="font-weight:600;font-size:13px">${esc(r.party)}</div><div style="font-size:11px;color:var(--muted)">${esc(r.date)} · ${esc(r.desc)}</div></div>
      <span class="badge ${r.type==='Credit'?'badge-green':'badge-orange'}">${r.type==='Credit'?'Cr':'Dr'} ${fmt(r.amount)}</span>
    </div>`).join('') :
    '<div class="empty-state" style="padding:24px"><div class="es-icon">📒</div><p>No transactions yet</p></div>';
}

function collectRent(shopId, amount, month) {
  openRentModal();
  document.getElementById('f-rent-shop').value = shopId;
  document.getElementById('f-rent-amount').value = amount;
  if (month) fillMonthSelect(document.getElementById('f-rent-month'), month);
  updateRentInfo();
}

// ===================== SHOPS =====================
function renderShops() {
  if (!requireBiz()) return;
  const mode = shopSortMode();
  document.getElementById('shop-sort').value = mode;
  const q = (document.getElementById('shop-search').value||'').trim().toLowerCase();
  const sf = document.getElementById('shop-filter-status').value;
  let shops = getShops().filter(s => {
    const match = !q || [s.shopNum, s.shopName, s.tenantName, s.tenantPhone].join(' ').toLowerCase().includes(q);
    return match && (!sf || s.status === sf);
  });
  // When searching, shops whose NUMBER matches come first (exact, then starts-with, then contains).
  if (q) {
    const rank = s => { const n = String(s.shopNum || '').toLowerCase(); return n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3; };
    shops.sort((x, y) => rank(x) - rank(y));
  }
  const movable = mode === 'custom' && !q && !sf;
  const tbody = document.getElementById('shops-tbody');
  if (!shops.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="es-icon">🏪</div><p>${q ? 'No shop matches “' + esc(q) + '”.' : 'No shops yet. Tap “+ Add Shop / Tenant” to add your first one.'}</p></div></td></tr>`;
    return;
  }
  const hint = mode === 'custom' && !movable ? '<tr class="hint-row"><td colspan="9">Clear the search and the status filter to rearrange shops.</td></tr>' : '';
  tbody.innerHTML = hint + shops.map((s, i) => `<tr ${movable ? `draggable="true" data-id="${s.id}" class="draggable"` : ''}>
      <td><strong>${movable ? '<span class="grip" title="Drag to move">☰</span> ' : ''}${esc(s.shopNum)}</strong></td>
      <td>${esc(s.shopName||'—')}</td>
      <td><a href="#" onclick="openTenantDetail('${s.id}');return false" style="color:var(--primary);font-weight:600">${esc(s.tenantName)}</a></td>
      <td>${esc(s.tenantPhone||'—')}</td>
      <td>${fmt(s.monthlyRent)}</td>
      <td>${fmt(s.depositPaid)} / ${fmt(s.depositTotal)}</td>
      <td>${esc(s.startDate||'—')}</td>
      <td><span class="badge ${s.status==='active'?'badge-green':'badge-gray'}">${esc(s.status)}</span></td>
      <td style="white-space:nowrap">
        ${movable ? `<button class="btn btn-ghost btn-sm" onclick="moveShop('${s.id}',-1)" ${i === 0 ? 'disabled' : ''} title="Move up">▲</button>
        <button class="btn btn-ghost btn-sm" onclick="moveShop('${s.id}',1)" ${i === shops.length - 1 ? 'disabled' : ''} title="Move down">▼</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="openShopModal('${s.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteShop('${s.id}')">Delete</button>
      </td>
    </tr>`).join('');
  if (movable) wireShopDrag(tbody);
}

// Save the current visible order (10, 20, 30…) so it syncs to every device.
async function saveShopOrder(list) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].order !== (i + 1) * 10) await Store.put('shops', { ...list[i], order: (i + 1) * 10 });
  }
}

async function moveShop(id, dir) {
  const list = getShops();
  const i = list.findIndex(s => s.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await saveShopOrder(list);
}

async function dropShop(dragId, targetId) {
  if (dragId === targetId) return;
  const list = getShops();
  const from = list.findIndex(s => s.id === dragId), to = list.findIndex(s => s.id === targetId);
  if (from < 0 || to < 0) return;
  list.splice(to, 0, list.splice(from, 1)[0]);
  await saveShopOrder(list);
}

function wireShopDrag(tbody) {
  let dragId = null;
  tbody.querySelectorAll('tr.draggable').forEach(tr => {
    tr.addEventListener('dragstart', e => { dragId = tr.dataset.id; e.dataTransfer.effectAllowed = 'move'; tr.classList.add('dragging'); });
    tr.addEventListener('dragend', () => tr.classList.remove('dragging'));
    tr.addEventListener('dragover', e => { e.preventDefault(); tr.classList.add('drop-target'); });
    tr.addEventListener('dragleave', () => tr.classList.remove('drop-target'));
    tr.addEventListener('drop', e => { e.preventDefault(); tr.classList.remove('drop-target'); dropShop(dragId, tr.dataset.id); });
  });
}

function openShopModal(id) {
  const s = id ? db.shops.find(x => x.id === id) : null;
  document.getElementById('shop-modal-title').textContent = s ? 'Edit Shop / Tenant' : 'Add Shop / Tenant';
  document.getElementById('f-shop-id').value = id || '';
  document.getElementById('f-shop-num').value = s?.shopNum || '';
  document.getElementById('f-shop-name').value = s?.shopName || '';
  document.getElementById('f-tenant-name').value = s?.tenantName || '';
  document.getElementById('f-tenant-phone').value = s?.tenantPhone || '';
  document.getElementById('f-monthly-rent').value = s?.monthlyRent || '';
  document.getElementById('f-start-date').value = s?.startDate || '';
  document.getElementById('f-deposit-total').value = s?.depositTotal || '';
  document.getElementById('f-deposit-paid').value = s?.depositPaid || '';
  document.getElementById('f-deposit-date').value = s?.depositDate || '';
  document.getElementById('f-status').value = s?.status || 'active';
  document.getElementById('f-prorate').checked = s?.prorate !== false;
  document.getElementById('f-notes').value = s?.notes || '';
  openModal('modal-shop');
}

async function saveShop() {
  const id = document.getElementById('f-shop-id').value;
  const shopNum = document.getElementById('f-shop-num').value.trim();
  const tenantName = document.getElementById('f-tenant-name').value.trim();
  if (!shopNum) return notify('Shop number required', 'error');
  if (!tenantName) return notify('Tenant name required', 'error');

  const data = {
    bizId: db.activeBizId,
    shopNum, tenantName,
    shopName: document.getElementById('f-shop-name').value.trim(),
    tenantPhone: document.getElementById('f-tenant-phone').value.trim(),
    monthlyRent: Number(document.getElementById('f-monthly-rent').value)||0,
    startDate: document.getElementById('f-start-date').value,
    depositTotal: Number(document.getElementById('f-deposit-total').value)||0,
    depositPaid: Number(document.getElementById('f-deposit-paid').value)||0,
    depositDate: document.getElementById('f-deposit-date').value,
    status: document.getElementById('f-status').value,
    notes: document.getElementById('f-notes').value.trim(),
    prorate: document.getElementById('f-prorate').checked
  };

  if (id) {
    const existing = db.shops.find(s => s.id === id);
    await Store.put('shops', { ...existing, ...data, id });
  } else {
    await Store.put('shops', { id: Store.uid(), depositWithheld: 0, depositNotes: '', ...data });
  }
  closeModal('modal-shop');
  renderShops();
  populateRentShopSelect();
  notify('Shop saved', 'success');
}

async function deleteShop(id) {
  if (!confirm('Delete this shop and all related rent records?')) return;
  for (const r of db.rentPayments.filter(r => r.shopId === id)) await Store.remove('rentPayments', r.id);
  await Store.remove('shops', id);
  renderShops();
  notify('Shop deleted', 'success');
}

// ===================== DEPOSITS =====================
function renderDeposits() {
  if (!requireBiz()) return;
  const shops = getShops();
  const tbody = document.getElementById('deposits-tbody');
  if (!shops.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="es-icon">💰</div><p>No shops added yet</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = shops.map(s => {
    const balance = (Number(s.depositPaid)||0) - (Number(s.depositWithheld)||0);
    const balBadge = balance > 0 ? 'badge-green' : balance < 0 ? 'badge-red' : 'badge-gray';
    return `<tr>
      <td><strong>${esc(s.shopNum)}</strong></td>
      <td>${esc(s.tenantName)}</td>
      <td>${fmt(s.depositTotal)}</td>
      <td>${fmt(s.depositPaid)}</td>
      <td>${fmt(s.depositWithheld||0)}</td>
      <td><span class="badge ${balBadge}">${fmt(balance)}</span></td>
      <td style="font-size:12px;color:var(--muted);max-width:180px">${esc(s.depositNotes||'—')}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="openDepositModal('${s.id}')">Edit</button></td>
    </tr>`;
  }).join('');
}

function openDepositModal(shopId) {
  const s = db.shops.find(x => x.id === shopId);
  if (!s) return;
  document.getElementById('fd-shop-id').value = shopId;
  document.getElementById('fd-total').value = s.depositTotal || 0;
  document.getElementById('fd-received').value = s.depositPaid || 0;
  document.getElementById('fd-withheld').value = s.depositWithheld || 0;
  document.getElementById('fd-notes').value = s.depositNotes || '';
  openModal('modal-deposit');
}

async function saveDeposit() {
  const id = document.getElementById('fd-shop-id').value;
  const shop = db.shops.find(s => s.id === id);
  if (!shop) return;
  await Store.put('shops', {
    ...shop,
    depositTotal: Number(document.getElementById('fd-total').value)||0,
    depositPaid: Number(document.getElementById('fd-received').value)||0,
    depositWithheld: Number(document.getElementById('fd-withheld').value)||0,
    depositNotes: document.getElementById('fd-notes').value.trim()
  });
  closeModal('modal-deposit');
  renderDeposits();
  notify('Deposit updated', 'success');
}

// ===================== RENT =====================
// Simple month dropdown ("October 2026"), from 2 years back to 3 months ahead.
function fillMonthSelect(sel, selected, allLabel) {
  const keep = selected ?? sel.value;
  const now = new Date();
  const opts = [];
  for (let i = 3; i >= -24; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    opts.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }
  if (keep && !opts.includes(keep)) opts.push(keep);        // old records outside the range
  const label = m => new Date(m + '-01T00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  sel.innerHTML = (allLabel ? `<option value="">${allLabel}</option>` : '') +
    opts.sort().reverse().map(m => `<option value="${m}">${label(m)}${m === today().slice(0, 7) ? ' (this month)' : ''}</option>`).join('');
  sel.value = keep || (allLabel ? '' : today().slice(0, 7));
}

function populateRentShopSelect() {
  fillMonthSelect(document.getElementById('rent-filter-month'), null, 'All months');
  fillMonthSelect(document.getElementById('f-rent-month'), null);
  const shops = getShops();
  const sel = document.getElementById('f-rent-shop');
  sel.innerHTML = shops.map(s => `<option value="${s.id}">${esc(s.shopNum)} - ${esc(s.tenantName)}</option>`).join('');

  const fsel = document.getElementById('rent-filter-shop');
  fsel.innerHTML = '<option value="">All Shops</option>' +
    shops.map(s => `<option value="${s.id}">${esc(s.shopNum)} - ${esc(s.tenantName)}</option>`).join('');
}

// Rent paid so far for a shop+month (optionally ignoring one payment being edited).
function paidFor(shopId, month, exceptId) {
  return getRent().filter(r => r.shopId === shopId && r.forMonth === month && r.id !== exceptId)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
}

function renderRentStatus(month) {
  const el = document.getElementById('rent-status');
  document.getElementById('rent-status-month').textContent = new Date(month + '-01T00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const shops = getShops().filter(s => s.status === 'active' && rentInfo(s, month).type !== 'notstarted');
  if (!shops.length) { el.innerHTML = '<div class="card empty-state"><p>No tenants renting in this month.</p></div>'; return; }
  el.innerHTML = shops.map(s => {
    const info = rentInfo(s, month);
    const rent = info.due;
    const pays = getRent().filter(r => r.shopId === s.id && r.forMonth === month).sort((x, y) => x.date.localeCompare(y.date));
    const paid = pays.reduce((t, r) => t + (Number(r.amount) || 0), 0);
    const left = Math.max(rent - paid, 0);
    const pct = rent ? Math.min(100, Math.round(paid / rent * 100)) : 0;
    const state = paid >= rent && rent > 0 ? ['Fully paid', 'badge-green', 'green'] : paid > 0 ? ['Part paid', 'badge-orange', ''] : ['Not paid', 'badge-red', 'red'];
    return `<div class="card rent-card">
      <div class="rc-head"><div><strong>${esc(s.shopNum)}</strong> · ${esc(s.tenantName)}</div><span class="badge ${state[1]}">${state[0]}</span></div>
      <div class="rc-nums"><div><small>Rent${rentNote(info) ? ' (' + rentNote(info) + ')' : ''}</small><b>${fmt(rent)}</b></div><div><small>Paid</small><b style="color:var(--success)">${fmt(paid)}</b></div><div><small>Still to pay</small><b style="color:${left ? 'var(--danger)' : 'var(--success)'}">${fmt(left)}</b></div></div>
      <div class="progress-wrap"><div class="progress-fill ${state[2]}" style="width:${pct}%"></div></div>
      ${pays.length ? `<ol class="rc-stages">${pays.map((r, i) => `<li>Payment ${i + 1}: <b>${fmt(r.amount)}</b> on ${esc(r.date)} <span class="muted">(${esc(r.mode)})</span></li>`).join('')}</ol>` : ''}
      ${left ? `<button class="btn btn-success btn-sm" onclick="collectRent('${s.id}',${left},'${month}')">+ Add a payment${pays.length ? ' (next stage)' : ''}</button>` : ''}
      <button class="btn btn-ghost btn-sm" onclick="openRentAdjust('${s.id}','${month}')">✏️ Change rent for this month</button>
    </div>`;
  }).join('');
}

function openRentAdjust(shopId, month) {
  const s = db.shops.find(x => x.id === shopId);
  if (!s) return;
  const info = rentInfo(s, month);
  const auto = rentInfo({ ...s, rentAdjust: {} }, month);
  document.getElementById('adj-shop').value = shopId;
  document.getElementById('adj-month').value = month;
  document.getElementById('adj-title').textContent = `${s.shopNum} · ${new Date(month + '-01T00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`;
  document.getElementById('adj-info').innerHTML = `Full monthly rent: <b>${fmt(auto.full)}</b><br>Automatic amount for this month: <b>${fmt(auto.due)}</b>${rentNote(auto) ? ` <span class="muted">(${rentNote(auto)})</span>` : ''}`;
  document.getElementById('adj-amount').value = info.due;
  openModal('modal-adjust');
}

async function saveRentAdjust() {
  const s = db.shops.find(x => x.id === document.getElementById('adj-shop').value);
  const month = document.getElementById('adj-month').value;
  const raw = document.getElementById('adj-amount').value;
  if (!s || raw === '' || Number(raw) < 0) return notify('Enter the rent amount for this month', 'error');
  await Store.put('shops', { ...s, rentAdjust: { ...(s.rentAdjust || {}), [month]: Number(raw) } });
  closeModal('modal-adjust'); renderRent(); notify('Rent changed for this month only', 'success');
}

async function clearRentAdjust() {
  const s = db.shops.find(x => x.id === document.getElementById('adj-shop').value);
  const month = document.getElementById('adj-month').value;
  if (!s) return;
  const adj = { ...(s.rentAdjust || {}) }; delete adj[month];
  await Store.put('shops', { ...s, rentAdjust: adj });
  closeModal('modal-adjust'); renderRent(); notify('Back to the automatic amount', 'success');
}

function updateRentInfo() {
  const el = document.getElementById('rent-info');
  const shop = db.shops.find(s => s.id === document.getElementById('f-rent-shop').value);
  const month = document.getElementById('f-rent-month').value;
  if (!shop || !month) { el.innerHTML = ''; return; }
  const info = rentInfo(shop, month);
  const rent = info.due;
  const already = paidFor(shop.id, month, document.getElementById('f-rent-id').value);
  const now = Number(document.getElementById('f-rent-amount').value) || 0;
  const after = rent - already - now;
  const amt = document.getElementById('f-rent-amount');
  amt.max = rent > 0 ? Math.max(rent - already, 0) : '';
  el.innerHTML = `Rent <b>${fmt(rent)}</b>${rentNote(info) ? ` <span class="muted">(${rentNote(info)})</span>` : ''} · already paid <b>${fmt(already)}</b> · after this payment: ` +
    (after > 0 ? `<b style="color:var(--danger)">${fmt(after)} still to pay</b>` : after === 0 ? '<b style="color:var(--success)">fully paid ✓</b>' : `<b style="color:var(--danger)">too much — only ${fmt(rent - already)} can be paid</b>`);
}

function renderRent() {
  if (!requireBiz()) return;
  populateRentShopSelect();
  renderRentStatus(document.getElementById('rent-filter-month').value || today().slice(0, 7));
  const shopF = document.getElementById('rent-filter-shop').value;
  const monthF = document.getElementById('rent-filter-month').value;
  let payments = getRent().filter(r => {
    return (!shopF || r.shopId === shopF) && (!monthF || r.forMonth === monthF);
  }).sort((a,b) => b.date.localeCompare(a.date));

  const tbody = document.getElementById('rent-tbody');
  if (!payments.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="es-icon">📋</div><p>No rent received yet. Tap “+ Receive Rent” when a tenant pays.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = payments.map(r => {
    const shop = db.shops.find(s => s.id === r.shopId);
    return `<tr>
      <td>${esc(r.date)}</td>
      <td>${esc(shop?.shopNum||'?')}</td>
      <td>${esc(shop?.tenantName||'?')}</td>
      <td>${esc(r.forMonth)}</td>
      <td><strong>${fmt(r.amount)}</strong></td>
      <td><span class="badge badge-blue">${esc(r.mode)}</span></td>
      <td style="font-size:12px;color:var(--muted)">${esc(r.notes||'—')}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="openRentModal('${r.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteRent('${r.id}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

function openRentModal(id) {
  populateRentShopSelect();
  const r = id ? db.rentPayments.find(x => x.id === id) : null;
  document.getElementById('f-rent-id').value = id || '';
  document.getElementById('f-rent-shop').value = r?.shopId || (getShops()[0]?.id || '');
  document.getElementById('f-rent-date').value = r?.date || today();
  fillMonthSelect(document.getElementById('f-rent-month'), r?.forMonth || today().slice(0,7));
  document.getElementById('f-rent-amount').value = r?.amount || '';
  document.getElementById('f-rent-mode').value = r?.mode || 'Cash';
  document.getElementById('f-rent-notes').value = r?.notes || '';
  updateRentInfo();
  openModal('modal-rent');
}

async function saveRent() {
  const id = document.getElementById('f-rent-id').value;
  const shopId = document.getElementById('f-rent-shop').value;
  const amount = Number(document.getElementById('f-rent-amount').value);
  if (!shopId) return notify('Select a shop', 'error');
  if (!amount) return notify('Enter amount', 'error');
  if (amount < 0) return notify('Amount cannot be negative', 'error');

  // Never collect more than the fixed monthly rent for that month.
  const shop = db.shops.find(s => s.id === shopId);
  const month = document.getElementById('f-rent-month').value;
  const rentDue = shop ? rentDueFor(shop, month) : 0;
  if (rentDue > 0) {
    const left = rentDue - paidFor(shopId, month, id);
    if (left <= 0) return notify(`Rent for this month is already fully paid (${fmt(rentDue)}).`, 'error');
    if (amount > left) return notify(`Too much. Only ${fmt(left)} is left to pay for this month.`, 'error');
  }

  const data = {
    bizId: db.activeBizId, shopId,
    date: document.getElementById('f-rent-date').value,
    forMonth: document.getElementById('f-rent-month').value,
    amount,
    mode: document.getElementById('f-rent-mode').value,
    notes: document.getElementById('f-rent-notes').value.trim()
  };

  if (id) {
    await Store.put('rentPayments', { ...db.rentPayments.find(r => r.id === id), ...data, id });
  } else {
    await Store.put('rentPayments', { id: Store.uid(), ...data });
  }
  closeModal('modal-rent');
  renderRent();
  notify('Rent payment saved', 'success');
}

async function deleteRent(id) {
  if (!confirm('Delete this payment record?')) return;
  await Store.remove('rentPayments', id);
  renderRent();
  notify('Payment deleted', 'success');
}

// ===================== ROZ NAMCHA =====================
function calcRozAmount() {
  const yards = Number(document.getElementById('fr-yards').value)||0;
  const rate = Number(document.getElementById('fr-rate').value)||0;
  if (yards && rate) document.getElementById('fr-amount').value = Math.round(yards * rate * 100) / 100;
}

function clearRozFilter() {
  document.getElementById('roz-search').value = '';
  document.getElementById('roz-from').value = '';
  document.getElementById('roz-to').value = '';
  renderRoznamcha();
}

function renderRoznamcha() {
  if (!requireBiz()) return;
  const q = (document.getElementById('roz-search').value||'').toLowerCase();
  const from = document.getElementById('roz-from').value;
  const to = document.getElementById('roz-to').value;

  let entries = getRoz().filter(r => {
    const matchQ = (r.party+r.desc+r.notes).toLowerCase().includes(q);
    const afterFrom = !from || r.date >= from;
    const beforeTo = !to || r.date <= to;
    return matchQ && afterFrom && beforeTo;
  }).sort((a,b) => b.date.localeCompare(a.date));

  const tbody = document.getElementById('roz-tbody');
  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state"><div class="es-icon">📒</div><p>Nothing written yet. Tap “+ Add Entry” to record money in or out.</p></div></td></tr>`;
    document.getElementById('roz-totals').innerHTML = '';
    return;
  }

  tbody.innerHTML = entries.map(r => `<tr>
    <td>${esc(r.date)}</td>
    <td>${esc(r.qty||'—')}</td>
    <td>${esc(r.particulars||'—')}</td>
    <td>${esc(r.yards||'—')}</td>
    <td><strong>${esc(r.party)}</strong></td>
    <td>${esc(r.desc||'—')}</td>
    <td>${r.rate ? fmt(r.rate) : '—'}</td>
    <td class="amt-dr">${r.type==='Debit' ? '<strong>'+fmt(r.amount)+'</strong>' : ''}</td>
    <td class="amt-cr">${r.type==='Credit' ? '<strong>'+fmt(r.amount)+'</strong>' : ''}</td>
    <td style="font-size:12px;color:var(--muted)">${esc(r.notes||'—')}</td>
    <td style="white-space:nowrap">
      <button class="btn btn-ghost btn-sm" onclick="openRozModal('${r.id}')">Edit</button>
      <button class="btn btn-danger btn-sm" onclick="deleteRoz('${r.id}')">Delete</button>
    </td>
  </tr>`).join('');

  const totalDebit = entries.filter(r => r.type==='Debit').reduce((t,r) => t+(Number(r.amount)||0), 0);
  const totalCredit = entries.filter(r => r.type==='Credit').reduce((t,r) => t+(Number(r.amount)||0), 0);
  const net = totalDebit - totalCredit;
  const box = (l, v, c) => `<div><div style="font-size:11px;color:var(--muted);font-weight:600">${l}</div><div style="font-size:20px;font-weight:700;color:${c}">${v}</div></div>`;
  document.getElementById('roz-totals').innerHTML = `<div style="display:flex;gap:24px;flex-wrap:wrap">
    ${box('TOTAL DEBIT (Dr)', fmt(totalDebit), 'var(--danger)')}
    ${box('TOTAL CREDIT (Cr)', fmt(totalCredit), 'var(--success)')}
    ${box(net >= 0 ? 'NET: PARTIES OWE YOU' : 'NET: YOU OWE PARTIES', fmt(Math.abs(net)), net >= 0 ? 'var(--primary)' : 'var(--warning)')}
    ${box('ENTRIES', entries.length, 'var(--text)')}
  </div>`;
}

function openRozModal(id) {
  const r = id ? db.roznamcha.find(x => x.id === id) : null;
  document.getElementById('roz-modal-title').textContent = r ? 'Edit Entry' : 'Add Roz Namcha Entry';
  document.getElementById('fr-id').value = id || '';
  document.getElementById('fr-date').value = r?.date || today();
  document.getElementById('fr-particulars').value = r?.particulars || '';
  document.getElementById('fr-yards').value = r?.yards || '';
  document.getElementById('fr-party').value = r?.party || '';
  document.getElementById('fr-desc').value = r?.desc || '';
  document.getElementById('fr-qty').value = r?.qty || '';
  document.getElementById('fr-rate').value = r?.rate || '';
  document.getElementById('fr-amount').value = r?.amount || '';
  document.getElementById('fr-type').value = r?.type || 'Debit';
  document.getElementById('fr-notes').value = r?.notes || '';
  document.getElementById('party-list').innerHTML = partyBalances().map(p => `<option value="${esc(p.name)}">`).join('');
  openModal('modal-roz');
}

async function saveRoz() {
  const id = document.getElementById('fr-id').value;
  const party = document.getElementById('fr-party').value.trim();
  const amount = Number(document.getElementById('fr-amount').value);
  if (!party) return notify('Party name required', 'error');
  if (!amount) return notify('Amount required', 'error');

  const data = {
    bizId: db.activeBizId,
    date: document.getElementById('fr-date').value,
    party,
    desc: document.getElementById('fr-desc').value.trim(),
    qty: document.getElementById('fr-qty').value,
    particulars: document.getElementById('fr-particulars').value.trim(),
    yards: document.getElementById('fr-yards').value,
    rate: document.getElementById('fr-rate').value,
    amount,
    type: document.getElementById('fr-type').value,
    notes: document.getElementById('fr-notes').value.trim()
  };

  if (id) {
    await Store.put('roznamcha', { ...db.roznamcha.find(r => r.id === id), ...data, id });
  } else {
    await Store.put('roznamcha', { id: Store.uid(), ...data });
  }
  closeModal('modal-roz');
  renderRoznamcha();
  notify('Entry saved', 'success');
}

async function deleteRoz(id) {
  if (!confirm('Delete this entry?')) return;
  await Store.remove('roznamcha', id);
  renderRoznamcha();
  notify('Entry deleted', 'success');
}

// ===================== PARTY ACCOUNTS =====================
// Balance = Debit - Credit. Positive: the party owes you. Negative: you owe the party.
function partyBalances() {
  const map = new Map();
  for (const r of getRoz()) {
    const name = String(r.party || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, { key, name, debit: 0, credit: 0, entries: [] });
    const p = map.get(key);
    const amt = Number(r.amount) || 0;
    if (r.type === 'Credit') p.credit += amt; else p.debit += amt;
    p.entries.push(r);
  }
  return [...map.values()].map(p => ({ ...p, balance: p.debit - p.credit })).sort((a, b) => a.name.localeCompare(b.name));
}

function partyTotals() {
  const ps = partyBalances();
  return {
    receive: ps.filter(p => p.balance > 0).reduce((t, p) => t + p.balance, 0),
    pay: ps.filter(p => p.balance < 0).reduce((t, p) => t - p.balance, 0)
  };
}

function partyStatus(b) {
  return b > 0 ? ['Owes you', 'badge-orange'] : b < 0 ? ['You owe', 'badge-red'] : ['Settled', 'badge-green'];
}

function renderParties() {
  if (!requireBiz()) return;
  const q = (document.getElementById('party-search').value || '').toLowerCase();
  const f = document.getElementById('party-filter').value;
  const all = partyBalances();
  const t = partyTotals();
  document.getElementById('party-stats').innerHTML = `
    <div class="stat-card blue"><div class="label">Parties</div><div class="value">${all.length}</div></div>
    <div class="stat-card green"><div class="label">Total To Receive</div><div class="value">${fmt(t.receive)}</div></div>
    <div class="stat-card orange"><div class="label">Total To Pay</div><div class="value">${fmt(t.pay)}</div></div>`;
  const list = all.filter(p => p.name.toLowerCase().includes(q) &&
    (!f || (f === 'receive' && p.balance > 0) || (f === 'pay' && p.balance < 0) || (f === 'settled' && p.balance === 0)));
  const tbody = document.getElementById('parties-tbody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="es-icon">👥</div><p>No parties yet. Parties appear here automatically when you add entries in the Daily Book.</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = list.map(p => {
    const [label, badge] = partyStatus(p.balance);
    return `<tr>
      <td><a href="#" onclick="openParty('${pk(p.key)}');return false" style="color:var(--primary);font-weight:600">${esc(p.name)}</a></td>
      <td class="amt-dr">${fmt(p.debit)}</td>
      <td class="amt-cr">${fmt(p.credit)}</td>
      <td><strong>${fmt(Math.abs(p.balance))}</strong></td>
      <td><span class="badge ${badge}">${label}</span></td>
      <td><button class="btn btn-ghost btn-sm" onclick="openParty('${pk(p.key)}')">View statement</button></td>
    </tr>`;
  }).join('');
}

const pk = k => encodeURIComponent(k).replace(/'/g, '%27');

function addEntryForParty(k) {
  closeModal('modal-party');
  openRozModal();
  document.getElementById('fr-party').value = (partyBalances().find(x => x.key === decodeURIComponent(k)) || {}).name || '';
}

function openParty(k) {
  const key = decodeURIComponent(k);
  const p = partyBalances().find(x => x.key === key);
  if (!p) return;
  let run = 0;
  const rows = [...p.entries].sort((a, b) => a.date.localeCompare(b.date)).map(r => {
    run += (r.type === 'Credit' ? -1 : 1) * (Number(r.amount) || 0);
    return { r, run };
  });
  const [label, badge] = partyStatus(p.balance);
  const sentence = p.balance > 0 ? `${esc(p.name)} owes you <b>${fmt(p.balance)}</b>` : p.balance < 0 ? `You need to pay ${esc(p.name)} <b>${fmt(-p.balance)}</b>` : 'All settled — nothing owed either way';
  document.getElementById('party-title').textContent = p.name;
  document.getElementById('party-body').innerHTML = `
    <div class="rent-info" style="font-size:15px">${sentence} <span class="badge ${badge}" style="margin-left:6px">${label}</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Particulars</th><th>Yards</th><th>Rate</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
      <tbody>${rows.map(({ r, run }) => `<tr>
        <td>${esc(r.date)}</td><td>${esc(r.particulars || r.desc || '—')}</td><td>${esc(r.yards || '—')}</td><td>${r.rate ? fmt(r.rate) : '—'}</td>
        <td class="amt-dr">${r.type === 'Debit' ? fmt(r.amount) : ''}</td>
        <td class="amt-cr">${r.type === 'Credit' ? fmt(r.amount) : ''}</td>
        <td><strong>${fmt(Math.abs(run))}</strong> <small class="muted">${run > 0 ? 'Dr' : run < 0 ? 'Cr' : ''}</small></td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4"><b>Total</b></td><td class="amt-dr"><b>${fmt(p.debit)}</b></td><td class="amt-cr"><b>${fmt(p.credit)}</b></td><td><b>${fmt(Math.abs(p.balance))}</b></td></tr></tfoot>
    </table></div>
    <div class="modal-footer"><button class="btn btn-primary" onclick="addEntryForParty('${pk(p.key)}')">+ Add entry for this party</button></div>`;
  openModal('modal-party');
}

// ===================== TENANT DETAIL =====================
function openTenantDetail(shopId) {
  const s = db.shops.find(x => x.id === shopId);
  if (!s) return;
  const payments = db.rentPayments.filter(r => r.shopId === shopId).sort((a,b) => b.date.localeCompare(a.date));
  const totalPaid = payments.reduce((x,r) => x+(Number(r.amount)||0), 0);
  const balance = (Number(s.depositPaid)||0) - (Number(s.depositWithheld)||0);

  document.getElementById('td-title').textContent = `${s.shopNum} — ${s.tenantName}`;
  document.getElementById('td-body').innerHTML = `
    <div class="detail-grid" style="margin-bottom:20px">
      <div class="detail-item"><div class="dk">Shop Number</div><div class="dv">${esc(s.shopNum)}</div></div>
      <div class="detail-item"><div class="dk">Shop Name</div><div class="dv">${esc(s.shopName||'—')}</div></div>
      <div class="detail-item"><div class="dk">Tenant</div><div class="dv">${esc(s.tenantName)}</div></div>
      <div class="detail-item"><div class="dk">Phone</div><div class="dv">${esc(s.tenantPhone||'—')}</div></div>
      <div class="detail-item"><div class="dk">Monthly Rent</div><div class="dv">${fmt(s.monthlyRent)}</div></div>
      <div class="detail-item"><div class="dk">Start Date</div><div class="dv">${esc(s.startDate||'—')}</div></div>
      <div class="detail-item"><div class="dk">Deposit (agreed)</div><div class="dv">${fmt(s.depositTotal)}</div></div>
      <div class="detail-item"><div class="dk">Deposit Received</div><div class="dv">${fmt(s.depositPaid)}</div></div>
      <div class="detail-item"><div class="dk">Deposit Withheld</div><div class="dv">${fmt(s.depositWithheld||0)}</div></div>
      <div class="detail-item"><div class="dk">Deposit Balance</div><div class="dv" style="color:${balance>=0?'var(--success)':'var(--danger)'}">${fmt(balance)}</div></div>
      <div class="detail-item"><div class="dk">Status</div><div class="dv"><span class="badge ${s.status==='active'?'badge-green':'badge-gray'}">${esc(s.status)}</span></div></div>
      <div class="detail-item"><div class="dk">Total Rent Collected</div><div class="dv" style="color:var(--success)">${fmt(totalPaid)}</div></div>
    </div>
    ${s.notes ? `<div style="background:var(--bg);border-radius:8px;padding:12px;font-size:13px;margin-bottom:20px;color:var(--muted)"><strong>Notes:</strong> ${esc(s.notes)}</div>` : ''}
    <div style="font-weight:700;font-size:14px;margin-bottom:12px">Rent Payment History (${payments.length})</div>
    ${payments.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>For Month</th><th>Amount</th><th>Mode</th><th>Notes</th></tr></thead>
      <tbody>${payments.map(r => `<tr>
        <td>${esc(r.date)}</td><td>${esc(r.forMonth)}</td>
        <td><strong>${fmt(r.amount)}</strong></td>
        <td><span class="badge badge-blue">${esc(r.mode)}</span></td>
        <td style="font-size:12px;color:var(--muted)">${esc(r.notes||'—')}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<p style="color:var(--muted);font-size:13px">No payments recorded.</p>'}
  `;
  openModal('modal-tenant-detail');
}

// ===================== OFFLINE & DATA SAFETY =====================
const DAY = 86400000;
async function lastBackupAt() { return (await Store.getMeta('lastBackup')) || 0; }

async function renderBackupWarning() {
  const el = document.getElementById('backup-warning');
  if (!el) return;
  const hasData = db.shops.length || db.roznamcha.length || db.rentPayments.length;
  const last = await lastBackupAt();
  const days = last ? Math.floor((Date.now() - last) / DAY) : null;
  el.innerHTML = hasData && (days === null || days >= 7)
    ? `<div class="warn-banner">🛡️ ${days === null ? 'You have not saved a backup yet.' : `Your last backup was ${days} days ago.`}
         Save one now so your records are safe. <button class="btn btn-warning btn-sm" onclick="exportJSON()">Save Backup</button></div>`
    : '';
}

async function renderAccount() {
  document.getElementById('account-card').hidden = !Auth.isOn();
  if (!Auth.isOn()) return;
  const user = await Auth.user();
  document.getElementById('account-card').innerHTML = `<div class="card-title">🔐 Admin account</div>
    <p class="muted" style="margin-bottom:12px;font-size:14px">Signed in as <b>${esc(user || 'admin')}</b> on this device.</p>
    <button class="btn btn-ghost" onclick="Auth.logout()">Sign out of this device</button>`;
}

async function renderOfflineStatus() {
  const el = document.getElementById('offline-status');
  const ready = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller && await caches.has('bizmanager-shell-v4');
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  let usage = '';
  try { const e = await navigator.storage.estimate(); usage = ` (${(e.usage / 1048576).toFixed(1)} MB used)`; } catch (e) {}
  const last = await lastBackupAt();
  const row = (ok, title, text) => `<div class="status-row"><span class="status-dot ${ok ? 'good' : 'bad'}"></span><div><b>${title}</b><div class="muted">${text}</div></div></div>`;
  el.innerHTML = `<div class="card-title">📶 Works without internet?</div>` +
    row(ready, ready ? 'Offline mode is ready' : 'Offline mode not ready yet',
        ready ? 'You can open this app any time with no internet and no server.' : 'Open the app once while connected (server running). After that it works offline. Use Chrome/Edge/Safari at http://localhost or an https address.') +
    row(persisted, persisted ? 'Data is protected from auto-deletion' : 'Data may be cleared if the device is low on space',
        'Your records are kept on this device' + usage + '. Installing the app (menu → Install) makes this more reliable.') +
    row(!!last, last ? 'Last backup: ' + new Date(last).toLocaleDateString('en-GB') : 'No backup saved yet',
        'A backup file is your safety net if the device is lost or the browser is cleared.');
}

// ===================== EXPORT =====================
function csvEscape(v) {
  v = String(v ?? '');
  if (v.includes(',') || v.includes('"') || v.includes('\n')) return '"' + v.replace(/"/g,'""') + '"';
  return v;
}

function buildCSV(headers, rows) {
  return [headers, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');
}

function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function exportShopsCSV() {
  const shops = getShops();
  const biz = getBiz();
  const csv = buildCSV(
    ['Business','Shop #','Shop Name','Tenant Name','Phone','Monthly Rent','Deposit Total','Deposit Received','Deposit Withheld','Deposit Balance','Start Date','Status','Notes'],
    shops.map(s => [
      biz?.name||'', s.shopNum, s.shopName, s.tenantName, s.tenantPhone,
      s.monthlyRent, s.depositTotal, s.depositPaid, s.depositWithheld||0,
      (Number(s.depositPaid)||0)-(Number(s.depositWithheld)||0),
      s.startDate, s.status, s.notes
    ])
  );
  downloadCSV(`shops_${today()}.csv`, csv);
  notify('Shops CSV downloaded', 'success');
}

function exportRentCSV() {
  const biz = getBiz();
  const payments = getRent().sort((a,b) => b.date.localeCompare(a.date));
  const csv = buildCSV(
    ['Business','Date','Shop #','Tenant','For Month','Amount','Payment Mode','Notes'],
    payments.map(r => {
      const s = db.shops.find(x => x.id === r.shopId);
      return [biz?.name||'', r.date, s?.shopNum||'', s?.tenantName||'', r.forMonth, r.amount, r.mode, r.notes];
    })
  );
  downloadCSV(`rent_${today()}.csv`, csv);
  notify('Rent CSV downloaded', 'success');
}

function exportRozCSV() {
  const biz = getBiz();
  const entries = getRoz().sort((a,b) => b.date.localeCompare(a.date));
  const csv = buildCSV(
    ['Business','Date','Quantity','Particulars','Yards','Party Name','Description','Rate','Amount','Type','Notes'],
    entries.map(r => [biz?.name||'', r.date, r.qty, r.particulars, r.yards, r.party, r.desc, r.rate, r.amount, r.type, r.notes])
  );
  downloadCSV(`roznamcha_${today()}.csv`, csv);
  notify('Roz Namcha CSV downloaded', 'success');
}

function exportJSON() {
  const backup = { businesses: db.businesses, activeBizId: db.activeBizId, shops: db.shops, rentPayments: db.rentPayments, roznamcha: db.roznamcha };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bizmanager_backup_${today()}.json`;
  a.click();
  Store.setMeta('lastBackup', Date.now()).then(() => { renderBackupWarning(); if (currentSection === 'reports') renderOfflineStatus(); });
  notify('Backup downloaded', 'success');
}

function importJSON(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!imported.businesses) throw new Error('Invalid file');
      if (!confirm('This will REPLACE all current data. Are you sure?')) return;
      await Store.replaceAll(imported);
      renderBizDropdown();
      renderSection(currentSection);
      notify('Data restored successfully', 'success');
    } catch(err) {
      notify('Invalid backup file', 'error');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

// ===================== UTILITIES =====================
function today() {
  return new Date().toISOString().split('T')[0];
}

function fmt(n) {
  n = Number(n)||0;
  return 'Rs ' + n.toLocaleString('en-PK');
}

function requireBiz() {
  const has = !!db.activeBizId;
  document.getElementById('no-biz').hidden = has;
  const active = document.querySelector('.section.active');
  if (active) active.style.display = has ? '' : 'none';
  return has;
}

function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

function notify(msg, type = 'success') {
  const wrap = document.getElementById('notif');
  const el = document.createElement('div');
  el.className = `notif-item ${type}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// ===================== INIT =====================
(async function init() {
  await Store.init();
  await Auth.ensure();
  document.querySelector('.signout-link').hidden = !Auth.isOn();
  Store.onChange(() => {
    renderBizDropdown(); renderSection(currentSection); renderBackupWarning();
    if (db.businesses.length) closeModal('modal-biz');       // business arrived from the server
  });
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  renderBizDropdown();
  renderDashboard();
  Sync.start();
  renderBackupWarning();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => { if (currentSection === 'reports') renderOfflineStatus(); }).catch(() => {});
  }
  // First run only: ask for a business name — but wait a moment in case the server is about to send existing ones.
  if (!db.businesses.length) setTimeout(() => { if (!db.businesses.length) openAddBusiness(); }, 1500);
})();
