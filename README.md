# scraper-natura

Duas rotas serverless (Vercel) que leem o valor mínimo de frete grátis na vitrine da Natura
e devolvem texto plano, pronto para ser consumido por uma página no HostGator.

A leitura da página é feita pela API REST `/scrape` do Browserless — não há dependências npm.

## Rotas

| Rota | Retorno |
|---|---|
| `GET /api/frete` | Só o valor do primeiro banner (ex.: `99` ou `99,00`) |
| `GET /api/frete2` | Uma linha por faixa: `Frete Grátis de "Natura" : 99`, separadas por `\n` |

Ambas respondem `text/plain; charset=utf-8`.

Quando o padrão não é encontrado, a resposta ainda é `200`, com o motivo no corpo
(`FALHA_REGEX: ...` ou `FALHA: ...`). Erro de infraestrutura devolve `500 ERRO_TECNICO: ...`.

## Variáveis de ambiente

| Variável | Obrigatória | Default |
|---|---|---|
| `BROWSERLESS_TOKEN` | sim | — |
| `BROWSERLESS_URL` | não | `https://chrome.browserless.io` |
| `BROWSERLESS_API_VERSION` | não | `v1` |
| `NATURA_STORE_URL` | não | vitrine de promoções do consultor `helium` |

`BROWSERLESS_API_VERSION` existe porque o host legado espera `waitFor` no corpo da
requisição, enquanto os hosts regionais mais novos esperam `waitForSelector`. Ao migrar para
um host regional, defina `BROWSERLESS_URL` **e** `BROWSERLESS_API_VERSION=v2` juntos.

## Rodando local

```bash
echo "BROWSERLESS_TOKEN=seu_token" > .env.local
vercel dev
curl http://localhost:3000/api/frete
curl http://localhost:3000/api/frete2
```
