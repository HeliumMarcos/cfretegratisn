import { timingSafeEqual } from 'node:crypto';
import { runSourceSync } from '../lib/catalog.js';

function authorized(request) {
    const secret = process.env.AUTOMATION_INGESTION_SECRET;
    const authorization = request.headers?.authorization ?? request.headers?.Authorization ?? '';

    if (!secret || secret.length < 32) return false;

    const expected = Buffer.from(`Bearer ${secret}`);
    const received = Buffer.from(String(authorization));
    return expected.length === received.length && timingSafeEqual(expected, received);
}

function validPayload(body) {
    const source = body?.source;
    let url;

    try {
        url = new URL(source?.url);
    } catch {
        return false;
    }

    return Number.isInteger(source?.id)
        && source.id > 0
        && typeof source.name === 'string'
        && source.name.trim().length > 0
        && source.name.length <= 100
        && ['www.minhaloja.natura.com', 'minhaloja.natura.com'].includes(url.hostname.toLowerCase())
        && url.protocol === 'https:'
        && Number.isInteger(source.product_limit)
        && source.product_limit >= 1
        && source.product_limit <= 100
        && typeof source.analyze_all === 'boolean'
        && body?.known
        && typeof body.known === 'object';
}

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ ok: false, error: 'Método não permitido.' });
    }

    if (!authorized(request)) {
        return response.status(401).json({ ok: false, error: 'Execução não autorizada.' });
    }

    if (!validPayload(request.body)) {
        return response.status(422).json({ ok: false, error: 'Configuração de página inválida.' });
    }

    const startedAt = Date.now();

    try {
        const result = await runSourceSync({
            source: request.body.source,
            known: request.body.known,
            now: startedAt,
        });

        return response.status(200).json({
            ok: true,
            duration_ms: Date.now() - startedAt,
            checked_at: new Date().toISOString(),
            ...result,
        });
    } catch (error) {
        console.error('catalog-source-run failed', error);

        return response.status(502).json({
            ok: false,
            duration_ms: Date.now() - startedAt,
            checked_at: new Date().toISOString(),
            error: error?.message ?? 'Falha desconhecida na análise da página.',
        });
    }
}
