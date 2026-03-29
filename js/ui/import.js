// ═══════════════════════════════════════
//  TRADER OS · ui/import.js
//  Importação real de CSV com preview,
//  mapeamento de colunas e detecção de broker
// ═══════════════════════════════════════

import { saveTrade, getTradeByDate, genId } from '../db.js';
import { showToast } from './components.js';

let _parsedRows   = [];
let _mappedTrades = [];
let _broker       = 'mt4';

// Layouts conhecidos por broker
const BROKER_LAYOUTS = {
  mt4: {
    name: 'MetaTrader 4 / 5',
    hint: 'Exporte em: Account History → clique direito → Save as Report (HTML). Use a versão HTML, não o relatório padrão. O arquivo CSV gerado tem colunas: Symbol, Type, Open Time, Close Time, Profit.',
    detect: headers => headers.some(h => h.includes('profit') || h.includes('symbol')),
    map: row => ({
      date:  parseDate(row['close time'] || row['closetime'] || row['time'] || row['data']),
      pnl:   parseFloat(row['profit'] || row['lucro'] || '0'),
      pair:  row['symbol'] || row['par'] || '',
      setup: row['comment'] || row['comentário'] || '',
      trades: 1,
    }),
  },
  ctrader: {
    name: 'cTrader',
    hint: 'Exporte em: History → Export → CSV. O arquivo tem colunas: Symbol, Direction, Entry Price, Close Price, Net Profit.',
    detect: headers => headers.some(h => h.includes('net profit') || h.includes('direction')),
    map: row => ({
      date:  parseDate(row['close time'] || row['closing time'] || row['data']),
      pnl:   parseFloat(row['net profit'] || row['profit'] || '0'),
      pair:  row['symbol'] || '',
      setup: row['label'] || '',
      trades: 1,
    }),
  },
  ninjatrader: {
    name: 'NinjaTrader',
    hint: 'Exporte em: Account Performance → Export → Trades CSV.',
    detect: headers => headers.some(h => h.includes('instrument') || h.includes('entry name')),
    map: row => ({
      date:  parseDate(row['exit time'] || row['time']),
      pnl:   parseFloat(row['profit'] || row['cum. net profit'] || '0'),
      pair:  row['instrument'] || '',
      setup: row['entry name'] || '',
      trades: 1,
    }),
  },
  generic: {
    name: 'CSV Genérico',
    hint: 'Formato livre. O sistema tentará detectar automaticamente as colunas de data e P&L.',
    detect: () => true,
    map: row => {
      // Tenta encontrar data e pnl em qualquer coluna
      const dateKeys = Object.keys(row).filter(k => k.match(/date|time|data|fecha/i));
      const pnlKeys  = Object.keys(row).filter(k => k.match(/profit|pnl|result|lucro|ganho|perda/i));
      const pairKeys = Object.keys(row).filter(k => k.match(/symbol|pair|instrument|par|ativo/i));
      return {
        date:  dateKeys.length ? parseDate(row[dateKeys[0]]) : null,
        pnl:   pnlKeys.length  ? parseFloat(row[pnlKeys[0]]) : 0,
        pair:  pairKeys.length ? row[pairKeys[0]] : '',
        trades: 1,
      };
    },
  },
};

// ── Inicializa eventos da página ──────
export function initImportPage() {
  const dropZone  = document.getElementById('import-drop-zone');
  const fileInput = document.getElementById('import-file-input');
  const brokerBtns = document.querySelectorAll('[data-broker]');

  brokerBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      brokerBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _broker = btn.dataset.broker;
      updateImportHint();
    });
  });

  if (fileInput) fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

  if (dropZone) {
    dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault(); dropZone.classList.remove('drag-over');
      handleFile(e.dataTransfer.files[0]);
    });
    dropZone.addEventListener('click', () => fileInput?.click());
    dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput?.click(); });
  }

  document.getElementById('btn-import-confirm')?.addEventListener('click', doImport);
  document.getElementById('btn-import-cancel')?.addEventListener('click', cancelImport);

  updateImportHint();
}

export function renderImportPage() {
  // Reseta estado visual
  const previewCard = document.getElementById('import-preview-card');
  if (previewCard) previewCard.setAttribute('hidden', '');
  _parsedRows = []; _mappedTrades = [];
}

function updateImportHint() {
  const layout = BROKER_LAYOUTS[_broker] || BROKER_LAYOUTS.generic;
  const hint   = document.getElementById('import-hint');
  if (hint) hint.textContent = layout.hint;
}

