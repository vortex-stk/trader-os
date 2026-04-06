// ═══════════════════════════════════════
//  TRADER OS · app.js  v2
//  Orquestrador completo — todos os eventos
// ═══════════════════════════════════════

import {
  loadLocal, saveLocal,
  createAccount, seedDefaultAccount,
  getAccounts, getActiveId, setActiveId,
  getActiveAccount, saveTrade, deleteTrade,
  getTrades, getTradeByDate,
  getTradesByMonth, getTradesByYear,
  calcStats, exportCSV, parseCSVImport,
  getGoals, saveGoals, getProfile, saveProfile,
  getConfig, saveConfig, genId,
} from './db.js';

import {
  initSupabase, isCloudReady, getCurrentUser, isLoggedIn,
  login, register, logout, recoverSession, resetPassword,
  loadFromCloud, scheduleSyncToCloud, syncToCloud,
  uploadScreenshot, onSyncStateChange, SUPABASE_SETUP_SQL,
  getSupabaseConfig,
} from './cloud.js';

import { saveSupabaseConfig } from './config.js';
import { validateTrade, validateAccount, validateGoals, formatErrors } from './validation.js';
import { applyPropFirmPreset } from './propfirm.js';
import { MONTHS, PROP_FIRMS } from './config.js';

import { renderDashboard, initEquityFilters } from './ui/dashboard.js';
import { renderCalendar, initCalendarControls } from './ui/calendar.js';
import { renderJournal } from './ui/journal.js';
import { renderAnalytics, renderMetas, renderPropFirm } from './ui/analytics-metas-propfirm.js';
import {
  showToast, openModal, closeModal, setLoading, openLightbox,
  initSidebar, initNavigation, initTradeFormSelects,
  initScreenshotZone, renderColorPicker, renderEmotionGrid, fmt$,
} from './ui/components.js';
import { initOperationsModal, openOperationModal, openEditOperationModal, renderOperationsList } from './ui/operations.js';
import { initImportPage, renderImportPage as renderImportPageUI } from './ui/import.js';
import { renderPricing, renderPlanBadge } from './ui/pricing.js';
import { generateMonthlyReport } from './pdf-report.js';
import { analyzeTradingMonth, analyzePatterns, generateWeeklySummary } from './ai-analysis.js';
import { loadUserPlan, requirePlan, renderUpgradeModal, checkCheckoutResult, getCurrentPlan, PRICING_CSS } from './stripe/billing.js';

// ── Estado UI ─────────────────────────
let _page          = 'dashboard';
let _editingId     = null;
let _selEmotion    = '';
let _selColor      = '#00F5A0';
let _screenshotFile = null;
let _screenshotUrl  = null;
let _importData    = [];
let _activeBroker  = 'mt4';
let _currentDay    = null;

// ═══════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════
async function boot() {
  const hasCloud = initSupabase();
  onSyncStateChange(updateSyncBadge);
  if (hasCloud) {
    const user = await recoverSession();
    if (user) { await launchApp(true); return; }
  }
  showAuthScreen();
  initAuthEvents();
}

