# GRANA — Finanças

App de controle financeiro pessoal para celular (Android e iPhone) e computador. Hospedado em `https://kafon-s-life.vercel.app`, com HTTPS de verdade e dados sincronizados na nuvem via Supabase — funciona de qualquer lugar com internet, sem depender de nenhum computador ligado. Também existe como app nativo para Android e iPhone (veja `APP-NATIVO.md`).

## Como usar

Abra `https://kafon-s-life.vercel.app` no navegador do celular (Safari no iPhone, Chrome no Android) ou do computador, crie sua conta (e-mail e senha) e comece a lançar. Para instalar como app: no iPhone, **Compartilhar → Adicionar à Tela de Início**; no Android, menu do Chrome → **Instalar app**.

Os dados ficam no Supabase, protegidos por login — cada conta só enxerga os próprios lançamentos (Row Level Security). Toda alteração sincroniza **em tempo real** entre os aparelhos logados na mesma conta: edite no computador e o celular atualiza sozinho, sem precisar recarregar.

## Comece pelos Ajustes

Abra **Ajustes** (na barra lateral no computador, no rodapé da tela no celular) e preencha:

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

**Antes de publicar esta versão no site:** rode o `supabase/schema.sql` inteiro no SQL Editor do Supabase. Ele só **adiciona** (tabelas `contas`, `cartoes`, `faturas` e três colunas em `lancamentos`), não apaga nada, e pode ser rodado várias vezes. Quem já tem lançamentos ganha uma "Conta principal" e os lançamentos antigos (menos os pagos no crédito) passam a apontar para ela. O app **exige** o schema completo: se o site subir antes do SQL, a tela mostra "Não deu pra carregar seus dados" com o botão de tentar de novo, até o SQL ser rodado. Por isso, rode o SQL **primeiro** e só depois publique.

## Transferência entre contas

Em **Contas → Transferir**: tira dinheiro de uma conta e põe em outra. Fica numa tabela própria (`transferencias`) e **não conta como receita nem despesa**: o Resumo e o Orçamento não mudam, só o saldo das duas contas. Dá para agendar para uma data futura (só mexe no saldo quando a data chegar), editar e excluir. Conta que tem transferência não pode ser apagada, só arquivada.

## Quanto posso gastar hoje

Card grande no topo do Resumo. A conta: **saldo das contas do dia a dia** (corrente, carteira e outras; poupança e investimentos ficam de fora) **− o que vence antes do próximo salário** (contas pendentes, inclusive atrasadas até 60 dias, e faturas de cartão em aberto) **÷ dias até o salário**. Conta que vence no dia do salário não entra, porque você paga com o salário novo. Sem dia de salário nos Ajustes, o período vai até o fim do mês; sem contas cadastradas, usa o saldo do mês.

**Nas primeiras semanas** (menos de 14 dias de uso) o app ainda não conhece o seu ritmo: o card avisa "ainda estou aprendendo o seu ritmo" e só fica verde ou vermelho (o amarelo espera). A média também divide só pelos dias que existem, não por 30. **Pendências atrasadas há mais de 60 dias** ficam fora da conta, mas aparecem num aviso discreto ("Você tem 2 contas antigas atrasadas") que abre a lista, com cada uma clicável para marcar como paga ou excluir.

O número muda de cor pelo seu ritmo: **verde** se dá para manter o seu gasto diário normal (média dos últimos 30 dias, sem contar contas grandes e raras como o aluguel); **amarelo** se sobra menos que o seu ritmo; **vermelho** se as contas até o salário já passam do saldo. "Como chegamos nesse valor" mostra a conta passo a passo. A lógica está em `js/vencimentos.js`.

## Importar extrato (OFX e CSV)

Em **Lançamentos → Importar extrato**. Escolha a conta (ou o cartão, para fatura em CSV), o arquivo, e **revise antes de importar**. O arquivo é lido no próprio aparelho; nada é enviado para fora.

