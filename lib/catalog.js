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
const SHORTENER_TIMEOUT = 7000;
const PRODUCT_DETAIL_TIMEOUT = 8000;
const NATURA_REFERENCE_SEARCH_URL = process.env.NATURA_REFERENCE_SEARCH_URL
    ?? 'https://www.minhaloja.natura.com/s/produtos?consultoria=helium&marca=natura';
const NATURA_SHORTENER_URL = process.env.NATURA_SHORTENER_URL
    ?? 'https://ncf-apigw.prd.naturacloud.com/url-shortener/links';
const NATURA_SHORT_URL_PATTERN = /^https:\/\/sminhaloja\.natura\.com\/[A-Za-z0-9_-]+\/?$/;

// Executada dentro de uma unica sessao Browserless. As duas paginas abrem em
// sequencia para preservar os rankings e consumir uma sessao, nao duas.
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
        const cardText = (card.textContent || '').replace(/\s+/g, ' ').toLowerCase();
        const availabilityStatus = cardText.includes('acabou, mas volta logo')
          ? 'back_soon'
          : (cardText.includes('produto esgotado') || cardText.includes('esgotado')
            ? 'sold_out'
            : (actionText.includes('adicionar') ? 'available' : 'unavailable'));
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
          available: availabilityStatus === 'available',
          availability_status: availabilityStatus,
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

