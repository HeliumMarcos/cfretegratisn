import { timingSafeEqual } from 'node:crypto';
import { runCatalogSync } from '../lib/catalog.js';

function authorized(request) {
    const secret = process.env.CRON_SECRET;
    const authorization = request.headers?.authorization ?? request.headers?.Authorization ?? '';

    if (!secret || secret.length < 16) {
        return false;
    }

    const expected = Buffer.from(`Bearer ${secret}`);
    const received = Buffer.from(String(authorization));

    return expected.length === received.length && timingSafeEqual(expected, received);
}

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        return response.status(405).json({ ok: false, error: 'Método não permitido.' });
    }

    if (!authorized(request)) {
        return response.status(401).json({ ok: false, error: 'Execução não autorizada.' });
    }

    const startedAt = Date.now();

    try {
        const result = await runCatalogSync({
            dryRun: request.query?.dry_run === '1',
            now: startedAt,
        });

        return response.status(200).json({
            ok: true,
            duration_ms: Date.now() - startedAt,
            checked_at: new Date().toISOString(),
            ...result,
        });
    } catch (error) {
        console.error('catalog-sync failed', error);

        return response.status(502).json({
            ok: false,
            duration_ms: Date.now() - startedAt,
            checked_at: new Date().toISOString(),
            error: error?.message ?? 'Falha desconhecida na sincronização.',
        });
    }
}
