// ═══════════════════════════════════════
//  TRADER OS · affiliate.js
//  Sistema de afiliados — links, comissões,
//  rastreamento e painel do afiliado
// ═══════════════════════════════════════

// ── SQL necessário (adicionar ao setup.sql) ──────────
export const AFFILIATE_SQL = `
-- Tabela de afiliados
create table if not exists public.affiliates (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references auth.users(id) on delete cascade not null unique,
  code        text not null unique,       -- ex: "JOAO2025"
  commission  numeric(4,2) default 0.20, -- 20%
  status      text default 'active',
  total_refs  int default 0,
  total_paid  numeric(12,2) default 0,
  created_at  timestamptz default now()
);

-- Rastreamento de indicações
create table if not exists public.referrals (
  id             uuid default gen_random_uuid() primary key,
  affiliate_id   uuid references public.affiliates(id) not null,
  referred_user  uuid references auth.users(id),
  status         text default 'pending',  -- pending | converted | paid
  plan           text,
  commission_amt numeric(12,2),
  created_at     timestamptz default now(),
  converted_at   timestamptz,
  paid_at        timestamptz
);

create index idx_referrals_affiliate on public.referrals(affiliate_id);
create index idx_referrals_code      on public.affiliates(code);

alter table public.affiliates enable row level security;
alter table public.referrals   enable row level security;

create policy "affiliate_own" on public.affiliates for all using (auth.uid() = user_id);
create policy "referral_own"  on public.referrals  for select
  using (affiliate_id in (select id from public.affiliates where user_id = auth.uid()));

-- Função: aplica código de afiliado ao signup
create or replace function public.apply_referral(ref_code text, new_user_id uuid)
returns void as $$
declare
  aff_id uuid;
begin
  select id into aff_id from public.affiliates where code = upper(ref_code) and status = 'active';
  if aff_id is not null then
    insert into public.referrals (affiliate_id, referred_user, status)
    values (aff_id, new_user_id, 'pending');
    update public.affiliates set total_refs = total_refs + 1 where id = aff_id;
  end if;
end;
$$ language plpgsql security definer;
`;

// ── Gera link de afiliado ──────────────
export function buildAffiliateLink(code) {
  const base = window.location.origin;
  return `${base}/app?ref=${code.toUpperCase()}`;
}

// ── Captura código de afiliado na URL ─
export function captureReferralCode() {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('ref');
  if (code) {
    sessionStorage.setItem('tros_ref', code.toUpperCase());
    // Limpa da URL
    params.delete('ref');
    const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
    window.history.replaceState({}, '', newUrl);
  }
  return sessionStorage.getItem('tros_ref');
}

// ── Aplica indicação após signup ──────
export async function applyReferralAfterSignup(sb, userId) {
  const code = sessionStorage.getItem('tros_ref');
  if (!code || !sb || !userId) return;
  try {
    await sb.rpc('apply_referral', { ref_code: code, new_user_id: userId });
    sessionStorage.removeItem('tros_ref');
  } catch (e) {
    console.warn('[Affiliate] Falha ao aplicar referral:', e.message);
  }
}