- **Formatos:** OFX (inclusive o antigo, sem tags de fechamento, e em Windows-1252) e CSV de vários bancos (separador vírgula, ponto e vírgula ou tab; cabeçalho com acento; linhas de apresentação antes do cabeçalho; colunas separadas de débito e crédito). Se o cabeçalho do CSV não for reconhecido, o app pede para você dizer qual coluna é qual. Em fatura de cartão em CSV as compras vêm positivas; a opção acompanha o destino.
- **Sem duplicar:** cada linha ganha um identificador (o do banco, ou um hash de data, valor e descrição). Reimportar o mesmo arquivo marca tudo como "já importado", e o banco recusa a repetição mesmo se dois aparelhos importarem ao mesmo tempo (índice único em `lancamentos.import_id`). Linhas com o mesmo valor e data próxima de algo que você já lançou à mão vêm como "possível duplicado", desmarcadas.
- **Pagamento de fatura** que aparece no extrato da conta vem desmarcado: o app já registra isso em "Pagar fatura", e importar contaria duas vezes.
- **Categoria sugerida:** primeiro pelo que você já lançou parecido, depois por palavras-chave (Uber, iFood, Netflix, farmácia...) mapeadas para os nomes das *suas* categorias, por último "Outros". Dá para trocar linha a linha. A lógica está em `js/importar.js` (`node scripts/testar-importar.js`).

## Alertas de vencimento

- **No Resumo:** o card **Contas a vencer** mostra o que está atrasado, vence hoje ou nos próximos 3 dias (inclusive a fatura do cartão), com "Marcar paga" ou "Ver fatura" ali mesmo.
- **Notificação das 21h:** avisa **3 dias e 1 dia antes** do vencimento, no dia e quando atrasa, para contas pendentes e faturas de cartão em aberto (só nesses marcos, para o mesmo vencimento não virar aviso todo dia). Só envia se houver algo a dizer; com o modo privacidade ligado o texto não mostra nomes. No site vem do servidor (`api/lembretes.js`); no app Android/iPhone os próximos 7 dias já ficam agendados no aparelho (`api/_planejar.js`), então chegam mesmo sem abrir o app. As duas versões usam a mesma lógica (`js/vencimentos.js`, `api/_mensagem.js`).

**Antes de publicar:** rode o `supabase/schema.sql` de novo (cria `transferencias` e a coluna `import_id`). Só adiciona; pode rodar várias vezes. Rode **antes** de publicar: o site não carrega sem as tabelas e colunas novas.

## Conta, senha e privacidade

- **Esqueci minha senha:** na tela de login, o link pede o e-mail e manda um link para criar uma senha nova. O link abre o GRANA direto na tela "Definir nova senha", e a pessoa só entra no app depois de salvar a senha nova. A resposta é a mesma exista ou não a conta (ninguém descobre quais e-mails estão cadastrados). Para funcionar, `https://kafon-s-life.vercel.app` precisa estar em **Supabase → Authentication → URL Configuration** (Site URL e Redirect URLs); o texto do e-mail se edita em **Authentication → Email Templates**.
- **Excluir minha conta:** em **Ajustes → Seus dados**. Pede para digitar EXCLUIR e apaga a conta e **todos** os dados na hora, sem volta (`api/excluir-conta.js`, que usa a chave de serviço no servidor; as tabelas apagam em cascata). O app Android/iPhone chama o mesmo endereço do site.
- **Política de Privacidade:** `privacidade.html` (publicada em `https://kafon-s-life.vercel.app/privacidade.html`), linkada no login e nos Ajustes. Ela cita o contato por chamado no GitHub; se quiser um e-mail de contato, edite a seção 9 do arquivo.
- **Ao sair da conta**, o aparelho apaga os caches do app e as preferências de "último destino". O service worker nunca guarda respostas de outros endereços (como o Supabase), só os arquivos do próprio site.

## Confirmação antes de excluir

Excluir um lançamento, meta ou desejo sempre pede confirmação antes. Não tem como apagar sem querer com um toque só.

## Insight automático

No topo do Resumo Mensal, quando há dado suficiente para comparar, aparece uma frase como "Você gastou 18% a mais do que em Julho, principalmente em Alimentação" — compara o total de despesas do mês exibido com o mês anterior e aponta a categoria que mais pesou. Some sozinho quando não há mês anterior para comparar, ou quando o modo privacidade está ligado.

