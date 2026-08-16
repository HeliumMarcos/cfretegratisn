import {
    lerFrete,
    amostraTexto,
    SELETOR_ESPERA,
    FONTE_DIRETA,
    FONTE_PRODUTO,
    FAST_PADRAO,
} from '../lib/natura.js';

export function lerFast(req) {
    const bruto = req?.query?.fast
        ?? new URL(req?.url ?? '/', 'http://local').searchParams.get('fast');
    if (bruto === '1') return true;
    if (bruto === '0') return false;
    return FAST_PADRAO;
}

function descreverModo(resultado, fast) {
    if (resultado?.fonteValor === FONTE_PRODUTO) return 'valor pela página de produto';
    if (resultado?.fonte === FONTE_DIRETA) return 'leitura direta, sem browser';
    if (!fast) return 'normal (carrega tudo)';
    if (resultado?.fastAplicado) return 'rápido — imagens, fontes e mídia bloqueadas';
    return 'rápido recusado pelo servidor; usou o modo normal';
}

function descreverEspera(esperaAplicada) {
    if (esperaAplicada === 'seletor') return `esperou ${SELETOR_ESPERA}`;
    if (esperaAplicada === 'tempo') return 'espera fixa — o bloco histórico não apareceu';
    if (esperaAplicada === 'nenhuma') return 'sem espera';
    return '—';
}

export function classificarResultado(resultado) {
    if (resultado.valorOk && resultado.listaOk) {
        return {
            estado: 'bom', rotulo: 'FUNCIONANDO',
            detalhe: 'As duas rotas estão respondendo com dados reais.',
        };
    }
    if (resultado.valorOk || resultado.listaOk) {
        const funciona = resultado.valorOk ? '/api/frete' : '/api/frete2';
        const falha = resultado.valorOk ? '/api/frete2' : '/api/frete';
        return {
            estado: 'atencao', rotulo: 'DEGRADADO',
            detalhe: `${funciona} está disponível, mas ${falha} ainda não tem dados confiáveis.`,
        };
    }
    return {
        estado: 'atencao', rotulo: 'SEM PROMOÇÃO',
        detalhe: 'A página foi consultada, mas nenhum anúncio de frete grátis foi localizado.',
    };
}

function diagnosticoBase(fast) {
    return {
        token: process.env.BROWSERLESS_TOKEN ? 'configurado' : 'ausente',
        host: process.env.BROWSERLESS_URL ?? 'https://chrome.browserless.io',
        apiBrowserless: process.env.BROWSERLESS_API_VERSION ?? 'v2',
        fastPedido: fast ? 'rápido' : 'normal',
    };
}

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method && !['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).json({
            estado: 'ruim', rotulo: 'MÉTODO NÃO PERMITIDO',
            detalhe: 'Use GET para consultar o status.',
        });
    }

    const inicio = Date.now();
    const fast = lerFast(req);
    try {
        const resultado = await lerFrete({ fast, precisaLista: true });
        const classificacao = classificarResultado(resultado);
        const textoLido = resultado.amostra
            ?? (resultado.textos.length > 0 ? amostraTexto(resultado.textos) : null);

        return res.status(200).json({
            ...classificacao,
            verificadoEm: new Date().toISOString(),
            duracaoMs: Date.now() - inicio,
            resultados: {
                frete: { ok: resultado.valorOk, valor: resultado.valor },
                frete2: { ok: resultado.listaOk, linhas: resultado.linhas },
            },
            diagnostico: {
                ...diagnosticoBase(fast),
                modo: descreverModo(resultado, fast),
                fonteValor: resultado.fonteValor ?? '—',
                fonteLista: resultado.fonteLista ?? '—',
                produto: resultado.detalheFonte ?? resultado.motivoProduto ?? '—',
                espera: descreverEspera(resultado.esperaAplicada),
                tentativas: resultado.tentativas || '—',
                blocosLidos: resultado.textos.length,
                erroFallback: resultado.erroVitrine ?? '—',
                textoLido: textoLido ?? 'nada foi lido',
            },
        });
    } catch (error) {
        const mensagem = error?.message ?? 'Falha técnica sem detalhes.';
        return res.status(503).json({
            estado: 'ruim', rotulo: 'FORA DO AR', detalhe: mensagem,
            verificadoEm: new Date().toISOString(),
            duracaoMs: Date.now() - inicio,
            resultados: {
                frete: { ok: false, valor: null },
                frete2: { ok: false, linhas: [] },
            },
            diagnostico: {
                ...diagnosticoBase(fast),
                modo: fast ? 'rápido' : 'normal',
                fonteValor: '—', fonteLista: '—', produto: '—', espera: '—',
                tentativas: '—', blocosLidos: 0, erroFallback: mensagem,
                textoLido: 'nada foi lido',
            },
        });
    }
}
