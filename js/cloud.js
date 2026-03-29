// ═══════════════════════════════════════
//  TRADER OS · cloud.js
//  Integração Supabase — auth + sync + storage
//  Sem chaves hardcoded. RLS obrigatório.
// ═══════════════════════════════════════

import { getSupabaseConfig } from './config.js';
import { getDB, loadLocal, saveLocal, setActiveId, getActiveId } from './db.js';

let _sbClient = null;
let _currentUser = null;
let _syncTimer = null;
let _onSyncStateChange = null; // callback: (state: 'syncing'|'synced'|'error'|'local') => void

// ── Inicialização ─────────────────────
export function initSupabase() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return false;
  try {
    _sbClient = window.supabase.createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    return true;
  } catch (e) {
    console.error('[Cloud] Falha ao inicializar Supabase:', e);
    return false;
  }
}

export function isCloudReady() { return !!_sbClient; }
export function getCurrentUser() { return _currentUser; }
export function isLoggedIn() { return !!_currentUser; }

export function onSyncStateChange(cb) { _onSyncStateChange = cb; }

function setSyncState(state) {
  if (_onSyncStateChange) _onSyncStateChange(state);
}

// ── Autenticação ──────────────────────
export async function login(email, password) {
  if (!_sbClient) throw new Error('Supabase não configurado');

  const { data, error } = await _sbClient.auth.signInWithPassword({ email, password });
  if (error) throw new Error(translateAuthError(error.message));

  _currentUser = data.user;
  return data.user;
}

export async function register(email, password) {
  if (!_sbClient) throw new Error('Supabase não configurado');
  if (password.length < 8) throw new Error('Senha deve ter pelo menos 8 caracteres');

  const { data, error } = await _sbClient.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.origin + '/auth.html',
    },
  });
  if (error) throw new Error(translateAuthError(error.message));

  return data;
}

export async function logout() {
  if (_sbClient) await _sbClient.auth.signOut();
  _currentUser = null;
  _sbClient = null;
  setSyncState('local');
}

export async function recoverSession() {
  if (!_sbClient) return null;
  const { data } = await _sbClient.auth.getSession();
  if (data?.session?.user) {
    _currentUser = data.session.user;
    return _currentUser;
  }
  return null;
}

export async function resetPassword(email) {
  if (!_sbClient) throw new Error('Supabase não configurado');
  const { error } = await _sbClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/auth.html?type=recovery',
  });
  if (error) throw new Error(translateAuthError(error.message));
}

// ── Sincronização de dados ────────────
export async function loadFromCloud() {
  if (!_sbClient || !_currentUser) return false;
  setSyncState('syncing');

  try {
    const uid = _currentUser.id;
    const { data, error } = await _sbClient
      .from('trader_os_data')
      .select('payload, updated_at')
      .eq('user_id', uid)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found

    if (data?.payload) {
      const parsed = JSON.parse(data.payload);
      // Substitui o db local pelos dados da nuvem
      Object.assign(window._db_ref || {}, parsed);
      // Usa a função importDB do db.js para fazer merge seguro
      importDBFromCloud(parsed);
      saveLocal();
      setSyncState('synced');
      return true;
    }

    setSyncState('synced');
    return false;
  } catch (e) {
    console.error('[Cloud] Erro ao carregar:', e);
    setSyncState('error');
    loadLocal(); // fallback para local
    return false;
  }
}

export function scheduleSyncToCloud() {
  clearTimeout(_syncTimer);
  setSyncState('syncing');
  _syncTimer = setTimeout(syncToCloud, 2000); // debounce 2s
}

export async function syncToCloud() {
  if (!_sbClient || !_currentUser) return;
  setSyncState('syncing');

  try {
    const uid = _currentUser.id;
    const payload = JSON.stringify(getDB());

    await _sbClient
      .from('trader_os_data')
      .upsert(
        { user_id: uid, payload, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );

    setSyncState('synced');
  } catch (e) {
    console.error('[Cloud] Erro ao sincronizar:', e);
    setSyncState('error');
  }
}

// ── Upload de screenshot ──────────────
/**
 * Faz upload de uma imagem para o Supabase Storage.
 * Retorna a URL pública. NÃO salva base64 em lugar nenhum.
 */
export async function uploadScreenshot(file, tradeDate, accountId) {
  if (!_sbClient || !_currentUser) {
    throw new Error('Faça login na nuvem para salvar screenshots');
  }

  const maxSizeMB = 5;
  if (file.size > maxSizeMB * 1024 * 1024) {
    throw new Error(`Screenshot muito grande. Máximo: ${maxSizeMB}MB`);
  }

  const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!validTypes.includes(file.type)) {
    throw new Error('Formato não suportado. Use JPEG, PNG ou WebP.');
  }

  const ext = file.name.split('.').pop().toLowerCase();
  const uid = _currentUser.id;
  const path = `${uid}/${accountId}/${tradeDate}-${Date.now()}.${ext}`;

  const { error } = await _sbClient.storage
    .from('screenshots')
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) throw new Error('Erro ao fazer upload: ' + error.message);

  const { data: urlData } = _sbClient.storage
    .from('screenshots')
    .getPublicUrl(path);

  return { url: urlData.publicUrl, path };
}

export async function deleteScreenshot(path) {
  if (!_sbClient) return;
  await _sbClient.storage.from('screenshots').remove([path]);
}

// ── Função para importar DB da nuvem ─
// (usada internamente — o db.js expõe a referência via window)
function importDBFromCloud(parsed) {
  // Acessa o módulo db via referência global (necessário pois ES modules são encapsulados)
  if (typeof window._importDB === 'function') {
    window._importDB(parsed);
  }
}

// ── SQL necessário no Supabase ────────
// Execute isto no SQL Editor do Supabase antes de usar:
export const SUPABASE_SETUP_SQL = `
-- Tabela principal de dados
create table if not exists trader_os_data (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  payload text not null,
  updated_at timestamptz default now()
);

-- Row Level Security: cada usuário só vê seus próprios dados
alter table trader_os_data enable row level security;

create policy "Usuários veem apenas seus dados"
  on trader_os_data for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Storage bucket para screenshots
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', true)
on conflict do nothing;

create policy "Usuários fazem upload dos próprios screenshots"
  on storage.objects for insert
  with check (auth.uid()::text = (storage.foldername(name))[1]);

create policy "Screenshots são públicos para leitura"
  on storage.objects for select
  using (bucket_id = 'screenshots');

create policy "Usuários deletam seus screenshots"
  on storage.objects for delete
  using (auth.uid()::text = (storage.foldername(name))[1]);
`;

// ── Traduções de erros do Supabase ────
function translateAuthError(msg) {
  const map = {
    'Invalid login credentials': 'Email ou senha incorretos',
    'Email not confirmed': 'Confirme seu email antes de entrar',
    'User already registered': 'Este email já está cadastrado',
    'Password should be at least 6 characters': 'Senha muito curta (mínimo 8 caracteres)',
    'rate limit': 'Muitas tentativas. Aguarde alguns minutos.',
    'network': 'Erro de conexão. Verifique sua internet.',
  };

  for (const [key, translation] of Object.entries(map)) {
    if (msg.toLowerCase().includes(key.toLowerCase())) return translation;
  }
  return msg;
}
