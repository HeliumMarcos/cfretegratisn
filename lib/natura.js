const STORE_URL = process.env.NATURA_STORE_URL
    ?? 'https://www.minhaloja.natura.com/c/promocoes?consultoria=helium&marca=natura';

const BROWSERLESS_URL = (process.env.BROWSERLESS_URL ?? 'https://chrome.browserless.io')
    .replace(/\/+$/, '');

// O host legado (chrome.browserless.io) usa `waitFor`; os hosts regionais mais novos
// (production-sfo.browserless.io e afins) usam `waitForSelector`.
const API_VERSION = process.env.BROWSERLESS_API_VERSION ?? 'v1';

export const SELETOR = '[data-testid="box-info"]';

const GOTO_TIMEOUT = 20000;
const SELETOR_TIMEOUT = 8000;

// Busca o innerText de cada elemento `box-info` da vitrine, via API REST do Browserless.
export async function buscarTextosBoxInfo() {
    const token = process.env.BROWSERLESS_TOKEN;
    if (!token) {
        throw new Error('variável de ambiente BROWSERLESS_TOKEN não configurada');
    }

    const body = {
        url: STORE_URL,
        elements: [{ selector: SELETOR }],
        gotoOptions: { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT }
    };

    if (API_VERSION === 'v2') {
        body.waitForSelector = { selector: SELETOR, timeout: SELETOR_TIMEOUT };
    } else {
        body.waitFor = SELETOR;
    }

    const resposta = await fetch(`${BROWSERLESS_URL}/scrape?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!resposta.ok) {
        const detalhe = (await resposta.text().catch(() => '')).slice(0, 300);
        throw new Error(`Browserless respondeu ${resposta.status}: ${detalhe}`);
    }

    const json = await resposta.json();
    const resultados = json?.data?.[0]?.results ?? [];

    return resultados
        .map(resultado => resultado?.text ?? '')
        .filter(texto => texto.length > 0);
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
