// ═══════════════════════════════════════
//  TRADER OS · stripe/billing.js
//  Planos, checkout, portal do cliente
//  Integração Stripe via Supabase Edge Functions
// ═══════════════════════════════════════

// ── Planos ────────────────────────────
export const PLANS = {
  free: {
    id:       'free',
    name:     'Gratuito',
    price:    0,
    currency: 'BRL',
    features: [
      '1 conta de trading',
      'Últimos 30 dias de histórico',
      'Dashboard básico',
      'Calendário',
    ],
    limits: {
      accounts:  1,
      daysHistory: 30,
      csvImport: false,
      propFirm:  false,
      pdfReport: false,
      aiAnalysis: false,
    },
  },
  pro: {
    id:       'pro',
    name:     'Pro',
    price:    97,
    priceId:  'price_pro_brl_monthly', // Substitua pelo ID real do Stripe
    currency: 'BRL',
    popular:  true,
    features: [
      'Contas ilimitadas',
      'Histórico completo',
      'Importação MT4/MT5/cTrader',
      'Modo Prop Firm (FTMO, Topstep…)',
      'Relatório PDF mensal',
      'Analytics completos',
      'PWA mobile',
      'Suporte via email',
    ],
    limits: {
      accounts:   Infinity,
      daysHistory: Infinity,
      csvImport:  true,
      propFirm:   true,
      pdfReport:  true,
      aiAnalysis: false,
    },
  },
  premium: {
    id:      'premium',
    name:    'Premium',
    price:   197,
    priceId: 'price_premium_brl_monthly', // Substitua pelo ID real do Stripe
    currency: 'BRL',
    features: [
      'Tudo do Pro',
      'Análise com IA (Claude)',
      'Integração automática MT4/MT5',
      'Perfil público verificado',
      'Alertas WhatsApp/Telegram',
      'Suporte prioritário',
      'Acesso antecipado a novas features',
    ],
    limits: {
      accounts:   Infinity,
      daysHistory: Infinity,
      csvImport:  true,
      propFirm:   true,
      pdfReport:  true,
      aiAnalysis: true,
    },
  },
};

// ── Estado do plano atual ──────────────
let _currentPlan = 'free';
let _subscriptionData = null;

export function getCurrentPlan() { return _currentPlan; }
export function getPlanLimits()  { return PLANS[_currentPlan]?.limits || PLANS.free.limits; }

export function canDo(feature) {
  const limits = getPlanLimits();
  return !!limits[feature];
}

// ── Carrega plano do usuário ───────────
export async function loadUserPlan(sbClient, userId) {
  if (!sbClient || !userId) return 'free';
  try {
    const { data } = await sbClient
      .from('subscriptions')
      .select('plan, status, stripe_customer_id, current_period_end')
      .eq('user_id', userId)
      .single();

    if (data?.status === 'active' || data?.status === 'trialing') {
      _currentPlan     = data.plan || 'free';
      _subscriptionData = data;
    } else {
      _currentPlan = 'free';
    }
  } catch {
    _currentPlan = 'free';
  }
  return _currentPlan;
}

// ── Inicia checkout Stripe ─────────────
export async function startCheckout(planId, sbClient, userId, userEmail) {
  if (!sbClient || !userId) throw new Error('Faça login para assinar.');

  const plan = PLANS[planId];
  if (!plan?.priceId) throw new Error('Plano inválido.');

  // Chama a Edge Function do Supabase que cria a sessão Stripe
  const { data, error } = await sbClient.functions.invoke('create-checkout', {
    body: {
      priceId:    plan.priceId,
      userId,
      email:      userEmail,
      successUrl: `${window.location.origin}?checkout=success&plan=${planId}`,
      cancelUrl:  `${window.location.origin}?checkout=cancelled`,
    },
  });

  if (error) throw new Error('Erro ao iniciar pagamento: ' + error.message);
  if (data?.url) {
    window.location.href = data.url;
  } else {
    throw new Error('URL de checkout não recebida.');
  }
}