// ── Painel do afiliado ─────────────────
export async function renderAffiliateDashboard(containerId, sb, userId) {
  const container = document.getElementById(containerId);
  if (!container || !sb || !userId) return;

  // Busca dados do afiliado
  let { data: aff } = await sb.from('affiliates').select('*').eq('user_id', userId).single();

  // Se não existe, cria automaticamente
  if (!aff) {
    const code = await generateUniqueCode(sb, userId);
    const { data: created } = await sb.from('affiliates')
      .insert({ user_id: userId, code }).select().single();
    aff = created;
  }

  if (!aff) {
    container.innerHTML = '<p style="color:var(--text-3)">Erro ao carregar painel de afiliados.</p>';
    return;
  }

  // Busca indicações
  const { data: refs } = await sb.from('referrals')
    .select('*').eq('affiliate_id', aff.id)
    .order('created_at', { ascending: false });

  const link        = buildAffiliateLink(aff.code);
  const converted   = refs?.filter(r => r.status === 'converted').length || 0;
  const pending     = refs?.filter(r => r.status === 'pending').length || 0;
  const totalEarned = refs?.filter(r => r.commission_amt)
    .reduce((a, r) => a + (r.commission_amt || 0), 0) || 0;

  container.innerHTML = `
    <div class="affiliate-header">
      <h2 class="page-title">Programa de Afiliados</h2>
      <p class="page-subtitle">Ganhe 20% de comissão recorrente por cada trader que você indicar.</p>
    </div>

    <!-- KPIs -->
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">
      <div class="kpi">
        <div class="kpi-tag">Indicações Totais</div>
        <div class="kpi-num b">${aff.total_refs || 0}</div>
        <div class="kpi-sub">${pending} aguardando conversão</div>
      </div>
      <div class="kpi">
        <div class="kpi-tag">Convertidos</div>
        <div class="kpi-num g">${converted}</div>
        <div class="kpi-sub">Assinaturas ativas</div>
      </div>
      <div class="kpi">
        <div class="kpi-tag">Comissão Total</div>
        <div class="kpi-num g">R$${totalEarned.toFixed(2)}</div>
        <div class="kpi-sub">20% recorrente</div>
      </div>
      <div class="kpi">
        <div class="kpi-tag">Taxa de Conversão</div>
        <div class="kpi-num o">${aff.total_refs > 0 ? (converted/aff.total_refs*100).toFixed(0) : 0}%</div>
        <div class="kpi-sub">Indicações → assinantes</div>
      </div>
    </div>

    <!-- Link de afiliado -->
    <div class="card" style="margin-bottom:16px">
      <h3 class="card-title" style="margin-bottom:14px">Seu link de indicação</h3>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;background:rgba(0,0,0,0.3);border:1px solid var(--border-md);border-radius:var(--r-sm);padding:11px 14px;font-family:var(--font-mono);font-size:13px;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${link}
        </div>
        <button class="btn-primary" id="btn-copy-affiliate" data-link="${link}">Copiar link</button>
      </div>
      <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
        <a href="https://wa.me/?text=${encodeURIComponent('Use meu link e ganhe acesso ao Trader OS: ' + link)}"
          target="_blank" class="btn-ghost btn-sm">📱 WhatsApp</a>
        <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent('Uso o @TraderOS para acompanhar minhas operações. Crie sua conta: ' + link)}"
          target="_blank" class="btn-ghost btn-sm">🐦 Twitter</a>
        <button class="btn-ghost btn-sm" id="btn-regen-code">↺ Novo código</button>
      </div>
      <p style="font-size:11px;color:var(--text-3);margin-top:10px">
        Código: <strong style="color:var(--purple);font-family:var(--font-mono)">${aff.code}</strong> ·
        Comissão de ${(aff.commission * 100).toFixed(0)}% por mês em cada assinatura ativa
      </p>
    </div>

    <!-- Histórico de indicações -->
    <div class="card">
      <h3 class="card-title" style="margin-bottom:14px">Histórico de Indicações</h3>
      ${!refs?.length ? '<p style="color:var(--text-3);font-size:13px">Nenhuma indicação ainda. Compartilhe seu link!</p>' : `
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:rgba(0,0,0,0.25);font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3)">
              <th style="padding:9px 12px;text-align:left">Data</th>
              <th style="padding:9px 12px;text-align:left">Status</th>
              <th style="padding:9px 12px;text-align:left">Plano</th>
              <th style="padding:9px 12px;text-align:right">Comissão</th>
            </tr>
          </thead>
          <tbody>
            ${refs.map(r => `
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:9px 12px;color:var(--text-2)">${new Date(r.created_at).toLocaleDateString('pt-BR')}</td>
                <td style="padding:9px 12px">
                  <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;
                    background:${r.status==='converted'?'var(--green-bg)':r.status==='paid'?'var(--blue-bg)':'var(--amber-bg)'};
                    color:${r.status==='converted'?'var(--green)':r.status==='paid'?'var(--blue)':'var(--amber)'}">
                    ${r.status==='converted'?'Ativo':r.status==='paid'?'Pago':'Aguardando'}
                  </span>
                </td>
                <td style="padding:9px 12px;color:var(--text-2)">${r.plan || '—'}</td>
                <td style="padding:9px 12px;text-align:right;font-family:var(--font-mono);color:var(--green)">
                  ${r.commission_amt ? '+R$' + r.commission_amt.toFixed(2) : '—'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;

  // Eventos
  document.getElementById('btn-copy-affiliate')?.addEventListener('click', async btn => {
    await navigator.clipboard.writeText(link);
    const orig = btn.textContent;
    btn.textContent = 'Copiado! ✓';
    setTimeout(() => btn.textContent = orig, 2000);
  });

  document.getElementById('btn-regen-code')?.addEventListener('click', async () => {
    if (!confirm('Gerar um novo código? O código antigo deixará de funcionar.')) return;
    const newCode = await generateUniqueCode(sb, userId);
    await sb.from('affiliates').update({ code: newCode }).eq('id', aff.id);
    renderAffiliateDashboard(containerId, sb, userId);
    window.TROS?.showToast?.('Novo código gerado!', 'success');
  });
}

async function generateUniqueCode(sb, userId) {
  const base   = userId.slice(0, 4).toUpperCase();
  const suffix = Math.floor(Math.random() * 9000 + 1000);
  const code   = base + suffix;
  // Verifica se já existe
  const { data } = await sb.from('affiliates').select('id').eq('code', code).single();
  if (data) return generateUniqueCode(sb, userId); // tenta novamente
  return code;
}
