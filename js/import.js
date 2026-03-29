// ═══════════════════════════════════════
//  TRADER OS · import.js  v2
//  Parsers reais: MT4/MT5, cTrader,
//  NinjaTrader, CSV genérico + mapeamento
// ═══════════════════════════════════════

// ── Resultado de parsing ──────────────
/**
 * @typedef {Object} ParseResult
 * @property {Array}  results  - trades prontos para salvar
 * @property {Array}  errors   - linhas com erro
 * @property {string} broker   - broker detectado
 */

// ── Detector automático de broker ─────
export function detectBroker(text) {
  const sample = text.slice(0, 500).toLowerCase();
  if (sample.includes('ticket') && sample.includes('magic'))      return 'mt4';
  if (sample.includes('position id') && sample.includes('entry')) return 'ctrader';
  if (sample.includes('instrument') && sample.includes('account statement')) return 'mt5';
  if (sample.includes('exectime') && sample.includes('basiq'))    return 'ninjatrader';
  return 'generic';
}

// ── Parser principal ──────────────────
export function parseCSV(text, broker = 'auto') {
  if (!text?.trim()) throw new Error('Arquivo vazio');

  const detected = broker === 'auto' ? detectBroker(text) : broker;
  const parser   = PARSERS[detected] || PARSERS.generic;

  try {
    return { ...parser(text), broker: detected };
  } catch (e) {
    // fallback para genérico
    if (detected !== 'generic') {
      try { return { ...PARSERS.generic(text), broker: 'generic' }; } catch {}
    }
    throw new Error('Não foi possível interpretar o arquivo. Verifique o formato. ' + e.message);
  }
}

