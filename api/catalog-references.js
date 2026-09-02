import { timingSafeEqual } from 'node:crypto';
import { lookupReferences, normalizeReferenceList } from '../lib/catalog.js';

function authorized(request) {
    const secret = process.env.AUTOMATION_INGESTION_SECRET;
    const authorization = request.headers?.authorization ?? request.headers?.Authorization ?? '';

    if (!secret || secret.length < 32) return false;

    const expected = Buffer.from(`Bearer ${secret}`);
    const received = Buffer.from(String(authorization));
    return expected.length === received.length && timingSafeEqual(expected, received);
}

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ ok: false, error: 'Método não permitido.' });
    }

    if (!authorized(request)) {
        return response.status(401).json({ ok: false, error: 'Pesquisa não autorizada.' });
    }

    let references;

    try {
        references = normalizeReferenceList(request.body?.references);
    } catch (error) {
        return response.status(422).json({ ok: false, error: error.message });
    }

    const startedAt = Date.now();

    try {
        const result = await lookupReferences(references);

        return response.status(200).json({
            ok: true,
            duration_ms: Date.now() - startedAt,
            checked_at: new Date().toISOString(),
            ...result,
        });
    } catch (error) {
        console.error('catalog-references failed', error);

        return response.status(502).json({
            ok: false,
            duration_ms: Date.now() - startedAt,
            checked_at: new Date().toISOString(),
            error: error?.message ?? 'Falha desconhecida na pesquisa por referências.',
        });
    }
}
