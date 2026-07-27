# scraper-natura

Duas rotas serverless (Vercel) que leem o valor mínimo de frete grátis na vitrine da Natura
e devolvem texto plano, pronto para ser consumido por uma página no HostGator.

A leitura da página é feita pela API REST `/scrape` do Browserless — não há dependências npm.

## Rotas

| Rota | Retorno |
|---|---|
| `GET /api/frete` | Só o valor do primeiro banner (ex.: `99` ou `99,00`) |
| `GET /api/frete2` | Uma linha por faixa: `Frete Grátis de "Natura" : 99`, separadas por `\n` |
| `GET /` | Página de status em HTML (o mesmo que `/api/status`) |

As duas primeiras respondem `text/plain; charset=utf-8`.

A página inicial faz uma consulta real ao site a cada acesso e mostra um de três estados:
**FUNCIONANDO**, **ATENÇÃO** (conectou mas não achou frete — promoção fora do ar ou layout
mudado) e **FORA DO AR** (falha de infraestrutura, com o motivo). Ela responde HTTP `503`
nesse último caso, então serve como endpoint de monitoramento de uptime.

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
