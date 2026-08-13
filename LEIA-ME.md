# GRANA — Finanças

App de controle financeiro pessoal para iPhone e Mac. Funciona offline de verdade (mesmo com o Mac desligado, abre com os últimos dados salvos) e guarda tudo no próprio aparelho — nada é enviado para a internet.

Para isso funcionar, o app roda sobre **HTTPS com um certificado próprio** (gerado neste Mac, sem depender de nenhum serviço externo). Isso exige confiar nesse certificado uma única vez no Mac e no iPhone — veja "Instalação (uma vez só)" abaixo. Sem esse passo, o app até abre, mas sem o modo offline: se o Mac estiver fora do ar, a tela fica em branco.

## Comece pelos Ajustes

Abra **Ajustes** (na barra lateral no Mac, no rodapé da tela no iPhone) e preencha:

- **Seu nome** — aparece na saudação do topo, que muda conforme a hora do dia.
- **Dia do salário** — o Resumo passa a mostrar quantos dias faltam e quanto sobra por dia até lá. Deixe vazio para esconder esse cartão.
- **Suas categorias** e **suas formas de pagamento** — uma por linha. Troque as listas genéricas pelas suas de verdade (Academia, Pets, Nubank, Itaú...). É o que mais acelera o lançamento no dia a dia.

Lançamentos antigos que usem uma categoria removida continuam intactos: ao editar, ela aparece marcada como "(removida)".

## Ocultar valores

O botão de olho no topo troca todos os valores por `•••••`. Serve para abrir o app no ônibus ou mostrar a tela para alguém sem expor quanto você tem. O estado fica salvo, então continua oculto na próxima vez que abrir.

## Instalação (uma vez só)

### 1. Ligar o servidor no Mac

Abra o Terminal e rode:

```bash
node "/Users/kaueafonso/Documents/CLAUDE KAFON/FINANÇAS PESSOAIS/servidor.js"
```

Ele mostra dois endereços para usar no iPhone:

- **`https://Kaues-MacBook-Air.local:8765`** — use este. É o nome do Mac na rede, não muda quando o Wi-Fi muda de IP.
- `https://10.10.9.16:8765` — o IP puro, mostrado só como alternativa caso o `.local` não funcione em alguma rede específica (algumas redes de empresa bloqueiam esse tipo de nome).

### 2. Confiar no certificado — no Mac

1. Abra a pasta `certs/` dentro de "FINANÇAS PESSOAIS" no Finder.
2. Dê **duplo clique em `rootCA.pem`**. Isso abre o app Keychain Access (Acesso às Chaves) e adiciona o certificado — provavelmente na aba "login".
3. Encontre **"GRANA Financas - CA Local"** na lista, dê duplo clique nele.
4. Expanda **"Confiar" (Trust)** e mude "Ao usar este certificado" para **"Confiar sempre" (Always Trust)**.
5. Feche a janela — o Mac vai pedir sua senha para confirmar. Digite e confirme.

Isso faz o Safari e o Chrome do Mac pararem de mostrar aviso de conexão insegura ao abrir o app.

### 3. Confiar no certificado — no iPhone

Os nomes de menu abaixo estão em português seguidos do inglês entre colchetes — use o que aparecer no seu aparelho.

1. No Mac, no Finder, clique com o botão direito em `certs/rootCA.pem` → **Compartilhar [Share]** → **AirDrop** → selecione seu iPhone.
2. No iPhone, toque em **Aceitar [Accept]** quando o AirDrop chegar.
3. Geralmente aparece sozinho um aviso **"Perfil Baixado" [Profile Downloaded]** — toque nele. Se não aparecer, vá manualmente em **Ajustes → Geral → VPN e Gerenciamento de Dispositivo [Settings → General → VPN & Device Management]**; o perfil vai estar listado lá.
4. Toque no perfil (**"GRANA Financas - CA Local"**) → **Instalar [Install]**, no canto superior direito.
5. Digite a senha do iPhone quando pedir.
6. Aparece um aviso em vermelho sobre certificado raiz não verificado — é esperado, é a sua própria CA. Toque em **Instalar [Install]** de novo para confirmar, depois **Concluído [Done]**.
7. **Passo que costuma ser esquecido — instalar sozinho não basta:** vá em **Ajustes → Geral → Sobre → Ajustes de Confiança de Certificado [Settings → General → About → Certificate Trust Settings]**. Em **"HABILITAR CONFIANÇA TOTAL PARA CERTIFICADOS RAIZ" ["ENABLE FULL TRUST FOR ROOT CERTIFICATES"]**, ative a chave ao lado de **"GRANA Financas - CA Local"** e confirme em **Continuar [Continue]**.

