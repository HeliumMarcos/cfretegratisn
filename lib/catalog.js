import { createHash, createHmac } from 'node:crypto';

const BROWSERLESS_URL = (process.env.BROWSERLESS_URL ?? 'https://chrome.browserless.io')
    .replace(/\/+$/, '');

const RANKING_URLS = [
    {
        key: 'top_sellers',
        label: 'Mais vendidos',
        url: process.env.NATURA_TOP_SELLERS_URL
            ?? 'https://www.minhaloja.natura.com/c/promocoes?consultoria=helium&marca=natura',
    },
    {
        key: 'discounts',
        label: 'Maior desconto',
        url: process.env.NATURA_DISCOUNTS_URL
            ?? 'https://www.minhaloja.natura.com/c/promocoes?consultoria=helium&marca=natura&sort=discounts',
    },
];

const BROWSERLESS_TIMEOUT = 52000;
const INGESTION_TIMEOUT = 10000;

// Executada dentro de uma unica sessao Browserless. As duas paginas abrem em
// paralelo para caber com folga na funcao serverless e consumir uma sessao, nao duas.
export const BROWSERLESS_CATALOG_FUNCTION = String.raw`
export default async ({ page, context }) => {
  const preparar = async (aba) => {
    await aba.setRequestInterception(true);
    aba.on('request', (request) => {
      if (['font', 'media'].includes(request.resourceType())) request.abort();
      else request.continue();
    });
  };

  const coletar = async (aba, ranking) => {
    const failedRequests = [];
    const apiResponses = [];
    const pageErrors = [];

    aba.on('requestfailed', (request) => {
      if (!['font', 'media'].includes(request.resourceType()) && failedRequests.length < 8) {
        failedRequests.push({
          url: request.url().slice(0, 220),
          error: request.failure()?.errorText || 'request failed',
        });
      }
    });
    aba.on('response', (response) => {
      const type = response.request().resourceType();
      if (['xhr', 'fetch'].includes(type) && apiResponses.length < 12) {
        apiResponses.push({ status: response.status(), url: response.url().slice(0, 220) });
      }
    });
    aba.on('pageerror', (error) => {
      if (pageErrors.length < 5) pageErrors.push(String(error?.message || error).slice(0, 300));
    });

    await preparar(aba);
    await aba.setViewport({ width: 1440, height: 1200 });
    await aba.goto(ranking.url, { waitUntil: 'domcontentloaded', timeout: 24000 });
    await aba.waitForSelector('article', { timeout: 16000 }).catch(() => null);

    // A grade principal fica abaixo de vitrines personalizadas e pode ser
    // hidratada apenas depois do scroll. A coleta progride ate encontra-la,
    // sem depender de um unico waitForFunction suscetivel a timeout.
    await aba.evaluate(async (limit) => {
      const countMainGridCards = () => [...document.querySelectorAll('article[data-testid^="product-card-"]')]
        .filter((card) => [...card.querySelectorAll('a[href*="/p/"]')]
          .some((link) => /listTitle=category(?:\+|%20)page/i.test(link.getAttribute('href') || '')))
        .length;

      for (let attempt = 0; attempt < 16 && countMainGridCards() < limit; attempt += 1) {
        const progress = Math.min(1, (attempt + 1) / 8);
        window.scrollTo(0, Math.max(window.innerHeight, document.body.scrollHeight * progress));
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
    }, ranking.limit);

    const products = await aba.$$eval('article[data-testid^="product-card-"]', (cards, source) => cards
      .map((card) => {
        const productLink = [...card.querySelectorAll('a[href*="/p/"]')]
          .find((link) => /listTitle=category(?:\+|%20)page/i.test(link.getAttribute('href') || ''));
        if (!productLink) return null;

        const reference = (card.getAttribute('data-testid') || '').replace('product-card-', '');
        const title = card.querySelector('[data-testid="product-card-title"]')?.textContent?.trim();
        const brand = card.querySelector('h3[aria-label^="Marca "]')?.textContent?.trim();
        const image = card.querySelector('img');
        const normal = card.querySelector('#product-price-de')?.textContent?.trim();
        const promo = card.querySelector('#product-price-por')?.textContent?.trim()
          || card.querySelector('[data-testid="product-card-price"]')?.textContent?.trim();
        const actionText = card.querySelector('button')?.textContent?.trim().toLowerCase() || '';
        const sourceUrl = new URL(productLink.getAttribute('href'), location.origin);
        sourceUrl.searchParams.delete('position');
        sourceUrl.searchParams.delete('listTitle');

        return {
          reference,
          name: title,
          brand,
          source_url: sourceUrl.href,
          image_url: image?.currentSrc || image?.getAttribute('src') || null,
          price_normal: normal || promo,
          price_promo: promo,
          available: actionText.includes('adicionar'),
        };
      })
      .filter(Boolean)
      .slice(0, source.limit)
      .map((product, index) => ({
        ...product,
        sources: [{ key: source.key, label: source.label, position: index + 1 }],
      })), { ...ranking, limit: context.limit });

    const diagnostic = await aba.evaluate(() => ({
      url: location.href,
      title: document.title,
      article_count: document.querySelectorAll('article').length,
      product_card_count: document.querySelectorAll('article[data-testid^="product-card-"]').length,
      product_link_count: document.querySelectorAll('a[href*="/p/"]').length,
      script_count: document.scripts.length,
      body_text: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 500),
      sample_product_links: [...document.querySelectorAll('a[href*="/p/"]')]
        .slice(0, 5)
        .map((link) => (link.getAttribute('href') || '').slice(0, 220)),
    }));

    diagnostic.failed_requests = failedRequests;
    diagnostic.api_responses = apiResponses;
    diagnostic.page_errors = pageErrors;

    return { products, diagnostic };
  };

  // A Natura compartilha estado de personalizacao entre abas. Coletar em
  // sequencia evita que duas hidratacoes concorrentes deixem ambas sem grade.
  const results = [await coletar(page, context.rankings[0])];
  const secondPage = await page.browser().newPage();
  results.push(await coletar(secondPage, context.rankings[1]));
  await secondPage.close();

  return {
    data: {
      rankings: results.map((result) => result.products),
      diagnostics: results.map((result) => result.diagnostic),
    },
    type: 'application/json',
  };
};
`;

