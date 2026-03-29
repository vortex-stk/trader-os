# TRADER OS v2.0 — Fase 2: Produto Real

## O que foi adicionado na Fase 2

| Módulo | Arquivo | Status |
|---|---|---|
| Operações granulares (entry, SL, TP, lote) | `js/ui/operations.js` | ✅ |
| Importação MT4/MT5/cTrader/NinjaTrader | `js/import.js` | ✅ |
| Motor de regras Prop Firm | `js/propfirm.js` | ✅ |
| Relatório PDF mensal | `js/pdf-report.js` | ✅ |
| Sistema de planos (Free/Pro/Premium) | `js/stripe/billing.js` | ✅ |
| Checkout Stripe | `js/stripe/edge-create-checkout.ts` | ✅ |
| Webhook Stripe | `js/stripe/edge-webhook.ts` | ✅ |
| Análise com IA (Claude) | `js/ai-analysis.js` | ✅ |
| Página de preços | `js/ui/pricing.js` | ✅ |

---

## Setup do Stripe (Fase 2)

### 1. Criar conta no Stripe

1. Acesse [dashboard.stripe.com](https://dashboard.stripe.com) e crie uma conta
2. Complete o KYC para aceitar pagamentos reais

### 2. Criar os produtos e preços

No Stripe Dashboard → Products → Add product:

**Plano Pro:**
- Nome: `Trader OS Pro`
- Preço recorrente: R$97,00/mês
- Copie o **Price ID** (começa com `price_...`)
- Cole em `js/stripe/billing.js` → `PLANS.pro.priceId`

**Plano Premium:**
- Nome: `Trader OS Premium`
- Preço recorrente: R$197,00/mês
- Copie o **Price ID**
- Cole em `PLANS.premium.priceId`

### 3. Deploy das Edge Functions

```bash
# Instale o CLI do Supabase
npm install -g supabase

# Login
supabase login

# Vincule ao projeto
supabase link --project-ref SEU_PROJECT_REF

# Configure os secrets
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase secrets set SITE_URL=https://seu-dominio.com

# Deploy das funções
supabase functions deploy create-checkout --no-verify-jwt
supabase functions deploy create-portal-session --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt
```

### 4. Configure o webhook no Stripe

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://[SEU-PROJETO].supabase.co/functions/v1/stripe-webhook`
3. Eventos para escutar:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copie o **Signing secret** (`whsec_...`) e configure como secret

### 5. Execute o SQL de billing

```sql
-- No SQL Editor do Supabase, execute:
-- setup-billing.sql
```

### 6. Edge Function: portal do cliente

Crie o arquivo `supabase/functions/create-portal-session/index.ts`:

```typescript
import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno';

Deno.serve(async (req) => {
  const { userId, returnUrl } = await req.json();
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-04-10', httpClient: Stripe.createFetchHttpClient() });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data } = await supabase.from('subscriptions').select('stripe_customer_id').eq('user_id', userId).single();

  const session = await stripe.billingPortal.sessions.create({
    customer: data.stripe_customer_id,
    return_url: returnUrl,
  });

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
});
```

---

## Usando o Relatório PDF

```javascript
import { generateMonthlyReport } from './js/pdf-report.js';

// Gera relatório do mês atual
await generateMonthlyReport();

// Gera relatório de mês específico
await generateMonthlyReport(2025, 5); // Junho 2025 (0-indexed)
```

O relatório é gerado como HTML estilizado e abre em nova aba com `window.print()`.

---

## Usando a Análise com IA

A análise com IA usa a Claude API diretamente do frontend.
**Requer plano Premium.**

```javascript
import { analyzeTradingMonth, analyzePatterns, generateWeeklySummary } from './js/ai-analysis.js';

// Análise do mês
await analyzeTradingMonth(2025, 5);

// Padrões comportamentais
await analyzePatterns();

// Resumo semanal
await generateWeeklySummary();
```

---

## Estrutura completa do projeto (Fase 2)

```
trader-os/
├── index.html
├── manifest.json
├── setup.sql                    ← Execute primeiro
├── setup-billing.sql            ← Execute segundo (planos)
├── README.md
├── FASE2.md                     ← Este arquivo
├── css/
│   ├── design-system.css
│   ├── layout.css
│   ├── components.css
│   └── pages.css
└── js/
    ├── app.js                   ← Orquestrador
    ├── config.js                ← Constantes
    ├── db.js                    ← Dados locais
    ├── cloud.js                 ← Supabase
    ├── validation.js            ← Validações
    ├── propfirm.js              ← Regras prop firm
    ├── import.js                ← Parsers CSV
    ├── pdf-report.js            ← Gerador PDF  [NOVO]
    ├── ai-analysis.js           ← Análise Claude [NOVO]
    ├── stripe/
    │   ├── billing.js           ← Planos + checkout [NOVO]
    │   ├── edge-create-checkout.ts  [NOVO]
    │   └── edge-webhook.ts          [NOVO]
    └── ui/
        ├── components.js
        ├── dashboard.js
        ├── calendar.js
        ├── journal.js
        ├── operations.js        ← Modal granular
        ├── analytics-metas-propfirm.js
        ├── pricing.js           ← Página de preços [NOVO]
        └── import.js            ← UI de importação
```

---

## Próximos passos (Fase 3)

- [ ] Migrar para Next.js + React para escalar
- [ ] Schema real no Supabase (tabelas separadas por recurso)
- [ ] Dashboard de admin (MRR, churn, usuários)
- [ ] Feature flags (lançar features gradualmente)
- [ ] Notificações push (drawdown, metas atingidas)
- [ ] Integração MT4/MT5 via Expert Advisor
- [ ] SEO e landing page otimizada
- [ ] Programa de afiliados
