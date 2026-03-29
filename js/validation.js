// ═══════════════════════════════════════
//  TRADER OS · validation.js
//  Validação centralizada de todos os dados
// ═══════════════════════════════════════

export class ValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
    this.name = 'ValidationError';
  }
}

// ── Trade / Operação ──────────────────
export function validateTrade(data) {
  const errors = [];

  // Data obrigatória e válida
  if (!data.date) {
    errors.push({ field: 'date', message: 'Data é obrigatória' });
  } else {
    const d = new Date(data.date + 'T12:00:00');
    if (isNaN(d.getTime())) {
      errors.push({ field: 'date', message: 'Data inválida' });
    } else if (d > new Date()) {
      errors.push({ field: 'date', message: 'Data não pode ser no futuro' });
    }
  }

  // P&L: número válido (pode ser negativo)
  if (data.pnl === '' || data.pnl === null || data.pnl === undefined) {
    errors.push({ field: 'pnl', message: 'P&L é obrigatório' });
  } else {
    const pnl = parseFloat(data.pnl);
    if (isNaN(pnl)) {
      errors.push({ field: 'pnl', message: 'P&L deve ser um número (ex: 450 ou -120)' });
    } else if (Math.abs(pnl) > 1_000_000) {
      errors.push({ field: 'pnl', message: 'P&L parece muito alto. Verifique o valor.' });
    }
  }

  // Número de trades: inteiro positivo
  if (data.trades !== '' && data.trades !== null && data.trades !== undefined) {
    const t = parseInt(data.trades, 10);
    if (isNaN(t) || t < 0 || t > 1000) {
      errors.push({ field: 'trades', message: 'Número de trades inválido (0-1000)' });
    }
  }

  // R múltiplo: número razoável
  if (data.rr !== '' && data.rr !== null && data.rr !== undefined) {
    const rr = parseFloat(data.rr);
    if (isNaN(rr)) {
      errors.push({ field: 'rr', message: 'R múltiplo deve ser um número (ex: 2.5)' });
    } else if (rr < -50 || rr > 100) {
      errors.push({ field: 'rr', message: 'R múltiplo fora do intervalo esperado (-50 a 100)' });
    }
  }

  return errors;
}

// ── Conta ─────────────────────────────
export function validateAccount(data) {
  const errors = [];

  if (!data.name || data.name.trim().length < 2) {
    errors.push({ field: 'name', message: 'Nome deve ter pelo menos 2 caracteres' });
  }
  if (data.name && data.name.trim().length > 60) {
    errors.push({ field: 'name', message: 'Nome muito longo (máx. 60 caracteres)' });
  }

  if (data.capital !== '' && data.capital !== null && data.capital !== undefined) {
    const cap = parseFloat(data.capital);
    if (isNaN(cap) || cap < 0) {
      errors.push({ field: 'capital', message: 'Capital deve ser um valor positivo' });
    } else if (cap > 100_000_000) {
      errors.push({ field: 'capital', message: 'Capital parece muito alto. Verifique.' });
    }
  }

  return errors;
}

// ── Metas ─────────────────────────────
export function validateGoals(data) {
  const errors = [];

  if (data.goalMonth !== '' && data.goalMonth !== null) {
    const v = parseFloat(data.goalMonth);
    if (isNaN(v) || v < 0) errors.push({ field: 'goalMonth', message: 'Meta mensal inválida' });
  }

  if (data.goalYear !== '' && data.goalYear !== null) {
    const v = parseFloat(data.goalYear);
    if (isNaN(v) || v < 0) errors.push({ field: 'goalYear', message: 'Meta anual inválida' });
  }

  if (data.goalWinRate !== '' && data.goalWinRate !== null) {
    const v = parseFloat(data.goalWinRate);
    if (isNaN(v) || v < 0 || v > 100) {
      errors.push({ field: 'goalWinRate', message: 'Win rate deve ser entre 0 e 100%' });
    }
  }

  if (data.goalRR !== '' && data.goalRR !== null) {
    const v = parseFloat(data.goalRR);
    if (isNaN(v) || v < 0 || v > 50) {
      errors.push({ field: 'goalRR', message: 'RR mínimo deve ser entre 0 e 50' });
    }
  }

  return errors;
}

// ── Utilitários ───────────────────────
export function sanitizeText(str, maxLength = 500) {
  if (!str) return '';
  return String(str).trim().slice(0, maxLength);
}

export function sanitizeNumber(val, fallback = null) {
  if (val === '' || val === null || val === undefined) return fallback;
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

export function sanitizeInt(val, fallback = null) {
  if (val === '' || val === null || val === undefined) return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

// Formata erros para exibição
export function formatErrors(errors) {
  return errors.map(e => e.message).join('\n');
}
