-- ═══════════════════════════════════════════════════════
--  TRADER OS · setup-billing.sql
--  Execute DEPOIS do setup.sql principal
--  Adiciona tabelas de assinatura e planos
-- ═══════════════════════════════════════════════════════

-- ── Tabela de assinaturas ─────────────────────────────
create table if not exists public.subscriptions (
  id                     uuid default gen_random_uuid() primary key,
  user_id                uuid references auth.users(id) on delete cascade not null,
  stripe_customer_id     text,
  stripe_subscription_id text,
  plan                   text not null default 'free',
  status                 text not null default 'inactive',
  current_period_end     timestamptz,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now(),
  constraint subscriptions_user_id_key unique (user_id)
);

create index if not exists idx_subscriptions_user_id on public.subscriptions(user_id);
create index if not exists idx_subscriptions_customer on public.subscriptions(stripe_customer_id);

alter table public.subscriptions enable row level security;

-- Usuário vê apenas sua assinatura
create policy "sub_select"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- Apenas service role (webhook) pode inserir/atualizar
-- (Edge Functions usam a service role key)
create policy "sub_service_insert"
  on public.subscriptions for insert
  with check (auth.uid() = user_id or auth.role() = 'service_role');

create policy "sub_service_update"
  on public.subscriptions for update
  using (auth.uid() = user_id or auth.role() = 'service_role');

-- Trigger updated_at
drop trigger if exists tr_subscriptions_updated_at on public.subscriptions;
create trigger tr_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.update_updated_at();

-- ── View conveniente: usuário + plano ─────────────────
create or replace view public.user_plan as
  select
    u.id                    as user_id,
    u.email,
    coalesce(s.plan, 'free') as plan,
    coalesce(s.status, 'inactive') as subscription_status,
    s.current_period_end,
    s.stripe_customer_id
  from auth.users u
  left join public.subscriptions s on s.user_id = u.id;

-- Apenas service role acessa a view (segurança)
revoke all on public.user_plan from anon, authenticated;
grant select on public.user_plan to service_role;

-- ── Função helper: verifica plano ─────────────────────
create or replace function public.user_has_plan(required_plan text)
returns boolean as $$
  select exists (
    select 1 from public.subscriptions
    where user_id = auth.uid()
      and (
        (required_plan = 'pro'     and plan in ('pro','premium') and status in ('active','trialing'))
        or
        (required_plan = 'premium' and plan = 'premium'          and status in ('active','trialing'))
      )
  );
$$ language sql security definer;

-- ── Verificação ───────────────────────────────────────
select 'Setup de billing concluído!' as status;
