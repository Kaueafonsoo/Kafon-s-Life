# GRANA — Finanças

App de controle financeiro pessoal para iPhone e Mac. Hospedado em `https://kafon-s-life.vercel.app`, com HTTPS de verdade e dados sincronizados na nuvem via Supabase — funciona de qualquer lugar com internet, sem depender do Mac ligado.

## Como usar

Abra `https://kafon-s-life.vercel.app` no Safari (iPhone) ou em qualquer navegador (Mac), crie sua conta (e-mail e senha) e comece a lançar. Para instalar como app no iPhone: **Compartilhar → Adicionar à Tela de Início**.

Os dados ficam no Supabase, protegidos por login — cada conta só enxerga os próprios lançamentos (Row Level Security). Toda alteração sincroniza **em tempo real** entre os aparelhos logados na mesma conta: edite no Mac e o iPhone atualiza sozinho, sem precisar recarregar.

## Comece pelos Ajustes

Abra **Ajustes** (na barra lateral no Mac, no rodapé da tela no iPhone) e preencha:

- **Seu nome** — aparece na saudação do topo, que muda conforme a hora do dia.
- **Dia do salário** — o Resumo passa a mostrar quantos dias faltam e quanto sobra por dia até lá. Deixe vazio para esconder esse cartão.
- **Suas categorias** e **suas formas de pagamento** — uma por linha. Troque as listas genéricas pelas suas de verdade (Academia, Pets, Nubank, Itaú...). É o que mais acelera o lançamento no dia a dia.

Lançamentos antigos que usem uma categoria removida continuam intactos: ao editar, ela aparece marcada como "(removida)".

## Ocultar valores

O botão de olho no topo troca todos os valores por `•••••`. Serve para abrir o app no ônibus ou mostrar a tela para alguém sem expor quanto você tem. O estado fica salvo, então continua oculto na próxima vez que abrir.

## Lançamentos recorrentes e parcelados

Ao criar um lançamento novo, o campo **Repetição** oferece três modos:

- **Não repete** — um lançamento único, como sempre.
- **Repetir mensalmente** — cria o mesmo lançamento nos próximos meses (você escolhe quantos). Útil para aluguel, assinaturas, salário. Cada ocorrência gerada é independente: editar ou excluir uma não afeta as outras.
- **Parcelado** — só aparece para despesas. Divide o valor digitado em partes iguais, uma por mês, com a descrição marcada "(1/3)", "(2/3)" etc. Se a divisão não fechar exata, o centavo que sobra fica na última parcela.

Uma caixinha mostra em qual mês cai a última parcela/recorrência antes de você salvar.

Editar um lançamento já existente mexe só naquele — a opção de repetição só aparece ao criar um novo.

## Contas, cartões de crédito e faturas

Aba **Contas** (e a tela da fatura, aberta ao tocar num cartão).

- **Contas e carteiras:** cada uma tem o seu saldo e cada lançamento fica ligado a uma conta (ou a um cartão). O saldo **não é gravado**: é calculado (saldo inicial + receitas pagas − despesas pagas − faturas pagas, até hoje), então nunca fica desatualizado. Lançamentos pendentes ou com data futura ainda não mexem no saldo. Se o saldo não bater com o do banco, abra a conta e digite o saldo certo: o app ajusta o saldo inicial sozinho.
- **Cartão de crédito:** limite, **melhor dia de compra** e dia de vencimento — os mesmos dados que o app do banco mostra. Compras feitas **a partir do melhor dia** entram só na fatura seguinte; as de antes ainda entram na fatura que está fechando (no Nubank o melhor dia é o próprio dia de fechamento; no Inter é o dia seguinte ao fechamento). A fatura fecha, portanto, no dia anterior ao melhor dia (melhor dia 1 = fecha no último dia do mês). O vencimento é o primeiro dia de vencer depois do fechamento (fecha 25 e vence 5 → vence no mês seguinte; fecha 3 e vence 10 → vence no mesmo mês). A fatura é identificada pelo mês do vencimento ("fatura de dezembro" vence em dezembro). As regras estão em `js/faturas.js` e são testadas com `node scripts/testar-faturas.js`.
- **Parcelas e recorrências no cartão:** cada parcela cai numa fatura seguinte. O **limite usado** conta a compra inteira até as parcelas serem pagas, como no banco.
- **Pagar fatura:** debita o total da conta escolhida e marca a fatura como paga (dá para desfazer). O pagamento fica na tabela `faturas`, **não** em lançamentos, para a despesa não contar duas vezes (ela já contou na compra); por isso o Resumo e o Orçamento não mudam ao pagar. Há também a opção de só marcar como paga, sem debitar de nenhuma conta, útil para faturas antigas.
- **Lançamentos antigos no crédito:** ao criar um cartão, o app oferece trazer as despesas que você já lançou com uma forma de pagamento como "Crédito Nubank" e as coloca nas faturas certas.
- Contas e cartões com histórico não podem ser apagados: são **arquivados** (somem das listas, o histórico fica) e podem ser reativados.

