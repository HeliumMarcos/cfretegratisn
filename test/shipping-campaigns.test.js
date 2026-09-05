import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPage, campaignFromTerms, safePage, consultShipping } from '../lib/shipping-campaigns.js';

const origin = 'https://www.minhaloja.natura.com';
const terms = 'Promoção válida até 09/09/2026. Exceto entrega expressa. Válido para compras acima de R$ 9, enquanto durarem os estoques. Promoção exclusiva para o cliente final, não poderão participar consultores e consultoras de Beleza Natura.';
const banner = { contentConditions: encodeURIComponent(`<p>${terms}</p>`), image: { desktop: { url: '/assets/campanha-frete.jpg' } } };
const html = data => `<html><script>self.__next_f.push(${JSON.stringify([1, '5:' + JSON.stringify(data)])})</script></html>`;
const baseline = async () => ({ ok: true, valor: '149', url: 'https://sminhaloja.natura.com/example' });

test('interpreta regulamento no banner Next, com validade e restrições, não o preço do produto', () => {
    const result = inspectPage(html({ components: [{ neMultiplesBanners: { bannersCarrousel: [banner] } }], price: 4.90 }), `${origin}/c/campanha-do-mes`);
    assert.equal(result.campaigns.length, 1);
    assert.equal(result.campaigns[0].value, 9);
    assert.equal(result.campaigns[0].ends_on, '2026-09-09');
    assert.equal(result.campaigns[0].delivery, 'standard');
    assert.equal(result.campaigns[0].consumer_only, true);
    assert.equal(result.campaigns[0].operator, 'gt');
});

test('não confunde cupom, produto próximo, Avon ou múltiplos mínimos com frete Natura', () => {
    assert.equal(campaignFromTerms('Ganhe 10% de desconto nas compras acima de R$ 9 com cupom!', 'frete', origin), null);
    assert.equal(campaignFromTerms('R$ 9,00', 'frete grátis', origin), null);
    assert.equal(campaignFromTerms(terms, 'Avon frete grátis', origin), null);
    assert.equal(campaignFromTerms(terms + ' Pedidos acima de R$ 99 em outra região.', 'frete', origin), null);
    assert.equal(campaignFromTerms(terms, 'presentes Natura', origin), null);
});

test('lê datas de início, valor inclusivo e não inventa validade', () => {
    const campaign = campaignFromTerms('Válido de 05/09/2026 até 09/09/2026. Compras a partir de R$ 1.000,50.', 'frete grátis', origin);
    assert.equal(campaign.starts_on, '2026-09-05');
    assert.equal(campaign.ends_on, '2026-09-09');
    assert.equal(campaign.value, 1000.50);
    assert.equal(campaign.operator, 'gte');
    assert.equal(campaignFromTerms('Compras acima de R$ 9.', 'frete', origin).ends_on, null);
    assert.equal(campaignFromTerms('Válido até 31/02/2026. Compras acima de R$ 9.', 'frete', origin).ends_on, null);
});

test('descobre campanha em URL nova pelo banner, não depende de especial-frete', async () => {
    const visited = [];
    const fetcher = async url => {
        visited.push(url);
        const data = new URL(url).pathname === '/c/setembro-cliente'
            ? { neMultiplesBanners: { bannersCarrousel: [banner] } }
            : { neMultiplesBanners: { bannersCarrousel: [{ buttons: [{ url: '/c/setembro-cliente' }], image: { url: '/assets/frete.jpg' } }] } };
        return new Response(html(data), { headers: { 'content-type': 'text/html' } });
    };
    const result = await consultShipping({ fetcher, baseline, now: new Date('2026-09-05T12:00:00Z') });
    assert.ok(visited.some(url => url.includes('/c/setembro-cliente')));
    assert.ok(!visited.some(url => url.includes('especial-frete')));
    assert.equal(result.items[0].value, 9);
    assert.equal(result.items[0].expired, false);
    assert.equal(result.items[1].value, 149);
    assert.equal(result.discovery.partial, false);
});

test('campanha vencida permanece identificada como encerrada mesmo com padrão disponível', async () => {
    const result = await consultShipping({ baseline, now: new Date('2026-09-10T03:00:01Z'),
        fetcher: async () => new Response(html(banner), { headers: { 'content-type': 'text/html' } }) });
    assert.equal(result.items[0].expired, true);
    assert.equal(result.items.at(-1).value, 149);
});

test('restringe links, credenciais e redirects ao host oficial e a páginas de leitura', async () => {
    for (const url of ['http://127.0.0.1/c/x', 'https://evil.test/c/x', 'https://www.minhaloja.natura.com.evil.test/c/x', '/sacola', '/api/test', 'https://user@www.minhaloja.natura.com/c/x']) assert.equal(safePage(url), null);
    assert.equal(safePage('/c/campanha?consultoria=outra&marca=avon'), `${origin}/c/campanha?consultoria=helium&marca=natura`);
    const visits = [];
    const result = await consultShipping({ baseline, fetcher: async url => {
        visits.push(url); return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
    } });
    assert.ok(visits.every(url => url.startsWith(origin)));
    assert.equal(result.discovery.failed.length, 2);
    assert.equal(result.items.length, 1);
    assert.equal(result.discovery.partial, true);
});

test('distingue falha total de uma leitura sem referências', async () => {
    const noBaseline = async () => ({ ok: false });
    const failed = await consultShipping({ baseline: noBaseline, fetcher: async () => new Response('', { status: 403 }) });
    assert.equal(failed.status, 'error');
    const empty = await consultShipping({ baseline: noBaseline, fetcher: async () => new Response('<html><p>Natura</p></html>', { headers: { 'content-type': 'text/html' } }) });
    assert.equal(empty.status, 'not_found');
});

test('preserva fallback de referência quando a página do produto não responde', async () => {
    let fallbackCalls = 0;
    const result = await consultShipping({ baseline: async () => ({ ok: false }),
        fallback: async () => { fallbackCalls++; return { ok: true, valor: '149', source_type: 'storefront', url: `${origin}/c/promocoes` }; },
        fetcher: async () => new Response('<html>Loja</html>', { headers: { 'content-type': 'text/html' } }),
    });
    assert.equal(fallbackCalls, 1);
    assert.equal(result.items[0].source_type, 'storefront');
    assert.equal(result.items[0].value, 149);
});
