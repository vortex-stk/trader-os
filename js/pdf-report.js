// ═══════════════════════════════════════
//  TRADER OS · pdf-report.js
//  Geração de relatório PDF mensal
//  Usa a API Canvas → imagem → window.print()
//  Não depende de bibliotecas externas.
// ═══════════════════════════════════════

import { getTrades, getTradesByMonth, getTradesByYear, calcStats, getActiveAccount, getGoals } from './db.js';
import { MONTHS, MONTHS_SHORT, WEEKDAYS } from './config.js';

// ── Gera e abre o relatório PDF ────────
export async function generateMonthlyReport(year, month) {
  const now    = new Date();
  year  = year  ?? now.getFullYear();
  month = month ?? now.getMonth();

  const acct   = getActiveAccount();
  const trades = getTradesByMonth(year, month);
  const all    = getTrades();
  const goals  = getGoals();
  const stats  = calcStats(trades);

  const yearTrades = getTradesByYear(year);
  const monthPnL   = trades.reduce((a, t) => a + t.pnl, 0);
  const totalPnL   = all.reduce((a, t) => a + t.pnl, 0);
  const balance    = (acct?.capital || 10000) + totalPnL;
  const retPct     = acct?.capital > 0 ? (monthPnL / acct.capital * 100) : 0;

  const monthName  = MONTHS[month];
  const reportDate = `${monthName} ${year}`;

  // Calcula série de equity do mês
  const equitySeries = buildEquitySeries(trades, (acct?.capital || 10000) + all.filter(t => {
    const d = new Date(t.date + 'T12:00:00');
    return d < new Date(year, month, 1);
  }).reduce((a, t) => a + t.pnl, 0));

  const html = buildReportHTML({
    acct, stats, trades, yearTrades, goals,
    monthPnL, totalPnL, balance, retPct,
    reportDate, monthName, year, month,
    equitySeries,
  });

  // Abre em nova aba e dispara impressão
  const win = window.open('', '_blank');
  if (!win) {
    alert('Permita pop-ups para gerar o PDF.');
    return;
  }
  win.document.write(html);
  win.document.close();
  win.addEventListener('load', () => {
    setTimeout(() => win.print(), 500);
  });
}

// ── Série de equity ───────────────────
function buildEquitySeries(trades, startCap) {
  const sorted = [...trades].sort((a, b) => a.date < b.date ? -1 : 1);
  let cum = 0;
  return [{ date: 'Início', val: startCap }, ...sorted.map(t => {
    cum += t.pnl;
    return { date: t.date.slice(5), val: parseFloat((startCap + cum).toFixed(2)) };
  })];
}

