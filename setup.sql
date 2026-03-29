-- ═══════════════════════════════════════════════════════
--  TRADER OS · setup.sql
--  Execute este script no SQL Editor do Supabase
--  (https://app.supabase.com → seu projeto → SQL Editor)
-- ═══════════════════════════════════════════════════════

-- ── 1. Tabela principal de dados ──────────────────────
create table if not exists public.trader_os_data (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  payload     text not null,
  updated_at  timestamptz default now(),
  constraint trader_os_data_user_id_key unique (user_id)
);

-- Índice para lookup rápido por usuário
create index if not exists idx_trader_os_data_user_id
  on public.trader_os_data(user_id);

-- ── 2. Row Level Security (RLS) ───────────────────────
-- CRÍTICO: cada usuário só acessa seus próprios dados
alter table public.trader_os_data enable row level security;

-- Remove políticas antigas se existirem
drop policy if exists "usuarios_selecionar" on public.trader_os_data;
drop policy if exists "usuarios_inserir" on public.trader_os_data;
drop policy if exists "usuarios_atualizar" on public.trader_os_data;
drop policy if exists "usuarios_deletar" on public.trader_os_data;

-- Políticas granulares (melhor que uma única policy de "all")
create policy "usuarios_selecionar"
  on public.trader_os_data for select
  using (auth.uid() = user_id);

create policy "usuarios_inserir"
  on public.trader_os_data for insert
  with check (auth.uid() = user_id);

create policy "usuarios_atualizar"
  on public.trader_os_data for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "usuarios_deletar"
  on public.trader_os_data for delete
  using (auth.uid() = user_id);

-- ── 3. Storage bucket para screenshots ───────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'screenshots',
  'screenshots',
  true,
  5242880,  -- 5MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

-- Políticas de storage
drop policy if exists "ss_upload" on storage.objects;
drop policy if exists "ss_read"   on storage.objects;
drop policy if exists "ss_delete" on storage.objects;

create policy "ss_upload"
  on storage.objects for insert
  with check (
    bucket_id = 'screenshots'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "ss_read"
  on storage.objects for select
  using (bucket_id = 'screenshots');

create policy "ss_delete"
  on storage.objects for delete
  using (
    bucket_id = 'screenshots'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ── 4. Trigger: atualizar updated_at automaticamente ──
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tr_trader_os_updated_at on public.trader_os_data;
create trigger tr_trader_os_updated_at
  before update on public.trader_os_data
  for each row execute function public.update_updated_at();

-- ── 5. Verificação ────────────────────────────────────
-- Rode após o script para confirmar que tudo está correto:
-- select tablename, rowsecurity from pg_tables where tablename = 'trader_os_data';
-- select policyname, cmd from pg_policies where tablename = 'trader_os_data';

select 'Setup concluído com sucesso!' as status;
