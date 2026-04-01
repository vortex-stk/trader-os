// ═══════════════════════════════════════
//  TRADER OS · db.js
//  Camada de dados — localStorage + Supabase
//  Schema real, sem blob JSON gigante
// ═══════════════════════════════════════

import { sanitizeNumber, sanitizeInt, sanitizeText } from './validation.js';

// ── Gerador de ID ────────────────────
export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Schema padrão (localStorage) ─────
function emptyDB() {
  return {
    version: 3,
    accounts: [],
    trades: {},       // { [accountId]: Trade[] }
    operations: {},   // { [accountId]: Operation[] }  ← NOVO: operações granulares
    config: {},       // { [accountId]: AccountConfig }
    goals: {},        // { [accountId]: Goals }
    profile: {
      name: '',
      email: '',
      country: 'Brasil',
      timezone: 'America/Sao_Paulo',
      broker: '',
      accountType: 'prop',
      accountSize: 0,
      experience: 'intermediate',
      favoritePairs: '',
      bio: '',
    },
    globalGoals: {
      goalMonth: 2000,
      goalYear: 24000,
      goalWinRate: 60,
      goalRR: 1.5,
    },
    dayMeta: {},  // { [accountId]: { [dateStr]: { notes, lesson, rating, screenshot } } }
  };
}

// ── Estado global ─────────────────────
let _db = emptyDB();
let _activeId = null;

export function getDB() { return _db; }
export function getActiveId() { return _activeId; }
export function setActiveId(id) { _activeId = id; }

// ── Persistência local ────────────────
export function loadLocal() {
  try {
    const raw = localStorage.getItem('tros_v3');
    if (raw) {
      const parsed = JSON.parse(raw);
      _db = migrateDB(parsed);
    }
    _activeId = localStorage.getItem('tros_active') || null;
  } catch (e) {
    console.error('[DB] Erro ao carregar dados locais:', e);
    _db = emptyDB();
  }
}

export function saveLocal() {
  try {
    localStorage.setItem('tros_v3', JSON.stringify(_db));
    if (_activeId) localStorage.setItem('tros_active', _activeId);
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      throw new Error(
        'Armazenamento local cheio. Isso geralmente acontece por screenshots em base64. ' +
        'Ative a sincronização em nuvem para liberar espaço.'
      );
    }
    throw e;
  }
}

// ── Migração de versões antigas ───────
function migrateDB(data) {
  // Versão 2 → 3: adicionar operations, goals
  if (!data.version || data.version < 3) {
    data.version = 3;
    if (!data.operations) data.operations = {};
    if (!data.goals) data.goals = {};
    if (!data.dayMeta) data.dayMeta = {};
    if (!data.globalGoals) {
      data.globalGoals = {
        goalMonth: data.globalConfig?.goalMonth || 2000,
        goalYear: data.globalConfig?.goalYear || 24000,
        goalWinRate: data.globalConfig?.goalWinrate || 60,
        goalRR: data.globalConfig?.goalRR || 1.5,
      };
    }
    // Migrar screenshots de base64 para marcador (não podemos mover aqui, mas evitamos salvar novos)
    if (data.trades) {
      Object.values(data.trades).forEach(tradeList => {
        if (Array.isArray(tradeList)) {
          tradeList.forEach(t => {
            if (t.screenshot && t.screenshot.startsWith('data:')) {
              t._screenshotLocal = true; // marcado para migrar depois
              t.screenshot = null; // não salva mais base64
            }
          });
        }
      });
    }
  }
  return data;
}

// ── Contas ────────────────────────────
export function getAccounts() { return _db.accounts || []; }

export function getAccount(id) {
  return _db.accounts.find(a => a.id === (id || _activeId));
}

export function getActiveAccount() {
  return getAccount(_activeId) || _db.accounts[0];
}

