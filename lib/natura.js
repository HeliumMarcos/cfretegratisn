const STORE_URL = process.env.NATURA_STORE_URL
    ?? 'https://www.minhaloja.natura.com/c/promocoes?consultoria=helium&marca=natura';

const BROWSERLESS_URL = (process.env.BROWSERLESS_URL ?? 'https://chrome.browserless.io')
    .replace(/\/+$/, '');

// A v2 espera `waitForSelector`; a v1 esperava `waitFor` e rejeita a chave nova com
// "must NOT have additional properties". Hoje chrome.browserless.io ja responde v2.
const API_VERSION = process.env.BROWSERLESS_API_VERSION ?? 'v2';

export const SELETOR = '[data-testid="box-info"]';

const GOTO_TIMEOUT = 20000;
const SELETOR_TIMEOUT = 8000;

// Modo rapido padrao das rotas. A pagina de status ignora isso quando recebe ?fast=.
export const FAST_PADRAO = process.env.BROWSERLESS_FAST === '1';

// Deliberadamente sem 'stylesheet': o texto que lemos e o renderizado, entao sem CSS
// elementos ocultos na pagina passariam a aparecer e mudariam o resultado.
const RECURSOS_BLOQUEADOS = ['image', 'font', 'media'];

function montarCorpo(fast) {
    const corpo = {
        url: STORE_URL,
        elements: [{ selector: SELETOR }],
        gotoOptions: { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT }
    };

    if (API_VERSION === 'v2') {
        corpo.waitForSelector = { selector: SELETOR, timeout: SELETOR_TIMEOUT };
    } else {
        corpo.waitFor = SELETOR;
    }

    if (fast) {
        corpo.rejectResourceTypes = RECURSOS_BLOQUEADOS;
    }

    return corpo;
}

async function enviar(corpo, token) {
    const resposta = await fetch(`${BROWSERLESS_URL}/scrape?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo)
    });

    if (resposta.ok) {
        return { ok: true, json: await resposta.json() };
    }

    const detalhe = (await resposta.text().catch(() => '')).slice(0, 300);
    return { ok: false, status: resposta.status, detalhe };
}

// Busca o texto de cada elemento `box-info` da vitrine, via API REST do Browserless.
// Devolve tambem se o modo rapido chegou a valer, porque ele pode cair sozinho.
export async function buscarTextosBoxInfo({ fast = FAST_PADRAO } = {}) {
    const token = process.env.BROWSERLESS_TOKEN;
    if (!token) {
        throw new Error('variável de ambiente BROWSERLESS_TOKEN não configurada');
    }

    let resultado = await enviar(montarCorpo(fast), token);
    let fastAplicado = fast;

    // O bloqueio de recursos e um extra: se o servidor nao aceitar a chave, repete sem
    // ela em vez de derrubar a rota.
    if (!resultado.ok && fast && resultado.status === 400) {
        fastAplicado = false;
        resultado = await enviar(montarCorpo(false), token);
    }

    if (!resultado.ok) {
        throw new Error(`Browserless (${API_VERSION}) respondeu ${resultado.status}: ${resultado.detalhe}`);
    }

    const textos = (resultado.json?.data?.[0]?.results ?? [])
        .map(item => item?.text ?? '')
        .filter(texto => texto.length > 0);

    return { textos, fastPedido: fast, fastAplicado };
}

export function normalizar(texto) {
    return texto.replace(/\s+/g, ' ').trim();
}

// Lê apenas o primeiro box-info, como fazia o $eval original.
export function extrairValor(textos) {
    const textoLimpo = normalizar(textos[0] ?? '');
    const match = textoLimpo.match(/frete gr[áa]tis Natura.*?R\$\s*(\d+(?:,\d{2})?)/i);

    return { valor: match ? match[1] : null, textoLimpo };
}

// Varre todos os box-info e monta uma linha por faixa de frete encontrada.
export function extrairLista(textos) {
    const resultados = [];

    for (const texto of textos) {
        const textoLimpo = normalizar(texto);

        if (!/frete/i.test(textoLimpo)) {
            continue;
        }

        // Grupo 1 captura o texto antes do R$ / Grupo 2 captura o valor numérico
        const regex = /frete gr[áa]tis\s+(.*?)\s*R\$\s*(\d+(?:,\d{2})?)/gi;
        let match;

        while ((match = regex.exec(textoLimpo)) !== null) {
            // Limpa preposições e termos genéricos para extrair apenas o nome da marca/categoria
            let especificacao = match[1]
                .replace(/acima de|a partir de|nas compras|em compras/gi, '')
                .trim();

            // Padronização: se a string ficar vazia, assume "Geral". Caso contrário, capitaliza a primeira letra.
            if (especificacao.length > 0) {
                especificacao = especificacao.charAt(0).toUpperCase() + especificacao.slice(1).toLowerCase();
            } else {
                especificacao = 'Geral';
            }

            const linha = `Frete Grátis de "${especificacao}" : ${match[2]}`;

            // Evita linhas duplicadas na saída
            if (!resultados.includes(linha)) {
                resultados.push(linha);
            }
        }
    }

    return resultados;
}
