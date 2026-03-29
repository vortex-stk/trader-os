// ═══════════════════════════════════════
//  TRADER OS · ui/dashboard.js
//  Renderização do Dashboard principal
// ═══════════════════════════════════════

import { getTrades, getTradesByMonth, getTradesByYear, calcStats, getActiveAccount, getConfig } from '../db.js';
import { MONTHS, MONTHS_SHORT, WEEKDAYS } from '../config.js';
import { fmt$, fmtPct } from './components.js';

let _charts = {};
let _eqFilter = '1M';

export function renderDashboard() {
  const now   = new Date();
  const acct  = getActiveAccount();
  const cfg   = getConfig();
  const all   = getTrades();
  const month = getTradesByMonth(now.getFullYear(), now.getMonth());
  const year  = getTradesByYear(now.getFullYear());
  const stats = calcStats(month);
  const totalPnL = all.reduce((a, t) => a + t.pnl, 0);
  const balance  = (acct?.capital || 10000) + totalPnL;

  // Subtítulo
  el('dash-subtitle', `${acct?.name || '—'} · ${MONTHS[now.getMonth()]} ${now.getFullYear()}`);

  // Alertas prop firm
  renderAlerts(cfg, acct, all);

  // KPIs
  renderKPIs(stats, month, totalPnL, balance, acct, cfg);

  // Equity stats
  renderEquityStats(totalPnL, balance, acct);

  // Gráfico equity
  renderEquityChart(all, acct?.capital || 10000);

  // Donut win rate
  renderWinRateDonut(stats);

  // Performance list
  renderPerfList(stats, month);

  // Barras mensais
  renderMonthlyBars(now);

  // Drawdown tracker
  renderDrawdownTracker(all, acct?.capital || 10000, cfg);

  // Distribuição por sessão
  renderSessionBars(month);
}

// ── Alertas ──────────────────────────
function renderAlerts(cfg, acct, all) {
  const container = document.getElementById('dash-alerts');
  if (!container) return;

  const alerts = [];
  const todayStr = new Date().toISOString().slice(0, 10);
  const today = all.filter(t => t.date === todayStr);
  const todayPnL = today.reduce((a, t) => a + t.pnl, 0);
  const totalPnL = all.reduce((a, t) => a + t.pnl, 0);
  const cap = acct?.capital || 10000;

  if (cfg.maxDailyLoss > 0 && todayPnL < 0) {
    const pct = Math.abs(todayPnL) / cfg.maxDailyLoss * 100;
    if (pct >= 100) alerts.push({ type: 'danger',  msg: 'Limite de perda diária atingido!', sub: `${fmt$(todayPnL)} hoje` });
    else if (pct >= 75) alerts.push({ type: 'warning', msg: `Atenção: ${pct.toFixed(0)}% do limite diário atingido`, sub: fmt$(todayPnL) + ' hoje' });
  }
  if (cfg.maxTotalLoss > 0 && totalPnL < 0) {
    const pct = Math.abs(totalPnL) / cfg.maxTotalLoss * 100;
    if (pct >= 90) alerts.push({ type: 'danger', msg: 'Max Loss quase atingido!', sub: `${fmt$(totalPnL)} total` });
  }

  container.innerHTML = alerts.map(a => `
    <div class="banner ${a.type}">
      <div style="flex:1">
        <strong>${a.msg}</strong>
        <div style="font-size:11px;opacity:0.7;margin-top:2px">${a.sub}</div>
      </div>
      <button class="banner-close" onclick="this.closest('.banner').remove()">✕</button>
    </div>
  `).join('');
}