// ── Parsers por plataforma ─────────────
const PARSERS = {

  // ── MT4 ─────────────────────────────
  mt4(text) {
    const lines = cleanLines(text);
    // MT4 pode ter formato HTML ou CSV puro
    if (text.includes('<html>') || text.includes('<table>')) {
      return parseMT4HTML(text);
    }
    const sep = detectSeparator(lines[0]);
    const hdr = parseLine(lines[0], sep).map(h => h.toLowerCase().trim());

    const results = [], errors = [];
    for (let i = 1; i < lines.length; i++) {
      try {
        const cols = parseLine(lines[i], sep);
        const row  = zipObj(hdr, cols);

        // MT4: colunas típicas = Ticket, Open Time, Type, Size, Item/Symbol, Open Price, S/L, T/P, Close Time, Close Price, Commission, Swap, Profit, Comment
        const isClose = (row.type||'').toLowerCase() !== 'balance' && (row.type||'').toLowerCase() !== 'credit';
        if (!isClose && !row.profit && !row['p/l']) continue;

        const pnl    = parseFloat(row.profit || row['p/l'] || 0);
        const date   = parseDateMT(row['close time'] || row.closetime || row['time'] || '');
        const pair   = cleanSymbol(row.item || row.symbol || row.instrument || '');
        const lot    = parseFloat(row.size || row.lots || 0);
        const setup  = cleanText(row.comment || '');

        if (!date || isNaN(pnl)) { errors.push({ line: i+1, error: 'Data ou P&L inválido' }); continue; }

        results.push({ date, pnl, pair, setup, trades: 1, rr: null,
          _raw: { lot, openPrice: parseFloat(row['open price']||0), closePrice: parseFloat(row['close price']||0) }
        });
      } catch (e) { errors.push({ line: i+1, error: e.message }); }
    }
    return groupByDate(results, errors);
  },

  // ── MT5 ─────────────────────────────
  mt5(text) {
    // MT5 tem formato similar ao MT4 mas com algumas diferenças de coluna
    const lines = cleanLines(text);
    const sep = detectSeparator(lines[0]);
    const hdr = parseLine(lines[0], sep).map(h => h.toLowerCase().replace(/\s+/g,'_').trim());

    const results = [], errors = [];
    for (let i = 1; i < lines.length; i++) {
      try {
        const cols = parseLine(lines[i], sep);
        const row  = zipObj(hdr, cols);

        // Ignora linhas de sumário (sem dados numéricos válidos)
        if (!row.profit && !row['p/l'] && !row.volume) continue;

        const pnl  = parseFloat(row.profit || row['p/l'] || 0);
        const date = parseDateMT(row.time || row.close_time || row.date || '');
        const pair = cleanSymbol(row.symbol || row.instrument || '');

        if (!date || isNaN(pnl)) { errors.push({ line: i+1, error: 'Dados inválidos' }); continue; }

        results.push({ date, pnl, pair, trades: 1,
          setup: cleanText(row.comment || row.magic || ''), rr: null });
      } catch (e) { errors.push({ line: i+1, error: e.message }); }
    }
    return groupByDate(results, errors);
  },

  // ── cTrader ─────────────────────────
  ctrader(text) {
    const lines = cleanLines(text);
    const sep = detectSeparator(lines[0]);
    const hdr = parseLine(lines[0], sep).map(h => h.toLowerCase().replace(/\s+/g,'_'));

    const results = [], errors = [];
    for (let i = 1; i < lines.length; i++) {
      try {
        const cols = parseLine(lines[i], sep);
        const row  = zipObj(hdr, cols);

        // cTrader: Closing Time, Symbol, Direction, Volume, Entry Price, Closing Price, Gross Profit, Commission, Net Profit
        const pnl  = parseFloat(row.net_profit || row.gross_profit || row['p&l'] || 0);
        const date = parseDateCT(row.closing_time || row.close_time || row.time || '');
        const pair = cleanSymbol(row.symbol || row.instrument || '');
        const dir  = (row.direction || row.type || '').toLowerCase();

        if (!date || isNaN(pnl)) { errors.push({ line: i+1, error: 'Dados inválidos' }); continue; }

        results.push({ date, pnl, pair, trades: 1,
          setup: dir === 'buy' ? 'Long' : dir === 'sell' ? 'Short' : '', rr: null });
      } catch (e) { errors.push({ line: i+1, error: e.message }); }
    }
    return groupByDate(results, errors);
  },

  // ── NinjaTrader ──────────────────────
  ninjatrader(text) {
    const lines = cleanLines(text);
    const sep = detectSeparator(lines[0]);
    const hdr = parseLine(lines[0], sep).map(h => h.toLowerCase().replace(/\s+/g,'_'));

    const results = [], errors = [];
    for (let i = 1; i < lines.length; i++) {
      try {
        const cols = parseLine(lines[i], sep);
        const row  = zipObj(hdr, cols);

        const pnl  = parseFloat(row.profit || row['cumulative_profit'] || row['net_profit'] || 0);
        const date = parseDateGeneric(row.exec_time || row.time || row.exit_time || '');
        const pair = cleanSymbol(row.instrument || row.symbol || '');

        if (!date || isNaN(pnl)) { errors.push({ line: i+1, error: 'Dados inválidos' }); continue; }

        results.push({ date, pnl, pair, trades: 1,
          setup: cleanText(row.entry_name || row.signal || ''), rr: null });
      } catch (e) { errors.push({ line: i+1, error: e.message }); }
    }
    return groupByDate(results, errors);
  },

  // ── CSV Genérico ─────────────────────
  generic(text) {
    const lines = cleanLines(text);
    if (lines.length < 2) throw new Error('Arquivo precisa ter pelo menos 2 linhas (cabeçalho + dados)');

    const sep = detectSeparator(lines[0]);
    const raw = parseLine(lines[0], sep).map(h => h.toLowerCase().replace(/[^a-z0-9]/g,'_').trim());

    // Detecta colunas por sinônimos
    const colMap = detectColumns(raw);
    if (!colMap.date)  throw new Error('Coluna de data não encontrada. Esperado: data, date, time, close_time');
    if (!colMap.pnl)   throw new Error('Coluna de P&L não encontrada. Esperado: pnl, profit, lucro, resultado, p&l');

    const results = [], errors = [];
    for (let i = 1; i < lines.length; i++) {
      try {
        const cols = parseLine(lines[i], sep);
        const row  = zipObj(raw, cols);

        const pnl  = parseFloat(row[colMap.pnl] || 0);
        const date = parseDateGeneric(row[colMap.date] || '');
        const pair = colMap.pair ? cleanSymbol(row[colMap.pair] || '') : '';

        if (!date || isNaN(pnl)) { errors.push({ line: i+1, error: 'Data ou P&L inválido' }); continue; }

        results.push({
          date, pnl, pair, trades: 1,
          setup:   colMap.setup   ? cleanText(row[colMap.setup] || '')   : '',
          notes:   colMap.notes   ? cleanText(row[colMap.notes] || '')   : '',
          session: colMap.session ? cleanText(row[colMap.session] || '') : '',
          rr:      colMap.rr      ? parseFloat(row[colMap.rr] || 0) || null : null,
        });
      } catch (e) { errors.push({ line: i+1, error: e.message }); }
    }
    return groupByDate(results, errors);
  },
};

