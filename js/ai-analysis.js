// ═══════════════════════════════════════
//  TRADER OS · ai-analysis.js
//  Análise inteligente via Claude API
//  Detecta padrões, sugere melhorias,
//  gera resumo semanal automático
// ═══════════════════════════════════════

import { getTrades, calcStats, getTradesByMonth, getTradesByYear, getGoals, getActiveAccount } from './db.js';
import { canDo } from './stripe/billing.js';
import { showToast } from './ui/components.js';
import { WEEKDAYS, MONTHS } from './config.js';

const API_URL = 'https://api.anthropic.com/v1/messages';

// ── Análise mensal completa ────────────
export async function analyzeTradingMonth(year, month) {
  if (!canDo('aiAnalysis')) {
    showUpgradePrompt('Análise com IA');
    return null;
  }

  const trades = getTradesByMonth(year, month);
  if (trades.length < 3) {
    showToast('Poucos dados para análise. Registre pelo menos 3 dias.', 'warning');
    return null;
  }

  const stats   = calcStats(trades);
  const goals   = getGoals();
  const acct    = getActiveAccount();
  const context = buildContext(trades, stats, goals, acct);

  return streamAnalysis(context, 'monthly');
}

// ── Análise de padrões comportamentais ─
export async function analyzePatterns() {
  if (!canDo('aiAnalysis')) { showUpgradePrompt('Análise de Padrões'); return null; }

  const all  = getTrades();
  if (all.length < 10) {
    showToast('Poucos dados. Registre pelo menos 10 dias de trading.', 'warning');
    return null;
  }

  const patterns = extractPatterns(all);
  const prompt   = buildPatternsPrompt(patterns);

  return streamAnalysis(prompt, 'patterns');
}

// ── Resumo semanal automático ──────────
export async function generateWeeklySummary() {
  if (!canDo('aiAnalysis')) { showUpgradePrompt('Resumo Semanal'); return null; }

  const now   = new Date();
  const start = new Date(now); start.setDate(now.getDate() - 7);
  const all   = getTrades();
  const week  = all.filter(t => new Date(t.date + 'T12:00:00') >= start);

  if (!week.length) {
    showToast('Nenhum trade registrado nos últimos 7 dias.', 'info');
    return null;
  }

  const stats = calcStats(week);
  return streamAnalysis(buildWeeklyPrompt(week, stats), 'weekly');
}

// ── Stream da análise ─────────────────
async function streamAnalysis(prompt, type) {
  const container = document.getElementById('ai-analysis-output');
  if (!container) return null;

  container.innerHTML = `
    <div class="ai-loading">
      <div class="ai-loading-dot"></div>
      <div class="ai-loading-dot" style="animation-delay:.2s"></div>
      <div class="ai-loading-dot" style="animation-delay:.4s"></div>
      <span style="margin-left:10px;color:var(--text-3);font-size:13px">Analisando seus trades…</span>
    </div>
  `;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: `Você é um coach de trading profissional especializado em psicologia do trading e análise de performance para traders de forex e prop firms. Analise os dados fornecidos e dê insights acionáveis em português. Seja direto, específico e baseado em dados. Formate com markdown para melhor leitura.`,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Erro na API');
    }

    const data = await response.json();
    const text = data.content?.find(c => c.type === 'text')?.text || '';

    container.innerHTML = `
      <div class="ai-result">
        <div class="ai-result-header">
          <span class="ai-badge">✦ Análise Claude</span>
          <span style="font-size:11px;color:var(--text-3)">${new Date().toLocaleDateString('pt-BR')}</span>
        </div>
        <div class="ai-result-body markdown-content">${markdownToHTML(text)}</div>
      </div>
    `;

    return text;
  } catch (e) {
    container.innerHTML = `
      <div class="banner danger">
        <strong>Erro na análise:</strong> ${e.message}
      </div>
    `;
    return null;
  }
}