// Coleta uma pagina configurada pelo painel. A propria pagina compara cada
// card com o retrato do catalogo recebido da HostGator; assim, itens iguais
// nao gastam a cota e o scroll continua ate completar alteracoes uteis.
export const BROWSERLESS_SOURCE_FUNCTION = String.raw`
export default async ({ page, context }) => {
  const source = context.source;
  const known = context.known || { products: {}, observations: {}, blocked: [] };
  const blocked = new Set(known.blocked || []);
  const maxAll = Math.max(1, Math.min(Number(context.max_all || 200), 200));
  const deadline = Date.now() + 44000;

  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (['font', 'media'].includes(request.resourceType())) request.abort();
    else request.continue();
  });
  await page.setViewport({ width: 1440, height: 1200 });
  await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 24000 });
  await page.waitForSelector('article[data-testid^="product-card-"]', { timeout: 16000 });

  const result = await page.evaluate(async ({ source, known, blockedValues, maxAll, deadline }) => {
    const blocked = new Set(blockedValues);
    const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const priceToCents = (value) => {
      const text = String(value || '').replace(/\u00a0/g, ' ');
      const match = text.match(/(\d{1,3}(?:\.\d{3})*|\d+),([0-9]{2})/);
      return match ? Number(match[1].replace(/\./g, '')) * 100 + Number(match[2]) : null;
    };
    const extract = () => {
      const cards = [...document.querySelectorAll('article[data-testid^="product-card-"]')];
      const mainGridCards = cards.filter((card) => [...card.querySelectorAll('a[href*="/p/"]')]
        .some((link) => /listTitle=category(?:\+|%20)page/i.test(link.getAttribute('href') || '')));
      const selectedCards = mainGridCards.length > 0 ? mainGridCards : cards;

      return selectedCards.map((card, index) => {
        const productLink = [...card.querySelectorAll('a[href*="/p/"]')]
          .find((link) => /listTitle=category(?:\+|%20)page/i.test(link.getAttribute('href') || ''))
          || card.querySelector('a[href*="/p/"]');
        if (!productLink) return null;

        const reference = (card.getAttribute('data-testid') || '').replace('product-card-', '').toUpperCase();
        const title = card.querySelector('[data-testid="product-card-title"]')?.textContent?.trim();
        const brand = card.querySelector('h3[aria-label^="Marca "]')?.textContent?.trim();
        const image = card.querySelector('img');
        const normalText = card.querySelector('#product-price-de')?.textContent?.trim();
        const promoText = card.querySelector('#product-price-por')?.textContent?.trim()
          || card.querySelector('[data-testid="product-card-price"]')?.textContent?.trim();
        const promo = priceToCents(promoText);
        const normal = Math.max(priceToCents(normalText || promoText) || 0, promo || 0);
        const actionText = [...card.querySelectorAll('button')].map((button) => button.textContent || '').join(' ').toLowerCase();
        const cardText = (card.textContent || '').replace(/\s+/g, ' ').toLowerCase();
        const availabilityStatus = cardText.includes('acabou, mas volta logo')
          ? 'back_soon'
          : (cardText.includes('produto esgotado') || cardText.includes('esgotado')
            ? 'sold_out'
            : (actionText.includes('adicionar') ? 'available' : 'unavailable'));
        const available = availabilityStatus === 'available';
        const sourceUrl = new URL(productLink.getAttribute('href'), location.origin);
        sourceUrl.searchParams.delete('position');
        sourceUrl.searchParams.delete('listTitle');

        if (!/^NATBRA-\d+$/.test(reference) || !title || !promo || !normal) return null;

        return {
          reference,
          name: title,
          brand,
          source_url: sourceUrl.href,
          image_url: image?.currentSrc || image?.getAttribute('src') || null,
          price_normal_cents: normal,
          price_promo_cents: promo,
          available,
          availability_status: availabilityStatus,
          position: index + 1,
        };
      })
      .filter(Boolean)
      .filter((product, index, all) => all.findIndex((item) => item.reference === product.reference) === index);
    };

    const useful = (products) => products.filter((product) => {
      if (blocked.has(product.reference)) return false;
      const priceFingerprint = product.price_normal_cents + ':' + product.price_promo_cents;
      const observation = priceFingerprint + ':' + product.availability_status;
      if (known.products?.[product.reference] === priceFingerprint) return false;
      if ((known.observations?.[product.reference] || []).includes(observation)) return false;
      return true;
    });

    let attempts = 0;
    let stagnant = 0;
    let previousCount = 0;
    let exhausted = false;
    let truncated = false;

    while (Date.now() < deadline && attempts < 60) {
      const products = extract();
      const candidates = useful(products);

      if (!source.analyze_all && candidates.length >= source.product_limit) break;
      if (source.analyze_all && candidates.length >= maxAll) {
        truncated = true;
        break;
      }

      const moreButton = [...document.querySelectorAll('button')]
        .find((button) => /carregar mais resultados/i.test(button.textContent || '') && !button.disabled);
      if (moreButton) moreButton.click();
      else window.scrollTo(0, document.body.scrollHeight);

      await sleep(850);
      const currentCount = extract().length;
      stagnant = currentCount > previousCount ? 0 : stagnant + 1;
      previousCount = currentCount;
      attempts += 1;

      if (stagnant >= 4 && !moreButton) {
        exhausted = true;
        break;
      }
    }

    const allProducts = extract();
    const candidates = useful(allProducts);
    const selected = candidates.slice(0, source.analyze_all ? maxAll : source.product_limit);

    if (source.analyze_all && candidates.length > selected.length) truncated = true;
    if (!exhausted && (Date.now() >= deadline || attempts >= 60)
      && (source.analyze_all || candidates.length < source.product_limit)) truncated = true;

    return {
      products: selected.map((product) => ({
        ...product,
        classification_terms: [product.brand].filter(Boolean),
        sources: [{ key: 'source_' + source.id, label: source.name, position: product.position }],
      })),
      collection: {
        scanned: allProducts.length,
        useful_found: candidates.length,
        requested: source.analyze_all ? null : source.product_limit,
        analyze_all: Boolean(source.analyze_all),
        exhausted,
        truncated,
      },
    };
  }, { source, known, blockedValues: [...blocked], maxAll, deadline });

  return { data: result, type: 'application/json' };
};
`;