// ── MT4 HTML report parser ─────────────
function parseMT4HTML(html) {
  // Remove tags e extrai texto tabular
  const clean  = html.replace(/<[^>]+>/g, '\t').replace(/&nbsp;/g, ' ').replace(/\t+/g, '\t');
  const tokens = clean.split('\t').map(t => t.trim()).filter(Boolean);

  const results = [], errors = [];
  let i = 0;
  // Procura por padrões: [Ticket] [OpenTime] [Type] [Size] [Symbol] ... [CloseTime] ... [Profit]
  while (i < tokens.length) {
    const t = tokens[i];
    // Ticket geralmente é número inteiro grande
    if (/^\d{6,}$/.test(t)) {
      try {
        const ticket = t;
        const openTime = tokens[i+1] || '';
        const type     = tokens[i+2] || '';
        const size     = tokens[i+3] || '';
        const symbol   = tokens[i+4] || '';
        // Pula preços intermediários
        // Procura closeTime (formato de data)
        let closeTime = '', profit = '';
        for (let j = i+5; j < Math.min(i+15, tokens.length); j++) {
          if (/\d{4}\.\d{2}\.\d{2}/.test(tokens[j])) { closeTime = tokens[j]; }
          if (/^-?\d+\.?\d*$/.test(tokens[j]) && parseFloat(tokens[j]) !== 0 && j > i+8) { profit = tokens[j]; break; }
        }
        if (closeTime && profit && type.toLowerCase() !== 'balance') {
          const pnl  = parseFloat(profit);
          const date = parseDateMT(closeTime);
          if (date && !isNaN(pnl)) results.push({ date, pnl, pair: cleanSymbol(symbol), trades: 1, setup: '', rr: null });
        }
      } catch {}
    }
    i++;
  }
  return groupByDate(results, errors);
}

// ── Agrupamento por data ───────────────
// MT4 exporta por operação; agrupamos por dia somando P&L
function groupByDate(results, errors) {
  const grouped = {};
  results.forEach(r => {
    if (!grouped[r.date]) {
      grouped[r.date] = { ...r, trades: 0, rr: null, _pnlList: [] };
    }
    grouped[r.date].pnl += r.pnl;
    grouped[r.date].trades++;
    grouped[r.date]._pnlList.push(r.pnl);
  });

  return {
    results: Object.values(grouped).map(({ _pnlList, ...r }) => ({
      ...r,
      pnl: parseFloat(r.pnl.toFixed(2)),
    })),
    errors,
  };
}

// ── Detecção de colunas ────────────────
function detectColumns(headers) {
  const find = (...terms) => {
    for (const h of headers) {
      if (terms.some(t => h === t || h.includes(t))) return h;
    }
    return null;
  };

  return {
    date:    find('data','date','time','close_time','closetime','dt'),
    pnl:     find('pnl','profit','lucro','resultado','p_l','ganho','net_profit','gross_profit'),
    pair:    find('par','pair','symbol','instrumento','instrument','ativo'),
    setup:   find('setup','estrategia','strategy','comment','comentario'),
    notes:   find('notas','notes','observacao','obs'),
    session: find('sessao','session'),
    rr:      find('rr','r_multiplo','r_multiple','risk_reward'),
    trades:  find('trades','operacoes','quantidade'),
  };
}

// ── Parsers de data por plataforma ─────
function parseDateMT(str) {
  // MT4: 2024.03.15 14:32:45 ou 2024.03.15
  const m = str.match(/(\d{4})[.\-/](\d{2})[.\-/](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return parseDateGeneric(str);
}

function parseDateCT(str) {
  // cTrader: 15/03/2024 14:32:45 ou 2024-03-15T14:32:45
  const iso = str.match(/(\d{4})[.\-/](\d{2})[.\-/](\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br  = str.match(/(\d{2})[./](\d{2})[./](\d{4})/);
  if (br)  return `${br[3]}-${br[2]}-${br[1]}`;
  return parseDateGeneric(str);
}

export function parseDateGeneric(str) {
  if (!str) return null;
  str = str.trim();

  // ISO: 2024-03-15 ou 2024-03-15T...
  const iso = str.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // BR: 15/03/2024 ou 15-03-2024
  const br = str.match(/^(\d{2})[./\-](\d{2})[./\-](\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  // US: 03/15/2024
  const us = str.match(/^(\d{2})[./](\d{2})[./](\d{4})/);
  if (us) {
    const d = new Date(`${us[3]}-${us[1]}-${us[2]}`);
    if (!isNaN(d.getTime())) return `${us[3]}-${us[1]}-${us[2]}`;
  }

  // Tenta new Date como último recurso
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);

  return null;
}

// ── Utilitários ───────────────────────
function cleanLines(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.match(/^[-=;,\t\s]*$/));
}

function detectSeparator(line) {
  const tabs    = (line.match(/\t/g) || []).length;
  const semis   = (line.match(/;/g)  || []).length;
  const commas  = (line.match(/,/g)  || []).length;
  if (tabs > semis && tabs > commas) return '\t';
  if (semis > commas) return ';';
  return ',';
}

function parseLine(line, sep) {
  const result = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === sep && !inQ) { result.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur.trim());
  return result;
}

function zipObj(keys, vals) {
  const obj = {};
  keys.forEach((k, i) => { obj[k] = vals[i] ?? ''; });
  return obj;
}

function cleanSymbol(s) {
  if (!s) return '';
  return s.replace(/['"]/g,'').replace(/\s+/g,'').toUpperCase().slice(0, 20);
}

function cleanText(s) {
  if (!s) return '';
  return s.replace(/['"]/g,'').trim().slice(0, 200);
}
