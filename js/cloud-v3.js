// ═══════════════════════════════════════
//  TRADER OS · cloud-v3.js
//  Supabase com tabelas reais (Fase 3)
//  Substitui o armazenamento em payload JSON
// ═══════════════════════════════════════

import { getSupabaseConfig } from './config.js';

let _sb   = null;
let _user = null;
let _syncCb = null;
let _realtimeSub = null;

// ── Init ──────────────────────────────
export function initSupabase() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return false;
  try {
    _sb = window.supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 2 } },
    });
    return true;
  } catch { return false; }
}

export const getSB      = ()  => _sb;
export const getUser    = ()  => _user;
export const isLoggedIn = ()  => !!_user;

export function onSyncStateChange(cb) { _syncCb = cb; }
function setSyncState(s) { _syncCb?.(s); }

// ── Auth ──────────────────────────────
export async function login(email, password) {
  if (!_sb) throw new Error('Supabase não configurado');
  const { data, error } = await _sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(translateError(error.message));
  _user = data.user;
  return _user;
}

export async function register(email, password) {
  if (!_sb) throw new Error('Supabase não configurado');
  if (password.length < 8) throw new Error('Senha: mínimo 8 caracteres');
  const { data, error } = await _sb.auth.signUp({ email, password });
  if (error) throw new Error(translateError(error.message));
  return data;
}

export async function logout() {
  _realtimeSub?.unsubscribe();
  if (_sb) await _sb.auth.signOut();
  _user = null; _sb = null;
  setSyncState('local');
}

export async function recoverSession() {
  if (!_sb) return null;
  const { data } = await _sb.auth.getSession();
  if (data?.session?.user) { _user = data.session.user; return _user; }
  return null;
}

export async function resetPassword(email) {
  if (!_sb) throw new Error('Supabase não configurado');
  const { error } = await _sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/?reset=true',
  });
  if (error) throw new Error(translateError(error.message));
}

// ── Perfil ────────────────────────────
export async function loadProfile() {
  if (!_sb || !_user) return null;
  const { data } = await _sb.from('profiles').select('*').eq('id', _user.id).single();
  return data;
}

export async function saveProfile(profile) {
  if (!_sb || !_user) return;
  await _sb.from('profiles').upsert({ ...profile, id: _user.id }, { onConflict: 'id' });
}

// ── Contas ────────────────────────────
export async function loadAccounts() {
  if (!_sb || !_user) return [];
  const { data } = await _sb.from('accounts')
    .select('*').eq('user_id', _user.id).eq('is_active', true).order('created_at');
  return data || [];
}

