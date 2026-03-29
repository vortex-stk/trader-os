// ═══════════════════════════════════════
//  TRADER OS · ui/analytics.js
// ═══════════════════════════════════════

import { getTrades, calcStats } from '../db.js';
import { WEEKDAYS } from '../config.js';

let _charts = {};

export function renderAnalytics() {
  const all = getTrades();
  if (!all.length) return;

  renderDistChart(all);
  renderPairChart(all);
  renderHeatmap(all);
  renderStrategies(all);
}

function renderDistChart(trades) {
  const ctx = document.getElementById('an-dist-chart');
  if (!ctx) return;
  if (_charts.dist) _charts.dist.destroy();

  const buckets = { '<-200': 0, '-200—-50': 0, '-50—0': 0, '0—50': 0, '50—200': 0, '>200': 0 };
  trades.forEach(t => {
    if (t.pnl < -200)      buckets['<-200']++;
    else if (t.pnl < -50)  buckets['-200—-50']++;
    else if (t.pnl < 0)    buckets['-50—0']++;
    else if (t.pnl < 50)   buckets['0—50']++;
    else if (t.pnl < 200)  buckets['50—200']++;
    else                   buckets['>200']++;
  });

  _charts.dist = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels: Object.keys(buckets),
      datasets: [{
        data: Object.values(buckets),
        backgroundColor: Object.keys(buckets).map(k => k.startsWith('-') || k.startsWith('<') ? 'rgba(255,61,107,0.7)' : 'rgba(0,245,160,0.7)'),
        borderRadius: 5,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#4A5470', font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: '#4A5470', font: { size: 10 }, stepSize: 1 }, grid: { display: false } },
      },
    },
  });
}