// Pesquisa referencias exatas na busca da Natura. As abas trabalham em
// paralelo dentro de uma unica sessao Browserless para que uma lista nao
// custe uma sessao separada por NATBRA.
export const BROWSERLESS_REFERENCE_FUNCTION = String.raw`
export default async ({ page, context }) => {
  const queue = [...context.references].map((reference, index) => ({ reference, index }));
  const products = [];
  const missing = [];

  const prepare = async (tab) => {
    await tab.setRequestInterception(true);
    tab.on('request', (request) => {
      if (['font', 'media'].includes(request.resourceType())) request.abort();
      else request.continue();
    });
    await tab.setViewport({ width: 1280, height: 900 });
  };

  const collectOne = async (tab, job) => {
    const searchUrl = new URL(context.search_url);
    searchUrl.searchParams.set('busca', job.reference);

    try {
      await tab.goto(searchUrl.href, { waitUntil: 'domcontentloaded', timeout: 22000 });
      await tab.waitForFunction((reference) => {
        const exact = document.querySelector('article[data-testid="product-card-' + reference + '"]');
        const noResults = /nenhum produto|nenhum resultado|n.o encontramos/i.test(document.body?.innerText || '');
        return Boolean(exact || noResults);
      }, { timeout: 14000 }, job.reference).catch(() => null);

      const product = await tab.evaluate((reference) => {
        const priceToCents = (value) => {
          const text = String(value || '').replace(/\u00a0/g, ' ');
          const match = text.match(/(\d{1,3}(?:\.\d{3})*|\d+),([0-9]{2})/);
          return match ? Number(match[1].replace(/\./g, '')) * 100 + Number(match[2]) : null;
        };
        const card = document.querySelector('article[data-testid="product-card-' + reference + '"]')
          || [...document.querySelectorAll('article[data-testid^="product-card-"]')]
            .find((item) => (item.getAttribute('data-testid') || '').toUpperCase().endsWith(reference));

        if (!card) return null;

        const productLink = card.querySelector('a[href*="/p/"]');
        const title = card.querySelector('[data-testid="product-card-title"]')?.textContent?.trim();
        const brand = card.querySelector('h3[aria-label^="Marca "]')?.textContent?.trim();
        const image = card.querySelector('img');
        const normalText = card.querySelector('#product-price-de')?.textContent?.trim();
        const promoText = card.querySelector('#product-price-por')?.textContent?.trim()
          || card.querySelector('[data-testid="product-card-price"]')?.textContent?.trim();
        const promo = priceToCents(promoText);
        const normal = Math.max(priceToCents(normalText || promoText) || 0, promo || 0);
        const actionText = [...card.querySelectorAll('button')].map((button) => button.textContent || '').join(' ').toLowerCase();
        const cardText = (card.textContent || '').replace(/\s+/g, ' ').toLowerCase();
        const availabilityStatus = cardText.includes('acabou, mas volta logo')
          ? 'back_soon'
          : (cardText.includes('produto esgotado') || cardText.includes('esgotado')
            ? 'sold_out'
            : (actionText.includes('adicionar') ? 'available' : 'unavailable'));

        if (!productLink || !title || !promo || !normal) return null;

        const sourceUrl = new URL(productLink.getAttribute('href'), location.origin);
        sourceUrl.searchParams.delete('position');
        sourceUrl.searchParams.delete('listTitle');
        sourceUrl.searchParams.set('consultoria', 'helium');
        sourceUrl.searchParams.set('marca', 'natura');
        const imageUrl = image?.currentSrc || image?.getAttribute('src') || null;

        return {
          reference,
          name: title,
          source_url: sourceUrl.href,
          image_url: imageUrl ? new URL(imageUrl, location.origin).href : null,
          price_normal_cents: normal,
          price_promo_cents: promo,
          available: availabilityStatus === 'available',
          availability_status: availabilityStatus,
          classification_terms: [brand].filter(Boolean),
          sources: [{ key: 'manual_references', label: 'Busca por referências', position: 1 }],
        };
      }, job.reference);

      if (product) products.push({ ...product, requested_position: job.index + 1 });
      else missing.push({ reference: job.reference, reason: 'Referência não encontrada na busca da Natura.' });
    } catch (error) {
      missing.push({ reference: job.reference, reason: String(error?.message || 'Falha na pesquisa').slice(0, 220) });
    }
  };

  const tabCount = Math.min(4, queue.length);
  const tabs = [page];
  for (let index = 1; index < tabCount; index += 1) tabs.push(await page.browser().newPage());
  await Promise.all(tabs.map(async (tab) => {
    await prepare(tab);
    while (queue.length > 0) {
      const job = queue.shift();
      await collectOne(tab, job);
    }
  }));
  await Promise.all(tabs.slice(1).map((tab) => tab.close()));

  products.sort((left, right) => left.requested_position - right.requested_position);
  missing.sort((left, right) => context.references.indexOf(left.reference) - context.references.indexOf(right.reference));

  return { data: { products, missing }, type: 'application/json' };
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

export function normalizeAvailabilityStatus(status, available) {
    const normalized = String(status ?? '').trim().toLowerCase();

    return ['available', 'sold_out', 'back_soon', 'unavailable'].includes(normalized)
        ? normalized
        : (available ? 'available' : 'unavailable');
}

export function normalizeReferenceList(values) {
    if (!Array.isArray(values) || values.length === 0 || values.length > 30) {
        throw new Error('informe de 1 a 30 referências');
    }

    const references = values.map((value) => String(value ?? '').trim().toUpperCase());

    if (references.some((reference) => !/^NATBRA-\d+$/.test(reference))) {
        throw new Error('todas as referências devem seguir o formato NATBRA-123456');
    }

    return [...new Set(references)];
}

function productSchemaNode(value, reference) {
    const stack = Array.isArray(value) ? [...value] : [value];

    while (stack.length > 0) {
        const item = stack.shift();
        if (!item || typeof item !== 'object') continue;

        const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
        const sku = String(item.sku ?? item.productID ?? '').trim().toUpperCase();

        if (types.includes('Product') && sku === reference && typeof item.name === 'string') {
            return item;
        }

        if (Array.isArray(item['@graph'])) stack.push(...item['@graph']);
    }

    return null;
}

export function extractProductNameFromHtml(html, reference) {
    const expectedReference = String(reference ?? '').trim().toUpperCase();
    const scripts = String(html ?? '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi);

    for (const script of scripts) {
        if (!/type\s*=\s*["']application\/ld\+json["']/i.test(script[1])) continue;

        try {
            const schema = JSON.parse(script[2]);
            const product = productSchemaNode(schema, expectedReference);
            const name = String(product?.name ?? '').replace(/\s+/g, ' ').trim();

            if (name.length > 0 && name.length <= 255) return name;
        } catch {
            // Outras tags JSON-LD da pagina podem estar incompletas. O parser
            // continua ate encontrar o schema Product com o NATBRA esperado.
        }
    }

    return null;
}

export async function fetchOfficialProductName(product, fetcher = fetch) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            const response = await fetcher(product.source_url, {
                headers: {
                    Accept: 'text/html,application/xhtml+xml',
                    'User-Agent': 'Mozilla/5.0 (compatible; NaturaCatalogAutomation/1.0)',
                },
                redirect: 'follow',
                signal: AbortSignal.timeout(PRODUCT_DETAIL_TIMEOUT),
            });

            if (response.ok) {
                const name = extractProductNameFromHtml(await response.text(), product.reference);
                if (name) return name;
            }
        } catch {
            // Mantem o nome do card como fallback; a coleta nao deve falhar
            // inteira por uma pagina individual temporariamente indisponivel.
        }

        if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return product.name;
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
        availability_status: normalizeAvailabilityStatus(product.availability_status, product.available),
        classification_terms: [product.brand].filter(Boolean),
        sources: product.sources,
    };
}

export function normalizeSourceProduct(product) {
    if (!/^NATBRA-\d+$/.test(product?.reference ?? '') || !product?.name || !product?.source_url) {
        throw new Error('card da Natura sem referência, nome ou link de produto');
    }

    const pricePromoCents = Number(product.price_promo_cents);
    const priceNormalCents = Number(product.price_normal_cents);

    if (!Number.isInteger(pricePromoCents) || !Number.isInteger(priceNormalCents)
        || pricePromoCents <= 0 || priceNormalCents < pricePromoCents) {
        throw new Error(`preços inválidos para ${product.reference}`);
    }

    return {
        reference: product.reference,
        name: product.name.trim(),
        source_url: product.source_url,
        image_url: product.image_url || null,
        price_normal_cents: priceNormalCents,
        price_promo_cents: pricePromoCents,
        available: Boolean(product.available),
        availability_status: normalizeAvailabilityStatus(product.availability_status, product.available),
        classification_terms: Array.isArray(product.classification_terms) ? product.classification_terms.slice(0, 10) : [],
        sources: product.sources,
    };
}

export function isUsefulProduct(product, known = {}) {
    if ((known.blocked ?? []).includes(product.reference)) return false;
    const prices = `${product.price_normal_cents}:${product.price_promo_cents}`;
    const observation = `${prices}:${normalizeAvailabilityStatus(product.availability_status, product.available)}`;
    if (known.products?.[product.reference] === prices) return false;
    return !(known.observations?.[product.reference] ?? []).includes(observation);
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

export function isValidNaturaShortUrl(value) {
    return NATURA_SHORT_URL_PATTERN.test(String(value ?? '').trim());
}

export async function shortenProductUrl(product, fetcher = fetch) {
    const apiKey = process.env.NATURA_SHORTENER_API_KEY;
    const bearer = process.env.NATURA_SHORTENER_BEARER;

    if (!apiKey || !bearer) {
        throw new Error('credenciais do encurtador oficial da Natura não configuradas');
    }

    let lastError = 'resposta sem link curto válido';

    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            const response = await fetcher(NATURA_SHORTENER_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Api-Key': apiKey,
                    Authorization: `Bearer ${bearer}`,
                },
                body: JSON.stringify({ url: product.source_url, domain: 1 }),
                signal: AbortSignal.timeout(SHORTENER_TIMEOUT),
            });
            const result = await response.json().catch(() => ({}));
            const shortUrl = String(result?.short ?? '').trim();
            const originalReference = String(result?.original ?? '').match(/NATBRA-\d+/i)?.[0]?.toUpperCase();

            if (response.ok && isValidNaturaShortUrl(shortUrl) && originalReference === product.reference) {
                return shortUrl;
            }

            lastError = `HTTP ${response.status}, link ou referência inválida`;
        } catch (error) {
            lastError = error?.message ?? 'falha desconhecida';
        }

        if (attempt === 1) {
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    }

    throw new Error(`não foi possível gerar link curto para ${product.reference}: ${lastError}`);
}

export async function attachShortLinks(products, workerCount = 4) {
    const queue = [...products];
    const completed = [];
    const workers = Array.from({ length: Math.min(workerCount, queue.length) }, async () => {
        while (queue.length > 0) {
            const product = queue.shift();
            completed.push({
                ...product,
                product_url: await shortenProductUrl(product),
            });
        }
    });

    await Promise.all(workers);

    const byReference = new Map(completed.map((product) => [product.reference, product]));
    return products.map((product) => byReference.get(product.reference));
}

export async function attachOfficialProductData(products, workerCount = 8) {
    const queue = [...products];
    const completed = [];
    const workers = Array.from({ length: Math.min(workerCount, queue.length) }, async () => {
        while (queue.length > 0) {
            const product = queue.shift();
            const [name, productUrl] = await Promise.all([
                fetchOfficialProductName(product),
                shortenProductUrl(product),
            ]);
            completed.push({ ...product, name, product_url: productUrl });
        }
    });

    await Promise.all(workers);

    const byReference = new Map(completed.map((product) => [product.reference, product]));
    return products.map((product) => byReference.get(product.reference));
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

export async function collectSource(source, known = {}) {
    const token = process.env.BROWSERLESS_TOKEN;

    if (!token) throw new Error('BROWSERLESS_TOKEN não configurado');

    const response = await fetch(`${BROWSERLESS_URL}/function?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            code: BROWSERLESS_SOURCE_FUNCTION,
            context: { source, known, max_all: 200 },
        }),
        signal: AbortSignal.timeout(BROWSERLESS_TIMEOUT),
    });

    if (!response.ok) {
        const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500);
        throw new Error(`Browserless respondeu HTTP ${response.status}: ${detail}`);
    }

    const json = await response.json();
    const data = json?.data ?? json;
    const rawProducts = data?.products;

    if (!Array.isArray(rawProducts) || !data?.collection) {
        throw new Error('Browserless não devolveu uma coleta válida para a página');
    }

    return {
        products: rawProducts.map(normalizeSourceProduct),
        collection: data.collection,
    };
}