## As abas

**Resumo Mensal** — "quanto posso gastar hoje", saldo do mês com receitas e despesas, contas a vencer, alertas de orçamento, ranking de gastos por categoria, categorias mês a mês e evolução patrimonial.

**Lançamentos** — a lista completa, com busca e filtros por categoria, tipo e conta. Clique em qualquer linha para editar; clique no cabeçalho de uma coluna para ordenar. Cada lançamento tem o ícone do que foi comprado. Daqui também sai o **Importar extrato**.

**Contas** — contas e carteiras com saldo, cartões de crédito com limite e fatura (tocar abre a tela da fatura), transferências entre contas.

**Orçamento** — valor planejado x gasto por categoria, com semáforo: verde (tranquilo), amarelo (a partir de 80% do planejado) e vermelho (estourou, mostrando quanto passou). Basta digitar no campo para mudar o planejado.

**Metas** — objetivos de economia com valor meta, valor atual, percentual concluído e prazo. Metas com menos de 30 dias restantes ficam destacadas.

**Desejos** — lista de coisas que você quer comprar, com preço estimado, prioridade e link opcional (só links que começam com http:// ou https://). O topo mostra o total desejado (soma dos itens ainda não comprados).

## Relatório em PDF

O botão de impressora no topo gera o relatório do mês (resumo, gastos por categoria e todos os lançamentos). No navegador abre a janela de impressão para salvar em PDF; no app Android/iPhone abre o "compartilhar" do celular. Com o modo privacidade ligado, o relatório sai com os valores reais mesmo assim (ele é para você guardar), e o modo volta ao que estava.

## Identidade visual

Preto, branco e cinza, sem laranja: cartões de destaque pretos (no modo escuro viram claros), fundo cinza-claro e cartões brancos arredondados. Verde e vermelho aparecem só em valores positivos e negativos; as categorias têm cores próprias nos gráficos e ícones. Títulos e números em **Space Grotesk** e texto em **Work Sans**, ambas incluídas no app (`fonts/`), então o visual é o mesmo no Android, no iPhone e no computador.

O tema claro ou escuro é escolhido em **Ajustes → Aparência** e sincroniza entre os aparelhos. No celular, o fundo do modo claro alterna faixas pretas e claras.

As cores são variáveis CSS no topo de `css/styles.css`, em `:root` (modo claro) e `:root[data-theme="dark"]` (modo escuro): `--primary` (preto de assinatura), `--surface` (cartões), `--income` e `--expense` (verde e vermelho dos valores) e `--chart-1` a `--chart-8` (categorias).

## Ícone

O ícone (monograma G) fica em `icons/`: `icon-180-v2.png` (iPhone), `icon-192-v2.png` e `icon-512-v2.png` (manifest e Android). Os nomes terminam em `-v2` de propósito: a pasta é servida com cache de 1 ano, então um ícone novo precisa de nome novo. Para trocar, gere PNGs quadrados com assunto centralizado (o iOS recorta em quadrado arredondado) e mude o nome dos arquivos e as referências em `index.html`, `manifest.json` e `sw.js`.

## Metas

Cada meta tem um emoji escolhido na hora de criar ou editar. Para mudar as opções disponíveis, edite `EMOJIS_META` no topo de `js/app.js`.

## Banco de dados (Supabase)

O schema completo (tabelas, permissões, sincronização em tempo real) está em `supabase/schema.sql`. Sempre que esse arquivo mudar, cole o conteúdo inteiro no **SQL Editor** do Supabase e rode — é seguro rodar quantas vezes precisar, mesmo que parte já exista.

## Rodando localmente (opcional, só para testes)

`servidor.js` e a pasta `certs/` permitem rodar uma cópia do app no seu computador via `https://localhost:8765`, sem precisar publicar no Vercel a cada mudança. Não é necessário para o uso do dia a dia — a versão publicada já faz tudo. Detalhes de como gerar/renovar o certificado local estão nos comentários de `certs/gerar-certificado.sh`.