// ── KPIs ─────────────────────────────
function renderKPIs(stats, month, totalPnL, balance, acct, cfg) {
  const container = document.getElementById('kpi-grid');
  if (!container) return;

  const cap = acct?.capital || 10000;
  const prevDate = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d; })();
  const prevMonth = getTrades().filter(t => {
    const d = new Date(t.date + 'T12:00:00');
    return d.getFullYear() === prevDate.getFullYear() && d.getMonth() === prevDate.getMonth();
  });
  const prevPnL  = prevMonth.reduce((a, t) => a + t.pnl, 0);
  const monthPnL = month.reduce((a, t) => a + t.pnl, 0);
  const pnlDiff  = prevPnL !== 0 ? ((monthPnL - prevPnL) / Math.abs(prevPnL) * 100) : 0;
  const ddPct    = cap > 0 ? (stats.maxDD / cap * 100) : 0;
  const retPct   = cap > 0 ? (totalPnL / cap * 100) : 0;

  const kpis = [
    {
      tag: 'P&L do Mês', cls: monthPnL >= 0 ? 'g' : 'r',
      val: (monthPnL >= 0 ? '+R$' : '-R$') + Math.abs(monthPnL).toFixed(0),
      sub: pnlDiff !== 0 ? `${pnlDiff >= 0 ? '▲' : '▼'} ${Math.abs(pnlDiff).toFixed(1)}% vs mês anterior` : 'Primeiro mês',
      line: 'linear-gradient(90deg,#00F5A0,#00C8FF)',
    },
    {
      tag: 'Win Rate', cls: 'b',
      val: fmtPct(stats.winRate),
      sub: `${stats.wins} vitórias · ${stats.losses} perdas`,
      line: 'linear-gradient(90deg,#3B9EFF,#7C5CFC)',
    },
    {
      tag: 'Profit Factor', cls: stats.profitFactor >= 1.5 ? 'g' : 'o',
      val: stats.profitFactor !== null ? stats.profitFactor.toFixed(2) : '—',
      sub: `Meta: >1.5`,
      line: 'linear-gradient(90deg,#00C8FF,#3B9EFF)',
    },
    {
      tag: 'Max Drawdown', cls: 'r',
      val: ddPct > 0 ? '-' + ddPct.toFixed(2) + '%' : '0%',
      sub: `Limite: ${cfg.maxTotalLoss > 0 ? (cfg.maxTotalLoss / cap * 100).toFixed(0) + '%' : '—'}`,
      line: 'linear-gradient(90deg,#FF3D6B,#FF8C69)',
    },
    {
      tag: 'R:R Médio', cls: 'o',
      val: stats.avgLoss > 0 ? (stats.avgWin / stats.avgLoss).toFixed(2) + 'R' : '—',
      sub: `${stats.totalTrades} operações no mês`,
      line: 'linear-gradient(90deg,#FFB547,#FFD700)',
    },
    {
      tag: 'Retorno Total', cls: totalPnL >= 0 ? 'g' : 'r',
      val: (retPct >= 0 ? '+' : '') + retPct.toFixed(2) + '%',
      sub: `Saldo: ${fmt$(balance)}`,
      line: totalPnL >= 0 ? 'linear-gradient(90deg,#00F5A0,#22D3EE)' : 'linear-gradient(90deg,#FF3D6B,#FF8C69)',
    },
  ];

  container.innerHTML = kpis.map(k => `
    <div class="kpi">
      <div class="kpi-accent" style="background:${k.line}"></div>
      <div class="kpi-tag">${k.tag}</div>
      <div class="kpi-num ${k.cls}">${k.val}</div>
      <div class="kpi-sub">${k.sub}</div>
    </div>
  `).join('');
}

// ── Equity stats ──────────────────────
function renderEquityStats(totalPnL, balance, acct) {
  const cap    = acct?.capital || 10000;
  const retPct = cap > 0 ? (totalPnL / cap * 100) : 0;

  const container = document.getElementById('equity-stats');
  if (!container) return;

  container.innerHTML = `
    <div>
      <span class="eq-val ${totalPnL >= 0 ? 'g' : 'r'}">${totalPnL >= 0 ? '+' : ''}${fmt$(totalPnL)}</span>
      <span class="eq-lbl">P&L Total</span>
    </div>
    <div>
      <span class="eq-val">${fmt$(balance)}</span>
      <span class="eq-lbl">Saldo da Conta</span>
    </div>
    <div>
      <span class="eq-val ${retPct >= 0 ? 'g' : 'r'}">${retPct >= 0 ? '+' : ''}${retPct.toFixed(2)}%</span>
      <span class="eq-lbl">Retorno</span>
    </div>
  `;
}

// ── Equity chart ──────────────────────
export function renderEquityChart(trades, cap, filter) {
  if (filter) _eqFilter = filter;

  const now = new Date();
  let filtered = [...trades].sort((a, b) => a.date < b.date ? -1 : 1);

  if (_eqFilter === '1M') {
    const cut = new Date(now.getFullYear(), now.getMonth(), 1);
    filtered = filtered.filter(t => new Date(t.date + 'T12:00:00') >= cut);
  } else if (_eqFilter === '3M') {
    const cut = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    filtered = filtered.filter(t => new Date(t.date + 'T12:00:00') >= cut);
  } else if (_eqFilter === 'YTD') {
    const cut = new Date(now.getFullYear(), 0, 1);
    filtered = filtered.filter(t => new Date(t.date + 'T12:00:00') >= cut);
  }

  const allSorted = [...trades].sort((a, b) => a.date < b.date ? -1 : 1);
  const startCap  = cap + allSorted.filter(t => !filtered.includes(t)).reduce((a, t) => a + t.pnl, 0);

  let cum = 0;
  const labels = ['Início'], data = [parseFloat(startCap.toFixed(2))];
  filtered.forEach(t => { cum += t.pnl; labels.push(t.date.slice(5)); data.push(parseFloat((startCap + cum).toFixed(2))); });

  const ctx = document.getElementById('eqChart');
  if (!ctx) return;
  if (_charts.eq) _charts.eq.destroy();

  const up   = data[data.length - 1] >= data[0];
  const color = up ? '#00F5A0' : '#FF3D6B';
  const grad  = ctx.getContext('2d').createLinearGradient(0, 0, 0, 240);
  grad.addColorStop(0, up ? 'rgba(0,245,160,0.22)' : 'rgba(255,61,107,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');

  _charts.eq = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data, borderColor: color, backgroundColor: grad,
        borderWidth: 2.5, fill: true, tension: 0.4,
        pointRadius: 0, pointHoverRadius: 5,
        pointHoverBackgroundColor: color,
      }],
    },
    options: {
      responsive: true, aspectRatio: 3.2,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0c1220', borderColor: 'rgba(255,255,255,0.06)',
          borderWidth: 1, padding: 10,
          callbacks: { label: c => '  R$' + c.raw.toFixed(2) },
        },
      },
      scales: {
        x: { ticks: { color: '#3A4155', font: { size: 9 }, maxTicksLimit: 12 }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#3A4155', font: { size: 9 }, callback: v => 'R$' + v.toFixed(0) }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
    },
  });
}

