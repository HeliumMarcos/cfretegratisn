const STORE_URL = process.env.NATURA_STORE_URL
    ?? 'https://www.minhaloja.natura.com/c/promocoes?consultoria=helium&marca=natura';

const BROWSERLESS_URL = (process.env.BROWSERLESS_URL ?? 'https://chrome.browserless.io')
    .replace(/\/+$/, '');

// A v2 espera `waitForSelector`; a v1 esperava `waitFor` e rejeita a chave nova com
// "must NOT have additional properties". Hoje chrome.browserless.io ja responde v2.
const API_VERSION = process.env.BROWSERLESS_API_VERSION ?? 'v2';

// Seletor historico da vitrine. Continua sendo o preferido: quando existe, e o bloco
// exato do banner e o resultado sai limpo, sem varrer a pagina inteira.
export const SELETOR = '[data-testid="box-info"]';

// Marcacao atual da vitrine: um carrossel Swiper onde cada slide e uma faixa da
// promocao — o equivalente exato dos antigos blocos box-info. Nao ha mais data-testid
// algum no banner; "box info" so sobrevive dentro do content_zone dos links.
const BLOCO_BANNER = '.swiper-slide';

// O site ja trocou a marcacao uma vez e vai trocar de novo. Em vez de depender de um
// unico seletor, pedimos varios candidatos na MESMA requisicao (o /scrape aceita uma
// lista de elements) e ficamos com o primeiro que trouxer o texto do frete.
const SELETORES_CANDIDATOS = [
    SELETOR,
    '[data-testid*="box-info"]',
    '[class*="box-info"]',
    '[class*="boxInfo"]',
    BLOCO_BANNER,
    '[data-testid*="banner"]',
    '[class*="shipping"]',
    '[class*="frete"]',
];

// Esperamos por qualquer um dos dois: o bloco historico, se um dia voltar, ou o slide
// do carrossel de hoje. E uma lista CSS comum, entao o querySelector por tras do
// waitForSelector aceita as duas alternativas — e nao gastamos a espera inteira num
// seletor que sabidamente nao existe mais.
export const SELETOR_ESPERA = `${SELETOR}, ${BLOCO_BANNER}`;

// Ultima linha de defesa: o texto renderizado da pagina inteira. Nao depende de
// marcacao nenhuma, entao sobrevive a qualquer redesign — so e menos preciso.
const SELETOR_FALLBACK = 'body';

const TODOS_SELETORES = [...SELETORES_CANDIDATOS, SELETOR_FALLBACK];

// Orcamento de tempo: o vercel.json corta a funcao em 30s. A primeira tentativa pode
// gastar GOTO + SELETOR; o resto do ladder so roda se ainda houver folga.
const GOTO_TIMEOUT = 15000;
const SELETOR_TIMEOUT = 6000;
const ESPERA_FIXA = 3500;
const ORCAMENTO_MS = 20000;

// Tamanho maximo das amostras de texto devolvidas para diagnostico. Com o fallback
// `body` o texto lido pode ter dezenas de milhares de caracteres, e ele acaba indo
// para dentro da resposta de /api/frete em caso de falha.
const AMOSTRA_MAX = 400;

// Modo rapido padrao das rotas. A pagina de status ignora isso quando recebe ?fast=.
export const FAST_PADRAO = process.env.BROWSERLESS_FAST === '1';

// Deliberadamente sem 'stylesheet': o texto que lemos e o renderizado, entao sem CSS
// elementos ocultos na pagina passariam a aparecer e mudariam o resultado.
const RECURSOS_BLOQUEADOS = ['image', 'font', 'media'];

const TEM_FRETE = /frete\s+gr[áa]tis/i;