export function createAccount({ name, type, capital, color, propFirm = null }) {
  const id = genId();
  const account = {
    id,
    name: sanitizeText(name, 60),
    type: sanitizeText(type, 40),
    capital: sanitizeNumber(capital, 10000),
    color: color || '#00F5A0',
    propFirm,
    createdAt: new Date().toISOString(),
  };
  _db.accounts.push(account);
  _db.trades[id] = [];
  _db.operations[id] = [];
  _db.config[id] = {
    capital: account.capital,
    maxDailyLoss: account.capital * 0.05,
    maxTotalLoss: account.capital * 0.10,
    profitTarget: account.capital * 0.10,
    minTradingDays: 10,
    trailingDrawdown: false,
  };
  _db.goals[id] = { ..._db.globalGoals };
  return account;
}

export function seedDefaultAccount() {
  const acc = createAccount({
    name: 'Conta Principal',
    type: 'Real Pessoal',
    capital: 10000,
    color: '#00F5A0',
  });
  _activeId = acc.id;
  return acc;
}

// ── Trades (registro diário) ──────────
export function getTrades(accountId) {
  const id = accountId || _activeId;
  return (_db.trades[id] || []).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function getTradeByDate(date, accountId) {
  return getTrades(accountId).find(t => t.date === date);
}

/**
 * Cria ou atualiza um trade diário.
 * Dados sanitizados e validados antes de salvar.
 */
export function saveTrade(data, accountId) {
  const id = accountId || _activeId;
  if (!_db.trades[id]) _db.trades[id] = [];

  const trade = {
    id: data.id || genId(),
    date: data.date,
    pnl: sanitizeNumber(data.pnl, 0),
    trades: sanitizeInt(data.trades, 0),
    pair: sanitizeText(data.pair, 30),
    session: sanitizeText(data.session, 30),
    setup: sanitizeText(data.setup, 100),
    rr: sanitizeNumber(data.rr, null),
    emotion: sanitizeText(data.emotion, 30),
    notes: sanitizeText(data.notes, 2000),
    screenshot: data.screenshot || null,       // URL do Supabase Storage (não base64)
    screenshotPath: data.screenshotPath || null,
    updatedAt: new Date().toISOString(),
    createdAt: data.createdAt || new Date().toISOString(),
  };

  const idx = _db.trades[id].findIndex(t => t.id === trade.id);
  if (idx >= 0) {
    _db.trades[id][idx] = trade;
  } else {
    _db.trades[id].push(trade);
  }

  return trade;
}

export function deleteTrade(tradeId, accountId) {
  const id = accountId || _activeId;
  const before = _db.trades[id]?.length || 0;
  _db.trades[id] = (_db.trades[id] || []).filter(t => t.id !== tradeId);
  // Também remove operações do dia se existirem
  _db.operations[id] = (_db.operations[id] || []).filter(op => op.tradeId !== tradeId);
  return (_db.trades[id]?.length || 0) < before;
}

// ── Operações granulares (NOVO) ───────
export function getOperations(accountId, tradeId = null) {
  const id = accountId || _activeId;
  const ops = _db.operations[id] || [];
  return tradeId ? ops.filter(op => op.tradeId === tradeId) : ops;
}

export function saveOperation(data, accountId) {
  const id = accountId || _activeId;
  if (!_db.operations[id]) _db.operations[id] = [];

  const op = {
    id: data.id || genId(),
    tradeId: data.tradeId,             // vinculado ao trade diário
    date: data.date,
    entryTime: sanitizeText(data.entryTime, 10),
    exitTime: sanitizeText(data.exitTime, 10),
    pair: sanitizeText(data.pair, 30),
    direction: data.direction === 'short' ? 'short' : 'long',
    entryPrice: sanitizeNumber(data.entryPrice, null),
    exitPrice: sanitizeNumber(data.exitPrice, null),
    stopLoss: sanitizeNumber(data.stopLoss, null),
    takeProfit: sanitizeNumber(data.takeProfit, null),
    lotSize: sanitizeNumber(data.lotSize, null),
    pnl: sanitizeNumber(data.pnl, 0),
    rr: sanitizeNumber(data.rr, null),
    setup: sanitizeText(data.setup, 100),
    notes: sanitizeText(data.notes, 1000),
    screenshot: data.screenshot || null,
    createdAt: data.createdAt || new Date().toISOString(),
  };

  // Calcula RR automaticamente se tiver preços
  if (!op.rr && op.entryPrice && op.stopLoss && op.exitPrice) {
    const risk = Math.abs(op.entryPrice - op.stopLoss);
    const reward = Math.abs(op.exitPrice - op.entryPrice);
    if (risk > 0) op.rr = parseFloat((reward / risk).toFixed(2));
  }

  const idx = _db.operations[id].findIndex(o => o.id === op.id);
  if (idx >= 0) {
    _db.operations[id][idx] = op;
  } else {
    _db.operations[id].push(op);
  }

  return op;
}

export function deleteOperation(opId, accountId) {
  const id = accountId || _activeId;
  _db.operations[id] = (_db.operations[id] || []).filter(o => o.id !== opId);
}

// ── Configuração da conta ─────────────
export function getConfig(accountId) {
  const id = accountId || _activeId;
  return _db.config[id] || {};
}

export function saveConfig(data, accountId) {
  const id = accountId || _activeId;
  _db.config[id] = { ...(_db.config[id] || {}), ...data };
}

// ── Metas ─────────────────────────────
export function getGoals(accountId) {
  const id = accountId || _activeId;
  return _db.goals[id] || _db.globalGoals;
}

export function saveGoals(data, accountId) {
  const id = accountId || _activeId;
  _db.goals[id] = { ...(_db.goals[id] || {}), ...data };
  _db.globalGoals = { ..._db.globalGoals, ...data }; // sincroniza global
}

// ── Perfil ────────────────────────────
export function getProfile() { return _db.profile || {}; }

export function saveProfile(data) {
  _db.profile = {
    ...(_db.profile || {}),
    name: sanitizeText(data.name, 100),
    email: sanitizeText(data.email, 200),
    country: sanitizeText(data.country, 60),
    timezone: sanitizeText(data.timezone, 60),
    broker: sanitizeText(data.broker, 100),
    accountType: sanitizeText(data.accountType, 30),
    accountSize: sanitizeNumber(data.accountSize, 0),
    experience: sanitizeText(data.experience, 20),
    favoritePairs: sanitizeText(data.favoritePairs, 200),
    bio: sanitizeText(data.bio, 500),
  };
}

// ── Estatísticas (calculadas) ─────────
export function calcStats(trades) {
  if (!trades || trades.length === 0) {
    return {
      totalPnL: 0, winRate: 0, avgWin: 0, avgLoss: 0,
      maxDD: 0, profitFactor: 0, expectancy: 0,
      wins: 0, losses: 0, totalTrades: 0,
    };
  }

  const wins   = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const totalPnL   = trades.reduce((a, t) => a + t.pnl, 0);
  const winRate    = (wins.length / trades.length) * 100;
  const avgWin     = wins.length   ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length   : 0;
  const avgLoss    = losses.length ? Math.abs(losses.reduce((a, t) => a + t.pnl, 0) / losses.length) : 0;
  const grossWin   = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss  = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : null;
  const expectancy = (winRate / 100) * avgWin - ((1 - winRate / 100)) * avgLoss;

  // Drawdown máximo
  let peak = 0, maxDD = 0, cum = 0;
  [...trades].sort((a, b) => a.date < b.date ? -1 : 1).forEach(t => {
    cum += t.pnl;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  });

  return {
    totalPnL,
    winRate: parseFloat(winRate.toFixed(1)),
    avgWin:  parseFloat(avgWin.toFixed(2)),
    avgLoss: parseFloat(avgLoss.toFixed(2)),
    maxDD:   parseFloat(maxDD.toFixed(2)),
    profitFactor: profitFactor ? parseFloat(profitFactor.toFixed(2)) : null,
    expectancy: parseFloat(expectancy.toFixed(2)),
    wins: wins.length,
    losses: losses.length,
    totalTrades: trades.reduce((a, t) => a + (t.trades || 0), 0),
  };
}

// ── Filtragem por período ─────────────
export function getTradesByMonth(year, month, accountId) {
  return getTrades(accountId).filter(t => {
    const d = new Date(t.date + 'T12:00:00');
    return d.getFullYear() === year && d.getMonth() === month;
  });
}

export function getTradesByYear(year, accountId) {
  return getTrades(accountId).filter(t =>
    new Date(t.date + 'T12:00:00').getFullYear() === year
  );
}

// ── Diário por dia (notas, lição, rating, screenshot) ─
export function getDayMeta(dateStr, accountId) {
  const id = accountId || _activeId;
  if (!_db.dayMeta) _db.dayMeta = {};
  if (!_db.dayMeta[id]) _db.dayMeta[id] = {};
  return _db.dayMeta[id][dateStr] || { notes: '', lesson: '', rating: 0, screenshot: null };
}

export function saveDayMeta(dateStr, data, accountId) {
  const id = accountId || _activeId;
  if (!_db.dayMeta) _db.dayMeta = {};
  if (!_db.dayMeta[id]) _db.dayMeta[id] = {};
  _db.dayMeta[id][dateStr] = {
    notes: sanitizeText(data.notes || '', 3000),
    lesson: sanitizeText(data.lesson || '', 1000),
    rating: Math.min(5, Math.max(0, parseInt(data.rating, 10) || 0)),
    screenshot: data.screenshot || null,
  };
}

// ── Exportação CSV ────────────────────
export function exportCSV(accountId) {
  const trades = getTrades(accountId);
  const header = ['Data','Par','P&L','R Múltiplo','Trades','Sessão','Setup','Emoção','Notas'];
  const rows = trades.map(t => [
    t.date,
    t.pair || '',
    t.pnl,
    t.rr ?? '',
    t.trades || 0,
    t.session || '',
    t.setup || '',
    t.emotion || '',
    (t.notes || '').replace(/"/g, '""'),
  ]);

  const csv = [header, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `trader-os-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Import CSV (MT4/MT5/cTrader) ──────
export function parseCSVImport(text, broker = 'generic') {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV vazio ou sem dados');

  const sep = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(sep).map(h => h.replace(/"/g, '').trim().toLowerCase());

  const results = [];
  const errors  = [];

  for (let i = 1; i < lines.length; i++) {
    try {
      const cols  = splitCSVLine(lines[i], sep);
      const row   = {};
      headers.forEach((h, idx) => { row[h] = (cols[idx] || '').replace(/"/g, '').trim(); });

      const trade = mapCSVRow(row, broker);
      if (trade) results.push(trade);
    } catch (e) {
      errors.push({ line: i + 1, error: e.message });
    }
  }

  return { results, errors };
}

function splitCSVLine(line, sep) {
  // Suporta campos entre aspas com vírgulas dentro
  const result = [];
  let current  = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === sep && !inQuotes) { result.push(current); current = ''; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

function mapCSVRow(row, broker) {
  // MT4/MT5 formato padrão
  if (broker === 'mt4' || broker === 'mt5' || broker === 'generic') {
    const pnl = parseFloat(row['profit'] || row['p&l'] || row['pnl'] || row['lucro'] || '0');
    const dateRaw = row['closetime'] || row['close time'] || row['data'] || row['date'] || '';
    const date = parseDateStr(dateRaw);
    if (!date) return null;

    return {
      date,
      pnl: isNaN(pnl) ? 0 : pnl,
      pair: row['symbol'] || row['par'] || row['instrument'] || '',
      setup: row['comment'] || row['comentario'] || '',
      trades: 1,
    };
  }
  return null;
}

function parseDateStr(str) {
  if (!str) return null;
  // Tenta vários formatos: YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const brMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (brMatch) return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;

  const usMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (usMatch) return `${usMatch[3]}-${usMatch[1]}-${usMatch[2]}`;

  return null;
}