// ── Processa o arquivo ────────────────
async function handleFile(file) {
  if (!file) return;
  const validTypes = ['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel'];
  if (!validTypes.includes(file.type) && !file.name.match(/\.(csv|txt)$/i)) {
    showToast('Arquivo inválido. Use formato CSV ou TXT.', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('Arquivo muito grande. Máximo 5MB.', 'error');
    return;
  }

  const text = await file.text();
  parseCSV(text);
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) { showToast('Arquivo vazio ou sem dados', 'error'); return; }

  // Detecta separador
  const sep = detectSeparator(lines[0]);
  const headers = splitLine(lines[0], sep).map(h => h.replace(/"/g, '').trim().toLowerCase());

  // Auto-detecta broker se for genérico
  let detectedBroker = _broker;
  if (_broker === 'generic') {
    detectedBroker = Object.entries(BROKER_LAYOUTS)
      .find(([, layout]) => layout !== BROKER_LAYOUTS.generic && layout.detect(headers))?.[0] || 'generic';
  }

  const layout = BROKER_LAYOUTS[detectedBroker] || BROKER_LAYOUTS.generic;
  _parsedRows  = [];
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i], sep);
    const row  = {};
    headers.forEach((h, idx) => { row[h] = (cols[idx] || '').replace(/"/g, '').trim(); });

    try {
      const mapped = layout.map(row);
      if (mapped.date && !isNaN(parseFloat(mapped.pnl))) {
        _parsedRows.push({ ...mapped, _raw: row });
      }
    } catch (e) {
      errors.push({ line: i + 1, error: e.message });
    }
  }

  if (!_parsedRows.length) {
    showToast('Nenhuma linha válida encontrada. Verifique o formato.', 'error');
    return;
  }

  // Agrupa por data (soma P&L do mesmo dia)
  const byDate = {};
  _parsedRows.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = { ...r, pnl: 0, trades: 0 };
    byDate[r.date].pnl    += r.pnl;
    byDate[r.date].trades += 1;
  });

  _mappedTrades = Object.values(byDate).sort((a, b) => a.date < b.date ? -1 : 1);
  renderPreview(errors, detectedBroker);
}

function renderPreview(errors, detectedBroker) {
  const card     = document.getElementById('import-preview-card');
  const table    = document.getElementById('import-preview-table');
  const countEl  = document.getElementById('import-count');

  if (!card || !table) return;
  card.removeAttribute('hidden');

  if (countEl) countEl.textContent = `— ${_mappedTrades.length} dias encontrados`;

  const existing = _mappedTrades.filter(t => getTradeByDate(t.date));

  table.innerHTML = `
    ${detectedBroker !== _broker ? `
      <div class="banner info" style="margin-bottom:12px">
        Formato detectado automaticamente: <strong>${BROKER_LAYOUTS[detectedBroker]?.name || detectedBroker}</strong>
      </div>` : ''}

    ${errors.length ? `
      <div class="banner warning" style="margin-bottom:12px">
        ${errors.length} linha(s) ignorada(s) por formato inválido
      </div>` : ''}

    ${existing.length ? `
      <div class="banner warning" style="margin-bottom:12px">
        ${existing.length} data(s) já existem e serão ignoradas na importação
      </div>` : ''}

    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-md);overflow:hidden;max-height:380px;overflow-y:auto">
      <div style="display:grid;grid-template-columns:100px 80px 90px 80px 1fr;padding:10px 16px;
        background:rgba(0,0,0,0.3);border-bottom:1px solid var(--border);
        font-size:9px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-3)">
        <span>Data</span><span>Par</span><span>P&L</span><span>Trades</span><span>Status</span>
      </div>
      ${_mappedTrades.map(t => {
        const dup = getTradeByDate(t.date);
        return `
          <div style="display:grid;grid-template-columns:100px 80px 90px 80px 1fr;
            padding:10px 16px;border-bottom:1px solid var(--border);
            font-size:12px;align-items:center;${dup ? 'opacity:0.45' : ''}">
            <span style="font-family:var(--font-mono)">${t.date}</span>
            <span style="color:var(--blue)">${t.pair || '—'}</span>
            <span style="font-family:var(--font-mono);font-weight:700;color:${t.pnl >= 0 ? 'var(--green)' : 'var(--red)'}">
              ${t.pnl >= 0 ? '+' : ''}R$${Math.abs(t.pnl).toFixed(2)}
            </span>
            <span style="color:var(--text-3)">${t.trades}</span>
            <span style="font-size:11px">
              ${dup
                ? '<span style="color:var(--amber)">⚠ já existe</span>'
                : '<span style="color:var(--green)">✓ novo</span>'}
            </span>
          </div>`;
      }).join('')}
    </div>

    <div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--text-3)">
      <span>${_mappedTrades.filter(t => !getTradeByDate(t.date)).length} novos · ${existing.length} existentes</span>
    </div>`;
}

function doImport() {
  if (!_mappedTrades.length) { showToast('Nenhum dado para importar', 'warning'); return; }

  let imported = 0, skipped = 0;
  _mappedTrades.forEach(t => {
    if (getTradeByDate(t.date)) { skipped++; return; }
    saveTrade({ ...t, id: genId() });
    imported++;
  });

  // Persiste e notifica
  document.dispatchEvent(new CustomEvent('tros:trades-imported', { detail: { imported, skipped } }));

  showToast(`${imported} trades importados! ${skipped > 0 ? skipped + ' já existiam.' : ''}`, 'success');
  cancelImport();
}

function cancelImport() {
  _parsedRows = []; _mappedTrades = [];
  const card = document.getElementById('import-preview-card');
  if (card) card.setAttribute('hidden', '');
  const input = document.getElementById('import-file-input');
  if (input) input.value = '';
}

// ── Parsers de data ───────────────────
function parseDate(str) {
  if (!str) return null;
  str = str.trim();

  // ISO: 2024-01-15
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // BR: 15/01/2024 ou 15.01.2024
  m = str.match(/^(\d{2})[\/\.](\d{2})[\/\.](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  // US: 01/15/2024
  m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) {
    const month = parseInt(m[1]), day = parseInt(m[2]);
    if (month <= 12) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  }

  // MT4: 2024.01.15 12:30:00
  m = str.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  return null;
}

function detectSeparator(line) {
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  for (const ch of line) { if (counts[ch] !== undefined) counts[ch]++; }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function splitLine(line, sep) {
  const result = []; let current = ''; let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === sep && !inQuotes) { result.push(current); current = ''; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}
