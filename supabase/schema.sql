-- GRANA — Finanças
-- Rode isto inteiro no SQL Editor do Supabase (Project → SQL Editor → New query → Run).
-- Cria as 5 tabelas e trava cada uma para que um usuário só veja e altere as
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
  serie_id uuid,
  created_at timestamptz not null default now()
);

-- Se a tabela já existia de uma versão anterior, adiciona a coluna nova sem apagar nada.
alter table lancamentos add column if not exists serie_id uuid;

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
  privacidade boolean not null default false,
  tema text not null default 'claro' check (tema in ('claro', 'escuro'))
);

-- Se a tabela já existia de uma versão anterior, adiciona a coluna nova sem apagar nada.
alter table config add column if not exists tema text not null default 'claro' check (tema in ('claro', 'escuro'));

alter table config enable row level security;

drop policy if exists "config: dono pode tudo" on config;
create policy "config: dono pode tudo"
  on config for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ===== lista de desejos =====
create table if not exists wishlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  preco numeric(12,2) not null default 0 check (preco >= 0),
  prioridade text not null default 'media' check (prioridade in ('alta', 'media', 'baixa')),
  link text,
  comprado boolean not null default false,
  created_at timestamptz not null default now()
);

alter table wishlist enable row level security;

drop policy if exists "wishlist: dono pode tudo" on wishlist;
create policy "wishlist: dono pode tudo"
  on wishlist for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ===== aparelhos com lembretes por notificação =====
-- Uma linha por aparelho que ativou "Lembretes" nos Ajustes. O servidor (pasta api/)
-- lê esta tabela com a chave de serviço pra enviar o aviso diário; o usuário só
-- enxerga e mexe nas próprias inscrições.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

drop policy if exists "push_subscriptions: dono pode tudo" on push_subscriptions;
create policy "push_subscriptions: dono pode tudo"
  on push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ===== contas, cartões de crédito e faturas =====
-- Tudo daqui é ADICIONAL: nenhuma tabela ou coluna existente é apagada ou alterada, e os dados que você já
-- tem continuam exatamente como estão. Seguro rodar mais de uma vez.
--
-- Como o app usa:
--  * contas: onde o dinheiro está (conta corrente, carteira...). O saldo é calculado pelos lançamentos pagos
--    (saldo_inicial + receitas - despesas - faturas pagas), então não existe coluna "saldo" para ficar desatualizada.
--  * cartoes: limite, dia de fechamento e dia de vencimento.
--  * faturas: guarda só o PAGAMENTO de uma fatura (qual cartão, qual mês, quanto, de qual conta). O valor da
--    fatura em si é a soma dos lançamentos daquele cartão naquele mês (lancamentos.fatura_ref). O pagamento fica
--    fora de "lancamentos" de propósito: senão a despesa contaria duas vezes (na compra e no pagamento).

create table if not exists contas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  tipo text not null default 'corrente' check (tipo in ('corrente', 'poupanca', 'carteira', 'investimento', 'outro')),
  saldo_inicial numeric(12,2) not null default 0,
  arquivada boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists contas_user_nome_idx on contas (user_id, lower(nome));

alter table contas enable row level security;
drop policy if exists "contas: dono pode tudo" on contas;
create policy "contas: dono pode tudo"
  on contas for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists cartoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  limite numeric(12,2) not null default 0 check (limite >= 0),
  dia_fechamento int not null check (dia_fechamento between 1 and 31),
  dia_vencimento int not null check (dia_vencimento between 1 and 31),
  conta_pagamento_id uuid references contas(id) on delete set null,
  arquivado boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists cartoes_user_nome_idx on cartoes (user_id, lower(nome));

alter table cartoes enable row level security;
drop policy if exists "cartoes: dono pode tudo" on cartoes;
create policy "cartoes: dono pode tudo"
  on cartoes for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists faturas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cartao_id uuid not null references cartoes(id) on delete cascade,
  referencia text not null check (referencia ~ '^[0-9]{4}-[0-9]{2}$'),  -- mês do vencimento, ex.: 2026-12
  valor_pago numeric(12,2) not null check (valor_pago >= 0),
  pago_em date not null,
  conta_id uuid references contas(id) on delete set null,               -- null = só marcou como paga, sem debitar de conta
  created_at timestamptz not null default now(),
  unique (cartao_id, referencia)
);

alter table faturas enable row level security;
drop policy if exists "faturas: dono pode tudo" on faturas;
create policy "faturas: dono pode tudo"
  on faturas for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Cada lançamento fica ligado a UMA conta (conta_id) OU a um cartão (cartao_id + fatura_ref), nunca aos dois.
-- Colunas novas e opcionais: os lançamentos antigos continuam válidos.
alter table lancamentos add column if not exists conta_id uuid references contas(id) on delete set null;
alter table lancamentos add column if not exists cartao_id uuid references cartoes(id) on delete set null;
alter table lancamentos add column if not exists fatura_ref text;

do $$
begin
  alter table lancamentos add constraint lancamentos_conta_ou_cartao check (conta_id is null or cartao_id is null);
exception when duplicate_object then null;
end $$;

create index if not exists lancamentos_conta_idx on lancamentos (conta_id);
create index if not exists lancamentos_cartao_fatura_idx on lancamentos (cartao_id, fatura_ref);

-- Migração dos dados que já existem:
-- 1) quem já tem lançamentos e nenhuma conta ganha uma "Conta principal";
-- 2) lançamentos antigos sem conta passam a apontar para ela — menos os pagos no crédito, que
--    não saem da conta: ficam sem vínculo até você criar o cartão e usar "Vincular lançamentos antigos".
-- O saldo inicial fica zerado; no app, em Contas, você informa o saldo real da conta.
insert into contas (user_id, nome, tipo)
select u.user_id, 'Conta principal', 'corrente'
from (select distinct user_id from lancamentos) u
where not exists (select 1 from contas c where c.user_id = u.user_id);

update lancamentos l
set conta_id = (
  select c.id from contas c
  where c.user_id = l.user_id and not c.arquivada
  order by c.created_at
  limit 1
)
where l.conta_id is null
  and l.cartao_id is null
  and l.forma_pagamento !~* 'cr[eé]dito';

-- ===== sincronização em tempo real =====
-- Liga o Realtime nas tabelas do app: uma alteração feita num aparelho aparece nos
-- outros sem precisar recarregar a página. O bloco "exception" evita erro se
-- você rodar este script de novo e a tabela já estiver na publicação.
--
-- REPLICA IDENTITY FULL é obrigatório para o filtro "user_id=eq..." funcionar
-- em exclusões: por padrão o Postgres manda só o id da linha apagada, sem
-- user_id, e o filtro descarta o evento por não achar esse campo. Com FULL,
-- a linha inteira vai junto no evento de exclusão.
alter table lancamentos replica identity full;
alter table orcamentos replica identity full;
alter table metas replica identity full;
alter table wishlist replica identity full;
alter table config replica identity full;
alter table contas replica identity full;
alter table cartoes replica identity full;
alter table faturas replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.lancamentos;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.orcamentos;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.metas;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.wishlist;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.config;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.contas;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.cartoes;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.faturas;
exception when duplicate_object then null;
end $$;