// ── Gera o HTML completo do relatório ─
function buildReportHTML({ acct, stats, trades, yearTrades, goals, monthPnL, totalPnL, balance, retPct, reportDate, monthName, year, month, equitySeries }) {
  const fmt = v => 'R$' + Math.abs(v).toFixed(2);
  const fmtSign = v => (v >= 0 ? '+R$' : '-R$') + Math.abs(v).toFixed(2);
  const fmtPct  = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';

  const rr = stats.avgLoss > 0 ? (stats.avgWin / stats.avgLoss).toFixed(2) : '—';
  const pf = stats.profitFactor !== null ? stats.profitFactor.toFixed(2) : '—';

  // Agrupa trades por semana
  const byWeek = {};
  trades.forEach(t => {
    const d   = new Date(t.date + 'T12:00:00');
    const wk  = `Semana ${Math.ceil(d.getDate() / 7)}`;
    if (!byWeek[wk]) byWeek[wk] = { pnl: 0, trades: 0, days: 0 };
    byWeek[wk].pnl    += t.pnl;
    byWeek[wk].trades += t.trades || 0;
    byWeek[wk].days++;
  });

  // P&L por dia da semana
  const byDow = { Dom:0, Seg:0, Ter:0, Qua:0, Qui:0, Sex:0, Sáb:0 };
  trades.forEach(t => { const d = new Date(t.date + 'T12:00:00'); byDow[WEEKDAYS[d.getDay()]] += t.pnl; });

  // Top setups
  const setups = {};
  trades.forEach(t => { if(t.setup){ if(!setups[t.setup]) setups[t.setup]={pnl:0,n:0}; setups[t.setup].pnl+=t.pnl; setups[t.setup].n++; } });
  const topSetups = Object.entries(setups).sort((a,b) => b[1].pnl - a[1].pnl).slice(0, 5);

  // Gráfico de equity simples (SVG)
  const eqSVG = buildEquitySVG(equitySeries);

  // Gráfico de barras mensais (SVG)
  const dowSVG = buildDowSVG(byDow);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório ${reportDate} — ${acct?.name || 'Trader OS'}</title>
<style>
  @page { size: A4; margin: 20mm 18mm; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI',Arial,sans-serif; font-size:10pt; color:#111; line-height:1.5; }

  .header { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:12px; border-bottom:2px solid #111; margin-bottom:20px; }
  .header-brand { font-size:18pt; font-weight:900; letter-spacing:.06em; color:#111; }
  .header-sub { font-size:9pt; color:#666; margin-top:3px; }
  .header-right { text-align:right; }
  .header-period { font-size:14pt; font-weight:700; }
  .header-acct { font-size:9pt; color:#666; }

  h2 { font-size:11pt; font-weight:700; margin:20px 0 10px; padding-bottom:4px; border-bottom:1px solid #ddd; color:#222; }
  h3 { font-size:9.5pt; font-weight:700; margin:14px 0 7px; color:#333; }

  .kpi-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:10px; margin-bottom:18px; }
  .kpi { background:#f8f9fa; border:1px solid #e9ecef; border-radius:6px; padding:10px 12px; }
  .kpi-label { font-size:7.5pt; font-weight:700; text-transform:uppercase; letter-spacing:.1em; color:#888; margin-bottom:4px; }
  .kpi-value { font-size:14pt; font-weight:900; color:#111; }
  .kpi-sub   { font-size:7.5pt; color:#888; margin-top:2px; }
  .kpi-value.pos { color:#10b981; }
  .kpi-value.neg { color:#ef4444; }

  .two-col { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; }
  .three-col { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:16px; }

  table { width:100%; border-collapse:collapse; font-size:9pt; }
  th { background:#f1f3f5; padding:6px 10px; text-align:left; font-size:7.5pt; text-transform:uppercase; letter-spacing:.08em; color:#666; font-weight:700; border-bottom:1px solid #dee2e6; }
  td { padding:7px 10px; border-bottom:1px solid #f1f3f5; }
  tr:last-child td { border-bottom:none; }
  .pos { color:#10b981; font-weight:700; }
  .neg { color:#ef4444; font-weight:700; }
  .mono { font-family:monospace; }

  .stat-table { }
  .stat-row { display:flex; justify-content:space-between; align-items:center; padding:7px 0; border-bottom:1px solid #f1f3f5; }
  .stat-row:last-child { border-bottom:none; }
  .stat-key { font-size:9pt; color:#555; }
  .stat-val { font-size:9pt; font-weight:700; }

  .chart-box { background:#fafafa; border:1px solid #e9ecef; border-radius:6px; padding:12px; margin-bottom:14px; }
  .chart-title { font-size:9pt; font-weight:700; color:#333; margin-bottom:8px; }

  .goal-row { display:flex; align-items:center; gap:10px; padding:6px 0; border-bottom:1px solid #f1f3f5; }
  .goal-name { font-size:9pt; color:#555; width:140px; }
  .goal-bar-wrap { flex:1; height:6px; background:#e9ecef; border-radius:99px; overflow:hidden; }
  .goal-bar-fill { height:100%; border-radius:99px; background:#10b981; }
  .goal-pct  { font-size:9pt; font-weight:700; color:#111; width:36px; text-align:right; }
  .goal-val  { font-size:9pt; color:#666; width:100px; text-align:right; }

  .footer { margin-top:24px; padding-top:10px; border-top:1px solid #ddd; display:flex; justify-content:space-between; font-size:7.5pt; color:#aaa; }

  @media print {
    body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .no-print { display:none; }
  }
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="header-brand">TRADER OS</div>
    <div class="header-sub">Relatório Mensal de Performance</div>
  </div>
  <div class="header-right">
    <div class="header-period">${reportDate}</div>
    <div class="header-acct">${acct?.name || 'Conta'} · Gerado em ${new Date().toLocaleDateString('pt-BR')}</div>
  </div>
</div>

<!-- KPIs principais -->
<div class="kpi-grid">
  <div class="kpi">
    <div class="kpi-label">P&L do Mês</div>
    <div class="kpi-value ${monthPnL>=0?'pos':'neg'}">${fmtSign(monthPnL)}</div>
    <div class="kpi-sub">${fmtPct(retPct)} do capital</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Win Rate</div>
    <div class="kpi-value ${stats.winRate>=50?'pos':'neg'}">${stats.winRate.toFixed(1)}%</div>
    <div class="kpi-sub">${stats.wins}V · ${stats.losses}P de ${trades.length} dias</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Profit Factor</div>
    <div class="kpi-value ${parseFloat(pf)>=1.5?'pos':''}">${pf}</div>
    <div class="kpi-sub">Meta: &gt;1.5</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">R:R Médio</div>
    <div class="kpi-value">${rr}R</div>
    <div class="kpi-sub">Expectância: ${fmtSign(stats.expectancy)}/op</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Max Drawdown</div>
    <div class="kpi-value neg">${fmt(stats.maxDD)}</div>
    <div class="kpi-sub">Saldo: ${fmt(balance)}</div>
  </div>
</div>

<!-- Equity e estatísticas -->
<div class="two-col">
  <div>
    <h2>Curva de Equity</h2>
    <div class="chart-box">${eqSVG}</div>
  </div>
  <div>
    <h2>Estatísticas Detalhadas</h2>
    <div class="stat-table">
      ${[
        ['Avg Ganho',   fmt(stats.avgWin),        'pos'],
        ['Avg Perda',   '-' + fmt(stats.avgLoss),  'neg'],
        ['Melhor Dia',  trades.length ? fmtSign(Math.max(...trades.map(t=>t.pnl))) : '—', 'pos'],
        ['Pior Dia',    trades.length ? fmtSign(Math.min(...trades.map(t=>t.pnl))) : '—', 'neg'],
        ['Total Trades', trades.reduce((a,t)=>a+(t.trades||0),0), ''],
        ['Dias Ativos', trades.length, ''],
        ['P&L Acumulado', fmtSign(totalPnL), totalPnL>=0?'pos':'neg'],
        ['Saldo Conta', fmt(balance), ''],
      ].map(([k,v,c])=>`<div class="stat-row"><span class="stat-key">${k}</span><span class="stat-val ${c}">${v}</span></div>`).join('')}
    </div>
  </div>
</div>

<!-- P&L por dia da semana -->
<div class="two-col">
  <div>
    <h2>P&L por Dia da Semana</h2>
    <div class="chart-box">${dowSVG}</div>
  </div>
  <div>
    <h2>Performance por Setup</h2>
    ${topSetups.length ? `
    <table>
      <thead><tr><th>Setup</th><th>Dias</th><th>P&L Total</th><th>Média/Dia</th></tr></thead>
      <tbody>
        ${topSetups.map(([name,s])=>`<tr>
          <td>${name}</td>
          <td class="mono">${s.n}</td>
          <td class="mono ${s.pnl>=0?'pos':'neg'}">${fmtSign(s.pnl)}</td>
          <td class="mono ${s.pnl>=0?'pos':'neg'}">${fmtSign(s.pnl/s.n)}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : '<p style="color:#888;font-size:9pt">Nenhum setup registrado este mês.</p>'}
  </div>
</div>

<!-- Semanas -->
<h2>Resumo por Semana</h2>
<table>
  <thead><tr><th>Semana</th><th>Dias</th><th>Total Trades</th><th>P&L</th><th>Média/Dia</th></tr></thead>
  <tbody>
    ${Object.entries(byWeek).map(([wk,s])=>`<tr>
      <td>${wk}</td>
      <td class="mono">${s.days}</td>
      <td class="mono">${s.trades}</td>
      <td class="mono ${s.pnl>=0?'pos':'neg'}">${fmtSign(s.pnl)}</td>
      <td class="mono ${s.pnl>=0?'pos':'neg'}">${fmtSign(s.pnl/s.days)}</td>
    </tr>`).join('')}
  </tbody>
</table>

<!-- Metas -->
<h2>Metas — ${reportDate}</h2>
${[
  { name:'Meta Mensal', target:goals.goalMonth||0, current:monthPnL },
  { name:'Win Rate',    target:goals.goalWinRate||60, current:stats.winRate, suffix:'%' },
  { name:'R:R Mínimo',  target:goals.goalRR||1.5, current:parseFloat(rr)||0, suffix:'R' },
].map(g => {
  const pct = g.target > 0 ? Math.min(100, Math.max(0, g.current/g.target*100)) : 0;
  const achieved = g.current >= g.target;
  return `<div class="goal-row">
    <span class="goal-name">${g.name}</span>
    <div class="goal-bar-wrap"><div class="goal-bar-fill" style="width:${pct}%;background:${achieved?'#10b981':'#f59e0b'}"></div></div>
    <span class="goal-pct">${pct.toFixed(0)}%</span>
    <span class="goal-val ${achieved?'pos':''}">${g.current.toFixed(g.suffix?1:2)}${g.suffix||''} / ${g.target}${g.suffix||''}</span>
  </div>`;
}).join('')}

<!-- Registro de trades -->
<h2>Registro de Trades — ${monthName} ${year}</h2>
<table>
  <thead><tr><th>Data</th><th>Par</th><th>P&L</th><th>R Múltiplo</th><th>Trades</th><th>Setup</th><th>Sessão</th></tr></thead>
  <tbody>
    ${[...trades].sort((a,b)=>a.date<b.date?-1:1).map(t=>`<tr>
      <td class="mono">${t.date}</td>
      <td>${t.pair||'—'}</td>
      <td class="mono ${t.pnl>=0?'pos':'neg'}">${fmtSign(t.pnl)}</td>
      <td class="mono ${t.rr!==null?(t.rr>=0?'pos':'neg'):''}">${t.rr!==null?t.rr.toFixed(2)+'R':'—'}</td>
      <td class="mono">${t.trades||0}</td>
      <td>${t.setup||'—'}</td>
      <td>${t.session||'—'}</td>
    </tr>`).join('')}
  </tbody>
</table>

<div class="footer">
  <span>Trader OS · Relatório gerado automaticamente em ${new Date().toLocaleString('pt-BR')}</span>
  <span>${acct?.name || 'Conta'} · Capital: R$${(acct?.capital||0).toLocaleString('pt-BR')}</span>
</div>

</body></html>`;
}

// ── SVG da equity ─────────────────────
function buildEquitySVG(series) {
  if (series.length < 2) return '<p style="color:#888;text-align:center;padding:20px">Dados insuficientes</p>';

  const W = 460, H = 120, PAD = { t:10, r:10, b:24, l:50 };
  const vals  = series.map(p => p.val);
  const min   = Math.min(...vals);
  const max   = Math.max(...vals);
  const range = max - min || 1;
  const W2    = W - PAD.l - PAD.r;
  const H2    = H - PAD.t - PAD.b;

  const px = (i) => PAD.l + (i / (series.length - 1)) * W2;
  const py = (v) => PAD.t + H2 - ((v - min) / range) * H2;

  const pts = series.map((p, i) => `${px(i).toFixed(1)},${py(p.val).toFixed(1)}`).join(' ');
  const areaPath = `M${PAD.l},${PAD.t + H2} L${pts.split(' ').join(' L')} L${PAD.l + W2},${PAD.t + H2} Z`;
  const linePath = `M${pts.split(' ').join(' L')}`;

  const isUp = vals[vals.length - 1] >= vals[0];
  const color = isUp ? '#10b981' : '#ef4444';
  const fillColor = isUp ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)';

  // Labels do eixo Y
  const yLabels = [min, (min+max)/2, max].map(v => ({
    y: py(v), label: 'R$' + v.toFixed(0)
  }));

  // Labels eixo X (max 6)
  const step  = Math.max(1, Math.floor(series.length / 5));
  const xLabels = series.filter((_, i) => i % step === 0 || i === series.length - 1)
    .map((p, _, arr) => ({ x: px(series.indexOf(p)), label: p.date }));

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:${H}px">
    ${yLabels.map(l => `
      <line x1="${PAD.l}" y1="${l.y.toFixed(1)}" x2="${PAD.l+W2}" y2="${l.y.toFixed(1)}" stroke="#e5e7eb" stroke-width="0.5" stroke-dasharray="3,3"/>
      <text x="${PAD.l-4}" y="${(l.y+3).toFixed(1)}" text-anchor="end" font-size="7" fill="#999">${l.label}</text>
    `).join('')}
    <path d="${areaPath}" fill="${fillColor}"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    ${xLabels.map(l => `<text x="${l.x.toFixed(1)}" y="${H-4}" text-anchor="middle" font-size="7" fill="#999">${l.label}</text>`).join('')}
  </svg>`;
}

// ── SVG do P&L por dia da semana ──────
function buildDowSVG(byDow) {
  const entries = Object.entries(byDow);
  const W = 460, H = 100, PAD = { t:10, r:10, b:20, l:45 };
  const vals  = entries.map(([,v]) => v);
  const absMax = Math.max(Math.max(...vals.map(Math.abs)), 1);
  const W2    = W - PAD.l - PAD.r;
  const H2    = H - PAD.t - PAD.b;
  const barW  = W2 / entries.length * 0.6;
  const gap   = W2 / entries.length;
  const zero  = PAD.t + H2 / 2;

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:${H}px">
    <line x1="${PAD.l}" y1="${zero.toFixed(1)}" x2="${PAD.l+W2}" y2="${zero.toFixed(1)}" stroke="#e5e7eb" stroke-width="0.8"/>
    ${entries.map(([day, v], i) => {
      const cx    = PAD.l + i * gap + gap / 2;
      const bh    = Math.abs(v) / absMax * (H2 / 2 - 4);
      const by    = v >= 0 ? zero - bh : zero;
      const color = v >= 0 ? '#10b981' : '#ef4444';
      const label = v !== 0 ? (v >= 0 ? '+' : '') + v.toFixed(0) : '';
      const textY = v >= 0 ? by - 3 : by + bh + 9;
      return `
        <rect x="${(cx - barW/2).toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(bh,1).toFixed(1)}" fill="${color}" rx="2"/>
        <text x="${cx.toFixed(1)}" y="${(H-5).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#666">${day}</text>
        ${label ? `<text x="${cx.toFixed(1)}" y="${textY.toFixed(1)}" text-anchor="middle" font-size="6.5" fill="${color}">${label}</text>` : ''}
      `;
    }).join('')}
  </svg>`;
}