// ── Win rate donut ─────────────────────
function renderWinRateDonut(stats) {
  const ctx = document.getElementById('wrDonut');
  if (!ctx) return;
  if (_charts.wrDonut) _charts.wrDonut.destroy();

  _charts.wrDonut = new Chart(ctx.getContext('2d'), {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [stats.wins || 0.001, stats.losses || 0.001],
        backgroundColor: ['rgba(0,245,160,0.85)', 'rgba(255,61,107,0.85)'],
        borderColor: 'transparent', borderWidth: 0,
      }],
    },
    options: {
      cutout: '72%',
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: { duration: 700 },
    },
  });

  el('wr-center',  stats.winRate.toFixed(0) + '%');
  el('wr-detail',  `${stats.wins} vitórias · ${stats.losses} perdas`);
}

// ── Performance list ───────────────────
function renderPerfList(stats, month) {
  const container = document.getElementById('perf-list');
  if (!container) return;

  const sorted = [...month].sort((a, b) => b.pnl - a.pnl);
  const bestDay  = sorted[0];
  const worstDay = sorted[sorted.length - 1];
  const expect   = stats.expectancy;
  const rr       = stats.avgLoss > 0 ? (stats.avgWin / stats.avgLoss) : 0;

  const rows = [
    ['Win Rate',      fmtPct(stats.winRate),                 stats.winRate >= 50 ? 'g' : 'r'],
    ['Avg Ganho',     stats.avgWin > 0 ? '+' + fmt$(stats.avgWin) : '—',  'g'],
    ['Avg Perda',     stats.avgLoss > 0 ? '-' + fmt$(stats.avgLoss) : '—', 'r'],
    ['R:R Médio',     rr > 0 ? rr.toFixed(2) + 'R' : '—',  rr >= 1.5 ? 'g' : 'o'],
    ['Melhor Dia',    bestDay  ? '+' + fmt$(bestDay.pnl)       : '—', 'g'],
    ['Pior Dia',      worstDay && worstDay.pnl < 0 ? '-' + fmt$(Math.abs(worstDay.pnl)) : '—', 'r'],
    ['Profit Factor', stats.profitFactor !== null ? stats.profitFactor.toFixed(2) : '—', stats.profitFactor >= 1.5 ? 'g' : 'o'],
    ['Expectância',   expect >= 0 ? '+' + fmt$(expect) + '/op' : fmt$(expect) + '/op', expect >= 0 ? 'g' : 'r'],
  ];

  const colors = { g: '#00F5A0', r: '#FF5B70', b: '#5BB4FF', o: '#FFB547' };

  container.innerHTML = rows.map(([k, v, c]) => `
    <div class="stat-row">
      <span class="stat-key">${k}</span>
      <span class="stat-val" style="color:${colors[c] || '#fff'}">${v}</span>
    </div>
  `).join('');
}

// ── Monthly bars ──────────────────────
function renderMonthlyBars(now) {
  el('monthly-year-label', 'Ano ' + now.getFullYear());
  const ctx = document.getElementById('monthlyChart');
  if (!ctx) return;
  if (_charts.monthly) _charts.monthly.destroy();

  const months = MONTHS_SHORT.map((label, i) => {
    const trades = getTrades().filter(t => {
      const d = new Date(t.date + 'T12:00:00');
      return d.getFullYear() === now.getFullYear() && d.getMonth() === i;
    });
    return { label, pnl: trades.reduce((a, t) => a + t.pnl, 0) };
  });

  _charts.monthly = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels: months.map(m => m.label),
      datasets: [{
        data: months.map(m => parseFloat(m.pnl.toFixed(2))),
        backgroundColor: months.map(m => m.pnl >= 0 ? 'rgba(0,245,160,0.75)' : 'rgba(255,61,107,0.75)'),
        borderRadius: 4, borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0c1220', callbacks: { label: c => (c.raw >= 0 ? '+R$' : '-R$') + Math.abs(c.raw).toFixed(2) } } },
      scales: {
        x: { ticks: { color: '#3A4155', font: { size: 9 } }, grid: { display: false } },
        y: { ticks: { color: '#3A4155', font: { size: 9 }, callback: v => 'R$' + v }, grid: { display: false } },
      },
    },
  });
}