export async function upsertAccount(account) {
  if (!_sb || !_user) return null;
  const { data, error } = await _sb.from('accounts').upsert(
    { ...account, user_id: _user.id },
    { onConflict: 'id' }
  ).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteAccount(accountId) {
  if (!_sb || !_user) return;
  await _sb.from('accounts').update({ is_active: false }).eq('id', accountId).eq('user_id', _user.id);
}

// ── Config da conta ───────────────────
export async function loadAccountConfig(accountId) {
  if (!_sb || !_user) return null;
  const { data } = await _sb.from('account_configs')
    .select('*').eq('account_id', accountId).single();
  return data;
}

export async function saveAccountConfig(accountId, config) {
  if (!_sb || !_user) return;
  await _sb.from('account_configs').upsert(
    { ...config, account_id: accountId, user_id: _user.id },
    { onConflict: 'account_id' }
  );
}

// ── Trades ────────────────────────────
export async function loadTrades(accountId, opts = {}) {
  if (!_sb || !_user) return [];
  let q = _sb.from('trades')
    .select('*')
    .eq('account_id', accountId)
    .eq('user_id', _user.id)
    .order('date', { ascending: true });

  if (opts.from) q = q.gte('date', opts.from);
  if (opts.to)   q = q.lte('date', opts.to);
  if (opts.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function upsertTrade(trade, accountId) {
  if (!_sb || !_user) return null;
  setSyncState('syncing');
  const { data, error } = await _sb.from('trades').upsert(
    { ...trade, account_id: accountId, user_id: _user.id },
    { onConflict: 'account_id,date' }
  ).select().single();
  if (error) { setSyncState('error'); throw new Error(error.message); }
  setSyncState('synced');
  return data;
}

export async function deleteTrade(tradeId) {
  if (!_sb || !_user) return;
  setSyncState('syncing');
  const { error } = await _sb.from('trades')
    .delete().eq('id', tradeId).eq('user_id', _user.id);
  if (error) { setSyncState('error'); throw new Error(error.message); }
  setSyncState('synced');
}

// ── Operações granulares ──────────────
export async function loadOperations(accountId, date = null) {
  if (!_sb || !_user) return [];
  let q = _sb.from('operations')
    .select('*').eq('account_id', accountId).eq('user_id', _user.id);
  if (date) q = q.eq('date', date);
  const { data } = await q.order('entry_time', { ascending: true });
  return data || [];
}

export async function upsertOperation(op, accountId) {
  if (!_sb || !_user) return null;
  const { data, error } = await _sb.from('operations').upsert(
    { ...op, account_id: accountId, user_id: _user.id },
    { onConflict: 'id' }
  ).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteOperation(opId) {
  if (!_sb || !_user) return;
  await _sb.from('operations').delete().eq('id', opId).eq('user_id', _user.id);
}

// ── Tags ──────────────────────────────
export async function loadTags(type = null) {
  if (!_sb || !_user) return [];
  let q = _sb.from('tags').select('*').eq('user_id', _user.id);
  if (type) q = q.eq('type', type);
  const { data } = await q.order('name');
  return data || [];
}

export async function upsertTag(tag) {
  if (!_sb || !_user) return null;
  const { data } = await _sb.from('tags').upsert(
    { ...tag, user_id: _user.id },
    { onConflict: 'user_id,name,type' }
  ).select().single();
  return data;
}

// ── Alertas ───────────────────────────
export async function loadAlerts(unreadOnly = true) {
  if (!_sb || !_user) return [];
  let q = _sb.from('alerts').select('*').eq('user_id', _user.id);
  if (unreadOnly) q = q.eq('is_read', false);
  const { data } = await q.order('created_at', { ascending: false }).limit(20);
  return data || [];
}

export async function markAlertRead(alertId) {
  if (!_sb || !_user) return;
  await _sb.from('alerts').update({ is_read: true }).eq('id', alertId).eq('user_id', _user.id);
}

export async function createAlert(accountId, type, message) {
  if (!_sb || !_user) return;
  await _sb.from('alerts').insert({
    user_id: _user.id, account_id: accountId, type, message,
  });
}

// ── Upload de screenshot ──────────────
export async function uploadScreenshot(file, tradeDate, accountId) {
  if (!_sb || !_user) throw new Error('Faça login para salvar screenshots');
  if (file.size > 5 * 1024 * 1024) throw new Error('Screenshot muito grande (máx. 5MB)');
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `${_user.id}/${accountId}/${tradeDate}-${Date.now()}.${ext}`;
  const { error } = await _sb.storage.from('screenshots').upload(path, file, { contentType: file.type });
  if (error) throw new Error('Upload falhou: ' + error.message);
  const { data: urlData } = _sb.storage.from('screenshots').getPublicUrl(path);
  return { url: urlData.publicUrl, path };
}

export async function deleteScreenshot(path) {
  if (!_sb || !path) return;
  await _sb.storage.from('screenshots').remove([path]);
}

// ── Realtime ──────────────────────────
export function subscribeToTrades(accountId, onUpdate) {
  if (!_sb || !_user) return;
  _realtimeSub = _sb.channel('trades-' + accountId)
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'trades',
      filter: `account_id=eq.${accountId}`,
    }, payload => onUpdate(payload))
    .subscribe();
}

export function unsubscribeRealtime() {
  _realtimeSub?.unsubscribe();
  _realtimeSub = null;
}

// ── Plano do usuário ──────────────────
export async function loadUserPlan() {
  if (!_sb || !_user) return 'free';
  const { data } = await _sb.from('subscriptions')
    .select('plan, status').eq('user_id', _user.id).single();
  if (data?.status === 'active' || data?.status === 'trialing') return data.plan || 'free';
  return 'free';
}

// ── Analytics no banco ────────────────
export async function fetchMonthlyStats(accountId, year) {
  if (!_sb || !_user) return [];
  const from = `${year}-01-01`;
  const to   = `${year}-12-31`;
  const { data } = await _sb.from('trades')
    .select('date, pnl, trades')
    .eq('account_id', accountId)
    .gte('date', from).lte('date', to)
    .order('date');
  return data || [];
}

// ── Error translations ────────────────
function translateError(msg) {
  const map = {
    'Invalid login credentials': 'Email ou senha incorretos',
    'Email not confirmed':       'Confirme seu email antes de entrar',
    'User already registered':   'Email já cadastrado',
    'rate limit':                'Muitas tentativas. Aguarde alguns minutos.',
  };
  for (const [k, v] of Object.entries(map)) {
    if (msg.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return msg;
}

export const SUPABASE_SETUP_SQL = `-- Ver arquivo setup.sql`;
