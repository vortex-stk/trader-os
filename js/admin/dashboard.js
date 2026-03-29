// ═══════════════════════════════════════
//  TRADER OS · admin/dashboard.js
//  Dashboard de administração
//  MRR, churn, usuários, feature flags
//  Acessível apenas via role 'admin'
// ═══════════════════════════════════════

// ── SQL do painel admin (execute no Supabase) ──────────
export const ADMIN_SQL = `
-- Role de admin (execute uma vez)
create table if not exists public.admin_users (
  user_id uuid references auth.users(id) primary key
);

-- Adicione seu usuário como admin:
-- insert into public.admin_users values ('SEU_USER_ID');

-- Feature flags
create table if not exists public.feature_flags (
  key         text primary key,
  enabled     boolean default false,
  description text,
  rollout_pct int default 100,   -- % de usuários que veem a feature
  updated_at  timestamptz default now()
);

-- Flags iniciais
insert into public.feature_flags (key, enabled, description, rollout_pct) values
  ('ai_analysis',      false, 'Análise com IA para usuários premium',    100),
  ('realtime_sync',    true,  'Sincronização em tempo real via Realtime', 100),
  ('new_dashboard',    false, 'Dashboard redesenhado (beta)',             10),
  ('mt_integration',   false, 'Integração automática MT4/MT5',           0),
  ('public_profiles',  false, 'Perfis públicos verificados',             0)
on conflict (key) do nothing;

-- View de métricas de admin
create or replace view public.admin_metrics as
select
  (select count(*) from auth.users)                                        as total_users,
  (select count(*) from auth.users where created_at >= now() - interval '30 days') as new_users_30d,
  (select count(*) from public.subscriptions where plan = 'pro'    and status = 'active') as pro_users,
  (select count(*) from public.subscriptions where plan = 'premium' and status = 'active') as premium_users,
  (select count(*) from public.subscriptions where status in ('cancelled','past_due'))     as churned_users,
  (select count(*) from public.trades where created_at >= now() - interval '30 days')     as trades_30d,
  (select count(distinct user_id) from public.trades where date >= current_date - 7)      as dau_7d;

grant select on public.admin_metrics to service_role;

-- RLS: apenas admins veem feature flags via API
alter table public.feature_flags enable row level security;
create policy "flags_admin_read" on public.feature_flags for select
  using (exists (select 1 from public.admin_users where user_id = auth.uid()));
create policy "flags_admin_write" on public.feature_flags for all
  using (exists (select 1 from public.admin_users where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users where user_id = auth.uid()));
`;

// ── Página de admin (HTML completo) ───
export function renderAdminPage(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = `
    <div class="admin-wrap">
      <div class="admin-header">
        <div>
          <h1 class="page-title">Admin</h1>
          <p class="page-subtitle">Métricas, usuários e configurações da plataforma</p>
        </div>
        <div class="admin-badges">
          <span class="badge badge-red">Restrito</span>
        </div>
      </div>

      <!-- KPIs de negócio -->
      <div class="admin-kpi-grid" id="admin-kpis">
        <div class="kpi admin-kpi-skeleton"></div>
        <div class="kpi admin-kpi-skeleton"></div>
        <div class="kpi admin-kpi-skeleton"></div>
        <div class="kpi admin-kpi-skeleton"></div>
        <div class="kpi admin-kpi-skeleton"></div>
      </div>

      <div class="admin-grid">
        <!-- Crescimento de usuários -->
        <div class="card">
          <h3 class="card-title">Crescimento</h3>
          <p class="card-subtitle">Novos usuários nos últimos 90 dias</p>
          <canvas id="admin-growth-chart" height="200"></canvas>
        </div>

        <!-- Distribuição de planos -->
        <div class="card">
          <h3 class="card-title">Distribuição de Planos</h3>
          <p class="card-subtitle">Usuários por plano atual</p>
          <canvas id="admin-plans-chart" height="200"></canvas>
          <div id="admin-plans-legend" class="admin-legend"></div>
        </div>
      </div>

      <!-- Feature flags -->
      <div class="card" style="margin-top:14px">
        <div class="card-header">
          <div>
            <h3 class="card-title">Feature Flags</h3>
            <p class="card-subtitle">Controle de funcionalidades em produção</p>
          </div>
          <button class="btn-ghost btn-sm" id="btn-reload-flags">↺ Recarregar</button>
        </div>
        <div id="admin-flags-list"></div>
      </div>

      <!-- Usuários recentes -->
      <div class="card" style="margin-top:14px">
        <div class="card-header">
          <h3 class="card-title">Usuários Recentes</h3>
          <input class="form-input" placeholder="Buscar por email…" id="admin-user-search"
            style="width:240px;font-size:12px;padding:7px 12px">
        </div>
        <div id="admin-users-table"></div>
      </div>

      <!-- MRR histórico -->
      <div class="card" style="margin-top:14px">
        <h3 class="card-title">MRR Estimado</h3>
        <p class="card-subtitle">Receita recorrente mensal projetada</p>
        <div id="admin-mrr-display"></div>
      </div>
    </div>
  `;

  loadAdminData();
  initAdminEvents();
}

