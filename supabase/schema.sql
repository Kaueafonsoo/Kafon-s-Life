-- GRANA — Finanças
-- Rode isto inteiro no SQL Editor do Supabase (Project → SQL Editor → New query → Run).
-- Cria as 4 tabelas e trava cada uma para que um usuário só veja e altere as
-- próprias linhas (Row Level Security por auth.uid()). Sem isso, qualquer
-- pessoa com a chave pública do projeto conseguiria ler os dados de todo mundo.
--
-- Seguro rodar mais de uma vez: "drop policy if exists" antes de cada
-- "create policy" evita o erro "policy already exists" se você rodar de novo.

create extension if not exists "pgcrypto";

-- ===== lançamentos =====
create table if not exists lancamentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data date not null,
  descricao text not null,
  categoria text not null,
  tipo text not null check (tipo in ('receita', 'despesa')),
  forma_pagamento text not null,
  valor numeric(12,2) not null check (valor >= 0),
  status text not null check (status in ('pago', 'pendente')),
  created_at timestamptz not null default now()
);

alter table lancamentos enable row level security;

drop policy if exists "lancamentos: dono pode tudo" on lancamentos;
create policy "lancamentos: dono pode tudo"
  on lancamentos for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists lancamentos_user_data_idx on lancamentos (user_id, data);

-- ===== orçamentos (um valor planejado por categoria) =====
create table if not exists orcamentos (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  categoria text not null,
  valor_planejado numeric(12,2) not null default 0 check (valor_planejado >= 0),
  primary key (user_id, categoria)
);

alter table orcamentos enable row level security;

drop policy if exists "orcamentos: dono pode tudo" on orcamentos;
create policy "orcamentos: dono pode tudo"
  on orcamentos for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ===== metas =====
create table if not exists metas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  emoji text not null default '🎯',
  nome text not null,
  valor_meta numeric(12,2) not null check (valor_meta >= 0),
  valor_atual numeric(12,2) not null default 0 check (valor_atual >= 0),
  data_prevista date not null,
  created_at timestamptz not null default now()
);

alter table metas enable row level security;

drop policy if exists "metas: dono pode tudo" on metas;
create policy "metas: dono pode tudo"
  on metas for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ===== config (uma linha por usuário) =====
create table if not exists config (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  nome text not null default '',
  dia_pagamento int,
  categorias text[] not null default array['Moradia','Alimentação','Transporte','Saúde','Lazer','Educação','Assinaturas','Outros'],
  formas_pagamento text[] not null default array['Dinheiro','Cartão de Débito','Cartão de Crédito','Pix','Transferência','Boleto','Outro'],
  privacidade boolean not null default false
);

alter table config enable row level security;

drop policy if exists "config: dono pode tudo" on config;
create policy "config: dono pode tudo"
  on config for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