// ── Drawdown tracker ───────────────────
function renderDrawdownTracker(all, cap, cfg) {
  const sorted = [...all].sort((a, b) => a.date < b.date ? -1 : 1);
  let peak = cap, cumPnL = 0, maxDD = 0, curDD = 0;
  const labels = [], ddData = [];

  sorted.forEach(t => {
    cumPnL += t.pnl;
    const bal = cap + cumPnL;
    if (bal > peak) peak = bal;
    curDD = ((peak - bal) / cap * 100);
    if (curDD > maxDD) maxDD = curDD;
    labels.push(t.date.slice(5));
    ddData.push(parseFloat((-curDD).toFixed(4)));
  });

  if (!labels.length) { labels.push('Início'); ddData.push(0); }

  const limitPct = cfg.maxTotalLoss > 0 ? (cfg.maxTotalLoss / cap * 100) : 10;
  el('dd-limit-label', `Limite: ${limitPct.toFixed(0)}%`);

  const ctx = document.getElementById('ddChart');
  if (!ctx) return;
  if (_charts.dd) _charts.dd.destroy();

  const grad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 120);
  grad.addColorStop(0, 'rgba(255,61,107,0.30)');
  grad.addColorStop(1, 'rgba(255,61,107,0.02)');

  _charts.dd = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: ddData, borderColor: 'rgba(255,61,107,0.9)',
        backgroundColor: grad, borderWidth: 2, fill: true,
        tension: 0.3, pointRadius: 0,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#3A4155', font: { size: 9 }, maxTicksLimit: 8 }, grid: { display: false } },
        y: { ticks: { color: '#3A4155', font: { size: 9 }, callback: v => v.toFixed(1) + '%' }, grid: { display: false } },
      },
    },
  });

  const ddContainer = document.getElementById('dd-stats');
  if (ddContainer) {
    ddContainer.innerHTML = [
      { v: '-' + curDD.toFixed(2) + '%', l: 'Atual',    c: 'var(--red)' },
      { v: '-' + maxDD.toFixed(2) + '%', l: 'Max DD',   c: 'var(--red)' },
      { v: '+' + Math.max(0, limitPct - maxDD).toFixed(2) + '%', l: 'Restante', c: 'var(--green)' },
    ].map(s => `
      <div class="dd-stat">
        <div class="dd-stat-val" style="color:${s.c}">${s.v}</div>
        <div class="dd-stat-lbl">${s.l}</div>
      </div>
    `).join('');
  }
}

// ── Sessões ───────────────────────────
function renderSessionBars(month) {
  const container = document.getElementById('session-bars');
  if (!container) return;

  const sessions = {};
  month.forEach(t => {
    const s = t.session || 'Sem sessão';
    if (!sessions[s]) sessions[s] = 0;
    sessions[s] += t.pnl;
  });

  const max = Math.max(...Object.values(sessions).map(Math.abs), 1);
  const colors = ['#00F5A0','#3B9EFF','#7C5CFC','#FFB547','#22D3EE','#FF3D6B'];

  container.innerHTML = Object.entries(sessions)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([name, pnl], i) => `
      <div class="session-row">
        <span class="session-name">${name}</span>
        <div class="session-track">
          <div class="session-fill" style="width:${Math.abs(pnl) / max * 100}%;background:${pnl >= 0 ? colors[i % colors.length] : 'var(--red)'}"></div>
        </div>
        <span class="session-val" style="color:${pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${pnl >= 0 ? '+' : ''}R$${Math.abs(pnl).toFixed(0)}</span>
      </div>
    `).join('') || '<p style="color:var(--text-3);font-size:13px">Nenhum dado de sessão registrado</p>';
}

// ── Filtro equity ─────────────────────
export function initEquityFilters() {
  document.querySelectorAll('[data-eq-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-eq-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const all  = getTrades();
      const acct = getActiveAccount();
      renderEquityChart(all, acct?.capital || 10000, btn.dataset.eqFilter);
    });
  });
}

// ── Util ──────────────────────────────
function el(id, text) {
  const e = document.getElementById(id);
  if (e) e.textContent = text;
}