export async function collectReferences(values) {
    const token = process.env.BROWSERLESS_TOKEN;
    const references = normalizeReferenceList(values);

    if (!token) throw new Error('BROWSERLESS_TOKEN não configurado');

    const response = await fetch(`${BROWSERLESS_URL}/function?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            code: BROWSERLESS_REFERENCE_FUNCTION,
            context: { references, search_url: NATURA_REFERENCE_SEARCH_URL },
        }),
        signal: AbortSignal.timeout(BROWSERLESS_TIMEOUT),
    });

    if (!response.ok) {
        const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500);
        throw new Error(`Browserless respondeu HTTP ${response.status}: ${detail}`);
    }

    const json = await response.json();
    const data = json?.data ?? json;

    if (!Array.isArray(data?.products) || !Array.isArray(data?.missing)) {
        throw new Error('Browserless não devolveu uma pesquisa válida por referências');
    }

    return {
        products: data.products.map(normalizeSourceProduct),
        missing: data.missing,
    };
}

export async function lookupReferences(values) {
    const collected = await collectReferences(values);
    const queue = [...collected.products];
    const products = [];
    const warnings = [];
    const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
        while (queue.length > 0) {
            const product = queue.shift();
            const name = await fetchOfficialProductName(product);
            let productUrl = null;

            try {
                productUrl = await shortenProductUrl(product);
            } catch (error) {
                warnings.push({
                    reference: product.reference,
                    reason: error?.message ?? 'Não foi possível gerar o link curto.',
                });
            }

            products.push({ ...product, name, product_url: productUrl });
        }
    });

    await Promise.all(workers);
    const order = normalizeReferenceList(values);
    products.sort((left, right) => order.indexOf(left.reference) - order.indexOf(right.reference));

    return { products, missing: collected.missing, warnings };
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

export async function submitToLaravel(products, now = Date.now(), options = {}) {
    const endpoint = process.env.AUTOMATION_INGESTION_URL;
    const secret = process.env.AUTOMATION_INGESTION_SECRET;

    if (!endpoint) {
        throw new Error('AUTOMATION_INGESTION_URL não configurada');
    }

    const payload = {
        source: options.source ?? 'vercel_daily',
        ...(options.automationSourceId ? { automation_source_id: options.automationSourceId } : {}),
        collected_at: new Date(now).toISOString(),
        ...(options.collection ? { collection: options.collection } : {}),
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

export async function runSourceSync({ source, known = {}, now = Date.now() }) {
    const collected = await collectSource(source, known);

    if (collected.products.length === 0) {
        return {
            found: 0,
            collection: collected.collection,
            ingestion: { created: 0, updated: 0, unchanged: 0, unavailable: 0 },
        };
    }

    const products = await attachOfficialProductData(collected.products);
    const ingestion = await submitToLaravel(products, now, {
        source: `automation_source:${source.id}`,
        automationSourceId: source.id,
        collection: collected.collection,
    });

    return {
        found: products.length,
        collection: collected.collection,
        ingestion,
    };
}

export async function runCatalogSync({ dryRun = false, now = Date.now() } = {}) {
    const products = await attachOfficialProductData(await collectCatalog());

    if (dryRun) {
        return { dry_run: true, found: products.length, products };
    }

    return {
        dry_run: false,
        found: products.length,
        ingestion: await submitToLaravel(products, now),
    };
}
