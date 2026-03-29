-- ═══════════════════════════════════════════════════════
--  TRADER OS · setup-schema-v3.sql
--  Schema real com tabelas separadas por recurso
--  Substitui o armazenamento em JSON blob único
--  Execute APÓS setup.sql e setup-billing.sql
-- ═══════════════════════════════════════════════════════

-- ── 1. Perfis de usuário ──────────────────────────────
create table if not exists public.profiles (
  id           uuid references auth.users(id) on delete cascade primary key,
  name         text,
  country      text default 'Brasil',
  timezone     text default 'America/Sao_Paulo',
  broker       text,
  account_type text default 'prop',
  account_size numeric(15,2) default 0,
  experience   text default 'intermediate',
  favorite_pairs text,
  bio          text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table public.profiles enable row level security;
create policy "profiles_own" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);

-- Auto-cria perfil no signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 2. Contas de trading ──────────────────────────────
create table if not exists public.accounts (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references auth.users(id) on delete cascade not null,
  name       text not null,
  type       text default 'Real Pessoal',
  capital    numeric(15,2) default 10000,
  color      text default '#00F5A0',
  prop_firm  text,
  is_active  boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_accounts_user on public.accounts(user_id);
alter table public.accounts enable row level security;
create policy "accounts_own" on public.accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 3. Configurações por conta ────────────────────────
create table if not exists public.account_configs (
  account_id         uuid references public.accounts(id) on delete cascade primary key,
  user_id            uuid references auth.users(id) on delete cascade not null,
  firm_name          text,
  max_daily_loss     numeric(15,2),
  max_total_loss     numeric(15,2),
  profit_target      numeric(15,2),
  min_trading_days   int default 10,
  trailing_drawdown  boolean default false,
  goal_month         numeric(15,2) default 2000,
  goal_year          numeric(15,2) default 24000,
  goal_win_rate      numeric(5,2)  default 60,
  goal_rr            numeric(5,2)  default 1.5,
  updated_at         timestamptz default now()
);

alter table public.account_configs enable row level security;
create policy "configs_own" on public.account_configs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 4. Trades diários ────────────────────────────────
create table if not exists public.trades (
  id          uuid default gen_random_uuid() primary key,
  account_id  uuid references public.accounts(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,
  date        date not null,
  pnl         numeric(12,2) not null default 0,
  trades      int default 0,
  pair        text,
  session     text,
  setup       text,
  rr          numeric(8,2),
  emotion     text,
  notes       text,
  screenshot  text,           -- URL do Supabase Storage
  screenshot_path text,       -- path para deleção
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  constraint  trades_account_date_unique unique (account_id, date)
);

create index idx_trades_account   on public.trades(account_id);
create index idx_trades_user       on public.trades(user_id);
create index idx_trades_date       on public.trades(date);
create index idx_trades_account_date on public.trades(account_id, date desc);

alter table public.trades enable row level security;
create policy "trades_own" on public.trades for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 5. Operações granulares ───────────────────────────
create table if not exists public.operations (
  id           uuid default gen_random_uuid() primary key,
  trade_id     uuid references public.trades(id) on delete cascade,
  account_id   uuid references public.accounts(id) on delete cascade not null,
  user_id      uuid references auth.users(id) on delete cascade not null,
  date         date not null,
  entry_time   time,
  exit_time    time,
  pair         text,
  session      text,
  direction    text default 'long',   -- 'long' | 'short'
  entry_price  numeric(12,5),
  exit_price   numeric(12,5),
  stop_loss    numeric(12,5),
  take_profit  numeric(12,5),
  lot_size     numeric(8,2),
  pnl          numeric(12,2) default 0,
  rr           numeric(8,2),
  setup        text,
  emotion      text,
  notes        text,
  screenshot   text,
  created_at   timestamptz default now()
);

create index idx_ops_account on public.operations(account_id);
create index idx_ops_trade   on public.operations(trade_id);
create index idx_ops_user    on public.operations(user_id);
create index idx_ops_date    on public.operations(date);

alter table public.operations enable row level security;
create policy "ops_own" on public.operations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 6. Tags/etiquetas customizáveis ──────────────────
create table if not exists public.tags (
  id       uuid default gen_random_uuid() primary key,
  user_id  uuid references auth.users(id) on delete cascade not null,
  name     text not null,
  type     text default 'setup',   -- 'setup' | 'pair' | 'session' | 'emotion'
  color    text default '#7C5CFC',
  constraint tags_user_name_type unique (user_id, name, type)
);

alter table public.tags enable row level security;
create policy "tags_own" on public.tags for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 7. Notificações e alertas ────────────────────────
create table if not exists public.alerts (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  account_id  uuid references public.accounts(id) on delete cascade,
  type        text not null,   -- 'daily_loss' | 'total_loss' | 'goal_reached' | 'streak'
  message     text not null,
  is_read     boolean default false,
  created_at  timestamptz default now()
);

create index idx_alerts_user    on public.alerts(user_id);
create index idx_alerts_unread  on public.alerts(user_id, is_read) where not is_read;

alter table public.alerts enable row level security;
create policy "alerts_own" on public.alerts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 8. Triggers de updated_at ────────────────────────
create trigger tr_profiles_updated    before update on public.profiles    for each row execute function public.update_updated_at();
create trigger tr_accounts_updated    before update on public.accounts    for each row execute function public.update_updated_at();
create trigger tr_trades_updated      before update on public.trades      for each row execute function public.update_updated_at();
create trigger tr_ac_configs_updated  before update on public.account_configs for each row execute function public.update_updated_at();

-- ── 9. Views analíticas (sem RLS — service_role only) ──
create or replace view public.v_monthly_stats as
select
  t.user_id,
  t.account_id,
  date_trunc('month', t.date) as month,
  count(*)                    as days,
  sum(t.pnl)                  as total_pnl,
  sum(case when t.pnl > 0 then 1 else 0 end) as wins,
  sum(case when t.pnl < 0 then 1 else 0 end) as losses,
  round(avg(t.pnl), 2)        as avg_pnl,
  max(t.pnl)                  as best_day,
  min(t.pnl)                  as worst_day,
  sum(t.trades)               as total_trades
from public.trades t
group by t.user_id, t.account_id, date_trunc('month', t.date);

revoke all on public.v_monthly_stats from anon, authenticated;
grant select on public.v_monthly_stats to service_role;

-- ── 10. Verificação ───────────────────────────────────
select
  schemaname,
  tablename,
  rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles','accounts','trades','operations','tags','alerts','account_configs','subscriptions')
order by tablename;