export function priceToCents(value) {
    const text = String(value ?? '').replace(/\u00a0/g, ' ');
    const match = text.match(/(\d{1,3}(?:\.\d{3})*|\d+),([0-9]{2})/);

    if (!match) {
        throw new Error(`preço inválido recebido da Natura: ${text.slice(0, 80)}`);
    }

    return Number(match[1].replace(/\./g, '')) * 100 + Number(match[2]);
}

export function normalizeProduct(product) {
    if (!/^NATBRA-\d+$/.test(product?.reference ?? '') || !product?.name || !product?.source_url) {
        throw new Error('card da Natura sem referência, nome ou link de produto');
    }

    const pricePromoCents = priceToCents(product.price_promo);
    const priceNormalCents = Math.max(priceToCents(product.price_normal), pricePromoCents);

    return {
        reference: product.reference,
        name: product.name.trim(),
        source_url: product.source_url,
        image_url: product.image_url || null,
        price_normal_cents: priceNormalCents,
        price_promo_cents: pricePromoCents,
        available: Boolean(product.available),
        classification_terms: [product.brand].filter(Boolean),
        sources: product.sources,
    };
}

export function mergeRankings(rankings) {
    const products = new Map();

    for (const ranking of rankings) {
        for (const rawProduct of ranking.slice(0, 10)) {
            const product = normalizeProduct(rawProduct);
            const existing = products.get(product.reference);

            if (!existing) {
                products.set(product.reference, product);
                continue;
            }

            existing.sources = [...existing.sources, ...product.sources]
                .filter((source, index, all) => all.findIndex((item) => item.key === source.key) === index);
        }
    }

    return [...products.values()];
}