async function loadAdminData() {
  const sb = window.TROS_CLOUD?.sbClient;
  if (!sb) return;

  try {
    // Métricas básicas via função
    const { data: metrics } = await sb.rpc('get_admin_metrics').maybeSingle()
      .catch(() => ({ data: null }));

    renderAdminKPIs(metrics);
    await loadFeatureFlags(sb);
    await loadRecentUsers(sb);
    renderMRR(metrics);
  } catch (e) {
    console.error('[Admin]', e);
    document.getElementById('admin-kpis').innerHTML =
      '<div class="banner warning">Erro ao carregar métricas. Verifique as permissões de admin.</div>';
  }
}

function renderAdminKPIs(m) {
  const container = document.getElementById('admin-kpis');
  if (!container) return;
  if (!m) {
    container.innerHTML = `
      <div class="banner warning" style="grid-column:1/-1">
        Métricas indisponíveis. Execute o SQL de admin e verifique as permissões.
      </div>`;
    return;
  }

  const proRevenue     = (m.pro_users || 0) * 97;
  const premiumRevenue = (m.premium_users || 0) * 197;
  const mrr            = proRevenue + premiumRevenue;
  const churnRate      = m.total_users > 0
    ? ((m.churned_users || 0) / m.total_users * 100).toFixed(1)
    : '0.0';

  container.innerHTML = [
    { tag: 'MRR',           val: 'R$' + mrr.toLocaleString('pt-BR'),           cls: 'g', sub: `Pro: R$${proRevenue.toLocaleString()} + Premium: R$${premiumRevenue.toLocaleString()}` },
    { tag: 'Total Usuários', val: (m.total_users || 0).toLocaleString(),        cls: 'b', sub: `+${m.new_users_30d || 0} nos últimos 30 dias` },
    { tag: 'Pro + Premium',  val: ((m.pro_users||0) + (m.premium_users||0)).toString(), cls: 'g', sub: `Pro: ${m.pro_users||0} · Premium: ${m.premium_users||0}` },
    { tag: 'Churn',          val: churnRate + '%',                               cls: 'r', sub: `${m.churned_users||0} cancelamentos` },
    { tag: 'DAU (7d)',       val: (m.dau_7d || 0).toString(),                   cls: 'o', sub: `${m.trades_30d||0} trades últimos 30d` },
  ].map(k => `
    <div class="kpi">
      <div class="kpi-tag">${k.tag}</div>
      <div class="kpi-num ${k.cls}">${k.val}</div>
      <div class="kpi-sub">${k.sub}</div>
    </div>
  `).join('');
}

