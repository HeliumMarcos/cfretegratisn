import { decodificar, lerLimiarProduto, buscarTextosBoxInfo, extrairDeHtml } from './natura.js';

const ORIGIN = 'https://www.minhaloja.natura.com';
const MONEY = String.raw`(\d+(?:\.\d{3})*(?:,\d{2})?)`;
const FREIGHT = /frete\s+gr[áa]tis|entrega\s+gr[áa]tis|frete|shipping/i;

function clean(value) {
    let text = String(value ?? '');
    try { text = decodeURIComponent(text); } catch { /* HTML não codificado em URL. */ }
    return decodificar(text).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ').trim();
}

// Lê JSON, nunca executa os scripts da loja. Next pode transmitir o CMS dentro de
// strings em self.__next_f.push(), em vez de um único application/json.
export function pageObjects(html) {
    const objects = [];
    const scan = (text) => {
        let start = -1, depth = 0, quoted = false, escaped = false;
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (start < 0) { if (char === '{') { start = i; depth = 1; } continue; }
            if (quoted) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') quoted = false;
            } else if (char === '"') quoted = true;
            else if (char === '{') depth++;
            else if (char === '}' && --depth === 0) {
                try { objects.push(JSON.parse(text.slice(start, i + 1))); } catch { /* Outro script. */ }
                start = -1;
            }
        }
    };
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
        const script = match[1];
        scan(script);
        for (const push of script.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)\s*;?/g)) {
            try {
                for (const part of JSON.parse(push[1])) if (typeof part === 'string') scan(part);
            } catch { /* Fragmento incompleto: não inventar regulamento. */ }
        }
    }
    return objects;
}

export function safePage(value, consultant = 'helium') {
    try {
        const url = new URL(value, ORIGIN);
        if (url.origin !== ORIGIN || url.username || url.password || !/^\/(?:$|c\/[^/]+\/?$|consultoria\/[^/]+\/?$)/.test(url.pathname)) return null;
        const result = new URL(url.pathname, ORIGIN);
        for (const key of ['sort', 'pageSize']) if (url.searchParams.has(key)) result.searchParams.set(key, url.searchParams.get(key));
        result.searchParams.set('consultoria', consultant);
        result.searchParams.set('marca', 'natura');
        return result.href;
    } catch { return null; }
}

