import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createSignedRequest,
    mergeRankings,
    priceToCents,
} from '../lib/catalog.js';

test('converte preço brasileiro para centavos sem usar float', () => {
    assert.equal(priceToCents('R$ 32,76'), 3276);
    assert.equal(priceToCents('R$\u00a01.299,90'), 129990);
});

test('mantém dez por ranking e mescla um NATBRA repetido com as duas origens', () => {
    const product = (reference, source, position) => ({
        reference,
        name: `Produto ${reference}`,
        brand: 'Natura',
        source_url: `https://www.minhaloja.natura.com/p/produto/${reference}?consultoria=helium&marca=natura`,
        image_url: `https://production.na01.natura.com/${reference}.jpg`,
        price_normal: 'R$ 100,00',
        price_promo: 'R$ 60,00',
        available: true,
        sources: [{ key: source, label: source === 'discounts' ? 'Maior desconto' : 'Mais vendidos', position }],
    });

    const topSellers = Array.from({ length: 12 }, (_, index) => product(`NATBRA-${1000 + index}`, 'top_sellers', index + 1));
    const discounts = [
        product('NATBRA-1000', 'discounts', 1),
        ...Array.from({ length: 11 }, (_, index) => product(`NATBRA-${2000 + index}`, 'discounts', index + 2)),
    ];

    const merged = mergeRankings([topSellers, discounts]);
    const repeated = merged.find((item) => item.reference === 'NATBRA-1000');

    assert.equal(merged.length, 19);
    assert.deepEqual(repeated.sources.map((source) => source.key), ['top_sellers', 'discounts']);
    assert.equal(Math.max(...merged.flatMap((item) => item.sources.map((source) => source.position))), 10);
});

test('assinatura e chave de idempotência são determinísticas para o mesmo lote', () => {
    const payload = { source: 'vercel_daily', collected_at: '2026-08-31T10:00:00.000Z', products: [] };
    const secret = 'shared-secret-with-at-least-thirty-two-characters';
    const now = Date.parse('2026-08-31T10:00:00.000Z');

    const first = createSignedRequest(payload, secret, now);
    const second = createSignedRequest(payload, secret, now);

    assert.deepEqual(first, second);
    assert.match(first.headers['X-Automation-Idempotency-Key'], /^daily:2026-08-31:[a-f0-9]{20}$/);
    assert.match(first.headers['X-Automation-Signature'], /^sha256=[a-f0-9]{64}$/);
});
