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
