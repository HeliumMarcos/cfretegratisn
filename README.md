# scraper-natura

Uma rota serverless (Vercel) que lê o valor mínimo de frete grátis na vitrine da Natura
e devolve texto plano, pronto para ser consumido por uma página no HostGator.

O mesmo projeto analisa as páginas configuradas em **Admin → Automação/Aprovação**. Cada
página define quantidade útil, modo “todos” e horário próprio. Os resultados são enviados,
com assinatura HMAC, para revisão no Laravel; nenhum produto é publicado diretamente.

A leitura é feita por `GET` simples sempre que possível; a API REST `/scrape` do Browserless
entra só como reserva. Não há dependências npm.

## Rotas

| Rota | Retorno |
|---|---|
| `GET /api/frete` | Só o limiar do frete grátis (ex.: `149` ou `79,90`) |
| `GET /` | Painel de status em HTML (o mesmo que `/api/status`) |
| `GET /api/status-data` | Estado atual estruturado em JSON, usado pelo painel e por monitores |
| `POST /api/catalog-source-run` | Analisa uma página configurada; chamada autenticada pela HostGator |
| `GET /api/catalog-sync` | Coletor legado dos dois rankings fixos, protegido por `CRON_SECRET` |

`/api/frete` responde `text/plain; charset=utf-8`.

A página inicial aparece imediatamente em estado **CONSULTANDO** e busca os dados em segundo
plano. Ela distingue **FUNCIONANDO**, **SEM PROMOÇÃO** e **FORA DO AR**. Há timeout amigável,
nova tentativa manual e diagnóstico técnico recolhível.

O HTML do painel sempre responde `200`; use `/api/status-data` para monitoramento. Esse
endpoint responde `503` em falha de infraestrutura e traz o estado em JSON.

O diagnóstico mostra **de qual seletor** o texto veio, **como** a página foi esperada,
quantas tentativas foram necessárias e uma amostra do **texto lido**. Quando algo parar de
funcionar de novo, esses quatro campos dizem se o problema é a marcação do site, a espera,
a infraestrutura ou a promoção em si.

## De onde vem o valor

Três fontes, em ordem, e a página de status diz qual respondeu (**Lido de**):

1. **Vitrine por `GET` simples** (`http-direto`) — o anúncio das faixas está no HTML do
   servidor. Responde em milissegundos, sem cota e sem fila.
2. **Páginas de produto** (`página de produto`) — têm um campo dedicado ao limiar. Três
   URLs são tentadas em ordem, porque um produto pode sair do ar (`NATURA_PRODUTO_URLS`).
3. **Browserless** — último recurso, quando nenhuma das anteriores serve.

### Por que os padrões são ancorados na frase inteira

A vitrine é uma **listagem cheia de preços**, e o HTML embute outro HTML dentro de JSON.
Desescapar as aspas quebra a estrutura das tags, e qualquer remoção de tags depois disso
corta no lugar errado, deixando restos de classe CSS no meio do texto:

```
Minha Loja - promocoes *]:!opacity-0 text-transparent w-32 h-8 rounded-3xl"> ... entrar 0
```

Sobre essa sopa, um padrão genérico (`frete grátis` … `R$`) casa com o preço de qualquer
coisa — foi assim que a rota chegou a devolver **`9,00`**, que era o preço de outro item.
Valor errado em silêncio é pior que falha: a página no HostGator publicaria um limiar
inexistente.

A defesa é não limpar o HTML e exigir a frase completa. **"acima de"** e **"a partir de"**
só aparecem no anúncio do limiar, então o padrão acerta sem depender de HTML bem-formado:

| Fonte | Frase exigida |
|---|---|
| vitrine | `frete grátis Natura acima de R$ …` |
| produto | `frete grátis a partir de R$ …` |

Na página de produto isso também evita duas armadilhas próximas: um selo "frete grátis"
solto e o preço do produto (`R$ 279,90`) logo depois.

Os padrões mais soltos continuam existindo, mas **só** sobre o texto que o Browserless
extrai de elementos específicos — ali o texto já vem limpo, e a ambiguidade não existe.

`149,00` e `149` são o mesmo limiar, então o valor é normalizado: sem isso a rota
devolveria um ou outro conforme a fonte que respondeu, mudando sozinha de um acesso para
o outro. Valores quebrados (`79,90`) ficam como estão.

Quando nenhuma fonte responde **e** houve falha de infraestrutura, a resposta é erro, não
"promoção fora do ar" — e traz o motivo de cada uma das três, que apontam para lugares
diferentes (bloqueio do site, produto sem o campo, cota do Browserless).

Uma limitação vale registrar: se o site passar a barrar por **impressão digital de TLS**
(JA3), as leituras diretas caem. O `fetch` do Node usa a stack TLS dele, e não há como
imitar a de um Chrome — é o que bibliotecas como `curl_cffi` fazem com `impersonate`, e
não existe equivalente no runtime da Vercel. Cabeçalhos de navegador ajudam com checagem
simples, não com essa.

