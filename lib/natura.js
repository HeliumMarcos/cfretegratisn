const STORE_URL = process.env.NATURA_STORE_URL
    ?? 'https://www.minhaloja.natura.com/c/promocoes?consultoria=helium&marca=natura';

const BROWSERLESS_URL = (process.env.BROWSERLESS_URL ?? 'https://chrome.browserless.io')
    .replace(/\/+$/, '');

// O texto do banner vem embutido no HTML da vitrine (no JSON que hidrata a pagina), entao
// na maioria das vezes da para ler sem browser nenhum. Vale muito a pena tentar: o
// Browserless e o recurso escasso aqui — tem cota, tem fila, e e ordens de grandeza mais
// lento. Se a leitura direta falhar, caimos nele como antes.
const HTTP_TIMEOUT = 6000;

// Paginas de produto, na ordem de tentativa. Sao links curtos que redirecionam, e existem
// tres porque um produto pode sair do ar — a leitura para no primeiro que responder.
const PRODUTO_URLS = (process.env.NATURA_PRODUTO_URLS ?? [
    'https://sminhaloja.natura.com/Kw8Pxgh',
    'https://sminhaloja.natura.com/2ksptuX',
    'https://sminhaloja.natura.com/HwYMS_p',
].join(',')).split(',').map(url => url.trim()).filter(Boolean);

const PRODUTO_TIMEOUT = 5000;

// Cabecalhos de navegador ajudam com checagem simples de bot. Nao resolvem checagem por
// impressao digital de TLS (JA3): o fetch do Node usa a stack TLS dele, e nao ha como
// imitar a de um Chrome — e o que bibliotecas como curl_cffi fazem com `impersonate`.
// Se a protecao do site for por JA3, esta leitura falha e o Browserless assume.
const CABECALHOS_NAVEGADOR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
        + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,'
        + 'image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'Upgrade-Insecure-Requests': '1',
};

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

// Rotulo da leitura sem browser, para o diagnostico distinguir os dois caminhos.
export const FONTE_DIRETA = 'http-direto';

const TODOS_SELETORES = [...SELETORES_CANDIDATOS, SELETOR_FALLBACK];

// Orcamento de tempo. O vercel.json corta a funcao em 30s, e estourar isso devolve um
// 504 cru da Vercel — pior que um erro nosso, porque nao diz o motivo.
//
// GOTO + SELETOR sao os limites que o Browserless aplica na navegacao, mas o relogio
// dele so comeca depois de subir a sessao do browser, o que leva mais alguns segundos.
// Por isso o timeout da requisicao tem folga sobre a soma dos dois, em vez de encostar
// nela: apertado demais, abortavamos leituras que estavam a caminho.
const GOTO_TIMEOUT = 10000;
const SELETOR_TIMEOUT = 4000;
const ESPERA_FIXA = 3500;

// O fetch nao tem timeout proprio: se o Browserless enfileira a requisicao esperando um
// worker livre, ficamos pendurados ate a Vercel matar a funcao. Este e o corte.
const REQUISICAO_TIMEOUT = 20000;

// Margem sob os 30s. Combinada com o timeout acima, isto faz a segunda tentativa so
// acontecer quando a primeira falhou *rapido* — que e justamente o caso em que repetir
// resolve (o servidor recusou uma chave do corpo). Repetir uma espera em fila nao
// resolve nada e so nos aproxima do 504.
const LIMITE_FUNCAO = 24000;

// Abaixo disto nao vale nem tentar: a requisicao so morreria no meio.
const MINIMO_REQUISICAO = 3000;

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

