// ═══════════════════════════════════════
//  TRADER OS · ui/operations.js
//  Modal de operação granular
//  Entry, Exit, SL, TP, lote, horário
// ═══════════════════════════════════════

import { saveOperation, deleteOperation, getOperations, genId } from '../db.js';
import { validateTrade, sanitizeNumber } from '../validation.js';
import { PAIRS, SESSIONS } from '../config.js';
import { showToast, openModal, closeModal, fmt$ } from './components.js';

let _editingOpId  = null;
let _currentTradeId = null;

// ── Inicia o módulo ───────────────────
export function initOperationsModal() {
  ensureModalExists();

  document.getElementById('btn-save-operation')?.addEventListener('click', doSaveOperation);
  document.getElementById('op-form')?.addEventListener('input', autoCalcRR);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal('operationModal');
  });
}

// ── Abre para nova operação ───────────
export function openOperationModal(tradeId, date = null) {
  _currentTradeId = tradeId;
  _editingOpId    = null;

  ensureModalExists();
  resetForm();
  setVal('op-date', date || new Date().toISOString().slice(0, 10));
  setVal('op-direction', 'long');
  doc('op-modal-title').textContent = 'Nova Operação';
  doc('op-error')?.setAttribute('hidden', '');
  openModal('operationModal');
}

// ── Abre para editar ──────────────────
export function openEditOperationModal(op) {
  if (!op) return;
  _editingOpId    = op.id;
  _currentTradeId = op.tradeId;

  ensureModalExists();
  setVal('op-date',         op.date || '');
  setVal('op-entry-time',   op.entryTime || '');
  setVal('op-exit-time',    op.exitTime || '');
  setVal('op-pair',         op.pair || '');
  setVal('op-direction',    op.direction || 'long');
  setVal('op-entry-price',  op.entryPrice ?? '');
  setVal('op-exit-price',   op.exitPrice ?? '');
  setVal('op-stop-loss',    op.stopLoss ?? '');
  setVal('op-take-profit',  op.takeProfit ?? '');
  setVal('op-lot-size',     op.lotSize ?? '');
  setVal('op-pnl',          op.pnl ?? '');
  setVal('op-rr',           op.rr ?? '');
  setVal('op-setup',        op.setup || '');
  setVal('op-notes',        op.notes || '');

  doc('op-modal-title').textContent = 'Editar Operação';
  doc('op-error')?.setAttribute('hidden', '');
  openModal('operationModal');
}

// ── Salva ─────────────────────────────
function doSaveOperation() {
  const errEl = doc('op-error');
  const data = {
    id:          _editingOpId || genId(),
    tradeId:     _currentTradeId,
    date:        getVal('op-date'),
    entryTime:   getVal('op-entry-time'),
    exitTime:    getVal('op-exit-time'),
    pair:        getVal('op-pair'),
    direction:   getVal('op-direction'),
    entryPrice:  getVal('op-entry-price'),
    exitPrice:   getVal('op-exit-price'),
    stopLoss:    getVal('op-stop-loss'),
    takeProfit:  getVal('op-take-profit'),
    lotSize:     getVal('op-lot-size'),
    pnl:         getVal('op-pnl'),
    rr:          getVal('op-rr'),
    setup:       getVal('op-setup'),
    notes:       getVal('op-notes'),
  };

  if (!data.date || data.pnl === '') {
    if (errEl) { errEl.textContent = 'Data e P&L são obrigatórios'; errEl.removeAttribute('hidden'); }
    return;
  }

  try {
    const op = saveOperation(data);

    // Dispara evento para quem precisar atualizar
    document.dispatchEvent(new CustomEvent('tros:operation-saved', { detail: op }));

    closeModal('operationModal');
    showToast('Operação salva!', 'success');
  } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.removeAttribute('hidden'); }
  }
}