## Por que não depende de um seletor só

A leitura já quebrou uma vez porque o site parou de usar `[data-testid="box-info"]`: o
Browserless respondia `200`, mas com zero blocos, e as duas rotas devolviam falha.

Hoje (15/08/2026) o banner é um **carrossel Swiper**, e cada faixa da promoção é um
`.swiper-slide` — o equivalente exato dos antigos blocos `box-info`. Não há mais
`data-testid` algum ali; "box info" só sobrevive dentro do `content_zone` dos links.

Agora a mesma requisição pede vários seletores candidatos **e** o `body` da página, e a
leitura fica com o primeiro que mencionar frete grátis. Pedir tudo de uma vez não custa
requisição extra. O `body` não depende de marcação nenhuma, então sobrevive a qualquer
redesign — é menos preciso, e por isso só entra quando os candidatos não trazem nada.

A espera é por `[data-testid="box-info"], .swiper-slide` — uma lista CSS que cobre o bloco
histórico, se um dia voltar, e o slide de hoje. Assim a primeira tentativa não gasta a
espera inteira num seletor que sabidamente não existe mais.

Esperar por um seletor que sumiu é justamente o que derruba a leitura, então, se a espera
falhar, a requisição é repetida com uma espera de tempo fixo, que deixa o JavaScript da loja
renderizar sem depender de marcação.

## Tempo e repetição

O `vercel.json` corta a função em 30s, e estourar isso devolve um `504` cru da Vercel — que
não diz o motivo e não aparece na página de status. Evitar esse `504` é o que dita os
números:

| Limite | Valor | Para quê |
|---|---|---|
| página de produto | 5s | por URL, para no primeiro que responder |
| leitura direta | 6s | o `GET` da vitrine, sem browser |
| `gotoOptions.timeout` | 10s | navegação, contada pelo Browserless |
| `waitForSelector` | 4s | espera do bloco, contada pelo Browserless |
| timeout da requisição | 20s | corte nosso, com folga sobre os 14s acima |
| limite da função | 24s | margem sob os 30s da Vercel |

O orçamento de 24s é **compartilhado**: o relógio começa antes da leitura direta, e cada
requisição ao Browserless recebe o menor entre o seu timeout e o tempo que sobrou. Sem esse
teto móvel as duas etapas somariam 26s e voltariam a estourar o limite da Vercel.

O `fetch` não tem timeout próprio: se o Browserless enfileira a requisição esperando um
worker livre, a função fica pendurada até a Vercel matá-la. Daí o corte de 20s, com folga
sobre a soma dos outros dois — o relógio deles só começa depois que a sessão do browser
sobe, então encostar na soma aborta leituras que estavam a caminho.

A combinação dos dois últimos faz a segunda tentativa acontecer **só quando a primeira
falhou rápido**, que é o único caso em que repetir resolve: o servidor recusando alguma
chave do corpo. Esperar numa fila e depois esperar de novo não resolve nada.

Pela mesma razão, `401`, `402`, `403` e `429` param na primeira resposta: limite de taxa e
credencial não melhoram com insistência, e repetir só queima mais cota. Um `429` aparece
como "cota do plano esgotada ou requisições demais ao mesmo tempo", não como a página HTML
do openresty.

Uma página que carrega e volta **sem texto algum**, nem no `body`, é tratada como erro de
infraestrutura (provável bloqueio de bot ou `NATURA_STORE_URL` inválida), não como
"promoção fora do ar" — os dois casos pediam ações bem diferentes e antes se pareciam.

O padrão do valor também ficou menos preso à copy: exige só "frete grátis" perto de um
`R$`, aceita a ordem invertida e lê corretamente valores com separador de milhar
(`R$ 1.000,00`, que o padrão antigo lia como `1`).

Quando o padrão não é encontrado, as rotas de texto respondem `404`, mantendo o motivo no
corpo (`FALHA_REGEX: ...` ou `FALHA: ...`). Erro de infraestrutura devolve
`500 ERRO_TECNICO: ...`; métodos diferentes de GET/HEAD devolvem `405`. O cabeçalho
`X-Result-Status` contém `ok`, `not-found` ou `error`.

## Variáveis de ambiente