async function loadFeatureFlags(sb) {
  const container = document.getElementById('admin-flags-list');
  if (!container) return;

  const { data: flags } = await sb.from('feature_flags').select('*').order('key');
  if (!flags?.length) {
    container.innerHTML = '<p style="color:var(--text-3);padding:14px">Nenhuma feature flag configurada. Execute o SQL de admin.</p>';
    return;
  }

  container.innerHTML = `
    <div class="flags-table">
      ${flags.map(f => `
        <div class="flag-row">
          <div class="flag-info">
            <div class="flag-key"><code>${f.key}</code></div>
            <div class="flag-desc">${f.description || '—'}</div>
          </div>
          <div class="flag-controls">
            <span style="font-size:11px;color:var(--text-3)">Rollout: ${f.rollout_pct}%</span>
            <input type="range" min="0" max="100" value="${f.rollout_pct}"
              class="flag-rollout" data-key="${f.key}" style="width:80px">
            <label class="flag-toggle">
              <input type="checkbox" ${f.enabled ? 'checked' : ''} data-flag-key="${f.key}">
              <span class="flag-toggle-track"></span>
            </label>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // Eventos de toggle
  container.querySelectorAll('[data-flag-key]').forEach(input => {
    input.addEventListener('change', async () => {
      await sb.from('feature_flags')
        .update({ enabled: input.checked })
        .eq('key', input.dataset.flagKey);
      showFlagToast(input.dataset.flagKey, input.checked);
    });
  });

  // Eventos de rollout
  container.querySelectorAll('.flag-rollout').forEach(range => {
    range.addEventListener('change', async () => {
      await sb.from('feature_flags')
        .update({ rollout_pct: parseInt(range.value) })
        .eq('key', range.dataset.key);
    });
  });
}

