// ═══════════════════════════════════════
//  TRADER OS · propfirm.js
//  Motor de regras para prop firms
//  FTMO, Topstep, The5%ers, etc.
// ═══════════════════════════════════════

import { PROP_FIRMS } from './config.js';
import { getTrades } from './db.js';

/**
 * Avalia o status atual de um desafio/conta prop firm.
 * Retorna um objeto com todos os indicadores e alertas.
 */
export function evaluatePropFirm(accountId, config, capital) {
  const trades  = getTrades(accountId);
  const rules   = buildRules(config, capital);
  const today   = new Date().toISOString().slice(0, 10);
  const todayTrades = trades.filter(t => t.date === today);

  // P&L acumulado (a partir do capital inicial)
  const totalPnL = trades.reduce((a, t) => a + t.pnl, 0);
  const balance  = capital + totalPnL;

  // P&L do dia atual
  const dailyPnL = todayTrades.reduce((a, t) => a + t.pnl, 0);

  // Drawdown: depende se é trailing ou fixo
  const drawdown = rules.trailingDrawdown
    ? calcTrailingDrawdown(trades, capital)
    : calcFixedDrawdown(totalPnL, capital);

  // Dias de trading registrados
  const tradingDays = new Set(trades.map(t => t.date)).size;

  // Consistência: % do maior dia sobre o total (regra de alguns firms)
  const consistency = calcConsistency(trades);

  // ── Avaliação de cada regra ──────────
  const checks = [
    {
      id: 'daily_loss',
      label: 'Perda Diária Máxima',
      limit: -rules.maxDailyLoss,
      current: dailyPnL,
      value: formatDollar(dailyPnL),
      limit_value: formatDollar(-rules.maxDailyLoss),
      pct: rules.maxDailyLoss > 0 ? Math.abs(Math.min(0, dailyPnL)) / rules.maxDailyLoss * 100 : 0,
      status: dailyPnL <= -rules.maxDailyLoss ? 'violated' : dailyPnL <= -rules.maxDailyLoss * 0.75 ? 'warning' : 'ok',
      violated: dailyPnL <= -rules.maxDailyLoss,
    },
    {
      id: 'total_loss',
      label: rules.trailingDrawdown ? 'Trailing Drawdown' : 'Perda Total Máxima',
      limit: rules.maxTotalLoss,
      current: drawdown,
      value: formatDollar(drawdown),
      limit_value: formatDollar(rules.maxTotalLoss),
      pct: rules.maxTotalLoss > 0 ? drawdown / rules.maxTotalLoss * 100 : 0,
      status: drawdown >= rules.maxTotalLoss ? 'violated' : drawdown >= rules.maxTotalLoss * 0.75 ? 'warning' : 'ok',
      violated: drawdown >= rules.maxTotalLoss,
    },
    {
      id: 'profit_target',
      label: 'Meta de Lucro',
      limit: rules.profitTarget,
      current: totalPnL,
      value: formatDollar(totalPnL),
      limit_value: formatDollar(rules.profitTarget),
      pct: rules.profitTarget > 0 ? Math.max(0, totalPnL) / rules.profitTarget * 100 : 0,
      status: totalPnL >= rules.profitTarget ? 'achieved' : 'pending',
      achieved: totalPnL >= rules.profitTarget,
    },
    {
      id: 'trading_days',
      label: 'Dias Mínimos de Trading',
      limit: rules.minTradingDays,
      current: tradingDays,
      value: `${tradingDays} dias`,
      limit_value: `${rules.minTradingDays} dias`,
      pct: rules.minTradingDays > 0 ? tradingDays / rules.minTradingDays * 100 : 100,
      status: tradingDays >= rules.minTradingDays ? 'achieved' : 'pending',
      achieved: tradingDays >= rules.minTradingDays,
    },
  ];

  // ── Status geral ─────────────────────
  const violated = checks.some(c => c.violated);
  const allPassed = !violated
    && checks.find(c => c.id === 'profit_target')?.achieved
    && checks.find(c => c.id === 'trading_days')?.achieved;

  let overallStatus;
  if (violated) overallStatus = 'failed';
  else if (allPassed) overallStatus = 'passed';
  else if (checks.some(c => c.status === 'warning')) overallStatus = 'warning';
  else overallStatus = 'active';

  // ── Alertas ativos ───────────────────
  const alerts = [];
  if (checks[0].status === 'warning') {
    const remaining = rules.maxDailyLoss + dailyPnL;
    alerts.push({
      level: 'warning',
      message: `Atenção! Restam apenas ${formatDollar(remaining)} para atingir o limite de perda diária.`,
    });
  }
  if (checks[0].violated) {
    alerts.push({
      level: 'danger',
      message: 'LIMITE DE PERDA DIÁRIA ATINGIDO. Pare de operar hoje.',
    });
  }
  if (checks[1].status === 'warning') {
    const remaining = rules.maxTotalLoss - drawdown;
    alerts.push({
      level: 'warning',
      message: `Drawdown em ${formatDollar(drawdown)}. Limite total: ${formatDollar(rules.maxTotalLoss)}. Cuidado.`,
    });
  }
  if (checks[1].violated) {
    alerts.push({
      level: 'danger',
      message: 'CONTA VIOLADA — Drawdown máximo atingido.',
    });
  }
  if (checks[2].achieved && !violated) {
    alerts.push({
      level: 'success',
      message: `META DE LUCRO ATINGIDA! ${formatDollar(totalPnL)} de ${formatDollar(rules.profitTarget)}`,
    });
  }

  return {
    overallStatus,
    checks,
    alerts,
    summary: {
      balance: parseFloat(balance.toFixed(2)),
      totalPnL: parseFloat(totalPnL.toFixed(2)),
      dailyPnL: parseFloat(dailyPnL.toFixed(2)),
      drawdown: parseFloat(drawdown.toFixed(2)),
      tradingDays,
      consistency: parseFloat(consistency.toFixed(1)),
    },
    rules,
  };
}

