// ═══════════════════════════════════════
//  supabase/functions/create-checkout/index.ts
//  Edge Function: cria sessão de checkout Stripe
//
//  Deploy: supabase functions deploy create-checkout
//  Variáveis necessárias (supabase secrets set):
//    STRIPE_SECRET_KEY=sk_live_...
//    STRIPE_WEBHOOK_SECRET=whsec_...
//    SITE_URL=https://seu-dominio.com
// ═══════════════════════════════════════

import Stripe from 'https://esm.sh/stripe@14?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-04-10',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { priceId, userId, email, successUrl, cancelUrl } = await req.json();

    if (!priceId || !userId || !email) {
      return new Response(JSON.stringify({ error: 'Campos obrigatórios faltando' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Busca ou cria o customer Stripe
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    let customerId = sub?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email, metadata: { userId } });
      customerId = customer.id;

      // Salva o customer ID
      await supabase.from('subscriptions').upsert({
        user_id:            userId,
        stripe_customer_id: customerId,
        plan:               'free',
        status:             'inactive',
      }, { onConflict: 'user_id' });
    }

    const session = await stripe.checkout.sessions.create({
      customer:   customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode:       'subscription',
      success_url: successUrl || `${Deno.env.get('SITE_URL')}?checkout=success`,
      cancel_url:  cancelUrl  || `${Deno.env.get('SITE_URL')}?checkout=cancelled`,
      subscription_data: {
        metadata: { userId },
      },
      payment_method_types: ['card'],
      // Aceita PIX para clientes brasileiros
      // payment_method_types: ['card', 'boleto'],
      locale: 'pt-BR',
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