function montarCorpo({ fast, espera }) {
    const corpo = {
        url: STORE_URL,
        elements: TODOS_SELETORES.map(selector => ({ selector })),
        gotoOptions: { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT }
    };

    if (espera === 'seletor') {
        if (API_VERSION === 'v2') {
            corpo.waitForSelector = { selector: SELETOR_ESPERA, timeout: SELETOR_TIMEOUT };
        } else {
            corpo.waitFor = SELETOR_ESPERA;
        }
    } else if (espera === 'tempo') {
        if (API_VERSION === 'v2') {
            corpo.waitForTimeout = ESPERA_FIXA;
        } else {
            corpo.waitFor = ESPERA_FIXA;
        }
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

// Sequencia de tentativas, da mais precisa para a mais tolerante. Esperar por um
// seletor que sumiu e justamente o que derruba a leitura, entao a segunda tentativa
// troca a espera por um tempo fixo, que deixa o JS da loja renderizar sem depender
// de marcacao nenhuma.
function montarPlanos(fast) {
    const vistos = new Set();

    return [
        { fast, espera: 'seletor' },
        { fast, espera: 'tempo' },
        { fast: false, espera: 'tempo' },
        { fast: false, espera: 'nenhuma' },
    ].filter(plano => {
        const chave = `${plano.fast}:${plano.espera}`;
        if (vistos.has(chave)) {
            return false;
        }
        vistos.add(chave);
        return true;
    });
}

// O /scrape devolve um bloco por seletor pedido, na ordem de `elements`. Casamos pelo
// nome do seletor e caimos no indice so se o formato da resposta mudar.
function textosDe(json, seletor, indice) {
    const blocos = Array.isArray(json?.data) ? json.data : [];
    const porNome = blocos.find(item => item?.selector === seletor);

    // A posicao so e confiavel quando veio um bloco por seletor pedido. Se a resposta
    // trouxe menos, alinhar por indice atribuiria o texto de um seletor a outro — e o
    // rotulo errado no diagnostico e pior que rotulo nenhum.
    const alinhado = blocos.length === TODOS_SELETORES.length ? blocos[indice] : undefined;
    const bloco = porNome ?? alinhado;

    return (bloco?.results ?? [])
        .map(item => normalizar(item?.text ?? ''))
        .filter(texto => texto.length > 0);
}

// Escolhe de qual seletor vamos ler: o primeiro que mencione frete gratis; senao o
// primeiro candidato especifico com algum texto; senao o body.
function escolherFonte(json) {
    const lidos = TODOS_SELETORES.map((seletor, indice) => ({
        seletor,
        textos: textosDe(json, seletor, indice)
    }));

    return lidos.find(fonte => fonte.textos.some(texto => TEM_FRETE.test(texto)))
        ?? lidos.find(fonte => fonte.seletor !== SELETOR_FALLBACK && fonte.textos.length > 0)
        ?? lidos[lidos.length - 1];
}

// Busca o texto do banner de frete na vitrine, via API REST do Browserless.
// Devolve tambem de onde o texto veio e como foi lido, porque as duas coisas mudam
// sozinhas e sao o que se precisa saber quando a leitura para de funcionar.
export async function buscarTextosBoxInfo({ fast = FAST_PADRAO } = {}) {
    const token = process.env.BROWSERLESS_TOKEN;
    if (!token) {
        throw new Error('variável de ambiente BROWSERLESS_TOKEN não configurada');
    }

    const limite = Date.now() + ORCAMENTO_MS;
    let ultimoErro = null;
    let respondeu = false;
    let vazio = null;

    for (const [indice, plano] of montarPlanos(fast).entries()) {
        if (indice > 0 && Date.now() > limite) {
            break;
        }

        const resultado = await enviar(montarCorpo(plano), token);

        if (!resultado.ok) {
            ultimoErro = `Browserless (${API_VERSION}) respondeu ${resultado.status}: ${resultado.detalhe}`;
            continue;
        }

        respondeu = true;

        const fonte = escolherFonte(resultado.json);
        const diagnostico = {
            fastPedido: fast,
            fastAplicado: plano.fast,
            esperaAplicada: plano.espera,
            tentativas: indice + 1
        };

        // Texto encontrado: para aqui. Uma pagina que renderizou mas nao tem promocao
        // tambem cai neste caso (o body vem cheio), e isso e o correto — nao adianta
        // repetir a leitura, o site e que nao tem frete gratis agora.
        if (fonte.textos.length > 0) {
            return { ...fonte, ...diagnostico };
        }

        vazio = { ...fonte, ...diagnostico };
    }

    if (!respondeu) {
        throw new Error(ultimoErro ?? 'Browserless não respondeu');
    }

    // Respondeu 200 mas a pagina veio sem texto nenhum, nem no body: quase sempre
    // bloqueio de bot ou pagina de erro da loja. Isso e falha de infra, nao ausencia
    // de promocao, entao vale avisar como erro em vez de fingir que so nao tem frete.
    if (!vazio || vazio.textos.length === 0) {
        throw new Error(
            'a página foi carregada mas voltou sem texto algum (nem via body) — '
            + 'provável bloqueio de bot, página de erro da loja ou NATURA_STORE_URL inválida'
        );
    }

    return vazio;
}

export function normalizar(texto) {
    return texto.replace(/\s+/g, ' ').trim();
}

function amostrar(texto) {
    return texto.length > AMOSTRA_MAX ? `${texto.slice(0, AMOSTRA_MAX)}…` : texto;
}

// Aceita 99, 99,00 e 1.000,00. O padrao antigo (`\d+(?:,\d{2})?`) lia "R$ 1.000,00"
// como 1, entao o separador de milhar precisa estar aqui.
const NUMERO = String.raw`\d+(?:\.\d{3})*(?:,\d{2})?`;

// O texto do banner ja veio como "Frete Grátis Natura acima de R$ 99", mas a loja
// muda a copy sem aviso. Exigimos so a ancora "frete grátis" perto de um valor —
// a distancia e limitada para nao casar com dois trechos sem relacao na pagina.
const PADRAO_VALOR = new RegExp(String.raw`frete\s+gr[áa]tis.{0,80}?R\$\s*(${NUMERO})`, 'i');
const PADRAO_VALOR_INVERTIDO = new RegExp(String.raw`R\$\s*(${NUMERO}).{0,80}?frete\s+gr[áa]tis`, 'i');

// Lê o primeiro valor de frete grátis que aparecer, na ordem dos blocos lidos.
export function extrairValor(textos) {
    const textoLimpo = amostrar(normalizar(textos[0] ?? ''));

    for (const texto of textos) {
        const match = texto.match(PADRAO_VALOR) ?? texto.match(PADRAO_VALOR_INVERTIDO);

        if (match) {
            return { valor: match[1], textoLimpo };
        }
    }

    return { valor: null, textoLimpo };
}

const PADRAO_LISTA = new RegExp(
    String.raw`frete\s+gr[áa]tis\s*(.{0,60}?)\s*R\$\s*(${NUMERO})`,
    'gi'
);

// Varre os blocos lidos e monta uma linha por faixa de frete encontrada.
export function extrairLista(textos) {
    const resultados = [];

    for (const texto of textos) {
        if (!TEM_FRETE.test(texto)) {
            continue;
        }

        // Grupo 1 captura o texto antes do R$ / Grupo 2 captura o valor numérico
        PADRAO_LISTA.lastIndex = 0;
        let match;

        while ((match = PADRAO_LISTA.exec(texto)) !== null) {
            // Limpa preposições e termos genéricos para extrair apenas o nome da marca/categoria
            let especificacao = normalizar(
                match[1].replace(/acima de|a partir de|nas compras|em compras/gi, '')
            ).replace(/^(de|em|para|nas|nos|na|no)\s+/i, '');

            // Padronização: se a string ficar vazia — ou for longa demais para ser um
            // nome, o que acontece quando o texto veio do body inteiro — assume "Geral".
            // Caso contrário, capitaliza a primeira letra.
            if (especificacao.length > 0 && especificacao.length <= 40) {
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

// Trecho do texto lido, para a página de status mostrar o que realmente chegou.
export function amostraTexto(textos) {
    return amostrar(normalizar(textos.join(' | ')));
}