// ── Extração de padrões ────────────────
function extractPatterns(trades) {
  const sorted = [...trades].sort((a, b) => a.date < b.date ? -1 : 1);

  // Por dia da semana
  const byDow = {};
  WEEKDAYS.forEach(d => { byDow[d] = { pnl: 0, n: 0, wins: 0 }; });
  sorted.forEach(t => {
    const d = WEEKDAYS[new Date(t.date + 'T12:00:00').getDay()];
    byDow[d].pnl += t.pnl;
    byDow[d].n++;
    if (t.pnl > 0) byDow[d].wins++;
  });

  // Por emoção
  const byEmo = {};
  sorted.filter(t => t.emotion).forEach(t => {
    if (!byEmo[t.emotion]) byEmo[t.emotion] = { pnl: 0, n: 0, wins: 0 };
    byEmo[t.emotion].pnl += t.pnl;
    byEmo[t.emotion].n++;
    if (t.pnl > 0) byEmo[t.emotion].wins++;
  });

  // Por setup
  const bySetup = {};
  sorted.filter(t => t.setup).forEach(t => {
    if (!bySetup[t.setup]) bySetup[t.setup] = { pnl: 0, n: 0, wins: 0 };
    bySetup[t.setup].pnl += t.pnl;
    bySetup[t.setup].n++;
    if (t.pnl > 0) bySetup[t.setup].wins++;
  });

  // Streak atual
  let streak = 0, streakDir = null;
  [...sorted].reverse().some(t => {
    const dir = t.pnl > 0 ? 'win' : 'loss';
    if (!streakDir) { streakDir = dir; streak = 1; }
    else if (dir === streakDir) streak++;
    else return true;
  });

  return { byDow, byEmo, bySetup, streak, streakDir, total: trades.length };
}

// ── Prompts ───────────────────────────
function buildContext(trades, stats, goals, acct) {
  const monthPnL = trades.reduce((a, t) => a + t.pnl, 0);
  const sorted   = [...trades].sort((a, b) => a.date < b.date ? -1 : 1);
  const rr       = stats.avgLoss > 0 ? (stats.avgWin / stats.avgLoss).toFixed(2) : 'N/A';

  return `Analise minha performance de trading do mês:

**Métricas Principais:**
- P&L total: R$${monthPnL.toFixed(2)} (${monthPnL >= 0 ? 'positivo' : 'negativo'})
- Win Rate: ${stats.winRate.toFixed(1)}% (meta: ${goals.goalWinRate || 60}%)
- Profit Factor: ${stats.profitFactor?.toFixed(2) || 'N/A'} (meta: >1.5)
- R:R médio: ${rr}R (meta: ${goals.goalRR || 1.5}R)
- Max Drawdown: R$${stats.maxDD.toFixed(2)}
- Expectância por operação: R$${stats.expectancy.toFixed(2)}
- Dias operados: ${trades.length}
- Total de trades: ${trades.reduce((a,t) => a+(t.trades||0), 0)}

**Últimos 5 dias:**
${sorted.slice(-5).map(t => `- ${t.date}: ${t.pnl >= 0 ? '+' : ''}R$${t.pnl.toFixed(2)} | Par: ${t.pair||'—'} | Setup: ${t.setup||'—'} | Emoção: ${t.emotion||'—'} | R: ${t.rr||'—'}`).join('\n')}

**Distribuição emocional:**
${trades.filter(t => t.emotion).reduce((acc, t) => { acc[t.emotion] = (acc[t.emotion]||0)+1; return acc; }, {})}

Por favor, forneça:
1. **Diagnóstico** — O que os dados mostram?
2. **Padrões identificados** — Onde você opera melhor/pior?
3. **Pontos de atenção** — O que precisa melhorar urgentemente?
4. **3 ações concretas** — Para a próxima semana.`;
}