**Antes de publicar esta versão no site:** rode o `supabase/schema.sql` inteiro no SQL Editor do Supabase. Ele só **adiciona** (tabelas `contas`, `cartoes`, `faturas` e três colunas em `lancamentos`), não apaga nada, e pode ser rodado várias vezes. Quem já tem lançamentos ganha uma "Conta principal" e os lançamentos antigos (menos os pagos no crédito) passam a apontar para ela. Se o site subir **antes** do SQL, nada quebra: sem as tabelas novas, a parte de contas fica escondida e o app funciona como antes.

## Confirmação antes de excluir

Excluir um lançamento, meta ou desejo sempre pede confirmação antes. Não tem como apagar sem querer com um toque só.

## Insight automático

No topo do Resumo Mensal, quando há dado suficiente para comparar, aparece uma frase como "Você gastou 18% a mais do que em Julho, principalmente em Alimentação" — compara o total de despesas do mês exibido com o mês anterior e aponta a categoria que mais pesou. Some sozinho quando não há mês anterior para comparar, ou quando o modo privacidade está ligado.

## As cinco abas

**Resumo Mensal** — receitas, despesas e saldo do mês, insight automático, gráfico de pizza com o percentual gasto por categoria e gráfico de barras comparando os últimos 6 meses.

**Lançamentos** — a lista completa, com busca e filtros por categoria e tipo. Clique em qualquer linha para editar; clique no cabeçalho de uma coluna para ordenar. Receitas aparecem em verde, despesas em vermelho.

**Orçamento** — valor planejado x gasto por categoria, com semáforo: verde (tranquilo), amarelo (a partir de 80% do planejado) e vermelho (estourou, mostrando quanto passou). Basta digitar no campo para mudar o planejado.

**Metas** — objetivos de economia com valor meta, valor atual, percentual concluído e prazo. Metas com menos de 30 dias restantes ficam destacadas.

**Desejos** — lista de coisas que você quer comprar, com preço estimado, prioridade e link opcional. O topo mostra o total desejado (soma dos itens ainda não comprados).

## Backup local (além da nuvem)

**Exportar dados** baixa um `.json` com tudo. **Importar dados** manda um backup anterior de volta para a conta atual na nuvem (soma ao que já existe, não substitui). Serve como segunda camada de segurança, e também para migrar dados entre contas.

## Identidade visual

Base cinza minimalista com laranja terroso de assinatura nos botões primários, aba ativa e barras de meta. Elementos secundários (selects, botões fantasmas como Ajustes/Exportar/Importar/Sair) usam um terceiro tom, terracota claro. Títulos das abas em maiúsculas. Títulos e valores em **Avenir Next**, que já vem instalada no iPhone e no Mac.

O app fica sempre no modo claro, mesmo que o aparelho esteja no modo escuro — por preferência explícita, não segue o tema do sistema.

Todas as cores são variáveis CSS no topo de `css/styles.css`, dentro de `:root`:

- `--primary` — o laranja de assinatura (fundo de botão)
- `--on-primary` — o texto **sobre** o laranja (branco, para ter contraste)
- `--primary-text` — o laranja usado **como texto** (percentual das metas, aba ativa), num tom mais fechado para ter contraste
- `--primary-light` — a terceira cor (fundo dos selects e botões fantasmas)

Se trocar o laranja, ajuste esses juntos e confira o contraste.

## Ícone

Os ícones ficam em `icons/`: `icon-180.png` (iPhone), `icon-192.png` e `icon-512.png` (manifest).

Para trocar por uma foto, forneça um **PNG quadrado de 1024×1024** e os três tamanhos são gerados a partir dele. O iOS recorta em quadrado arredondado, então deixe o assunto centralizado e sem detalhe importante nas bordas.

## Metas

Cada meta tem um emoji escolhido na hora de criar ou editar. Para mudar as opções disponíveis, edite `EMOJIS_META` no topo de `js/app.js`.

## Banco de dados (Supabase)

O schema completo (tabelas, permissões, sincronização em tempo real) está em `supabase/schema.sql`. Sempre que esse arquivo mudar, cole o conteúdo inteiro no **SQL Editor** do Supabase e rode — é seguro rodar quantas vezes precisar, mesmo que parte já exista.

## Rodando localmente (opcional, só para testes)

`servidor.js` e a pasta `certs/` permitem rodar uma cópia do app no seu Mac via `https://localhost:8765`, sem precisar publicar no Vercel a cada mudança. Não é necessário para o uso do dia a dia — a versão publicada já faz tudo. Detalhes de como gerar/renovar o certificado local estão nos comentários de `certs/gerar-certificado.sh`.