| Variável | Obrigatória | Default |
|---|---|---|
| `BROWSERLESS_TOKEN` | só para a reserva | — |
| `BROWSERLESS_URL` | não | `https://chrome.browserless.io` |
| `BROWSERLESS_API_VERSION` | não | `v2` |
| `BROWSERLESS_FAST` | não | desligado (`1` liga) |
| `NATURA_STORE_URL` | não | vitrine de promoções do consultor `helium` |
| `NATURA_PRODUTO_URLS` | não | três páginas de produto, separadas por vírgula |
| `CRON_SECRET` | sim, automação | protege a execução agendada; mínimo de 16 caracteres |
| `AUTOMATION_INGESTION_URL` | sim, automação | `https://bio.heliummarcos.com.br/api/automation/proposals` |
| `AUTOMATION_INGESTION_SECRET` | sim, automação | mesmo segredo da HostGator; mínimo de 32 caracteres |
| `NATURA_TOP_SELLERS_URL` | não | ranking de promoções mais vendidas do consultor |
| `NATURA_DISCOUNTS_URL` | não | ranking de promoções por maior desconto |
| `NATURA_SHORTENER_API_KEY` | sim, automação | chave pública usada pelo compartilhamento oficial da Natura |
| `NATURA_SHORTENER_BEARER` | sim, automação | autorização pública usada pelo compartilhamento oficial da Natura |

## Automação do catálogo

Os horários ficam no banco do Laravel, em vez de serem gravados no `vercel.json`. Uma única
tarefa Cron da HostGator executa `php artisan schedule:run` a cada cinco minutos; o Laravel
seleciona somente as páginas que venceram naquele horário e chama `/api/catalog-source-run`.
O botão “Executar agora” chama a mesma rota para uma página individual.

Antes de navegar, o Laravel envia um retrato dos preços atuais, propostas já pendentes,
observações ignoradas até mudar e referências descartadas. O navegador continua carregando
a grade até completar a quantidade de alterações realmente úteis. O modo “todos” trabalha
em lotes de até 200 mudanças por execução, permitindo repetir a execução sem reenviar itens
que já estão na fila. Por fim, o coletor usa o mesmo encurtador do botão “Compartilhar” da
Natura para preencher `sminhaloja.natura.com`.

A coleta também diferencia `Produto esgotado` de `Acabou, mas volta logo`. O painel mostra
o aviso quando o item já precisa de revisão por ser novo ou por ter mudança de preço. Uma
alteração apenas no estoque não cria proposta para produto que já está cadastrado.

Antes de publicar esta versão, configure nas variáveis de ambiente da Vercel:

```text
CRON_SECRET=um-segredo-exclusivo-para-o-agendamento
AUTOMATION_INGESTION_URL=https://bio.heliummarcos.com.br/api/automation/proposals
AUTOMATION_INGESTION_SECRET=o-mesmo-segredo-configurado-na-hostgator
```

Na HostGator, adicione o mesmo valor ao `.env`:

```text
AUTOMATION_INGESTION_SECRET=o-mesmo-segredo-configurado-na-vercel
AUTOMATION_RUNNER_URL=https://cfretegratisn.vercel.app/api/catalog-source-run
```

Cada envio inclui timestamp de curta validade, chave de idempotência e assinatura do
corpo integral. Uma repetição do mesmo lote não cria propostas duplicadas.

## Modo rápido

Com `BROWSERLESS_FAST=1`, o Browserless é instruído a não baixar imagens, fontes e mídia —
só precisamos do texto. **CSS não é bloqueado de propósito:** o texto que lemos é o
renderizado, então sem CSS elementos ocultos na página passariam a aparecer e mudariam o
resultado das duas rotas.

O ganho tende a ser modesto, porque a leitura já usa `waitUntil: 'domcontentloaded'` e retorna
assim que o banner aparece — nunca esperamos a página terminar de carregar. O que sobra é a
disputa por banda e CPU com o JavaScript da loja.

Para medir antes de decidir, a página de status aceita `?fast=1` e `?fast=0`, que ignoram a
variável de ambiente e valem só para aquele acesso:

```
https://SEU-PROJETO.vercel.app/?fast=0   # como está hoje
https://SEU-PROJETO.vercel.app/?fast=1   # com o bloqueio
```

Compare o campo **Tempo de resposta** entre os dois, algumas vezes. Se compensar, ligue
`BROWSERLESS_FAST=1` no Vercel para valer em `/api/frete`.

Se o servidor recusar a chave `rejectResourceTypes`, a requisição é repetida sem ela
automaticamente e a página informa `rápido recusado pelo servidor` — nunca derruba a rota.

## Notas

`BROWSERLESS_API_VERSION` existe porque a v2 espera `waitForSelector` no corpo da requisição,
enquanto a v1 esperava `waitFor`. Cada uma rejeita a chave da outra com
`400 ... must NOT have additional properties`, então é esse o sintoma de versão trocada.
Se algum dia cair numa instância v1, basta definir `BROWSERLESS_API_VERSION=v1`.

## Rodando local

```bash
echo "BROWSERLESS_TOKEN=seu_token" > .env.local
vercel dev
curl http://localhost:3000/api/frete
curl http://localhost:3000/api/status-data
```

Verificação local sem dependências adicionais:

```bash
npm run check
npm test
```