async function launchApp(cloud = false) {
  setLoading(true, 'Carregando seus dados...');
  try {
    if (cloud && isCloudReady()) {
      const ok = await loadFromCloud();
      if (!ok) { loadLocal(); await syncToCloud(); }
    } else {
      loadLocal();
    }
    if (!getAccounts().length) { seedDefaultAccount(); saveLocal(); }
    if (!getActiveId() || !getAccounts().find(a => a.id === getActiveId()))
      setActiveId(getAccounts()[0].id);

    hideAuthScreen();
    showApp();
    setLoading(false);
    initAllEvents();
    navigateTo('dashboard');
    renderHeader();
    startClock();

    // Carrega plano Stripe em background (nao bloqueia o boot)
    if (cloud && isLoggedIn()) {
      const sbClient = window.__sbClient;
      if (sbClient) {
        loadUserPlan(sbClient, getCurrentUser()?.id)
          .then(() => renderPlanBadge())
          .catch(() => {});
      }
    }
  } catch (e) {
    setLoading(false);
    showToast('Erro ao carregar: ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════
//  EVENTOS GLOBAIS
// ═══════════════════════════════════════
function initAllEvents() {
  initSidebar();
  initNavigation(navigateTo);
  initCalendarControls();
  initEquityFilters();
  initHeaderEvents();
  initTradeModalEvents();
  initAccountModalEvents();
  initDayDetailEvents();
  initImportEvents();
  initSettingsEvents();
  initPropFirmConfigEvents();
  initOperationsModal();
  initImportPage();
  initAIEvents();
  initPDFEvents();
  renderUpgradeModal();
  document.getElementById('btn-mob-add')?.addEventListener('click', () => openTradeModal());

  // Resultado de checkout Stripe ao voltar da página de pagamento
  const checkoutResult = checkCheckoutResult();
  if (checkoutResult?.success) {
    showToast(`🎉 Plano ativado com sucesso! Bem-vindo ao Pro.`, 'success');
    navigateTo('pricing');
  } else if (checkoutResult?.cancelled) {
    showToast('Pagamento cancelado. Continue no gratuito quando quiser.', 'info');
  }

  injectDynamicCSS();
}

// ── Injeta CSS dinâmico (Stripe, IA) ──
function injectDynamicCSS() {
  if (document.getElementById('tros-dynamic-css')) return;
  const style = document.createElement('style');
  style.id = 'tros-dynamic-css';
  style.textContent = PRICING_CSS + `
    .op-row {
      padding:12px 0; border-bottom:1px solid var(--border);
      display:flex; flex-direction:column; gap:6px;
    }
    .op-row:last-child { border-bottom:none; }
    .op-row-main { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
    .op-row-left  { display:flex; align-items:center; gap:6px; flex-wrap:wrap; flex:1; }
    .op-row-right { display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
    .op-btn-edit, .op-btn-del {
      background:none; border:1px solid var(--border); border-radius:6px;
      padding:3px 8px; font-size:12px; cursor:pointer; color:var(--text-3);
      transition:all 0.15s; font-family:var(--font-ui);
    }
    .op-btn-edit:hover { color:var(--blue);  border-color:var(--blue); }
    .op-btn-del:hover  { color:var(--red);   border-color:var(--red); }
    .op-actions { display:flex; gap:4px; }
    .ai-section { margin-top:14px; }
    .ai-btn-row { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
    .ai-loading { display:flex; align-items:center; gap:10px; padding:24px;
      background:var(--bg-card); border:1px solid var(--border); border-radius:var(--r-md); }
    .ai-loading-dot {
      width:8px; height:8px; border-radius:50%; background:var(--purple);
      animation:pulse 1s ease-in-out infinite;
    }
    .ai-result { background:var(--bg-card); border:1px solid var(--border); border-radius:var(--r-md); overflow:hidden; }
    .ai-result-header {
      display:flex; justify-content:space-between; align-items:center;
      padding:12px 18px; border-bottom:1px solid var(--border);
      background:rgba(124,92,252,0.06);
    }
    .ai-badge { font-size:11px; font-weight:700; letter-spacing:0.1em; color:var(--purple); text-transform:uppercase; }
    .ai-result-body { padding:18px; font-size:13px; color:var(--text-2); line-height:1.7; }
    .ai-result-body strong { color:var(--text-1); }
    #plan-badge {
      display:none; font-size:10px; font-weight:700; letter-spacing:0.08em;
      padding:3px 10px; border-radius:20px; text-transform:uppercase; margin-left:8px;
    }
  `;
  document.head.appendChild(style);
}

// ── Navegação ─────────────────────────
function navigateTo(page) {
  _page = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('[data-nav]').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');
  document.querySelectorAll(`[data-nav="${page}"]`).forEach(b => b.classList.add('active'));
  ({
    dashboard: renderDashboard,
    calendar:  renderCalendar,
    journal:   renderJournal,
    analytics: () => setTimeout(renderAnalytics, 50),
    metas:     renderMetas,
    propfirm:  renderPropFirm,
    pricing:   renderPricing,
    import:    renderImportPageUI,
    settings:  loadSettingsForm,
  })[page]?.();
}

// ── Header ────────────────────────────
function initHeaderEvents() {
  document.getElementById('btn-acct-trigger')?.addEventListener('click', e => {
    e.stopPropagation();
    const dd = document.getElementById('acct-dropdown');
    const open = !dd.hasAttribute('hidden');
    closeAllMenus();
    if (!open) { dd.removeAttribute('hidden'); renderAccountList(); }
  });
  document.getElementById('btn-user-menu')?.addEventListener('click', e => {
    e.stopPropagation();
    const m = document.getElementById('user-menu');
    const open = !m.hasAttribute('hidden');
    closeAllMenus();
    if (!open) {
      m.removeAttribute('hidden');
      const em = document.getElementById('user-email-display');
      if (em) em.textContent = getCurrentUser()?.email || 'Modo local';
    }
  });
  document.addEventListener('click', closeAllMenus);
  document.getElementById('btn-new-account')?.addEventListener('click', openAccountModal);
  document.getElementById('btn-logout')?.addEventListener('click', doLogout);
  document.getElementById('btn-new-trade')?.addEventListener('click', () => openTradeModal());
  document.getElementById('btn-journal-new')?.addEventListener('click', () => openTradeModal());
  document.getElementById('btn-export-csv')?.addEventListener('click', doExportCSV);
  document.getElementById('btn-journal-export')?.addEventListener('click', doExportCSV);
}

function closeAllMenus() {
  document.querySelectorAll('.acct-dropdown, .user-menu').forEach(el => el.setAttribute('hidden', ''));
}

function renderAccountList() {
  const list = document.getElementById('acct-list');
  if (!list) return;
  const activeId = getActiveId();
  list.innerHTML = getAccounts().map(a => {
    const pnl = (getTrades(a.id) || []).reduce((s, t) => s + t.pnl, 0);
    return `
      <div class="acct-item ${a.id===activeId?'active':''}" data-id="${a.id}">
        <span class="acct-dot" style="background:${a.color}"></span>
        <div style="flex:1;min-width:0">
          <div class="acct-item-name">${a.name}</div>
          <div class="acct-item-type">${a.type}</div>
        </div>
        <span class="acct-item-bal" style="color:${pnl>=0?'var(--green)':'var(--red)'}">
          ${pnl>=0?'+':''}R$${Math.abs(pnl).toFixed(0)}
        </span>
      </div>`;
  }).join('');
  list.querySelectorAll('[data-id]').forEach(el =>
    el.addEventListener('click', () => {
      setActiveId(el.dataset.id); persist();
      renderHeader(); navigateTo(_page); closeAllMenus();
    })
  );
}

function renderHeader() {
  const acct = getActiveAccount();
  const pnl  = getTrades().reduce((a, t) => a + t.pnl, 0);
  const bal  = (acct?.capital || 0) + pnl;
  const user = getCurrentUser();

  q('hdr-acct-name', acct?.name || 'Conta');
  q('hdr-balance',   fmt$(bal));
  const dot = document.getElementById('hdr-acct-dot');
  if (dot) dot.style.background = acct?.color || 'var(--green)';
  q('hdr-avatar', (user?.email || 'TR').slice(0, 2).toUpperCase());
  q('sac-name', acct?.name || 'Conta');
  q('sac-bal', fmt$(bal));
  const sc = document.getElementById('sac-change');
  if (sc) { sc.textContent = (pnl>=0?'▲ +':'▼ ') + fmt$(pnl, true); sc.style.color = pnl>=0?'var(--green)':'var(--red)'; }
  const goals = getGoals();
  const pct = goals.goalMonth > 0 ? Math.min(100, Math.max(0, pnl / goals.goalMonth * 100)) : 50;
  const fill = document.getElementById('sac-bar-fill');
  if (fill) fill.style.width = pct + '%';
}

// ═══════════════════════════════════════
//  MODAL DE TRADE
// ═══════════════════════════════════════
function initTradeModalEvents() {
  initTradeFormSelects();
  renderEmotionGrid('emotion-grid', '', v => { _selEmotion = v; });
  initScreenshotZone(f => { _screenshotFile = f; });
  document.getElementById('btn-save-trade')?.addEventListener('click', doSaveTrade);
  document.getElementById('tradeModal')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') doSaveTrade();
  });
}

function openTradeModal(date = null) {
  _editingId = null; _selEmotion = ''; _screenshotFile = null; _screenshotUrl = null;
  set('f-date',    date || new Date().toISOString().slice(0, 10));
  ['f-pnl','f-trades','f-setup','f-rr','f-notes'].forEach(id => set(id, ''));
  set('f-pair',''); set('f-session','');
  document.getElementById('screenshot-preview')?.setAttribute('hidden','');
  const lbl = document.getElementById('screenshot-label');
  if (lbl) lbl.textContent = '📸 Clique ou arraste a imagem';
  renderEmotionGrid('emotion-grid', '', v => { _selEmotion = v; });
  q('trade-modal-title', 'Registrar Trade');
  document.getElementById('trade-modal-error')?.setAttribute('hidden','');
  openModal('tradeModal');
}

function openEditModal(trade) {
  if (!trade) return;
  _editingId = trade.id; _selEmotion = trade.emotion||'';
  _screenshotFile = null; _screenshotUrl = trade.screenshot||null;
  set('f-date',    trade.date);
  set('f-pnl',     trade.pnl);
  set('f-trades',  trade.trades||'');
  set('f-pair',    trade.pair||'');
  set('f-session', trade.session||'');
  set('f-setup',   trade.setup||'');
  set('f-rr',      trade.rr ?? '');
  set('f-notes',   trade.notes||'');
  renderEmotionGrid('emotion-grid', _selEmotion, v => { _selEmotion = v; });
  const prev = document.getElementById('screenshot-preview');
  if (prev) { if (trade.screenshot) { prev.src = trade.screenshot; prev.removeAttribute('hidden'); } else prev.setAttribute('hidden',''); }
  q('trade-modal-title', 'Editar Trade');
  openModal('tradeModal');
}

async function doSaveTrade() {
  const errEl = document.getElementById('trade-modal-error');
  const data = {
    id:      _editingId || genId(),
    date:    get('f-date'),
    pnl:     get('f-pnl'),
    trades:  get('f-trades'),
    pair:    get('f-pair'),
    session: get('f-session'),
    setup:   get('f-setup'),
    rr:      get('f-rr'),
    emotion: _selEmotion,
    notes:   get('f-notes'),
  };
  const errs = validateTrade(data);
  if (errs.length) {
    if (errEl) { errEl.textContent = formatErrors(errs); errEl.removeAttribute('hidden'); }
    return;
  }
  if (errEl) errEl.setAttribute('hidden','');

  if (_screenshotFile && isLoggedIn()) {
    try {
      const r = await uploadScreenshot(_screenshotFile, data.date, getActiveId());
      data.screenshot = r.url; data.screenshotPath = r.path;
    } catch { showToast('Screenshot não enviado, mas trade salvo.','warning'); }
  } else {
    data.screenshot = _screenshotUrl;
  }

  saveTrade(data); persist();
  closeModal('tradeModal');
  showToast(_editingId ? 'Trade atualizado!' : 'Trade salvo! ✓','success');
  refreshPage();
  if (_currentDay === data.date) renderDayDetail(_currentDay);
}

function doDeleteTrade(id, date) {
  if (!confirm('Deletar este trade? Ação irreversível.')) return;
  deleteTrade(id); persist();
  showToast('Trade removido.','info');
  refreshPage();
  if (_currentDay) renderDayDetail(_currentDay);
}

// ═══════════════════════════════════════
//  DETALHE DO DIA
// ═══════════════════════════════════════
function initDayDetailEvents() {
  document.getElementById('btn-day-new-op')?.addEventListener('click', () => {
    closeModal('dayDetailModal');
    openTradeModal(_currentDay);
  });
}

function openDayDetail(dateStr) {
  _currentDay = dateStr;
  renderDayDetail(dateStr);
  openModal('dayDetailModal');
}

function renderDayDetail(dateStr) {
  const d    = new Date(dateStr + 'T12:00:00');
  const ops  = getTrades().filter(t => t.date === dateStr).sort((a, b) => a.id < b.id ? -1 : 1);
  const pnl  = ops.reduce((a, t) => a + t.pnl, 0);
  const wins = ops.filter(t => t.pnl > 0);
  const loss = ops.filter(t => t.pnl < 0);
  const wr   = ops.length ? Math.round(wins.length / ops.length * 100) : 0;
  const days = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  q('day-detail-title', `${days[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`);
  q('day-detail-subtitle', `${ops.length} operaç${ops.length===1?'ão':'ões'} registradas`);

  const sum = document.getElementById('day-detail-summary');
  if (sum) sum.innerHTML = [
    { v: fmt$(pnl, true), l: 'P&L Total', c: pnl>=0?'var(--green)':'var(--red)' },
    null,
    { v: ops.length,  l: 'Operações' },
    null,
    { v: wins.length, l: 'Positivas', c: 'var(--green)' },
    null,
    { v: loss.length, l: 'Negativas', c: 'var(--red)' },
    null,
    { v: wr + '%',    l: 'Win Rate',  c: wr>=50?'var(--green)':'var(--red)' },
  ].map(item => item === null ? '<div class="day-divider"></div>'
    : `<div class="day-sum-item"><div class="day-sum-val" style="color:${item.c||'var(--text-1)'}">${item.v}</div><div class="day-sum-lbl">${item.l}</div></div>`
  ).join('');

  const opsEl = document.getElementById('day-detail-ops');
  if (!opsEl) return;
  if (!ops.length) {
    opsEl.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text-3)">
      <div style="font-size:32px;margin-bottom:10px;opacity:0.3">📋</div>
      <p>Nenhuma operação neste dia.</p>
      <button class="btn-primary" style="margin-top:14px" id="btn-dd-add">+ Adicionar Trade</button></div>`;
    document.getElementById('btn-dd-add')?.addEventListener('click', () => {
      closeModal('dayDetailModal'); openTradeModal(dateStr);
    });
    return;
  }
  const emoMap = {calmo:'😌',confiante:'😎',ansioso:'😰',frustrado:'😤',ganancioso:'🤑',cansado:'😴',no_flow:'🔥',perdido:'😵'};
  opsEl.innerHTML = ops.map(t => {
    const rrStr = t.rr != null ? (t.rr>=0?'+':'') + t.rr.toFixed(1) + 'R' : null;
    const emo   = t.emotion ? (emoMap[t.emotion] || '') : '';
    return `<div class="day-op-card ${t.pnl>=0?'win':'loss'}">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-family:var(--font-mono);font-size:20px;font-weight:800;color:${t.pnl>=0?'var(--green)':'var(--red)'}">
          ${t.pnl>=0?'+':''}R$${Math.abs(t.pnl).toFixed(2)}</span>
        <div style="display:flex;gap:5px;flex-wrap:wrap;flex:1">
          ${t.pair    ? `<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:var(--blue-bg);color:var(--blue)">${t.pair}</span>`:'' }
          ${t.setup   ? `<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:var(--purple-bg);color:var(--purple)">${t.setup}</span>`:'' }
          ${t.session ? `<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:var(--green-bg);color:var(--green)">${t.session}</span>`:'' }
          ${rrStr     ? `<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:${t.rr>=0?'var(--green-bg)':'var(--red-bg)'};color:${t.rr>=0?'var(--green)':'var(--red)'}">${rrStr}</span>`:'' }
        </div>
        <div style="display:flex;gap:5px;margin-left:auto">
          <button class="btn-ghost btn-sm" data-edit="${t.id}">✏ Editar</button>
          <button class="btn-danger btn-sm" data-del="${t.id}" data-date="${t.date}">🗑</button>
        </div>
      </div>
      ${t.trades||emo ? `<div style="font-size:12px;color:var(--text-3);margin-top:6px">${t.trades?`📊 ${t.trades} trade${t.trades>1?'s':''} `:''} ${emo}</div>`:'' }
      ${t.notes  ? `<div style="font-size:12px;color:rgba(255,255,255,0.55);line-height:1.5;margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">${t.notes}</div>`:'' }
      ${t.screenshot ? `<img src="${t.screenshot}" style="width:100%;border-radius:6px;margin-top:8px;cursor:pointer;max-height:180px;object-fit:cover" data-lb="${t.screenshot}">`:'' }
    </div>`;
  }).join('');

  // Eventos dos botões dentro do detalhe
  opsEl.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = getTrades().find(x => x.id === btn.dataset.edit);
      closeModal('dayDetailModal'); openEditModal(t);
    });
  });
  opsEl.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => doDeleteTrade(btn.dataset.del, btn.dataset.date));
  });
  opsEl.querySelectorAll('[data-lb]').forEach(img => {
    img.addEventListener('click', () => openLightbox(img.dataset.lb));
  });
}

// ═══════════════════════════════════════
//  MODAL DE CONTA
// ═══════════════════════════════════════
function initAccountModalEvents() {
  renderColorPicker('color-picker', _selColor, c => { _selColor = c; });
  document.getElementById('btn-save-account')?.addEventListener('click', doSaveAccount);
}

function openAccountModal() {
  set('a-name',''); set('a-capital',''); set('a-type','prop');
  _selColor = '#00F5A0';
  renderColorPicker('color-picker', _selColor, c => { _selColor = c; });
  closeAllMenus();
  openModal('acctModal');
}

function doSaveAccount() {
  const data = { name: get('a-name'), type: get('a-type'), capital: get('a-capital'), color: _selColor };
  const errs = validateAccount(data);
  if (errs.length) { showToast(formatErrors(errs),'error'); return; }
  const acct = createAccount(data);
  setActiveId(acct.id); persist();
  closeModal('acctModal'); renderHeader(); navigateTo('dashboard');
  showToast(`Conta "${acct.name}" criada!`,'success');
}

// ═══════════════════════════════════════
//  IMPORTAÇÃO CSV
// ═══════════════════════════════════════
function initImportEvents() {
  document.getElementById('broker-grid')?.addEventListener('click', e => {
    const btn = e.target.closest('.broker-btn');
    if (!btn) return;
    document.querySelectorAll('.broker-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _activeBroker = btn.dataset.broker;
    updateImportHint(_activeBroker);
  });

  const dz  = document.getElementById('import-drop-zone');
  const inp = document.getElementById('import-file-input');
  if (dz && inp) {
    dz.addEventListener('click', () => inp.click());
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
    });
    inp.addEventListener('change', () => { if (inp.files[0]) processFile(inp.files[0]); });
  }
  document.getElementById('btn-import-confirm')?.addEventListener('click', doImport);
  document.getElementById('btn-import-cancel')?.addEventListener('click', cancelImport);
}

function updateImportHint(b) {
  const hints = {
    mt4:'Exporte o histórico do MetaTrader 4/5: Account History → Save as Report (CSV).',
    ctrader:'No cTrader: History → Export → CSV (Closed Positions).',
    ninjatrader:'No NinjaTrader: Account Performance → Export → CSV.',
    generic:'CSV com colunas: data, par, P&L. Primeira linha = cabeçalho.',
  };
  q('import-hint', hints[b] || hints.generic);
}

function processFile(file) {
  const r = new FileReader();
  r.onload = e => {
    try {
      const { results, errors } = parseCSVImport(e.target.result, _activeBroker);
      _importData = results;
      renderPreview(results, errors);
    } catch (err) { showToast('Erro ao ler arquivo: ' + err.message,'error'); }
  };
  r.readAsText(file, 'UTF-8');
}

function renderPreview(results, errors) {
  const card = document.getElementById('import-preview-card');
  const table = document.getElementById('import-preview-table');
  const count = document.getElementById('import-count');
  if (!card || !table) return;
  if (count) count.textContent = `${results.length} trades encontrados${errors.length?`, ${errors.length} ignorados`:''}`;
  if (!results.length) {
    table.innerHTML = '<p style="color:var(--red);padding:20px;text-align:center">Nenhum trade encontrado. Verifique o formato e a plataforma selecionada.</p>';
    card.removeAttribute('hidden'); return;
  }
  table.innerHTML = `<div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:rgba(0,0,0,0.3);font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-3)">
        <th style="padding:9px 12px;text-align:left">Data</th>
        <th style="padding:9px 12px;text-align:left">Par</th>
        <th style="padding:9px 12px;text-align:right">P&L</th>
        <th style="padding:9px 12px;text-align:left">Setup/Comentário</th>
      </tr></thead>
      <tbody>
        ${results.slice(0,20).map(t=>`<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:9px 12px;color:var(--text-2);font-family:var(--font-mono)">${t.date}</td>
          <td style="padding:9px 12px">${t.pair||'—'}</td>
          <td style="padding:9px 12px;text-align:right;font-family:var(--font-mono);color:${t.pnl>=0?'var(--green)':'var(--red)'}">
            ${t.pnl>=0?'+':''}R$${Math.abs(t.pnl).toFixed(2)}</td>
          <td style="padding:9px 12px;color:var(--text-3)">${t.setup||'—'}</td>
        </tr>`).join('')}
        ${results.length>20?`<tr><td colspan="4" style="padding:9px 12px;color:var(--text-3);text-align:center">... e mais ${results.length-20} trades</td></tr>`:''}
      </tbody>
    </table></div>`;
  card.removeAttribute('hidden');
}

function doImport() {
  if (!_importData.length) return;
  let n = 0;
  _importData.forEach(t => { if (!getTradeByDate(t.date)) { saveTrade({...t,id:genId()}); n++; } });
  persist();
  showToast(`${n} trades importados!${_importData.length-n>0?` (${_importData.length-n} já existiam)`:''}`, 'success');
  cancelImport();
  navigateTo('journal');
}

function cancelImport() {
  _importData = [];
  document.getElementById('import-preview-card')?.setAttribute('hidden','');
  const fi = document.getElementById('import-file-input');
  if (fi) fi.value = '';
}

function renderImportPage() { updateImportHint(_activeBroker); }

// ═══════════════════════════════════════
//  CONFIGURAÇÕES
// ═══════════════════════════════════════
function initSettingsEvents() {
  document.getElementById('btn-save-profile')?.addEventListener('click', doSaveProfile);
  document.getElementById('btn-save-goals')?.addEventListener('click', doSaveGoals);
  document.getElementById('btn-activate-cloud')?.addEventListener('click', doActivateCloud);
  document.getElementById('btn-force-upload')?.addEventListener('click', doForceUpload);
  document.getElementById('btn-force-download')?.addEventListener('click', doForceDownload);
  document.getElementById('btn-clear-data')?.addEventListener('click', doClearData);
  document.getElementById('btn-copy-sql')?.addEventListener('click', () => {
    navigator.clipboard.writeText(SUPABASE_SETUP_SQL).then(() => showToast('SQL copiado!','success'));
  });
}

function loadSettingsForm() {
  const p   = getProfile();
  const g   = getGoals();
  const cfg = getSupabaseConfig();
  set('cfg-name',      p.name||'');
  set('cfg-country',   p.country||'');
  set('cfg-broker',    p.broker||'');
  set('cfg-acct-type', p.accountType||'prop');
  set('cfg-goal-month', g.goalMonth||2000);
  set('cfg-goal-year',  g.goalYear||24000);
  set('cfg-goal-wr',    g.goalWinRate||60);
  set('cfg-goal-rr',    g.goalRR||1.5);
  set('cfg-sb-url', cfg.url||'');
  set('cfg-sb-key', cfg.key||'');
  const sqlEl = document.getElementById('supabase-sql-display');
  if (sqlEl) sqlEl.textContent = SUPABASE_SETUP_SQL;
  updateCloudStatusUI();
}

function doSaveProfile() {
  saveProfile({ name:get('cfg-name'), country:get('cfg-country'), broker:get('cfg-broker'), accountType:get('cfg-acct-type'), email:getCurrentUser()?.email||'' });
  persist(); showToast('Perfil salvo!','success');
}

function doSaveGoals() {
  const data = { goalMonth:parseFloat(get('cfg-goal-month'))||2000, goalYear:parseFloat(get('cfg-goal-year'))||24000, goalWinRate:parseFloat(get('cfg-goal-wr'))||60, goalRR:parseFloat(get('cfg-goal-rr'))||1.5 };
  const errs = validateGoals(data);
  if (errs.length) { showToast(formatErrors(errs),'error'); return; }
  saveGoals(data); persist(); showToast('Metas salvas!','success');
}

async function doActivateCloud() {
  try {
    saveSupabaseConfig(get('cfg-sb-url'), get('cfg-sb-key'));
    showToast('Supabase configurado! Recarregue para fazer login.','success');
    updateCloudStatusUI();
  } catch (e) { showToast(e.message,'error'); }
}

async function doForceUpload() {
  if (!isLoggedIn()) { showToast('Faça login primeiro.','warning'); return; }
  showToast('Enviando...','info'); await syncToCloud(); showToast('Enviado!','success');
}

async function doForceDownload() {
  if (!isLoggedIn()) { showToast('Faça login primeiro.','warning'); return; }
  showToast('Baixando...','info'); await loadFromCloud(); showToast('Baixado!','success'); navigateTo('dashboard');
}

function doClearData() {
  if (!confirm('ATENÇÃO: apagar TODOS os dados permanentemente?')) return;
  if (!confirm('Confirmar exclusão total?')) return;
  localStorage.removeItem('tros_v3');
  localStorage.removeItem('tros_active');
  showToast('Dados apagados. Recarregando...','info');
  setTimeout(() => location.reload(), 1500);
}

function updateCloudStatusUI() {
  const el = document.getElementById('cloud-status-display');
  const actions = document.getElementById('cloud-actions');
  if (!el) return;
  if (isLoggedIn()) {
    el.innerHTML = `<p class="cloud-status-ok">✅ Sincronização ativa · ${getCurrentUser()?.email}</p>`;
    actions?.removeAttribute('hidden');
  } else {
    el.innerHTML = `<p class="cloud-status-off">⚠ Modo local — configure o Supabase para sincronizar.</p>`;
    actions?.setAttribute('hidden','');
  }
}

// ═══════════════════════════════════════
//  PROP FIRM CONFIG
// ═══════════════════════════════════════
function initPropFirmConfigEvents() {
  document.getElementById('btn-configure-propfirm')?.addEventListener('click', openPropFirmModal);
}

function openPropFirmModal() {
  let modal = document.getElementById('propfirm-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'propfirm-modal';
    modal.className = 'modal-overlay';
    modal.setAttribute('hidden','');
    modal.innerHTML = buildPFModalHTML();
    document.body.appendChild(modal);
    wirePFModal(modal);
  }
  const cfg = getConfig();
  const cap = getActiveAccount()?.capital || 10000;
  set('pf-firm',       cfg.firmName ? Object.keys(PROP_FIRMS).find(k=>PROP_FIRMS[k].name===cfg.firmName)||'custom' : 'ftmo');
  set('pf-capital',    cap);
  set('pf-daily-loss', cfg.maxDailyLoss || cap*0.05);
  set('pf-total-loss', cfg.maxTotalLoss || cap*0.10);
  set('pf-profit',     cfg.profitTarget || cap*0.10);
  set('pf-min-days',   cfg.minTradingDays ?? 10);
  const tr = document.getElementById('pf-trailing');
  if (tr) tr.checked = !!cfg.trailingDrawdown;
  openModal('propfirm-modal');
}

function buildPFModalHTML() {
  const opts = Object.entries(PROP_FIRMS).map(([k,f])=>`<option value="${k}">${f.name}</option>`).join('');
  return `<div class="modal" style="max-width:500px">
    <div class="modal-header">
      <h2 class="modal-title">Configurar Prop Firm</h2>
      <button class="modal-close" data-close-modal="propfirm-modal">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Prop Firm</label>
        <select class="form-select" id="pf-firm">${opts}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Capital da Conta (R$)</label>
        <input class="form-input" type="number" id="pf-capital" placeholder="50000">
      </div>
      <div style="background:rgba(0,0,0,0.2);border-radius:10px;padding:16px;margin-top:4px">
        <p style="font-size:11px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;margin-bottom:12px">Regras (valores em R$)</p>
        <div class="form-grid-2">
          <div class="form-group"><label class="form-label">Perda Diária Máx.</label><input class="form-input" type="number" id="pf-daily-loss" step="100"></div>
          <div class="form-group"><label class="form-label">Perda Total Máx.</label><input class="form-input" type="number" id="pf-total-loss" step="100"></div>
          <div class="form-group"><label class="form-label">Meta de Lucro</label><input class="form-input" type="number" id="pf-profit" step="100"></div>
          <div class="form-group"><label class="form-label">Dias Mínimos</label><input class="form-input" type="number" id="pf-min-days" min="0"></div>
        </div>
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13px;color:var(--text-2);margin-top:6px">
          <input type="checkbox" id="pf-trailing" style="width:16px;height:16px;accent-color:var(--purple)">
          Trailing Drawdown
        </label>
      </div>
      <div id="pf-hint" style="display:none;margin-top:10px;padding:10px 14px;border-radius:8px;background:var(--blue-bg);border:1px solid rgba(59,158,255,0.2);font-size:12px;color:var(--blue)"></div>
    </div>
    <div class="modal-footer">
      <button class="btn-ghost" data-close-modal="propfirm-modal">Cancelar</button>
      <button class="btn-primary" id="btn-save-pf">Salvar</button>
    </div>
  </div>`;
}

function applyPreset(firmKey) {
  const cap    = parseFloat(get('pf-capital')) || 10000;
  const preset = applyPropFirmPreset(firmKey, cap);
  if (!preset || firmKey === 'custom') return;
  set('pf-daily-loss', preset.maxDailyLoss.toFixed(0));
  set('pf-total-loss', preset.maxTotalLoss.toFixed(0));
  set('pf-profit',     preset.profitTarget.toFixed(0));
  set('pf-min-days',   preset.minTradingDays);
  const tr = document.getElementById('pf-trailing');
  if (tr) tr.checked = preset.trailingDrawdown;
  const hint = document.getElementById('pf-hint');
  if (hint) { hint.style.display='block'; hint.textContent=`Regras padrão da ${preset.firmName} aplicadas.`; }
}

function wirePFModal(modal) {
  modal.addEventListener('change', e => {
    if (e.target.id === 'pf-firm') applyPreset(e.target.value);
  });
  modal.addEventListener('input', e => {
    if (e.target.id === 'pf-capital') applyPreset(get('pf-firm'));
  });
  document.getElementById('btn-save-pf')?.addEventListener('click', () => {
    const firmKey = get('pf-firm');
    const cap     = parseFloat(get('pf-capital')) || 10000;
    const cfg = {
      firmName:         PROP_FIRMS[firmKey]?.name || 'Customizado',
      maxDailyLoss:     parseFloat(get('pf-daily-loss')) || cap*0.05,
      maxTotalLoss:     parseFloat(get('pf-total-loss')) || cap*0.10,
      profitTarget:     parseFloat(get('pf-profit'))     || cap*0.10,
      minTradingDays:   parseInt(get('pf-min-days'))     || 10,
      trailingDrawdown: document.getElementById('pf-trailing')?.checked || false,
    };
    saveConfig(cfg); persist();
    closeModal('propfirm-modal');
    showToast(`Regras da ${cfg.firmName} configuradas!`,'success');
    renderPropFirm();
  });
}

// ═══════════════════════════════════════
//  PDF REPORT
// ═══════════════════════════════════════
function initPDFEvents() {
  document.getElementById('btn-pdf-report')?.addEventListener('click', async () => {
    if (!requirePlan('pdfReport')) return;
    const btn = document.getElementById('btn-pdf-report');
    if (btn) { btn.disabled = true; btn.textContent = 'Gerando…'; }
    try {
      const now = new Date();
      await generateMonthlyReport(now.getFullYear(), now.getMonth());
      showToast('Relatório aberto! Use Ctrl+P para salvar como PDF.', 'success');
    } catch (e) {
      showToast('Erro ao gerar relatório: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📄 Relatório PDF'; }
    }
  });
}

// ═══════════════════════════════════════
//  ANÁLISE COM IA
// ═══════════════════════════════════════
function initAIEvents() {
  document.getElementById('btn-ai-monthly')?.addEventListener('click', async () => {
    if (!requirePlan('aiAnalysis', 'premium')) return;
    const now = new Date();
    await analyzeTradingMonth(now.getFullYear(), now.getMonth());
  });

  document.getElementById('btn-ai-patterns')?.addEventListener('click', async () => {
    if (!requirePlan('aiAnalysis', 'premium')) return;
    await analyzePatterns();
  });

  document.getElementById('btn-ai-weekly')?.addEventListener('click', async () => {
    if (!requirePlan('aiAnalysis', 'premium')) return;
    await generateWeeklySummary();
  });
}

// ═══════════════════════════════════════
//  EXPORTS PÚBLICOS ADICIONAIS (Fase 2)
// ═══════════════════════════════════════
// openOperationModal exposta via TROS para o detalhe do dia
window.TROS = {
  ...window.TROS,
  openOperationModal,
  openEditOperationModal,
  renderOperationsList,
  generateMonthlyReport: async () => {
    if (!requirePlan('pdfReport')) return;
    const now = new Date();
    return generateMonthlyReport(now.getFullYear(), now.getMonth());
  },
  getCurrentPlan,
  navigateToPricing: () => navigateTo('pricing'),
};

// ═══════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════
function initAuthEvents() {
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected','false'); });
      tab.classList.add('active'); tab.setAttribute('aria-selected','true');
      const isLogin = tab.dataset.tab === 'login';
      document.getElementById('login-form')?.toggleAttribute('hidden', !isLogin);
      document.getElementById('register-form')?.toggleAttribute('hidden', isLogin);
      clearAuthMsg();
    });
  });

  document.getElementById('btn-login')?.addEventListener('click', doLogin);
  document.getElementById('btn-register')?.addEventListener('click', doRegister);
  document.getElementById('btn-local-mode')?.addEventListener('click', () => launchApp(false));
  document.getElementById('btn-local-from-setup')?.addEventListener('click', () => launchApp(false));

  document.getElementById('btn-go-setup')?.addEventListener('click', () => {
    document.getElementById('setup-panel')?.removeAttribute('hidden');
    document.getElementById('login-panel')?.setAttribute('hidden','');
  });
  document.getElementById('btn-back-to-login')?.addEventListener('click', () => {
    document.getElementById('setup-panel')?.setAttribute('hidden','');
    document.getElementById('login-panel')?.removeAttribute('hidden');
  });
  document.getElementById('btn-save-supabase')?.addEventListener('click', () => {
    try {
      saveSupabaseConfig(get('setup-sb-url'), get('setup-sb-key'));
      authMsg('Supabase configurado! Faça login.','success');
      document.getElementById('setup-panel')?.setAttribute('hidden','');
      document.getElementById('login-panel')?.removeAttribute('hidden');
      initSupabase();
    } catch (e) { authMsg(e.message,'error'); }
  });
  document.getElementById('btn-forgot-pass')?.addEventListener('click', async () => {
    const email = get('login-email');
    if (!email) { authMsg('Digite seu email primeiro','error'); return; }
    try { await resetPassword(email); authMsg('Email enviado!','success'); }
    catch (e) { authMsg(e.message,'error'); }
  });

  ['login-email','login-pass'].forEach(id =>
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key==='Enter') doLogin(); })
  );
}

async function doLogin() {
  const email = get('login-email'), pass = get('login-pass');
  if (!email||!pass) { authMsg('Preencha email e senha','error'); return; }
  setLoading(true,'Entrando...');
  try { await login(email, pass); await launchApp(true); }
  catch (e) { setLoading(false); authMsg(e.message,'error'); }
}

async function doRegister() {
  const email=get('reg-email'), pass=get('reg-pass'), pass2=get('reg-pass2');
  if (!email||!pass) { authMsg('Preencha todos os campos','error'); return; }
  if (pass!==pass2)  { authMsg('As senhas não coincidem','error'); return; }
  if (pass.length<8) { authMsg('Senha: mínimo 8 caracteres','error'); return; }
  setLoading(true,'Criando conta...');
  try { await register(email,pass); setLoading(false); authMsg('Conta criada! Verifique seu email.','success'); }
  catch(e) { setLoading(false); authMsg(e.message,'error'); }
}

async function doLogout() {
  await logout(); closeAllMenus(); hideApp(); showAuthScreen(); initAuthEvents();
}

function authMsg(msg, type) {
  const e = document.getElementById('auth-error');
  const s = document.getElementById('auth-success');
  if (type==='error') { if(e){e.textContent=msg;e.removeAttribute('hidden');} s?.setAttribute('hidden',''); }
  else { if(s){s.textContent=msg;s.removeAttribute('hidden');} e?.setAttribute('hidden',''); }
}
function clearAuthMsg() { document.getElementById('auth-error')?.setAttribute('hidden',''); document.getElementById('auth-success')?.setAttribute('hidden',''); }

// ── Utils ─────────────────────────────
function showAuthScreen() { document.getElementById('auth-screen').style.display='flex'; document.getElementById('app')?.classList.remove('visible'); }
function hideAuthScreen() { document.getElementById('auth-screen').style.display='none'; }
function showApp()        { document.getElementById('app')?.classList.add('visible'); }
function hideApp()        { document.getElementById('app')?.classList.remove('visible'); }
function get(id)          { return document.getElementById(id)?.value ?? ''; }
function set(id, v)       { const el=document.getElementById(id); if(el) el.value=v; }
function q(id, text)      { const el=document.getElementById(id); if(el) el.textContent=text; }
function persist()        { saveLocal(); if(isLoggedIn()) scheduleSyncToCloud(); }
function refreshPage()    { navigateTo(_page); renderHeader(); }
function doExportCSV()    { exportCSV(); showToast('CSV exportado!','success'); }

function updateSyncBadge(state) {
  const dot=document.getElementById('sync-dot'), text=document.getElementById('sync-text');
  if (!dot||!text) return;
  const m={syncing:['syncing','sincronizando'],synced:['synced','sincronizado'],error:['error','erro'],local:['','local']};
  const [cls,lbl]=m[state]||m.local;
  dot.className='sync-dot'+(cls?' '+cls:''); text.textContent=lbl;
}

function startClock() {
  const tick=()=>{const el=document.getElementById('clock');if(el)el.textContent=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});};
  tick(); setInterval(tick,60000);
}

// ── API pública ───────────────────────
window.TROS = {
  navigateTo, openTradeModal, openEditModal, openDayDetail,
  doDeleteTrade, openLightbox,
  getTradeById: id => getTrades().find(t => t.id === id),
  getTrades, getTradesByMonth, getTradesByYear, calcStats,
  getGoals, saveGoals, getProfile, saveProfile,
  getConfig, saveConfig, getActiveAccount, getAccounts,
  exportCSV: doExportCSV, SUPABASE_SETUP_SQL,
};

if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

// ════════════════════════════════════════
//  TOUR GUIADO
// ════════════════════════════════════════
const TOUR_STEPS = [
  { title:'Bem-vindo ao Trader OS!', desc:'Vamos fazer um tour rapido pelas principais funcionalidades. Clique em Proximo para comecar.', selector:null },
  { title:'Dashboard', desc:'Aqui voce ve todos os KPIs: P&L, Win Rate, Fator de Lucro, Drawdown e Curva de Equity em tempo real.', selector:'[data-page="dashboard"]', page:'dashboard' },
  { title:'Registro de Negociacoes', desc:'Liste, filtre e gerencie todas as operacoes. Clique em + Nova Operacao para registrar com todos os detalhes.', selector:'[data-page="trades"]', page:'trades' },
  { title:'Calendario', desc:'Visao mensal do desempenho. Clique em qualquer dia para ver detalhes, notas e screenshots.', selector:'[data-page="calendar"]', page:'calendar' },
  { title:'Analises', desc:'Performance por par, sessao, setup e direcao. Identifique onde voce performa melhor.', selector:'[data-page="analytics"]', page:'analytics' },
  { title:'Calculadora', desc:'Tamanho ideal de posicao, R:R e simulador de crescimento da conta.', selector:'[data-page="calculator"]', page:'calculator' },
  { title:'Integracao MT5', desc:'Baixe o EA e conecte o MetaTrader 5. Os trades aparecem aqui em tempo real automaticamente!', selector:'[data-page="mt5integration"]', page:'mt5integration' },
  { title:'Configuracoes', desc:'Capital, limites de risco, metas, sincronizacao com Supabase, perfil e muito mais.', selector:'[data-page="settings"]', page:'settings' },
  { title:'Tudo pronto!', desc:'Voce conheceu as principais funcionalidades. Comece registrando sua primeira operacao. Bons trades!', selector:null },
];

let _tourStep = 0;

window.startTour = function() {
  _tourStep = 0;
  const ov = document.getElementById('tour-overlay');
  if(ov) ov.classList.remove('hidden');
  renderTourStep();
};

window.endTour = function() {
  const ov = document.getElementById('tour-overlay');
  if(ov) ov.classList.add('hidden');
  localStorage.setItem('tros_tour_done','1');
};

window.tourNext = function() {
  _tourStep++;
  if(_tourStep >= TOUR_STEPS.length){ endTour(); return; }
  renderTourStep();
};

function renderTourStep() {
  const step  = TOUR_STEPS[_tourStep];
  const total = TOUR_STEPS.length;
  const badge = document.getElementById('tour-badge');
  const title = document.getElementById('tour-title');
  const desc  = document.getElementById('tour-desc');
  const btn   = document.getElementById('tour-next-btn');
  const dots  = document.getElementById('tour-dots');
  if(badge) badge.textContent = 'Passo '+(_tourStep+1)+' de '+total;
  if(title) title.textContent = step.title;
  if(desc)  desc.textContent  = step.desc;
  if(btn)   btn.textContent   = _tourStep===total-1 ? 'Concluir' : 'Proximo';
  if(dots)  dots.innerHTML    = TOUR_STEPS.map((_,i)=>'<div class="tour-dot'+(i===_tourStep?' active':'')+'"></div>').join('');

  if(step.page && window.navigateTo) navigateTo(step.page);

  const hl   = document.getElementById('tour-highlight');
  const card = document.getElementById('tour-card');
  if(!hl || !card) return;

  if(step.selector) {
    const el = document.querySelector(step.selector);
    if(el) {
      const r = el.getBoundingClientRect();
      hl.style.cssText = 'position:fixed;left:'+(r.left-6)+'px;top:'+(r.top-6)+'px;width:'+(r.width+12)+'px;height:'+(r.height+12)+'px;border-radius:10px;box-shadow:0 0 0 4px #00F5A0,0 0 0 9999px rgba(5,8,16,0.8);pointer-events:none;z-index:9002;transition:all 0.35s';
      const cl = Math.min(r.right+16, window.innerWidth-316);
      const ct = Math.max(Math.min(r.top, window.innerHeight-240), 20);
      card.style.cssText = 'position:fixed;left:'+cl+'px;top:'+ct+'px;z-index:9003;pointer-events:all;transition:all 0.35s';
    }
  } else {
    hl.style.cssText   = 'display:none';
    card.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9003;pointer-events:all';
  }
}

// Auto-start para novos usuarios
setTimeout(function() {
  if(!localStorage.getItem('tros_tour_done') && !localStorage.getItem('trader_os_v3')) {
    if(window.startTour) startTour();
  }
}, 2500);

// ════════════════════════════════════════
//  WIKI / FAQ
// ════════════════════════════════════════
window.toggleWiki = function(el) { el.classList.toggle('open'); };

window.filterWiki = function(q) {
  const s = q.toLowerCase().trim();
  document.querySelectorAll('.wiki-item').forEach(function(item) {
    item.style.display = (!s || item.textContent.toLowerCase().includes(s)) ? '' : 'none';
  });
  document.querySelectorAll('.wiki-cat').forEach(function(cat) {
    const vis = Array.from(cat.querySelectorAll('.wiki-item')).some(function(i){ return i.style.display !== 'none'; });
    cat.style.display = vis ? '' : 'none';
  });
};

window.scrollToWikiCat = function(id) {
  if(window.navigateTo) navigateTo('wiki');
  setTimeout(function() {
    const el = document.getElementById('wiki-cat-'+id);
    if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
  }, 150);
};
