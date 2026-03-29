// ═══════════════════════════════════════
//  TRADER OS · ui/journal.js
// ═══════════════════════════════════════

import { getTrades, calcStats } from '../db.js';
import { MONTHS_SHORT, WEEKDAYS } from '../config.js';
import { fmt$, fmtR } from './components.js';

let _filter = 'all';

export function renderJournal() {
  const all = [...getTrades()].sort((a, b) => b.date < a.date ? -1 : 1);
  const pairs  = [...new Set(all.filter(t => t.pair).map(t => t.pair))];
  const setups = [...new Set(all.filter(t => t.setup).map(t => t.setup))];

  // Filtros dinâmicos
  const filtersEl = document.getElementById('journal-filters');
  if (filtersEl) {
    filtersEl.innerHTML = [
      { f: 'all',   label: 'Todos',       cls: '' },
      { f: 'wins',  label: '✓ Ganhos',    cls: '' },
      { f: 'losses',label: '✕ Perdas',    cls: '' },
      ...pairs.map(p => ({ f: p, label: p, cls: 'pair' })),
      ...setups.map(s => ({ f: s, label: s, cls: 'setup' })),
    ].map(c => `
      <button class="filter-chip ${c.cls} ${_filter === c.f ? 'active' : ''}"
        data-filter="${c.f}">${c.label}</button>
    `).join('');

    filtersEl.addEventListener('click', e => {
      const btn = e.target.closest('[data-filter]');
      if (!btn) return;
      _filter = btn.dataset.filter;
      renderJournal();
    });
  }

  // Filtra
  let trades = all;
  if      (_filter === 'wins')   trades = trades.filter(t => t.pnl > 0);
  else if (_filter === 'losses') trades = trades.filter(t => t.pnl < 0);
  else if (_filter !== 'all')    trades = trades.filter(t => t.pair === _filter || t.setup === _filter);

  const now = new Date();
  const sub = document.getElementById('journal-subtitle');
  if (sub) sub.textContent = `${trades.length} registros · ${MONTHS_SHORT[now.getMonth()]} ${now.getFullYear()}`;

  const container = document.getElementById('journal-list');
  if (!container) return;

  if (!trades.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--text-3)">
        <div style="font-size:38px;margin-bottom:12px;opacity:0.35">📓</div>
        <div style="font-size:14px;font-weight:700;color:var(--text-2);margin-bottom:5px">Nenhum registro encontrado</div>
        <div style="font-size:12px">Ajuste os filtros ou registre seu primeiro trade</div>
      </div>`;
    return;
  }

  // Agrupa por data
  const byDate = {};
  const order  = [];
  trades.forEach(t => {
    if (!byDate[t.date]) { byDate[t.date] = []; order.push(t.date); }
    byDate[t.date].push(t);
  });

  container.innerHTML = order.map(date => {
    const ops    = byDate[date];
    const d      = new Date(date + 'T12:00:00');
    const dayPnL = ops.reduce((a, t) => a + t.pnl, 0);
    const totalTrades = ops.reduce((a, t) => a + (t.trades || 1), 0);
    const allPairs  = [...new Set(ops.filter(t => t.pair).map(t => t.pair))];
    const allSetups = [...new Set(ops.filter(t => t.setup).map(t => t.setup))];
    const avgRR = ops.filter(t => t.rr != null).length
      ? ops.filter(t => t.rr != null).reduce((a, t) => a + t.rr, 0) / ops.filter(t => t.rr != null).length
      : null;
    const emo   = ops.length === 1 && ops[0].emotion ? ops[0].emotion.split('_')[0] : '';
    const notes = ops.length === 1 ? ops[0].notes : '';

    return `
      <div class="jrow" data-date="${date}">
        <div class="jrow-date">
          <div>${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}</div>
          <div style="font-size:10px;color:var(--text-3)">${WEEKDAYS[d.getDay()]}</div>
        </div>
        <div>${allPairs.map(p => `<span class="jrow-pair">${p}</span>`).join(' ') || '—'}
          ${ops.length > 1 ? `<span style="font-size:10px;background:var(--purple-bg);color:var(--purple);border-radius:20px;padding:2px 7px;margin-left:4px">${ops.length} ops</span>` : ''}
        </div>
        <div class="jrow-pnl ${dayPnL >= 0 ? 'pos' : 'neg'}">${dayPnL >= 0 ? '+' : ''}R$${Math.abs(dayPnL).toFixed(2)}</div>
        <div class="jrow-r ${avgRR === null ? '' : avgRR >= 0 ? 'pos' : 'neg'}">${avgRR !== null ? fmtR(avgRR) : '—'}</div>
        <div style="font-family:var(--font-mono);font-size:13px;color:var(--text-2)">${totalTrades}</div>
        <div style="font-size:16px">${emo}</div>
        <div>${allSetups.map(s => `<span class="jrow-setup">${s}</span>`).join(' ') || '—'}</div>
        <div class="jrow-note">${notes || (ops.length > 1 ? ops.length + ' operações' : 'Sem notas')}</div>
        <div style="display:flex;justify-content:center">
          <button class="jrow-more" data-date="${date}">···</button>
        </div>
      </div>
    `;
  }).join('');

  // Clique na linha abre detalhe do dia
  container.querySelectorAll('.jrow').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.jrow-more')) return;
      if (window.TROS) window.TROS.openDayDetail(row.dataset.date);
    });
  });
}