export async function collectCatalog() {
    const token = process.env.BROWSERLESS_TOKEN;

    if (!token) {
        throw new Error('BROWSERLESS_TOKEN não configurado');
    }

    const response = await fetch(`${BROWSERLESS_URL}/function?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            code: BROWSERLESS_CATALOG_FUNCTION,
            context: { rankings: RANKING_URLS, limit: 10 },
        }),
        signal: AbortSignal.timeout(BROWSERLESS_TIMEOUT),
    });

    if (!response.ok) {
        const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
        throw new Error(`Browserless respondeu HTTP ${response.status}: ${detail}`);
    }

    const json = await response.json();
    const rankings = json?.data?.rankings ?? json?.rankings;
    const diagnostics = json?.data?.diagnostics ?? json?.diagnostics ?? [];

    if (!Array.isArray(rankings) || rankings.length !== 2) {
        throw new Error('Browserless não devolveu os dois rankings esperados');
    }

    const products = mergeRankings(rankings);

    if (products.length === 0 || products.length > 20) {
        const compactDiagnostics = diagnostics.map((diagnostic) => ({
            url: diagnostic.url,
            title: diagnostic.title,
            product_card_count: diagnostic.product_card_count,
            product_link_count: diagnostic.product_link_count,
            page_errors: diagnostic.page_errors,
            api_responses: diagnostic.api_responses,
            failed_requests: diagnostic.failed_requests,
            body_text: diagnostic.body_text,
        }));
        const detail = JSON.stringify(compactDiagnostics).slice(0, 5000);
        throw new Error(`quantidade inesperada de produtos coletados: ${products.length}; diagnóstico: ${detail}`);
    }

    return products;
}

export function createSignedRequest(payload, secret, now = Date.now()) {
    if (typeof secret !== 'string' || secret.length < 32) {
        throw new Error('AUTOMATION_INGESTION_SECRET deve ter pelo menos 32 caracteres');
    }

    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(now / 1000));
    const digest = createHash('sha256').update(body).digest('hex');
    const day = new Date(now).toISOString().slice(0, 10);
    const idempotencyKey = `daily:${day}:${digest.slice(0, 20)}`;
    const signature = createHmac('sha256', secret)
        .update(`${timestamp}.${idempotencyKey}.${body}`)
        .digest('hex');

    return {
        body,
        headers: {
            'Content-Type': 'application/json',
            'X-Automation-Timestamp': timestamp,
            'X-Automation-Idempotency-Key': idempotencyKey,
            'X-Automation-Signature': `sha256=${signature}`,
        },
    };
}

export async function submitToLaravel(products, now = Date.now()) {
    const endpoint = process.env.AUTOMATION_INGESTION_URL;
    const secret = process.env.AUTOMATION_INGESTION_SECRET;

    if (!endpoint) {
        throw new Error('AUTOMATION_INGESTION_URL não configurada');
    }

    const payload = {
        source: 'vercel_daily',
        collected_at: new Date(now).toISOString(),
        products,
    };
    const signed = createSignedRequest(payload, secret, now);
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: signed.headers,
        body: signed.body,
        signal: AbortSignal.timeout(INGESTION_TIMEOUT),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(`HostGator respondeu HTTP ${response.status}: ${result.message ?? 'sem detalhes'}`);
    }

    return result;
}

export async function runCatalogSync({ dryRun = false, now = Date.now() } = {}) {
    const products = await collectCatalog();

    if (dryRun) {
        return { dry_run: true, found: products.length, products };
    }

    return {
        dry_run: false,
        found: products.length,
        ingestion: await submitToLaravel(products, now),
    };
}
