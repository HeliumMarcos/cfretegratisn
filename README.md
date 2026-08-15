# scraper-natura

Duas rotas serverless (Vercel) que leem o valor mínimo de frete grátis na vitrine da Natura
e devolvem texto plano, pronto para ser consumido por uma página no HostGator.

A leitura da página é feita pela API REST `/scrape` do Browserless — não há dependências npm.

## Rotas

| Rota | Retorno |
|---|---|
| `GET /api/frete` | Só o valor do primeiro banner (ex.: `149` ou `99,00`) |
| `GET /api/frete2` | Uma linha por faixa: `Frete Grátis de "Natura" : 149`, separadas por `\n` |
| `GET /` | Página de status em HTML (o mesmo que `/api/status`) |

As duas primeiras respondem `text/plain; charset=utf-8`.

A página inicial faz uma consulta real ao site a cada acesso e mostra um de três estados:
**FUNCIONANDO**, **ATENÇÃO** (conectou mas não achou frete — promoção fora do ar) e
**FORA DO AR** (falha de infraestrutura, com o motivo). Ela responde HTTP `503`
nesse último caso, então serve como endpoint de monitoramento de uptime.

O diagnóstico mostra **de qual seletor** o texto veio, **como** a página foi esperada,
quantas tentativas foram necessárias e uma amostra do **texto lido**. Quando algo parar de
funcionar de novo, esses quatro campos dizem se o problema é a marcação do site, a espera,
a infraestrutura ou a promoção em si.

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
| `gotoOptions.timeout` | 10s | navegação, contada pelo Browserless |
| `waitForSelector` | 4s | espera do bloco, contada pelo Browserless |
| timeout da requisição | 20s | corte nosso, com folga sobre os 14s acima |
| limite da função | 24s | margem sob os 30s da Vercel |

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

Quando o padrão não é encontrado, a resposta ainda é `200`, com o motivo no corpo
(`FALHA_REGEX: ...` ou `FALHA: ...`). Erro de infraestrutura devolve `500 ERRO_TECNICO: ...`.

## Variáveis de ambiente

| Variável | Obrigatória | Default |
|---|---|---|
| `BROWSERLESS_TOKEN` | sim | — |
| `BROWSERLESS_URL` | não | `https://chrome.browserless.io` |
| `BROWSERLESS_API_VERSION` | não | `v2` |
| `BROWSERLESS_FAST` | não | desligado (`1` liga) |
| `NATURA_STORE_URL` | não | vitrine de promoções do consultor `helium` |

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
`BROWSERLESS_FAST=1` no Vercel para valer também em `/api/frete` e `/api/frete2`.

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
curl http://localhost:3000/api/frete2
```
