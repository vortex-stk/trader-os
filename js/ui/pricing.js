// ═══════════════════════════════════════
//  TRADER OS · ui/pricing.js
//  Página de planos e gerenciamento de assinatura
// ═══════════════════════════════════════

import { PLANS, renderPricingPage, openCustomerPortal, loadUserPlan, getCurrentPlan } from '../stripe/billing.js';
import { getCurrentUser, isLoggedIn } from '../cloud.js';
import { showToast } from './components.js';

export async function renderPricing() {
  const container = document.getElementById('pricing-content');
  if (!container) return;

  const plan = getCurrentPlan();
  const user = getCurrentUser();

  container.innerHTML = `
    <div style="text-align:center;margin-bottom:32px">
      <h1 class="page-title">Escolha seu Plano</h1>
      <p style="color:var(--text-2);margin-top:8px;font-size:14px">
        Comece grátis. Faça upgrade quando precisar. Cancele quando quiser.
      </p>
      ${plan !== 'free' ? `
        <div style="margin-top:12px">
          <span style="background:var(--green-bg);color:var(--green);padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700">
            ✓ Você está no plano ${PLANS[plan]?.name || plan}
          </span>
          ${user ? `<button class="btn-ghost btn-sm" id="btn-manage-sub" style="margin-left:10px">Gerenciar assinatura</button>` : ''}
        </div>
      ` : ''}
    </div>

    <div id="pricing-cards"></div>

    <div style="margin-top:32px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
      <div class="card" style="text-align:center">
        <div style="font-size:24px;margin-bottom:8px">🔒</div>
        <div style="font-weight:700;margin-bottom:4px">Pagamento Seguro</div>
        <div style="font-size:12px;color:var(--text-3)">Processado pelo Stripe com criptografia TLS</div>
      </div>
      <div class="card" style="text-align:center">
        <div style="font-size:24px;margin-bottom:8px">↩</div>
        <div style="font-weight:700;margin-bottom:4px">Cancele Quando Quiser</div>
        <div style="font-size:12px;color:var(--text-3)">Sem multa, sem perguntas. Dados preservados.</div>
      </div>
      <div class="card" style="text-align:center">
        <div style="font-size:24px;margin-bottom:8px">🇧🇷</div>
        <div style="font-weight:700;margin-bottom:4px">Pagamento em R$</div>
        <div style="font-size:12px;color:var(--text-3)">Cartão de crédito em até 12x. PIX em breve.</div>
      </div>
    </div>
  `;

  renderPricingPage('pricing-cards');

  // Botão gerenciar assinatura
  document.getElementById('btn-manage-sub')?.addEventListener('click', async () => {
    try {
      const { sbClient } = window.TROS_CLOUD || {};
      await openCustomerPortal(sbClient, user?.id);
    } catch (e) {
      showToast(e.message, 'error');
    }
  });
}

// ── Página HTML de preços para adicionar ao index.html ─
export const PRICING_PAGE_HTML = `
<!-- ── PREÇOS ────────────────────── -->
<div class="page" id="page-pricing">
  <div class="page-header">
    <div>
      <h1 class="page-title">Planos e Preços</h1>
      <p class="page-subtitle">Escolha o plano ideal para sua jornada</p>
    </div>
  </div>
  <div id="pricing-content"></div>
</div>
`;

// ── Badge de plano no header ──────────
export function renderPlanBadge() {
  const plan = getCurrentPlan();
  if (plan === 'free') return;

  const badge = document.getElementById('plan-badge');
  if (!badge) return;

  const colors = {
    pro:     { bg: 'var(--green-bg)',  color: 'var(--green)',  label: 'Pro' },
    premium: { bg: 'var(--purple-bg)', color: 'var(--purple)', label: 'Premium' },
  };
  const c = colors[plan];
  if (!c) return;

  badge.style.background = c.bg;
  badge.style.color      = c.color;
  badge.style.display    = 'inline-flex';
  badge.textContent      = c.label;
}