Sem esse último passo (item 7), o certificado fica instalado mas não confiável — o app abre, mas sem o modo offline.

### 4. Adicionar à Tela de Início

O iPhone e o Mac precisam estar na mesma rede Wi-Fi.

1. No Safari do iPhone, abra `https://Kaues-MacBook-Air.local:8765`.
2. Confirme que não aparece nenhum aviso de "conexão não é privada" — se aparecer, volte ao passo 3 acima.
3. Toque em **Compartilhar** → **Adicionar à Tela de Início**. Deixe **"Abrir como Web App"** ativado.

Se você já tinha um ícone do GRANA na tela de início de uma versão anterior (com `http://`), apague-o e use este novo.

## Se o app parar de abrir

**O Mac está desligado ou dormindo?** Agora, com o certificado confiado, o app deve abrir mesmo assim — ele carrega a última versão salva no aparelho. Se mesmo assim aparecer tela em branco, volte à etapa 3 acima e confirme o último passo: **Ajustes de Confiança de Certificado** ativado.

**Usando `https://Kaues-MacBook-Air.local:8765`, o IP mudar não é mais problema** — esse nome segue o Mac em qualquer rede doméstica, então normalmente você nunca mais precisa pensar em IP.

**Apareceu "conexão não é privada" mesmo assim?** Ou o `.local` não carrega em alguma rede específica (raro — acontece em algumas redes de empresa/hotel que bloqueiam esse tipo de nome). Nesse caso, descubra o IP atual e use-o direto:
```bash
ipconfig getifaddr en0
```
Se mesmo o IP der aviso de certificado, rode:
```bash
"/Users/kaueafonso/Documents/CLAUDE KAFON/FINANÇAS PESSOAIS/certs/gerar-certificado.sh"
```
e reinicie o servidor (`node servidor.js`). Não precisa refazer a confiança do certificado no iPhone — é a mesma CA, só o certificado do servidor é renovado.

## Onde ficam os dados

Os lançamentos, orçamentos e metas ficam salvos no navegador do próprio aparelho. **iPhone e Mac guardam dados separados** — eles não sincronizam sozinhos.

Para passar dados de um para o outro, use **Exportar backup** (gera um arquivo `.json`) e depois **Importar backup** no outro aparelho.

> Faça um backup de vez em quando. Limpar os dados de navegação do Safari/Chrome apaga tudo.

## As quatro abas

**Resumo Mensal** — receitas, despesas e saldo do mês, gráfico de pizza com o percentual gasto por categoria e gráfico de barras comparando os últimos 6 meses.

**Lançamentos** — a lista completa, com busca e filtros por categoria e tipo. Clique em qualquer linha para editar; clique no cabeçalho de uma coluna para ordenar. Receitas aparecem em verde, despesas em vermelho.

**Orçamento** — valor planejado x gasto por categoria, com semáforo: verde (tranquilo), amarelo (a partir de 80% do planejado) e vermelho (estourou, mostrando quanto passou). Basta digitar no campo para mudar o planejado.

**Metas** — objetivos de economia com valor meta, valor atual, percentual concluído e prazo. Metas com menos de 30 dias restantes ficam destacadas.

## Identidade visual

Base cinza minimalista com laranja terroso de assinatura nos botões, aba ativa e barras de meta. Títulos das abas em maiúsculas. Títulos e valores em **Avenir Next**, que já vem instalada no iPhone e no Mac — nada é baixado, então funciona offline.

O app fica sempre no modo claro, mesmo que o aparelho esteja no modo escuro — por preferência explícita, não segue mais o tema do sistema.

Todas as cores são variáveis CSS no topo de `css/styles.css`, dentro de `:root`:

- `--primary` — o laranja de assinatura (fundo de botão)
- `--on-primary` — o texto **sobre** o laranja (branco, para ter contraste)
- `--primary-text` — o laranja usado **como texto** (percentual das metas, aba ativa), num tom mais fechado para ter contraste

Se trocar o laranja, ajuste os três juntos e confira o contraste.

## Ícone

Os ícones ficam em `icons/`: `icon-180.png` (iPhone), `icon-192.png` e `icon-512.png` (manifest).

Para trocar por uma foto, forneça um **PNG quadrado de 1024×1024** e os três tamanhos são gerados a partir dele. O iOS recorta em quadrado arredondado, então deixe o assunto centralizado e sem detalhe importante nas bordas.

## Metas

Cada meta tem um emoji escolhido na hora de criar ou editar. Para mudar as opções disponíveis, edite `EMOJIS_META` no topo de `js/app.js`.
