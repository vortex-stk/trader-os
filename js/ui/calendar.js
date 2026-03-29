// ═══════════════════════════════════════
//  TRADER OS · ui/calendar.js
// ═══════════════════════════════════════

import { getTrades, getTradesByMonth, calcStats } from '../db.js';
import { MONTHS, MONTHS_SHORT, WEEKDAYS } from '../config.js';
import { fmt$, fmtPct, openModal } from './components.js';

let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth();

export function renderCalendar() {
  const month = getTradesByMonth(_calYear, _calMonth);
  const stats = calcStats(month);
  const monthPnL = month.reduce((a, t) => a + t.pnl, 0);

  // Título
  const titleEl = document.getElementById('cal-title');
  if (titleEl) titleEl.textContent = `${MONTHS[_calMonth]} ${_calYear}`;

  // KPIs do mês
  const kpiRow = document.getElementById('cal-kpi-row');
  if (kpiRow) {
    kpiRow.innerHTML = [
      { label: 'P&L do Mês', val: fmt$(monthPnL, true), color: monthPnL >= 0 ? 'var(--green)' : 'var(--red)' },
      { label: 'Win Rate',   val: fmtPct(stats.winRate), color: stats.winRate >= 50 ? 'var(--green)' : 'var(--red)' },
      { label: 'Dias +',     val: stats.wins,   color: 'var(--green)' },
      { label: 'Dias −',     val: stats.losses, color: 'var(--red)' },
    ].map(k => `
      <div class="kpi">
        <div class="kpi-tag">${k.label}</div>
        <div class="kpi-num" style="color:${k.color}">${k.val}</div>
      </div>
    `).join('');
  }

  // Grid de dias
  const container = document.getElementById('cal-days');
  if (!container) return;

  const firstDay = new Date(_calYear, _calMonth, 1).getDay();
  const daysInMonth = new Date(_calYear, _calMonth + 1, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);

  // Indexa trades por data
  const byDate = {};
  month.forEach(t => { byDate[t.date] = (byDate[t.date] || []); byDate[t.date].push(t); });

  let html = '';
  // Células vazias antes do dia 1
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="cal-cell empty"></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${_calYear}-${String(_calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const ops = byDate[dateStr] || [];
    const dayPnL = ops.reduce((a, t) => a + t.pnl, 0);
    const hasData = ops.length > 0;
    const isToday = dateStr === today;

    const cls = [
      'cal-cell',
      isToday ? 'today' : '',
      hasData ? (dayPnL >= 0 ? 'win-day' : 'loss-day') : '',
    ].filter(Boolean).join(' ');

    html += `
      <div class="${cls}" data-date="${dateStr}">
        <div class="cell-num">${d}</div>
        ${hasData ? `
          <div class="cell-pnl ${dayPnL >= 0 ? 'pos' : 'neg'}">${dayPnL >= 0 ? '+' : ''}R$${Math.abs(dayPnL).toFixed(0)}</div>
          ${ops.reduce((a, t) => a + (t.trades || 0), 0) > 0 ? `<div class="cell-trades">${ops.reduce((a, t) => a + (t.trades || 0), 0)} trades</div>` : ''}
          <div class="cell-dot ${dayPnL >= 0 ? 'win' : 'loss'}"></div>
        ` : ''}
      </div>
    `;
  }

  container.innerHTML = html;

  // Eventos de clique
  container.querySelectorAll('.cal-cell:not(.empty)').forEach(cell => {
    cell.addEventListener('click', () => {
      const dateStr = cell.dataset.date;
      if (window.TROS) window.TROS.openDayDetail(dateStr);
    });
  });
}

export function calChangeMonth(delta) {
  _calMonth += delta;
  if (_calMonth < 0)  { _calMonth = 11; _calYear--; }
  if (_calMonth > 11) { _calMonth = 0;  _calYear++; }
  renderCalendar();
}

export function calGoToday() {
  _calYear  = new Date().getFullYear();
  _calMonth = new Date().getMonth();
  renderCalendar();
}

export function initCalendarControls() {
  document.getElementById('btn-cal-prev')?.addEventListener('click', () => calChangeMonth(-1));
  document.getElementById('btn-cal-next')?.addEventListener('click', () => calChangeMonth(1));
  document.getElementById('btn-cal-today')?.addEventListener('click', calGoToday);
}