async function enviar(corpo, token, orcamento) {
    let resposta;

    try {
        resposta = await fetch(`${BROWSERLESS_URL}/scrape?token=${encodeURIComponent(token)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(corpo),
            signal: AbortSignal.timeout(orcamento)
        });
    } catch (e) {
        // Abort e falha de rede caem aqui. status 0 marca "nem chegou a responder".
        const motivo = e?.name === 'TimeoutError' || e?.name === 'AbortError'
            ? `não respondeu em ${Math.round(orcamento / 1000)}s`
            : e?.message ?? 'falha de rede';
        return { ok: false, status: 0, detalhe: motivo };
    }

    if (resposta.ok) {
        return { ok: true, json: await resposta.json() };
    }

    const detalhe = (await resposta.text().catch(() => '')).slice(0, 300);
    return { ok: false, status: resposta.status, detalhe };
}

// O banner aparece dentro do JSON que hidrata a pagina, onde os acentos vem escapados
// (á) e o resto do HTML esta ao redor. Desfaz os dois para que os mesmos padroes
// usados no texto renderizado sirvam aqui, sem precisar de um parser.
// Desfaz escapes sem tirar as tags: o valor mais confiavel da pagina de produto esta num
// atributo (aria-label), e tirar as tags o apagaria junto.
export function decodificar(html) {
    return html
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\"/g, '"')
        // Entidades numericas cobrem qualquer acento (&#225; = á) de uma vez.
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&nbsp;/gi, ' ')
        .replace(/&quot;/gi, '"')
        .replace(/&aacute;/gi, 'á')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&');
}

export function textoDaPagina(html) {
    return normalizar(decodificar(html).replace(/<[^>]+>/g, ' '));
}

// GET simples com timeout. Devolve o HTML ou o motivo da falha — o motivo entra no
// diagnostico, porque saber *por que* o caminho barato falhou e o que evita adivinhacao.
async function buscarHtml(url, timeout) {
    let resposta;

    try {
        resposta = await fetch(url, {
            headers: CABECALHOS_NAVEGADOR,
            redirect: 'follow',
            signal: AbortSignal.timeout(timeout)
        });
    } catch (e) {
        const motivo = e?.name === 'TimeoutError' || e?.name === 'AbortError'
            ? `não respondeu em ${Math.round(timeout / 1000)}s`
            : e?.message ?? 'falha de rede';
        return { ok: false, motivo };
    }

    if (!resposta.ok) {
        // 403 aqui costuma ser bloqueio de bot — provavelmente por impressao digital de
        // TLS, que o Node nao consegue disfarcar.
        return { ok: false, motivo: `HTTP ${resposta.status}` };
    }

    const html = await resposta.text().catch(() => '');
    return html.length > 0 ? { ok: true, html } : { ok: false, motivo: 'resposta vazia' };
}

// Leitura sem browser. Devolve { ok, texto } ou { ok:false, motivo } — o motivo entra no
// diagnostico, porque saber *por que* o caminho barato falhou e o que evita adivinhacao.
export async function lerDireto() {
    const resultado = await buscarHtml(STORE_URL, HTTP_TIMEOUT);

    if (!resultado.ok) {
        return resultado;
    }

    const texto = textoDaPagina(resultado.html);

    if (!TEM_FRETE.test(texto)) {
        return { ok: false, motivo: `HTML de ${resultado.html.length} bytes sem frete grátis` };
    }

    return { ok: true, texto };
}

export const FONTE_PRODUTO = 'página de produto';

// Percorre as paginas de produto ate uma devolver o limiar. Respeita o orcamento comum:
// nao adianta comecar uma leitura que a Vercel vai matar no meio.
export async function lerLimiarProduto(limite) {
    const motivos = [];

    for (const url of PRODUTO_URLS) {
        if (Date.now() + PRODUTO_TIMEOUT > limite) {
            motivos.push('sem tempo no orçamento');
            break;
        }

        const resultado = await buscarHtml(url, PRODUTO_TIMEOUT);
        const curto = url.replace(/^https?:\/\//, '');

        if (!resultado.ok) {
            motivos.push(`${curto}: ${resultado.motivo}`);
            continue;
        }

        const valor = extrairLimiar(resultado.html);

        if (valor) {
            return { ok: true, valor, url };
        }

        motivos.push(`${curto}: sem o campo de frete`);
    }

    return { ok: false, motivo: motivos.join('; ') || 'nenhuma URL de produto configurada' };
}

// Repetir so ajuda quando outra forma de requisicao pode passar — um 400 e o servidor
// recusando alguma chave do corpo. Limite de taxa e credencial nao melhoram com
// insistencia: repetir ai so queima mais cota e deixa o problema pior.
const STATUS_SEM_REPETICAO = new Set([401, 402, 403, 429]);

// O Browserless responde 429 com uma pagina HTML inteira do openresty, que ocupava a
// tela de status sem dizer o que fazer. Traduz os casos conhecidos.
function descreverErro(status, detalhe) {
    if (status === 0) {
        return `Browserless ${detalhe} — normalmente é fila do plano esperando um worker `
            + 'livre. Tente de novo em alguns minutos.';
    }

    if (status === 429) {
        return 'Browserless recusou por limite de requisições (429) — cota do plano '
            + 'esgotada ou requisições demais ao mesmo tempo. Verifique o plano em '
            + 'browserless.io ou tente de novo em alguns minutos.';
    }

    if (status === 401 || status === 403) {
        return `Browserless recusou a credencial (${status}) — confira BROWSERLESS_TOKEN.`;
    }

    const limpo = normalizar(detalhe.replace(/<[^>]*>/g, ' ')).slice(0, 200);
    return `Browserless (${API_VERSION}) respondeu ${status}: ${limpo}`;
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
export async function buscarTextosBoxInfo({ fast = FAST_PADRAO, limite: limiteDado } = {}) {
    // O relogio comeca aqui, antes da leitura direta: ela e barata mas nao e gratis, e o
    // que a Vercel corta e o tempo total da funcao, nao o de cada etapa.
    const limite = limiteDado ?? Date.now() + LIMITE_FUNCAO;

    // Caminho barato primeiro: sem cota, sem fila, e responde em menos de um segundo.
    const direto = await lerDireto();

    if (direto.ok) {
        return {
            textos: [direto.texto],
            seletor: FONTE_DIRETA,
            fastPedido: fast,
            fastAplicado: false,
            esperaAplicada: null,
            tentativas: 1
        };
    }

    const token = process.env.BROWSERLESS_TOKEN;
    if (!token) {
        throw new Error(
            `leitura direta falhou (${direto.motivo}) e BROWSERLESS_TOKEN não está configurada`
        );
    }

    let ultimoErro = null;
    let respondeu = false;
    let vazio = null;

    for (const [indice, plano] of montarPlanos(fast).entries()) {
        // Cada tentativa recebe o menor entre o timeout normal e o tempo que sobrou. E
        // isto que garante o total abaixo do corte da Vercel, mesmo tendo gasto parte do
        // orcamento na leitura direta: sem o teto movel, as duas etapas somadas estouram.
        const orcamento = Math.min(REQUISICAO_TIMEOUT, limite - Date.now());

        if (orcamento < MINIMO_REQUISICAO) {
            break;
        }

        const resultado = await enviar(montarCorpo(plano), token, orcamento);

        if (!resultado.ok) {
            ultimoErro = descreverErro(resultado.status, resultado.detalhe);

            // status 0 e espera estourada: repetir com menos tempo ainda nao ajuda.
            if (resultado.status === 0 || STATUS_SEM_REPETICAO.has(resultado.status)) {
                break;
            }

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
        // Os dois caminhos falharam: o motivo de cada um importa, porque apontam para
        // lugares diferentes (bloqueio do site x plano do Browserless).
        throw new Error(
            `${ultimoErro ?? 'Browserless não respondeu'} `
            + `(a leitura direta também falhou: ${direto.motivo})`
        );
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

// A vitrine de promoções é uma listagem cheia de preços, e "frete grátis Natura" pode
// cair perto do R$ de um produto qualquer — foi assim que a rota chegou a devolver 9,00.
// A página de produto tem um campo dedicado ao limiar, com uma frase que a listagem não
// usa: "a partir de". É essa frase que torna a leitura inequívoca.
//
// Ancorar nela também é o que evita o outro erro possível ali: a mesma página tem um selo
// "frete grátis" solto e o preço do produto logo depois, então um padrão genérico
// devolveria o preço (R$ 279,90) em vez do limiar.
const PADRAO_LIMIAR = new RegExp(
    String.raw`frete\s+gr[áa]tis\s+a\s+partir\s+de\s+R\$\s*(${NUMERO})`,
    'i'
);

// O mesmo dado aparece no aria-label, já sem centavos: "frete grátis a partir de 149
// Reais". É a leitura preferida por ser a mais limpa — e por não depender de como o preço
// está formatado no texto visível.
const PADRAO_LIMIAR_ARIA = new RegExp(
    String.raw`aria-label="frete\s+gr[áa]tis\s+a\s+partir\s+de\s+(${NUMERO})\s*Reais?"`,
    'i'
);

// "149,00" e "149" são o mesmo limiar. Sem normalizar, a rota devolveria um ou outro
// conforme a fonte que respondeu — e o valor mudaria sozinho de um acesso para o outro.
function normalizarValor(valor) {
    return valor.replace(/,00$/, '');
}

// Lê o limiar de frete grátis de uma página de produto.
export function extrairLimiar(html) {
    const decodificado = decodificar(html);
    const aria = decodificado.match(PADRAO_LIMIAR_ARIA);

    if (aria) {
        return normalizarValor(aria[1]);
    }

    const texto = normalizar(decodificado.replace(/<[^>]+>/g, ' '));
    const match = texto.match(PADRAO_LIMIAR);

    return match ? normalizarValor(match[1]) : null;
}

// O texto do banner ja veio como "Frete Grátis Natura acima de R$ 99", mas a loja
// muda a copy sem aviso. Exigimos so a ancora "frete grátis" perto de um valor —
// a distancia e limitada para nao casar com dois trechos sem relacao na pagina.
const PADRAO_VALOR = new RegExp(String.raw`frete\s+gr[áa]tis.{0,80}?R\$\s*(${NUMERO})`, 'i');
const PADRAO_VALOR_INVERTIDO = new RegExp(String.raw`R\$\s*(${NUMERO}).{0,80}?frete\s+gr[áa]tis`, 'i');

// A vitrine anuncia mais de uma faixa (Natura e Avon, hoje), e /api/frete sempre foi o
// valor da Natura — o padrao original exigia a palavra na regex. Lendo o texto da pagina
// inteira a ordem deixa de ser garantida, entao a preferencia pela marca precisa ser
// explicita: sem isso a rota devolve a faixa da Avon quando ela aparece primeiro.
const MARCA_PRINCIPAL = 'Natura';
const PADRAO_VALOR_MARCA = new RegExp(
    String.raw`frete\s+gr[áa]tis\s+${MARCA_PRINCIPAL}.{0,80}?R\$\s*(${NUMERO})`,
    'i'
);

// Lê o valor da marca principal; se a copy deixar de citá-la, cai no primeiro que houver.
export function extrairValor(textos) {
    const textoLimpo = amostrar(normalizar(textos[0] ?? ''));

    for (const padrao of [PADRAO_VALOR_MARCA, PADRAO_VALOR, PADRAO_VALOR_INVERTIDO]) {
        for (const texto of textos) {
            const match = texto.match(padrao);

            if (match) {
                return { valor: match[1], textoLimpo };
            }
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

    // A faixa da marca principal vem primeiro. Lendo a pagina inteira a ordem depende de
    // onde cada trecho caiu no HTML, e a pagina que consome isto espera a Natura no topo.
    const daMarca = linha => new RegExp(`"${MARCA_PRINCIPAL}"`, 'i').test(linha);

    return [...resultados.filter(daMarca), ...resultados.filter(linha => !daMarca(linha))];
}

// Trecho do texto lido, para a página de status mostrar o que realmente chegou.
export function amostraTexto(textos) {
    return amostrar(normalizar(textos.join(' | ')));
}

// Orquestra as duas fontes. A pagina de produto e a mais confiavel para o *valor*, porque
// tem um campo dedicado ao limiar; a vitrine e a unica que tem a *lista* de faixas, uma
// por marca. Entao cada rota pede so o que precisa, e nao paga pelo que nao usa.
export async function lerFrete({ fast = FAST_PADRAO, precisaLista = true } = {}) {
    const limite = Date.now() + LIMITE_FUNCAO;

    const produto = await lerLimiarProduto(limite);

    // Com o valor em maos e sem precisar da lista, acabou — nem tocamos na vitrine.
    if (produto.ok && !precisaLista) {
        return {
            valor: produto.valor,
            linhas: [`Frete Grátis de "${MARCA_PRINCIPAL}" : ${produto.valor}`],
            fonte: FONTE_PRODUTO,
            detalheFonte: produto.url,
            textos: [],
            erroVitrine: null,
        };
    }

    let vitrine = null;
    let erroVitrine = null;

    try {
        vitrine = await buscarTextosBoxInfo({ fast, limite });
    } catch (e) {
        erroVitrine = e.message;
    }

    const textos = vitrine?.textos ?? [];
    const linhas = extrairLista(textos);
    const valorVitrine = extrairValor(textos).valor;

    // O valor da pagina de produto ganha do da vitrine: la o campo e dedicado ao limiar,
    // aqui ele e inferido de um banner no meio de uma listagem de precos.
    const valor = produto.ok ? produto.valor : valorVitrine;

    // Se a vitrine nao deu lista mas temos o valor, ainda ha o que responder.
    if (linhas.length === 0 && valor) {
        linhas.push(`Frete Grátis de "${MARCA_PRINCIPAL}" : ${valor}`);
    }

    return {
        valor,
        linhas,
        fonte: produto.ok ? FONTE_PRODUTO : (vitrine?.seletor ?? null),
        detalheFonte: produto.ok ? produto.url : null,
        motivoProduto: produto.ok ? null : produto.motivo,
        textos,
        seletor: vitrine?.seletor ?? null,
        fastAplicado: vitrine?.fastAplicado ?? false,
        esperaAplicada: vitrine?.esperaAplicada ?? null,
        tentativas: vitrine?.tentativas ?? 0,
        erroVitrine,
    };
}