// ── Auto-calcula R:R ──────────────────
function autoCalcRR() {
  const entry = parseFloat(getVal('op-entry-price'));
  const exit  = parseFloat(getVal('op-exit-price'));
  const sl    = parseFloat(getVal('op-stop-loss'));
  const dir   = getVal('op-direction');

  if (!entry || !sl || !exit || isNaN(entry) || isNaN(sl) || isNaN(exit)) return;

  const risk   = Math.abs(entry - sl);
  const reward = dir === 'long' ? exit - entry : entry - exit;
  if (risk > 0) {
    const rr = reward / risk;
    setVal('op-rr', rr.toFixed(2));
  }

  // Preview do P&L estimado (pip value baseado no lot size)
  const lot = parseFloat(getVal('op-lot-size')) || 0;
  const pips = Math.abs(exit - entry) * 10000;
  if (lot > 0 && pips > 0) {
    const estimated = (reward > 0 ? 1 : -1) * pips * lot * 1; // ~$1/pip/0.01 lot
    setVal('op-pnl', estimated.toFixed(2));
  }
}

// ── Renderiza lista de operações ──────
export function renderOperationsList(tradeId, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const ops = getOperations(undefined, tradeId)
    .sort((a, b) => (a.entryTime || '00:00') < (b.entryTime || '00:00') ? -1 : 1);

  if (!ops.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:24px;color:var(--text-3)">
        <div style="font-size:24px;margin-bottom:8px;opacity:0.4">📊</div>
        <div style="font-size:13px">Nenhuma operação registrada</div>
        <div style="font-size:11px;margin-top:4px">Clique em "Nova Operação" para adicionar</div>
      </div>`;
    return;
  }

  container.innerHTML = ops.map(op => {
    const pnlColor  = op.pnl >= 0 ? 'var(--green)' : 'var(--red)';
    const dirBadge  = op.direction === 'long'
      ? '<span style="background:rgba(0,245,160,0.1);color:var(--green);padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700">LONG</span>'
      : '<span style="background:rgba(255,61,107,0.1);color:var(--red);padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700">SHORT</span>';

    return `
      <div class="op-row" data-id="${op.id}">
        <div class="op-row-main">
          <div class="op-row-left">
            ${dirBadge}
            ${op.pair ? `<span class="jrow-pair">${op.pair}</span>` : ''}
            ${op.entryTime ? `<span style="font-family:var(--font-mono);font-size:11px;color:var(--text-3)">${op.entryTime}${op.exitTime ? ' → ' + op.exitTime : ''}</span>` : ''}
            ${op.setup ? `<span class="jrow-setup">${op.setup}</span>` : ''}
          </div>
          <div class="op-row-right">
            ${op.entryPrice ? `<span style="font-size:11px;color:var(--text-3)">E: ${op.entryPrice}</span>` : ''}
            ${op.exitPrice  ? `<span style="font-size:11px;color:var(--text-3)">X: ${op.exitPrice}</span>`  : ''}
            ${op.stopLoss   ? `<span style="font-size:11px;color:var(--red);opacity:0.7">SL: ${op.stopLoss}</span>` : ''}
            ${op.lotSize    ? `<span style="font-size:11px;color:var(--text-3)">${op.lotSize} lote</span>` : ''}
            ${op.rr != null ? `<span style="font-family:var(--font-mono);font-size:12px;color:${op.rr >= 0 ? 'var(--green)':'var(--red)'}">${op.rr >= 0 ? '+' : ''}${op.rr}R</span>` : ''}
            <span style="font-family:var(--font-mono);font-size:15px;font-weight:700;color:${pnlColor}">
              ${op.pnl >= 0 ? '+' : ''}R$${Math.abs(op.pnl).toFixed(2)}
            </span>
            <div class="op-actions">
              <button class="op-btn-edit" data-id="${op.id}" title="Editar">✏</button>
              <button class="op-btn-del"  data-id="${op.id}" title="Apagar">🗑</button>
            </div>
          </div>
        </div>
        ${op.notes ? `<div style="font-size:11px;color:var(--text-3);padding:6px 0 0;border-top:1px solid var(--border);margin-top:6px;line-height:1.5">${op.notes}</div>` : ''}
      </div>`;
  }).join('');

  // Eventos
  container.querySelectorAll('.op-btn-edit').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const op = getOperations().find(o => o.id === btn.dataset.id);
      if (op) openEditOperationModal(op);
    })
  );
  container.querySelectorAll('.op-btn-del').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm('Apagar operação?')) return;
      deleteOperation(btn.dataset.id);
      document.dispatchEvent(new CustomEvent('tros:operation-deleted'));
      renderOperationsList(tradeId, containerId);
      showToast('Operação removida', 'info');
    })
  );
}

// ── Garante que o modal existe no DOM ─
function ensureModalExists() {
  if (document.getElementById('operationModal')) return;

  const modal = document.createElement('div');
  modal.id = 'operationModal';
  modal.className = 'modal-overlay';
  modal.setAttribute('hidden', '');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `
    <div class="modal" style="max-width:600px">
      <div class="modal-header">
        <h2 class="modal-title" id="op-modal-title">Nova Operação</h2>
        <button class="modal-close" data-close-modal="operationModal">✕</button>
      </div>
      <div class="modal-body">
        <form id="op-form" onsubmit="return false">
          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">Data <span class="required">*</span></label>
              <input class="form-input" type="date" id="op-date">
            </div>
            <div class="form-group">
              <label class="form-label">P&L (R$) <span class="required">*</span></label>
              <input class="form-input" type="number" id="op-pnl" placeholder="+250 ou -80" step="0.01">
            </div>
          </div>

          <div class="form-grid-3">
            <div class="form-group">
              <label class="form-label">Par</label>
              <select class="form-select" id="op-pair">
                <option value="">—</option>
                ${PAIRS.map(p => `<option>${p}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Direção</label>
              <select class="form-select" id="op-direction">
                <option value="long">LONG ↑</option>
                <option value="short">SHORT ↓</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Lot Size</label>
              <input class="form-input" type="number" id="op-lot-size" placeholder="0.10" step="0.01">
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">Hora Entrada</label>
              <input class="form-input" type="time" id="op-entry-time">
            </div>
            <div class="form-group">
              <label class="form-label">Hora Saída</label>
              <input class="form-input" type="time" id="op-exit-time">
            </div>
          </div>

          <div class="form-grid-2" style="margin-bottom:4px">
            <div class="form-group">
              <label class="form-label">Preço Entrada</label>
              <input class="form-input" type="number" id="op-entry-price" placeholder="1.0850" step="0.00001">
            </div>
            <div class="form-group">
              <label class="form-label">Preço Saída</label>
              <input class="form-input" type="number" id="op-exit-price" placeholder="1.0920" step="0.00001">
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">Stop Loss</label>
              <input class="form-input" type="number" id="op-stop-loss" placeholder="1.0820" step="0.00001">
            </div>
            <div class="form-group">
              <label class="form-label">Take Profit</label>
              <input class="form-input" type="number" id="op-take-profit" placeholder="1.0950" step="0.00001">
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">Setup / Estratégia</label>
              <input class="form-input" type="text" id="op-setup" placeholder="ICT OB, Breakout...">
            </div>
            <div class="form-group">
              <label class="form-label">R Múltiplo (auto)</label>
              <input class="form-input" type="number" id="op-rr" placeholder="2.0" step="0.01" readonly
                style="background:rgba(0,0,0,0.5);color:var(--green)">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Notas</label>
            <textarea class="form-textarea" id="op-notes" rows="2"
              placeholder="Razão da entrada, lição aprendida..."></textarea>
          </div>
        </form>

        <div id="op-error" class="modal-error" hidden></div>
      </div>
      <div class="modal-footer">
        <button class="btn-ghost" data-close-modal="operationModal">Cancelar</button>
        <button class="btn-primary" id="btn-save-operation">Salvar Operação</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  // Re-wire após inserir no DOM
  document.getElementById('btn-save-operation')?.addEventListener('click', doSaveOperation);
  document.getElementById('op-form')?.addEventListener('input', autoCalcRR);
}

// ── Helpers ───────────────────────────
function getVal(id)    { return document.getElementById(id)?.value ?? ''; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }
function resetForm()   { ['op-date','op-entry-time','op-exit-time','op-pair','op-entry-price','op-exit-price','op-stop-loss','op-take-profit','op-lot-size','op-pnl','op-rr','op-setup','op-notes'].forEach(id => setVal(id, '')); }
function doc(id)       { return document.getElementById(id); }