function renderPairChart(trades) {
  const ctx = document.getElementById('an-pair-chart');
  if (!ctx) return;
  if (_charts.pair) _charts.pair.destroy();

  const pairs = {};
  trades.forEach(t => { if (t.pair) pairs[t.pair] = (pairs[t.pair] || 0) + t.pnl; });
  const sorted = Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 8);

  _charts.pair = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{
        data: sorted.map(([, v]) => parseFloat(v.toFixed(2))),
        backgroundColor: sorted.map(([, v]) => v >= 0 ? 'rgba(59,158,255,0.75)' : 'rgba(255,61,107,0.75)'),
        borderRadius: 5,
      }],
    },
    options: {
      indexAxis: 'y', responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#4A5470', font: { size: 10 }, callback: v => 'R$' + v }, grid: { display: false } },
        y: { ticks: { color: '#8A96B0', font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

function renderHeatmap(trades) {
  const container = document.getElementById('an-heatmap');
  if (!container) return;

  const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  const cells  = {};
  hours.forEach(h => WEEKDAYS.forEach(d => { cells[`${d}-${h}`] = []; }));
  trades.forEach(t => {
    const d = new Date(t.date + 'T12:00:00');
    const day = WEEKDAYS[d.getDay()];
    const hour = 12; // hora padrão se não houver
    if (cells[`${day}-${hour}`]) cells[`${day}-${hour}`].push(t.pnl);
  });

  const vals = Object.values(cells).flat();
  const maxAbs = Math.max(Math.abs(Math.min(...vals, 0)), Math.abs(Math.max(...vals, 0)), 1);

  const header = `
    <div class="hm-header">
      <div class="hm-hdr-cell"></div>
      ${WEEKDAYS.map(d => `<div class="hm-hdr-cell">${d}</div>`).join('')}
    </div>
  `;

  const rows = hours.map(h => `
    <div class="hm-row">
      <div class="hm-lbl">${h}h</div>
      ${WEEKDAYS.map(d => {
        const ps = cells[`${d}-${h}`] || [];
        const avg = ps.length ? ps.reduce((a, v) => a + v, 0) / ps.length : 0;
        const intensity = Math.abs(avg) / maxAbs;
        const bg = avg > 0
          ? `rgba(0,245,160,${0.15 + intensity * 0.65})`
          : avg < 0
          ? `rgba(255,61,107,${0.15 + intensity * 0.65})`
          : 'rgba(255,255,255,0.04)';
        const text = avg !== 0 ? (avg >= 0 ? '+' : '') + avg.toFixed(0) : '';
        return `<div class="hm-cell" style="background:${bg}">${text}</div>`;
      }).join('')}
    </div>
  `).join('');

  container.innerHTML = `<div class="heatmap-wrap">${header}${rows}</div>`;
}

function renderStrategies(trades) {
  const container = document.getElementById('an-strategies');
  if (!container) return;

  const strats = {};
  trades.forEach(t => {
    const s = t.setup || 'Sem setup';
    if (!strats[s]) strats[s] = { pnl: 0, count: 0 };
    strats[s].pnl += t.pnl;
    strats[s].count++;
  });

  const sorted = Object.entries(strats).sort((a, b) => b[1].pnl - a[1].pnl);
  const maxPnL = Math.max(...sorted.map(([, s]) => Math.abs(s.pnl)), 1);
  const colors = ['#00F5A0', '#3B9EFF', '#7C5CFC', '#FFB547', '#22D3EE', '#FF3D6B'];

  container.innerHTML = `
    <div class="strategy-list">
      ${sorted.map(([name, s], i) => `
        <div class="strategy-row">
          <div class="strat-dot" style="background:${colors[i % colors.length]}"></div>
          <span class="strat-name">${name}</span>
          <span class="strat-trades">${s.count} dias</span>
          <div class="strat-bar">
            <div class="strat-bar-fill" style="width:${Math.abs(s.pnl) / maxPnL * 100}%;background:${s.pnl >= 0 ? colors[i % colors.length] : 'var(--red)'}"></div>
          </div>
          <span class="strat-pnl" style="color:${s.pnl >= 0 ? 'var(--green)' : 'var(--red)'}">
            ${s.pnl >= 0 ? '+' : ''}R$${Math.abs(s.pnl).toFixed(0)}
          </span>
        </div>
      `).join('')}
    </div>
  `;
}


// ═══════════════════════════════════════
//  TRADER OS · ui/metas.js
// ═══════════════════════════════════════

import { getGoals, getTrades as _getTrades, getTradesByMonth, getTradesByYear, calcStats } from '../db.js';
import { MONTHS_SHORT } from '../config.js';

let _metaCharts = {};

export function renderMetas() {
  const goals  = getGoals();
  const now    = new Date();
  const month  = getTradesByMonth(now.getFullYear(), now.getMonth());
  const year   = getTradesByYear(now.getFullYear());
  const all    = _getTrades();
  const stats  = calcStats(month);
  const monthPnL = month.reduce((a, t) => a + t.pnl, 0);
  const yearPnL  = year.reduce((a, t) => a + t.pnl, 0);
  const wr       = stats.winRate;
  const rr       = stats.avgLoss > 0 ? stats.avgWin / stats.avgLoss : 0;

  // Cards de metas
  const goalsEl = document.getElementById('metas-goals-grid');
  if (goalsEl) {
    const goalCards = [
      { icon: '💰', label: 'Meta Mensal',   value: 'R$' + monthPnL.toFixed(0),  pct: goals.goalMonth > 0 ? Math.min(100, monthPnL / goals.goalMonth * 100) : 0, sub: `Meta: R$${goals.goalMonth || 0}`, accent: '#00F5A0', color: monthPnL >= 0 ? 'var(--green)' : 'var(--red)', footer: `Restante: R$${Math.max(0, (goals.goalMonth || 0) - monthPnL).toFixed(0)}` },
      { icon: '🎯', label: 'Meta Anual',    value: 'R$' + yearPnL.toFixed(0),   pct: goals.goalYear > 0 ? Math.min(100, yearPnL / goals.goalYear * 100) : 0,   sub: `Meta: R$${goals.goalYear || 0}`,  accent: '#3B9EFF', color: yearPnL >= 0 ? 'var(--green)' : 'var(--red)', footer: `${now.getMonth() + 1}/12 meses` },
      { icon: '📊', label: 'Win Rate',      value: wr.toFixed(1) + '%',          pct: goals.goalWinRate > 0 ? Math.min(100, wr / goals.goalWinRate * 100) : 0,  sub: `Meta: ${goals.goalWinRate || 60}%`, accent: '#7C5CFC', color: wr >= (goals.goalWinRate || 60) ? 'var(--green)' : 'var(--amber)', footer: `${stats.wins} vitórias · ${stats.losses} perdas` },
      { icon: '⚡', label: 'R:R Médio',     value: rr > 0 ? rr.toFixed(2) + 'R' : '—', pct: goals.goalRR > 0 ? Math.min(100, rr / goals.goalRR * 100) : 0, sub: `Meta: ${goals.goalRR || 1.5}R`, accent: '#FFB547', color: rr >= (goals.goalRR || 1.5) ? 'var(--green)' : 'var(--amber)', footer: `Avg ganho: R$${stats.avgWin.toFixed(0)}` },
    ];

    goalsEl.innerHTML = goalCards.map(g => `
      <div class="goal-card">
        <div style="font-size:28px;margin-bottom:10px">${g.icon}</div>
        <div class="goal-top">
          <span class="goal-name">${g.label}</span>
          <span class="goal-pct" style="color:${g.accent}">${g.pct.toFixed(0)}%</span>
        </div>
        <div class="goal-bar"><div class="goal-fill" style="width:${g.pct}%;background:${g.accent}"></div></div>
        <div class="goal-vals">
          <span style="color:${g.color};font-size:18px;font-weight:700;font-family:var(--font-mono)">${g.value}</span>
          <span>${g.sub}</span>
        </div>
        <div style="margin-top:8px;font-size:11px;color:var(--text-3);font-family:var(--font-mono)">${g.footer}</div>
      </div>
    `).join('');
  }

  // KPI row
  const kpiEl = document.getElementById('metas-kpi-row');
  if (kpiEl) {
    const grossWin  = month.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
    const grossLoss = Math.abs(month.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));
    const pf   = grossLoss > 0 ? grossWin / grossLoss : null;
    const maxDD = stats.maxDD;
    const exp   = stats.expectancy;

    kpiEl.innerHTML = [
      { icon: '💹', label: 'Profit Factor',   val: pf !== null ? pf.toFixed(2) : 'N/A', sub: 'Meta: >1.5', color: pf !== null && pf >= 1.5 ? 'var(--green)' : 'var(--red)' },
      { icon: '📊', label: 'Expectância/Dia', val: 'R$' + exp.toFixed(2), sub: 'Retorno esperado', color: exp >= 0 ? 'var(--green)' : 'var(--red)' },
      { icon: '📉', label: 'Max Drawdown',    val: 'R$' + maxDD.toFixed(2), sub: 'No mês atual', color: maxDD > 0 ? 'var(--red)' : 'var(--green)' },
      { icon: '🔢', label: 'Total de Trades', val: month.reduce((a, t) => a + (t.trades || 0), 0), sub: month.length + ' dias registrados', color: 'var(--blue)' },
    ].map(k => `
      <div class="kpi">
        <div style="font-size:20px;margin-bottom:8px">${k.icon}</div>
        <div class="kpi-tag">${k.label}</div>
        <div class="kpi-num" style="color:${k.color}">${k.val}</div>
        <div class="kpi-sub">${k.sub}</div>
      </div>
    `).join('');
  }

  // Gráficos
  renderMetaCharts(month, year, goals, wr);
  renderStreaks(all);
  renderYearSummary(year, now);
}

function renderMetaCharts(month, year, goals, wr) {
  const now = new Date();

  // Chart 1: P&L Mensal vs Meta (últimos 6 meses)
  const last6 = [];
  for (let i = 5; i >= 0; i--) {
    const d  = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mt = getTrades().filter(t => { const dd = new Date(t.date + 'T12:00:00'); return dd.getFullYear() === d.getFullYear() && dd.getMonth() === d.getMonth(); });
    last6.push({ label: MONTHS_SHORT[d.getMonth()], pnl: mt.reduce((a, t) => a + t.pnl, 0) });
  }
  const ctx1 = document.getElementById('metaMonthChart');
  if (ctx1) {
    if (_metaCharts.month) _metaCharts.month.destroy();
    _metaCharts.month = new Chart(ctx1.getContext('2d'), {
      type: 'bar',
      data: {
        labels: last6.map(x => x.label),
        datasets: [
          { label: 'P&L', data: last6.map(x => parseFloat(x.pnl.toFixed(2))), backgroundColor: last6.map(x => x.pnl >= 0 ? 'rgba(0,245,160,0.65)' : 'rgba(255,61,107,0.65)'), borderRadius: 5 },
          { label: 'Meta', data: last6.map(() => goals.goalMonth || 0), type: 'line', borderColor: 'rgba(255,181,71,0.7)', borderDash: [4, 3], borderWidth: 2, pointRadius: 0, fill: false },
        ],
      },
      options: { responsive: true, plugins: { legend: { display: true, labels: { color: '#8A96B0', font: { size: 10 } } } }, scales: { x: { ticks: { color: '#4A5470', font: { size: 9 } }, grid: { display: false } }, y: { ticks: { color: '#4A5470', font: { size: 9 } }, grid: { display: false } } } },
    });
  }

  // Chart 2: Win Rate donut
  const ctx2 = document.getElementById('metaWRChart');
  if (ctx2) {
    if (_metaCharts.wr) _metaCharts.wr.destroy();
    const w = month.filter(t => t.pnl > 0).length;
    const l = month.filter(t => t.pnl < 0).length;
    _metaCharts.wr = new Chart(ctx2.getContext('2d'), {
      type: 'doughnut',
      data: { labels: ['Ganhos', 'Perdas', 'Neutros'], datasets: [{ data: [w, l, Math.max(0.01, month.filter(t => t.pnl === 0).length)], backgroundColor: ['rgba(0,245,160,0.8)', 'rgba(255,61,107,0.8)', 'rgba(59,158,255,0.5)'], borderColor: 'transparent', borderWidth: 0 }] },
      options: { responsive: true, cutout: '70%', plugins: { legend: { display: true, position: 'bottom', labels: { color: '#8A96B0', font: { size: 11 }, padding: 14 } } } },
    });
  }

  // Chart 3: P&L por dia da semana
  const dm = { Dom: 0, Seg: 0, Ter: 0, Qua: 0, Qui: 0, Sex: 0, Sáb: 0 };
  getTrades().forEach(t => { const d = new Date(t.date + 'T12:00:00'); dm[['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d.getDay()]] += t.pnl; });
  const ctx3 = document.getElementById('metaDowChart');
  if (ctx3) {
    if (_metaCharts.dow) _metaCharts.dow.destroy();
    _metaCharts.dow = new Chart(ctx3.getContext('2d'), {
      type: 'bar',
      data: { labels: Object.keys(dm), datasets: [{ data: Object.values(dm).map(v => parseFloat(v.toFixed(2))), backgroundColor: Object.values(dm).map(v => v >= 0 ? 'rgba(59,158,255,0.7)' : 'rgba(255,61,107,0.7)'), borderRadius: 5 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#4A5470' }, grid: { display: false } }, y: { ticks: { color: '#4A5470', callback: v => 'R$' + v }, grid: { display: false } } } },
    });
  }

  // Chart 4: Distribuição R múltiplo
  const rrVals = getTrades().filter(t => t.rr != null).map(t => t.rr);
  const rrBuckets = { '<-1': 0, '-1—0': 0, '0—1': 0, '1—2': 0, '2—3': 0, '>3': 0 };
  rrVals.forEach(r => {
    if (r < -1)      rrBuckets['<-1']++;
    else if (r < 0)  rrBuckets['-1—0']++;
    else if (r < 1)  rrBuckets['0—1']++;
    else if (r < 2)  rrBuckets['1—2']++;
    else if (r < 3)  rrBuckets['2—3']++;
    else             rrBuckets['>3']++;
  });
  const ctx4 = document.getElementById('metaRRChart');
  if (ctx4) {
    if (_metaCharts.rr) _metaCharts.rr.destroy();
    _metaCharts.rr = new Chart(ctx4.getContext('2d'), {
      type: 'bar',
      data: { labels: Object.keys(rrBuckets), datasets: [{ data: Object.values(rrBuckets), backgroundColor: Object.keys(rrBuckets).map(k => (k.includes('1—') || k.includes('2—') || k === '>3') ? 'rgba(0,245,160,0.7)' : 'rgba(255,61,107,0.7)'), borderRadius: 5 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#4A5470' }, grid: { display: false } }, y: { ticks: { color: '#4A5470', stepSize: 1 }, grid: { display: false } } } },
    });
  }
}

function renderStreaks(all) {
  const el = document.getElementById('metas-streaks');
  if (!el) return;
  const sorted = [...all].sort((a, b) => a.date < b.date ? -1 : 1);
  let curWin = 0, curLoss = 0, maxWin = 0, maxLoss = 0;
  sorted.forEach(t => {
    if (t.pnl > 0) { curWin++; curLoss = 0; if (curWin > maxWin) maxWin = curWin; }
    else if (t.pnl < 0) { curLoss++; curWin = 0; if (curLoss > maxLoss) maxLoss = curLoss; }
    else { curWin = 0; curLoss = 0; }
  });
  let curStreak = 0, lastDir = null;
  [...sorted].reverse().some(t => {
    const dir = t.pnl > 0 ? 'win' : t.pnl < 0 ? 'loss' : null;
    if (!dir) return true;
    if (lastDir === null) { lastDir = dir; curStreak = 1; }
    else if (dir === lastDir) curStreak++;
    else return true;
  });

  el.innerHTML = [
    { label: '🔥 Sequência Atual',       val: curStreak + (lastDir === 'win' ? ' ganhos' : ' perdas'), color: lastDir === 'win' ? 'var(--green)' : 'var(--red)' },
    { label: '🏆 Maior Sequência +',     val: maxWin + ' dias', color: 'var(--green)' },
    { label: '⚠️ Maior Sequência −',     val: maxLoss + ' dias', color: 'var(--red)' },
    { label: '📅 Total Dias Registrados',val: all.length + ' dias', color: 'var(--blue)' },
    { label: '📈 Dias Positivos',         val: all.filter(t => t.pnl > 0).length + ' dias', color: 'var(--green)' },
    { label: '📉 Dias Negativos',         val: all.filter(t => t.pnl < 0).length + ' dias', color: 'var(--red)' },
  ].map(s => `
    <div class="streak-row">
      <span class="streak-label">${s.label}</span>
      <span class="streak-val" style="color:${s.color}">${s.val}</span>
    </div>
  `).join('');
}

function renderYearSummary(year, now) {
  const el = document.getElementById('metas-year-summary');
  if (!el) return;
  const s = calcStats(year);
  const yearPnL = year.reduce((a, t) => a + t.pnl, 0);
  const rr = s.avgLoss > 0 ? s.avgWin / s.avgLoss : 0;
  const posMonths = [...Array(12)].filter((_, i) => {
    const mt = year.filter(t => new Date(t.date + 'T12:00:00').getMonth() === i);
    return mt.reduce((a, t) => a + t.pnl, 0) > 0;
  }).length;

  el.innerHTML = [
    ['P&L Total Ano', (yearPnL >= 0 ? '+R$' : '-R$') + Math.abs(yearPnL).toFixed(2), yearPnL >= 0 ? 'var(--green)' : 'var(--red)'],
    ['Win Rate Anual', s.winRate.toFixed(1) + '%', s.winRate >= 60 ? 'var(--green)' : 'var(--amber)'],
    ['Avg Ganho', 'R$' + s.avgWin.toFixed(2), 'var(--green)'],
    ['Avg Perda', '-R$' + s.avgLoss.toFixed(2), 'var(--red)'],
    ['R:R Anual', rr.toFixed(2) + 'R', rr >= 1.5 ? 'var(--green)' : 'var(--amber)'],
    ['Max Drawdown', 'R$' + s.maxDD.toFixed(2), 'var(--red)'],
    ['Meses Positivos', posMonths + '/' + (now.getMonth() + 1), 'var(--blue)'],
    ['Total Trades', year.reduce((a, t) => a + (t.trades || 0), 0), 'var(--text-1)'],
  ].map(([k, v, c]) => `
    <div class="stat-row">
      <span class="stat-key">${k}</span>
      <span class="stat-val" style="color:${c}">${v}</span>
    </div>
  `).join('');
}

function getTrades() { return window.TROS ? window.TROS.getTrades() : []; }


// ═══════════════════════════════════════
//  TRADER OS · ui/propfirm-ui.js
// ═══════════════════════════════════════

import { evaluatePropFirm, getStatusLabel } from '../propfirm.js';
import { getActiveAccount, getConfig } from '../db.js';

export function renderPropFirm() {
  const container = document.getElementById('propfirm-content');
  if (!container) return;

  const acct   = getActiveAccount();
  const config = getConfig();

  if (!acct) {
    container.innerHTML = '<p style="color:var(--text-3);padding:40px;text-align:center">Nenhuma conta ativa</p>';
    return;
  }

  const status = evaluatePropFirm(acct.id || '', config, acct.capital || 10000);
  const { overallStatus, checks, alerts, summary } = status;
  const { label, color } = getStatusLabel(overallStatus);

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <div>
        <div style="font-size:13px;color:var(--text-3);margin-bottom:4px">Status do Desafio</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="pf-status-badge ${overallStatus}">${label}</span>
          <span style="font-size:13px;color:var(--text-2)">${acct.name}</span>
        </div>
      </div>
      <div style="margin-left:auto;text-align:right">
        <div style="font-family:var(--font-mono);font-size:22px;font-weight:700;color:${summary.totalPnL >= 0 ? 'var(--green)' : 'var(--red)'}">
          ${summary.totalPnL >= 0 ? '+' : ''}R$${Math.abs(summary.totalPnL).toFixed(2)}
        </div>
        <div style="font-size:11px;color:var(--text-3)">P&L acumulado</div>
      </div>
    </div>

    ${alerts.length ? `
      <div style="margin-bottom:16px">
        ${alerts.map(a => `<div class="banner ${a.level === 'danger' ? 'danger' : a.level === 'success' ? 'success' : 'warning'}" style="margin-bottom:8px">${a.message}</div>`).join('')}
      </div>
    ` : ''}

    <div class="propfirm-checks">
      ${checks.map(c => {
        const { label, color } = getStatusLabel(c.status);
        const pct = Math.min(100, c.pct);
        const barColor = c.status === 'ok' || c.status === 'achieved' ? 'var(--green)' : c.status === 'warning' ? 'var(--amber)' : 'var(--red)';
        return `
          <div class="check-row ${c.status}">
            <div class="check-label">${c.label}</div>
            <div class="check-values">
              <span class="check-current" style="color:${c.violated ? 'var(--red)' : c.achieved ? 'var(--green)' : 'var(--text-1)'}">${c.value}</span>
              <span class="check-limit">Limite: ${c.limit_value}</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width:${pct}%;background:${barColor}"></div>
            </div>
            <div style="font-size:11px;color:var(--text-3);margin-top:4px;display:flex;justify-content:space-between">
              <span>${pct.toFixed(0)}% utilizado</span>
              <span class="pf-status-badge ${c.status}" style="font-size:10px;padding:2px 8px">${label}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <div style="margin-top:16px" class="card">
      <div class="card-title" style="margin-bottom:12px">Resumo da Conta</div>
      ${[
        ['Saldo Atual', 'R$' + summary.balance.toFixed(2), summary.totalPnL >= 0 ? 'var(--green)' : 'var(--red)'],
        ['P&L Hoje', (summary.dailyPnL >= 0 ? '+' : '') + 'R$' + Math.abs(summary.dailyPnL).toFixed(2), summary.dailyPnL >= 0 ? 'var(--green)' : 'var(--red)'],
        ['Drawdown Atual', 'R$' + summary.drawdown.toFixed(2), 'var(--red)'],
        ['Dias de Trading', summary.tradingDays + ' dias', 'var(--blue)'],
      ].map(([k, v, c]) => `
        <div class="stat-row">
          <span class="stat-key">${k}</span>
          <span class="stat-val" style="color:${c}">${v}</span>
        </div>
      `).join('')}
    </div>
  `;
}
