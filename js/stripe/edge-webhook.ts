// ═══════════════════════════════════════
//  supabase/functions/stripe-webhook/index.ts
//  Webhook Stripe → atualiza assinatura no Supabase
//  
//  Configure no Stripe Dashboard:
//  Endpoint: https://[project].supabase.co/functions/v1/stripe-webhook
//  Eventos: checkout.session.completed,
//           customer.subscription.updated,
//           customer.subscription.deleted,
//           invoice.payment_failed
// ═══════════════════════════════════════

import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno';

const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  const body      = await req.text();

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
    apiVersion:  '2024-04-10',
    httpClient:  Stripe.createFetchHttpClient(),
  });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
    );
  } catch (err) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  // Mapeamento de priceId → plano
  const PRICE_TO_PLAN: Record<string, string> = {
    'price_pro_brl_monthly':     'pro',
    'price_premium_brl_monthly': 'premium',
    // Adicione outros IDs conforme criar no Stripe
  };

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== 'subscription') break;

        const sub = await stripe.subscriptions.retrieve(session.subscription as string);
        const priceId = sub.items.data[0]?.price.id;
        const plan    = PRICE_TO_PLAN[priceId] || 'pro';
        const userId  = sub.metadata?.userId || session.metadata?.userId;

        if (userId) {
          await supabase.from('subscriptions').upsert({
            user_id:             userId,
            stripe_customer_id:  session.customer as string,
            stripe_subscription_id: sub.id,
            plan,
            status:              'active',
            current_period_end:  new Date(sub.current_period_end * 1000).toISOString(),
          }, { onConflict: 'user_id' });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub     = event.data.object as Stripe.Subscription;
        const priceId = sub.items.data[0]?.price.id;
        const plan    = PRICE_TO_PLAN[priceId] || 'pro';
        const userId  = sub.metadata?.userId;

        if (userId) {
          await supabase.from('subscriptions').upsert({
            user_id:             userId,
            stripe_subscription_id: sub.id,
            plan,
            status:              sub.status,
            current_period_end:  new Date(sub.current_period_end * 1000).toISOString(),
          }, { onConflict: 'user_id' });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub    = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        if (userId) {
          await supabase.from('subscriptions')
            .update({ plan: 'free', status: 'cancelled' })
            .eq('user_id', userId);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const sub     = await stripe.subscriptions.retrieve(invoice.subscription as string);
        const userId  = sub.metadata?.userId;
        if (userId) {
          await supabase.from('subscriptions')
            .update({ status: 'past_due' })
            .eq('user_id', userId);
        }
        break;
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
    return new Response(`Handler error: ${err.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