async function loadRecentUsers(sb) {
  const container = document.getElementById('admin-users-table');
  if (!container) return;

  // Busca via service role (Edge Function em produção real)
  // Aqui simulamos com dados disponíveis via RLS
  const { data: subs } = await sb.from('subscriptions')
    .select('user_id, plan, status, created_at, current_period_end')
    .order('created_at', { ascending: false })
    .limit(20);

  if (!subs?.length) {
    container.innerHTML = '<p style="color:var(--text-3);padding:14px">Nenhum usuário encontrado.</p>';
    return;
  }

  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:rgba(0,0,0,0.25);font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3)">
          <th style="padding:10px 14px;text-align:left">User ID</th>
          <th style="padding:10px 14px;text-align:left">Plano</th>
          <th style="padding:10px 14px;text-align:left">Status</th>
          <th style="padding:10px 14px;text-align:left">Desde</th>
          <th style="padding:10px 14px;text-align:left">Próx. cobrança</th>
        </tr>
      </thead>
      <tbody>
        ${subs.map(s => `
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:10px 14px;font-family:var(--font-mono);font-size:11px;color:var(--text-3)">
              ${s.user_id?.slice(0,8)}…
            </td>
            <td style="padding:10px 14px">
              <span class="badge badge-${s.plan === 'premium' ? 'purple' : s.plan === 'pro' ? 'green' : 'gray'}">
                ${s.plan || 'free'}
              </span>
            </td>
            <td style="padding:10px 14px">
              <span style="font-size:11px;color:${s.status==='active'?'var(--green)':s.status==='past_due'?'var(--red)':'var(--text-3)'}">
                ${s.status || 'inactive'}
              </span>
            </td>
            <td style="padding:10px 14px;font-size:12px;color:var(--text-2)">
              ${s.created_at ? new Date(s.created_at).toLocaleDateString('pt-BR') : '—'}
            </td>
            <td style="padding:10px 14px;font-size:12px;color:var(--text-2)">
              ${s.current_period_end ? new Date(s.current_period_end).toLocaleDateString('pt-BR') : '—'}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderMRR(m) {
  const container = document.getElementById('admin-mrr-display');
  if (!container || !m) return;

  const proRev     = (m.pro_users || 0) * 97;
  const premiumRev = (m.premium_users || 0) * 197;
  const mrr        = proRev + premiumRev;
  const arr        = mrr * 12;

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:14px">
      <div class="kpi">
        <div class="kpi-tag">MRR</div>
        <div class="kpi-num g">R$${mrr.toLocaleString('pt-BR')}</div>
        <div class="kpi-sub">Receita mensal recorrente</div>
      </div>
      <div class="kpi">
        <div class="kpi-tag">ARR Projetado</div>
        <div class="kpi-num b">R$${arr.toLocaleString('pt-BR')}</div>
        <div class="kpi-sub">MRR × 12</div>
      </div>
      <div class="kpi">
        <div class="kpi-tag">ARPU</div>
        <div class="kpi-num o">R$${((m.pro_users||0)+(m.premium_users||0)) > 0 ? (mrr/((m.pro_users||0)+(m.premium_users||0))).toFixed(0) : '—'}</div>
        <div class="kpi-sub">Receita média por usuário pago</div>
      </div>
    </div>
  `;
}

function initAdminEvents() {
  document.getElementById('btn-reload-flags')?.addEventListener('click', loadAdminData);

  document.getElementById('admin-user-search')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#admin-users-table tr').forEach((row, i) => {
      if (i === 0) return; // header
      row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

function showFlagToast(key, enabled) {
  window.TROS?.showToast?.(
    `Feature "${key}" ${enabled ? 'ativada' : 'desativada'}`,
    enabled ? 'success' : 'info'
  );
}

// ── CSS de admin ──────────────────────
export const ADMIN_CSS = `
.admin-wrap { max-width: 1200px; }
.admin-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:22px; }
.admin-badges { display:flex; gap:8px; align-items:center; }
.admin-kpi-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin-bottom:18px; }
.admin-grid { display:grid; grid-template-columns:2fr 1fr; gap:14px; }
.admin-kpi-skeleton { height:80px; background:rgba(255,255,255,0.04); border-radius:var(--r-md); border:1px solid var(--border); animation:shimmer 1.5s infinite; background-size:200% 100%; background-image:linear-gradient(90deg,rgba(255,255,255,0.03) 25%,rgba(255,255,255,0.07) 50%,rgba(255,255,255,0.03) 75%); }
.admin-legend { display:flex; gap:14px; margin-top:12px; flex-wrap:wrap; }
.flags-table { display:flex; flex-direction:column; }
.flag-row { display:flex; align-items:center; justify-content:space-between; padding:12px 0; border-bottom:1px solid var(--border); gap:16px; }
.flag-row:last-child { border-bottom:none; }
.flag-info { flex:1; min-width:0; }
.flag-key  { font-size:13px; margin-bottom:2px; }
.flag-key code { background:rgba(0,0,0,0.3); padding:2px 8px; border-radius:4px; font-family:var(--font-mono); }
.flag-desc { font-size:11px; color:var(--text-3); }
.flag-controls { display:flex; align-items:center; gap:12px; flex-shrink:0; }
.flag-toggle { position:relative; width:36px; height:20px; cursor:pointer; }
.flag-toggle input { opacity:0; width:0; height:0; }
.flag-toggle-track { position:absolute; inset:0; background:var(--text-4); border-radius:99px; transition:.2s; }
.flag-toggle input:checked + .flag-toggle-track { background:var(--green); }
.flag-toggle-track::after { content:''; position:absolute; top:2px; left:2px; width:16px; height:16px; background:#fff; border-radius:50%; transition:.2s; }
.flag-toggle input:checked + .flag-toggle-track::after { transform:translateX(16px); }
@media(max-width:1100px){ .admin-kpi-grid{grid-template-columns:repeat(3,1fr)} .admin-grid{grid-template-columns:1fr} }
@media(max-width:768px){ .admin-kpi-grid{grid-template-columns:1fr 1fr} }
`;