// ── Abre portal do cliente Stripe ─────
export async function openCustomerPortal(sbClient, userId) {
  if (!sbClient || !userId) throw new Error('Faça login primeiro.');

  const { data, error } = await sbClient.functions.invoke('create-portal-session', {
    body: {
      userId,
      returnUrl: window.location.origin,
    },
  });

  if (error) throw new Error('Erro ao abrir portal: ' + error.message);
  if (data?.url) window.location.href = data.url;
}

// ── Verifica resultado do checkout ────
export function checkCheckoutResult() {
  const params = new URLSearchParams(window.location.search);
  const result = params.get('checkout');
  const plan   = params.get('plan');

  if (result === 'success') {
    // Limpa URL
    window.history.replaceState({}, '', window.location.pathname);
    return { success: true, plan };
  }
  if (result === 'cancelled') {
    window.history.replaceState({}, '', window.location.pathname);
    return { success: false, cancelled: true };
  }
  return null;
}

// ── Gate de funcionalidade ─────────────
/**
 * Verifica se o usuário pode usar uma feature.
 * Se não puder, mostra o modal de upgrade.
 * Retorna true se pode, false se não pode.
 */
export function requirePlan(feature, minPlan = 'pro') {
  if (canDo(feature)) return true;
  showUpgradeModal(feature, minPlan);
  return false;
}

// ── Modal de upgrade ──────────────────
export function showUpgradeModal(feature, minPlan = 'pro') {
  const featureNames = {
    csvImport:   'Importação CSV',
    propFirm:    'Modo Prop Firm',
    pdfReport:   'Relatório PDF',
    aiAnalysis:  'Análise com IA',
  };

  const plan = PLANS[minPlan];
  const modal = document.getElementById('upgrade-modal');
  if (!modal) {
    renderUpgradeModal();
    return;
  }

  const featureName = featureNames[feature] || feature;
  const titleEl = document.getElementById('upgrade-modal-feature');
  if (titleEl) titleEl.textContent = featureName;

  modal.removeAttribute('hidden');
}

export function renderUpgradeModal() {
  if (document.getElementById('upgrade-modal')) return;

  const modal = document.createElement('div');
  modal.innerHTML = `
    <div class="modal-overlay" id="upgrade-modal" role="dialog" aria-modal="true">
      <div class="modal modal-sm" style="text-align:center">
        <button class="modal-close" style="position:absolute;top:16px;right:16px" data-close-modal="upgrade-modal">✕</button>

        <div style="font-size:40px;margin-bottom:12px">🚀</div>
        <h2 class="modal-title" style="margin-bottom:6px">Upgrade necessário</h2>
        <p style="font-size:13px;color:var(--text-2);margin-bottom:4px">
          <strong id="upgrade-modal-feature">Esta função</strong> requer o plano Pro ou superior.
        </p>
        <p style="font-size:12px;color:var(--text-3);margin-bottom:20px">
          Plano Pro: R$97/mês · Cancele quando quiser.
        </p>

        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
          ${PLANS.pro.features.slice(0,5).map(f =>
            `<div style="display:flex;align-items:center;gap:8px;font-size:13px">
              <span style="color:var(--green);font-size:16px">✓</span>${f}
            </div>`
          ).join('')}
        </div>

        <button class="btn-primary btn-full" id="btn-upgrade-pro"
          style="margin-bottom:8px;font-size:14px;padding:13px">
          Assinar Pro — R$97/mês
        </button>
        <button class="btn-ghost btn-full" data-close-modal="upgrade-modal">
          Continuar no gratuito
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal.firstElementChild);

  document.getElementById('btn-upgrade-pro')?.addEventListener('click', () => {
    document.getElementById('upgrade-modal')?.setAttribute('hidden','');
    window.TROS?.navigateTo('pricing');
  });
}

// ── Página de preços ──────────────────
export function renderPricingPage(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="pricing-grid">
      ${Object.values(PLANS).map(plan => `
        <div class="pricing-card ${plan.popular ? 'popular' : ''} ${_currentPlan === plan.id ? 'current' : ''}">
          ${plan.popular ? '<div class="pricing-badge">Mais popular</div>' : ''}
          ${_currentPlan === plan.id ? '<div class="pricing-badge current-badge">Seu plano atual</div>' : ''}

          <div class="pricing-name">${plan.name}</div>
          <div class="pricing-price">
            ${plan.price === 0
              ? '<span class="price-num">Grátis</span>'
              : `<span class="price-num">R$${plan.price}</span><span class="price-per">/mês</span>`
            }
          </div>

          <ul class="pricing-features">
            ${plan.features.map(f => `
              <li><span class="feat-check">✓</span>${f}</li>
            `).join('')}
          </ul>

          <button class="btn-full pricing-cta ${plan.popular ? 'btn-primary' : 'btn-ghost'}"
            data-plan="${plan.id}"
            ${_currentPlan === plan.id ? 'disabled' : ''}>
            ${_currentPlan === plan.id ? 'Plano atual' :
              plan.price === 0 ? 'Usar gratuitamente' : `Assinar ${plan.name}`}
          </button>
        </div>
      `).join('')}
    </div>

    <p style="text-align:center;font-size:12px;color:var(--text-3);margin-top:20px">
      Pagamento seguro via Stripe · Cancele a qualquer momento · Sem taxa de cancelamento
    </p>
  `;

  // Eventos dos botões
  container.querySelectorAll('[data-plan]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const planId = btn.dataset.plan;
      if (planId === 'free' || planId === _currentPlan) return;

      btn.disabled = true;
      btn.textContent = 'Redirecionando…';

      try {
        const { sbClient, user } = window.TROS_CLOUD || {};
        await startCheckout(planId, sbClient, user?.id, user?.email);
      } catch (e) {
        btn.disabled = false;
        btn.textContent = `Assinar ${PLANS[planId]?.name}`;
        if (window.TROS?.showToast) window.TROS.showToast(e.message, 'error');
      }
    });
  });
}