function buildPatternsPrompt(patterns) {
  const dowLines = Object.entries(patterns.byDow)
    .filter(([,v]) => v.n > 0)
    .map(([day, v]) => `${day}: ${v.n} dias, R$${v.pnl.toFixed(0)}, WR ${v.n ? Math.round(v.wins/v.n*100) : 0}%`)
    .join('\n');

  const emoLines = Object.entries(patterns.byEmo)
    .sort((a,b) => b[1].n - a[1].n)
    .map(([emo, v]) => `${emo}: ${v.n} dias, R$${v.pnl.toFixed(0)}, WR ${Math.round(v.wins/v.n*100)}%`)
    .join('\n');

  const setupLines = Object.entries(patterns.bySetup)
    .sort((a,b) => b[1].pnl - a[1].pnl)
    .slice(0, 6)
    .map(([s, v]) => `${s}: ${v.n} dias, R$${v.pnl.toFixed(0)}, WR ${Math.round(v.wins/v.n*100)}%`)
    .join('\n');

  return `Analise meus padrões de trading (${patterns.total} dias registrados):

**Por dia da semana:**
${dowLines || 'Sem dados'}

**Por estado emocional:**
${emoLines || 'Sem dados'}

**Por setup:**
${setupLines || 'Sem dados'}

**Streak atual:** ${patterns.streak} ${patterns.streakDir === 'win' ? 'ganhos' : 'perdas'} consecutivos

Identifique meus padrões de comportamento, em quais condições opero melhor e pior, e recomende ajustes específicos na minha rotina.`;
}

function buildWeeklyPrompt(week, stats) {
  const pnl = week.reduce((a, t) => a + t.pnl, 0);
  const sorted = [...week].sort((a, b) => a.date < b.date ? -1 : 1);
  return `Gere um resumo semanal da minha performance:

**Esta semana:**
- P&L: ${pnl >= 0 ? '+' : ''}R$${pnl.toFixed(2)}
- Win Rate: ${stats.winRate.toFixed(1)}%
- Dias operados: ${week.length}

**Trades:**
${sorted.map(t => `${t.date}: ${t.pnl >= 0 ? '+' : ''}R$${t.pnl.toFixed(2)} (${t.emotion||'—'}, ${t.setup||'—'})`).join('\n')}

Crie um resumo motivacional mas honesto da semana, destacando o que foi bem, o que precisa melhorar, e um foco específico para a próxima semana.`;
}

// ── Markdown para HTML ────────────────
function markdownToHTML(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/^### (.+)$/gm,   '<h4 style="margin:14px 0 6px;font-size:13px;color:var(--text-1)">$1</h4>')
    .replace(/^## (.+)$/gm,    '<h3 style="margin:16px 0 8px;font-size:14px;color:var(--text-1)">$1</h3>')
    .replace(/^# (.+)$/gm,     '<h2 style="margin:18px 0 10px;font-size:16px">$1</h2>')
    .replace(/^- (.+)$/gm,     '<li style="margin:4px 0">$1</li>')
    .replace(/(<li.*<\/li>)/gs, '<ul style="padding-left:18px;margin:8px 0">$1</ul>')
    .replace(/^(\d+)\. (.+)$/gm, '<li style="margin:4px 0">$2</li>')
    .replace(/\n\n/g, '</p><p style="margin:8px 0">')
    .replace(/^(?!<[hul])/gm, '<p style="margin:8px 0">')
    .replace(/<p style="margin:8px 0"><\/p>/g, '');
}

// ── CSS ───────────────────────────────
export const AI_CSS = `
.ai-loading {
  display:flex; align-items:center; padding:24px;
  background:var(--bg-card); border:1px solid var(--border); border-radius:var(--r-md);
}
.ai-loading-dot {
  width:8px; height:8px; border-radius:50%; background:var(--purple);
  animation:pulse 1s ease-in-out infinite;
  margin-right:4px;
}
.ai-result {
  background:var(--bg-card); border:1px solid var(--border);
  border-radius:var(--r-md); overflow:hidden;
}
.ai-result-header {
  display:flex; justify-content:space-between; align-items:center;
  padding:12px 18px; border-bottom:1px solid var(--border);
  background:rgba(124,92,252,0.06);
}
.ai-badge {
  font-size:11px; font-weight:700; letter-spacing:0.1em;
  color:var(--purple); text-transform:uppercase;
}
.ai-result-body {
  padding:18px; font-size:13px; color:var(--text-2); line-height:1.7;
}
.ai-result-body strong { color:var(--text-1); }
.ai-result-body h2, .ai-result-body h3, .ai-result-body h4 { color:var(--text-1); }
`;

function showUpgradePrompt(feature) {
  if (window.TROS?.showUpgradeModal) window.TROS.showUpgradeModal(feature);
  else showToast(`${feature} requer o plano Premium.`, 'warning');
}