function isoDate(value) {
    if (!value) return null;
    const [day, month, year] = value.split('/');
    const iso = `${year}-${month}-${day}`;
    const date = new Date(`${iso}T12:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export function campaignFromTerms(terms, context, sourceUrl) {
    const conditions = clean(terms);
    // O mínimo deve pertencer ao regulamento, não a um preço de produto próximo.
    // Contexto fica restrito ao próprio banner, não ao HTML inteiro da vitrine.
    if (!FREIGHT.test(clean(context)) || /\bavon\b/i.test(clean(context) + ' ' + conditions)) return null;
    const amounts = [...conditions.matchAll(new RegExp(String.raw`(?:compras|pedidos)\s+(acima\s+de|a\s+partir\s+de|a\s+partir)\s+R\$\s*${MONEY}`, 'gi'))];
    const direct = conditions.match(new RegExp(String.raw`frete\s+gr[áa]tis(?:\s+Natura)?\s+(acima\s+de|a\s+partir\s+de)\s+R\$\s*${MONEY}`, 'i'));
    if (direct) amounts.push(direct);
    const values = [...new Set(amounts.map(m => Number(m[2].replace(/\./g, '').replace(',', '.'))))];
    if (values.length !== 1 || values[0] <= 0 || values[0] > 5000) return null;
    // Não associar o mínimo de um cupom a um selo genérico de frete grátis.
    if (!direct && /\b(?:cupom|cashback|desconto\s+de|ganhe|brinde)\b/i.test(conditions)) return null;
    const end = conditions.match(/(?:v[áa]lid[ao]|vigente)(?:s)?\s+at[ée]\s+(\d{2}\/\d{2}\/\d{4})/i)
        ?? conditions.match(/(?:a|at[ée])\s+(\d{2}\/\d{2}\/\d{4})/i);
    const start = conditions.match(/(?:de|a\s+partir\s+de)\s+(\d{2}\/\d{2}\/\d{4})\s+(?:a|at[ée])/i);
    const delivery = /exceto\s+(?:a\s+)?entrega\s+expressa|entrega\s+(?:normal|padr[ãa]o)/i.test(conditions) ? 'standard' : 'unspecified';
    return {
        kind: 'campaign', label: 'Campanha de frete — conferir condições', value: values[0],
        operator: /acima/i.test(amounts[0][1]) ? 'gt' : 'gte',
        source_url: sourceUrl, conditions: conditions.slice(0, 5000),
        starts_on: isoDate(start?.[1]), ends_on: isoDate(end?.[1]), delivery,
        consumer_only: /exclusiva\s+para\s+o\s+cliente\s+final|n[ãa]o\s+poder[ãa]o\s+participar\s+consultor/i.test(conditions),
        requires_review: true,
    };
}

export function inspectPage(html, sourceUrl, consultant = 'helium') {
    const campaigns = [], links = new Map();
    const addLink = (value, priority) => {
        const url = safePage(value, consultant);
        if (url && url !== sourceUrl) links.set(url, Math.max(priority, links.get(url) ?? 0));
    };
    const visit = (node, parent = null, inBanner = false) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(child => visit(child, parent, inBanner)); return; }
        const isBanner = inBanner || Object.keys(node).some(k => /banner|boxinfo/i.test(k)) || /banner|boxinfo/i.test(node.entity ?? '');
        if (typeof node.contentConditions === 'string') {
            const context = JSON.stringify({ title: node.title, subtitle: node.subtitle, image: node.image, conditions: node.conditions, terms: node.contentConditions });
            const campaign = campaignFromTerms(node.contentConditions, context, sourceUrl);
            if (campaign) campaigns.push(campaign);
        }
        for (const [key, value] of Object.entries(node)) {
            if (typeof value === 'string' && /^(?:url|href|link)$/i.test(key)) {
                const context = JSON.stringify(parent ?? node);
                addLink(value, FREIGHT.test(clean(context)) ? 100 : isBanner ? 70 : 5);
            } else if (typeof value === 'object') visit(value, node, isBanner);
        }
    };
    pageObjects(html).forEach(root => visit(root));
    // Links renderizados também cobrem versões do CMS sem hidratação disponível.
    for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        const context = clean(match[0]);
        const banner = /<img\b|banner|box.info/i.test(match[0]);
        addLink(match[1].replace(/&amp;/g, '&'), FREIGHT.test(context) ? 95 : banner ? 65 : 5);
    }
    // Regulamentos em HTML tradicional: somente blocos curtos com contexto explícito.
    for (const match of html.matchAll(/<p\b[^>]*>([\s\S]{0,6000}?)<\/p>/gi)) {
        if (match[0].length > 6000 || !/frete\s+gr[áa]tis/i.test(clean(match[0]))) continue;
        const campaign = campaignFromTerms(match[0], match[0], sourceUrl);
        if (campaign) campaigns.push(campaign);
    }
    const unique = [...new Map(campaigns.map(c => [`${c.value}|${c.conditions}`, c])).values()];
    return { campaigns: unique, links: [...links].map(([url, priority]) => ({ url, priority })) };
}

async function readPage(url, deadline, fetcher) {
    // Redirecionamentos descobertos não podem sair do host público Natura.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(5000, deadline - Date.now())));
    try {
        for (let i = 0; i < 4; i++) {
            const response = await fetcher(url, {
                redirect: 'manual', signal: controller.signal,
                headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'text/html' },
            });
            if (response.status >= 300 && response.status < 400) {
                const next = new URL(response.headers.get('location'), url);
                const safe = safePage(next.href, new URL(url).searchParams.get('consultoria') ?? 'helium');
                if (!safe) throw new Error('Redirecionamento fora das páginas permitidas.');
                url = safe;
                continue;
            }
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('Resposta não é HTML.');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let html = '', bytes = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                bytes += value.length;
                if (bytes > 3_000_000) { await reader.cancel(); throw new Error('Página excedeu o limite de leitura.'); }
                html += decoder.decode(value, { stream: true });
            }
            html += decoder.decode();
            if (!/<html|<body|<script/i.test(html) || /<title>[^<]*(?:access denied|just a moment|captcha)/i.test(html)) throw new Error('Página indisponível ou bloqueada.');
            return { html, url };
        }
        throw new Error('Muitos redirecionamentos.');
    } finally { clearTimeout(timer); }
}

async function renderedReference(deadline) {
    if (!process.env.BROWSERLESS_TOKEN || deadline - Date.now() < 3500) return { ok: false };
    const response = await buscarTextosBoxInfo({ fast: true, limite: deadline });
    // Reutiliza a infraestrutura existente, mas não a regex genérica perto de preços.
    for (const text of response.textos) {
        const { valor } = extrairDeHtml(text);
        if (valor !== null) return { ok: true, valor, source_type: 'storefront',
            url: safePage(process.env.NATURA_STORE_URL ?? '/c/promocoes') };
    }
    return { ok: false };
}

export async function consultShipping({ fetcher = fetch, baseline = lerLimiarProduto, fallback = renderedReference, now = new Date(), extraPages = process.env.NATURA_SHIPPING_PAGES ?? '' } = {}) {
    const deadline = Date.now() + 23000;
    const consultant = new URL(process.env.NATURA_STORE_URL ?? `${ORIGIN}/?consultoria=helium`).searchParams.get('consultoria') ?? 'helium';
    const queue = [
        { url: safePage('/', consultant), priority: 110, depth: 0 },
        { url: safePage(process.env.NATURA_STORE_URL ?? '/c/promocoes', consultant), priority: 105, depth: 0 },
        ...extraPages.split(',').filter(Boolean).map(url => ({ url: safePage(url.trim(), consultant), priority: 90, depth: 0 })),
    ].filter(item => item.url);
    const seen = new Set(), checked = [], failed = [], campaigns = [];
    // O limiar do produto nunca encerra a pesquisa de campanhas antecipadamente.
    const standardPromise = baseline(deadline).catch(() => ({ ok: false }));
    while (queue.length && seen.size < 10 && Date.now() < deadline - 500) {
        queue.sort((a, b) => b.priority - a.priority);
        const batch = [];
        while (queue.length && batch.length < 3 && seen.size < 10) {
            const item = queue.shift();
            if (seen.has(item.url)) continue;
            seen.add(item.url); batch.push(item);
        }
        await Promise.all(batch.map(async item => {
            try {
                const page = await readPage(item.url, deadline, fetcher);
                const result = inspectPage(page.html, page.url, consultant);
                checked.push(page.url); campaigns.push(...result.campaigns);
                if (item.depth < 2) queue.push(...result.links.filter(link => link.priority >= 65)
                    .map(link => ({ ...link, depth: item.depth + 1 })));
            } catch (error) { failed.push({ url: item.url, reason: error.name === 'AbortError' ? 'Tempo de consulta excedido.' : error.message }); }
        }));
    }
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
    const items = [...new Map(campaigns.map(c => [`${c.value}|${c.conditions}`, c])).values()]
        .map(c => ({ ...c, expired: !!c.ends_on && c.ends_on < today, upcoming: !!c.starts_on && c.starts_on > today }));
    let standard = await standardPromise;
    if (!standard.ok && Date.now() < deadline - 3500) {
        standard = await fallback(deadline).catch(() => ({ ok: false }));
    }
    if (standard.ok && standard.valor !== null) {
        const value = Number(String(standard.valor).replace(/\./g, '').replace(',', '.'));
        if (Number.isFinite(value) && value >= 20 && value <= 5000) items.push({
            kind: 'standard', label: standard.source_type === 'storefront' ? 'Referência da vitrine' : 'Referência da página de produto', value, operator: 'gte',
            source_type: standard.source_type ?? 'product',
            source_url: standard.url, conditions: 'Referência consultada na página de produto; campanhas e CEP podem alterar o frete na sacola.',
        });
    }
    const partial = failed.length > 0 || queue.some(item => !seen.has(item.url));
    return {
        schema_version: 2, status: items.length ? 'success' : checked.length ? 'not_found' : 'error',
        items, checked_at: now.toISOString(), discovery: { checked, failed, partial, limit: 10 },
        message: (partial ? 'Consulta limitada a até 10 páginas: há links adicionais ou fontes indisponíveis. ' : '')
            + 'Busca nos banners e páginas vinculadas à loja. Confira o regulamento e o frete na sacola para o CEP do cliente antes de importar. Campanhas só em imagem ou personalizadas podem não ser detectadas.',
    };
}
