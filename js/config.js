// ═══════════════════════════════════════
//  TRADER OS · config.js
//  Configurações globais — NUNCA coloque
//  chaves de API diretamente aqui.
// ═══════════════════════════════════════

export const APP_VERSION = '2.0.0';

// Supabase: lidas do localStorage (usuário configura na tela de setup)
export function getSupabaseConfig() {
  return {
    url: localStorage.getItem('tros_sb_url') || '',
    key: localStorage.getItem('tros_sb_key') || '',
  };
}

export function saveSupabaseConfig(url, key) {
  if (!url || !key) throw new Error('URL e Key são obrigatórios');
  // Validação básica de formato
  if (!url.startsWith('https://') || !url.includes('.supabase.co')) {
    throw new Error('URL do Supabase inválida. Deve ser https://xxxx.supabase.co');
  }
  if (key.length < 20) {
    throw new Error('Anon Key parece inválida. Verifique no painel do Supabase.');
  }
  localStorage.setItem('tros_sb_url', url.trim());
  localStorage.setItem('tros_sb_key', key.trim());
}

export function clearSupabaseConfig() {
  localStorage.removeItem('tros_sb_url');
  localStorage.removeItem('tros_sb_key');
}

// Pares de moeda suportados
export const PAIRS = [
  'EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CAD',
  'NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY','XAU/USD',
  'USD/CHF','EUR/CHF','GBP/AUD','EUR/AUD','BTC/USD',
  'ETH/USD','Múltiplos','Outro',
];

// Sessões de mercado
export const SESSIONS = ['Londres','Nova York','Tóquio','Londres+NY','Asiática','Outro'];

// Estados emocionais
export const EMOTIONS = [
  { val: 'calmo',      label: 'Calmo',      emoji: '😌' },
  { val: 'confiante',  label: 'Confiante',  emoji: '😎' },
  { val: 'ansioso',    label: 'Ansioso',    emoji: '😰' },
  { val: 'frustrado',  label: 'Frustrado',  emoji: '😤' },
  { val: 'ganancioso', label: 'Ganancioso', emoji: '🤑' },
  { val: 'cansado',    label: 'Cansado',    emoji: '😴' },
  { val: 'no_flow',    label: 'No Flow',    emoji: '🔥' },
  { val: 'perdido',    label: 'Perdido',    emoji: '😵' },
];

// Tipos de conta de prop firm com regras padrão
export const PROP_FIRMS = {
  ftmo: {
    name: 'FTMO',
    maxDailyLoss: 0.05,      // 5% do capital
    maxTotalLoss: 0.10,      // 10% do capital
    profitTarget: 0.10,      // 10% para passar fase 1
    minTradingDays: 10,
    trailingDrawdown: false,
  },
  topstep: {
    name: 'Topstep',
    maxDailyLoss: 0.03,
    maxTotalLoss: 0.06,
    profitTarget: 0.06,
    minTradingDays: 5,
    trailingDrawdown: true,
  },
  the5ers: {
    name: 'The5%ers',
    maxDailyLoss: 0.04,
    maxTotalLoss: 0.08,
    profitTarget: 0.08,
    minTradingDays: 0,
    trailingDrawdown: false,
  },
  myforexfunds: {
    name: 'My Forex Funds',
    maxDailyLoss: 0.05,
    maxTotalLoss: 0.12,
    profitTarget: 0.08,
    minTradingDays: 5,
    trailingDrawdown: false,
  },
  custom: {
    name: 'Customizado',
    maxDailyLoss: 0.05,
    maxTotalLoss: 0.10,
    profitTarget: 0.10,
    minTradingDays: 0,
    trailingDrawdown: false,
  },
};

// Dias da semana em português
export const WEEKDAYS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

// Meses em português
export const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
export const MONTHS_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