// ── CSS de preços ──────────────────────
export const PRICING_CSS = `
.pricing-grid {
  display:grid; grid-template-columns:repeat(3,1fr);
  gap:16px; max-width:900px; margin:0 auto;
}
.pricing-card {
  background:var(--bg-card); border:1px solid var(--border);
  border-radius:var(--r-lg); padding:28px 24px;
  display:flex; flex-direction:column; gap:0;
  position:relative; transition:border-color 0.2s, transform 0.2s;
}
.pricing-card:hover { transform:translateY(-4px); border-color:var(--border-md); }
.pricing-card.popular {
  border-color:rgba(0,245,160,0.35);
  box-shadow:0 0 0 1px rgba(0,245,160,0.2), var(--glow-green);
}
.pricing-card.current { border-color:rgba(59,158,255,0.35); }

.pricing-badge {
  position:absolute; top:-12px; left:50%; transform:translateX(-50%);
  background:linear-gradient(135deg,var(--green),var(--cyan));
  color:#050810; font-size:10px; font-weight:800;
  padding:4px 14px; border-radius:20px; white-space:nowrap;
}
.pricing-badge.current-badge { background:var(--blue); color:#fff; }

.pricing-name  { font-size:11px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:var(--text-3); margin-bottom:10px; }
.pricing-price { margin-bottom:20px; }
.price-num     { font-family:var(--font-mono); font-size:32px; font-weight:900; }
.price-per     { font-size:13px; color:var(--text-3); margin-left:4px; }

.pricing-features {
  list-style:none; flex:1; margin-bottom:24px;
  display:flex; flex-direction:column; gap:8px;
}
.pricing-features li { display:flex; align-items:flex-start; gap:8px; font-size:13px; color:var(--text-2); }
.feat-check { color:var(--green); font-size:13px; flex-shrink:0; margin-top:1px; }

.pricing-cta { padding:12px; font-size:13px; font-weight:700; border-radius:var(--r-sm); }
.pricing-cta:disabled { opacity:0.5; cursor:default; }

@media(max-width:768px) { .pricing-grid { grid-template-columns:1fr; } }
`;