// ── Construção de regras ──────────────
function buildRules(config, capital) {
  // Suporta valores em % ou absolutos
  const pct = (v) => v > 1 ? v : v * capital; // se > 1, assume que é absoluto

  return {
    maxDailyLoss:   config.maxDailyLoss   != null ? pct(config.maxDailyLoss)   : capital * 0.05,
    maxTotalLoss:   config.maxTotalLoss   != null ? pct(config.maxTotalLoss)   : capital * 0.10,
    profitTarget:   config.profitTarget   != null ? pct(config.profitTarget)   : capital * 0.10,
    minTradingDays: config.minTradingDays != null ? config.minTradingDays      : 10,
    trailingDrawdown: !!config.trailingDrawdown,
  };
}

// ── Cálculos de drawdown ──────────────
function calcFixedDrawdown(totalPnL, capital) {
  return Math.max(0, -totalPnL); // quanto caiu do capital inicial
}

function calcTrailingDrawdown(trades, capital) {
  // Trailing: o limite se move com o pico de equity
  let peak = capital;
  let maxDD = 0;
  let cum = capital;

  [...trades].sort((a, b) => a.date < b.date ? -1 : 1).forEach(t => {
    cum += t.pnl;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  });

  return maxDD;
}

// ── Consistência ──────────────────────
function calcConsistency(trades) {
  if (!trades.length) return 100;
  const totalProfit = trades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  if (totalProfit <= 0) return 100;
  const maxDayProfit = Math.max(...trades.map(t => t.pnl));
  return (maxDayProfit / totalProfit) * 100;
}

// ── Preset de regras por prop firm ────
export function applyPropFirmPreset(firmKey, capital) {
  const preset = PROP_FIRMS[firmKey];
  if (!preset) return null;

  return {
    maxDailyLoss:    capital * preset.maxDailyLoss,
    maxTotalLoss:    capital * preset.maxTotalLoss,
    profitTarget:    capital * preset.profitTarget,
    minTradingDays:  preset.minTradingDays,
    trailingDrawdown: preset.trailingDrawdown,
    firmName:        preset.name,
  };
}

// ── Status labels ─────────────────────
export function getStatusLabel(status) {
  const map = {
    ok:       { label: 'OK',           color: 'green' },
    warning:  { label: 'Atenção',      color: 'amber' },
    violated: { label: 'Violado',      color: 'red'   },
    achieved: { label: 'Concluído',    color: 'green' },
    pending:  { label: 'Pendente',     color: 'blue'  },
    passed:   { label: 'Aprovado',     color: 'green' },
    failed:   { label: 'Reprovado',    color: 'red'   },
    active:   { label: 'Em Progresso', color: 'blue'  },
  };
  return map[status] || { label: status, color: 'gray' };
}

// ── Utilitários ───────────────────────
function formatDollar(v) {
  const abs = Math.abs(v);
  const formatted = abs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '-' : '') + 'R$' + formatted;
}
