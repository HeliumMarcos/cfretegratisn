import test from 'node:test';
import assert from 'node:assert/strict';
import { extractProductClassificationFromHtml, fetchOfficialProductData, normalizeProduct } from '../lib/catalog.js';

const html = `<nav>masculino|infantil</nav>
<script type="application/ld+json">{"@type":"Product","sku":"NATBRA-43135","name":"Desodorante Perfume Una Infinito 75 ml"}</script>
<div data-gtm-product-tags="una|feminino|adocicado|deo perfume|para sair, ocasiões especiais" data-testid="product-tags"></div>
<article data-gtm-product-tags="masculino" data-testid="product-tags"></article>`;

test('uses only main product tags and checks the reference', () => {
    assert.deepEqual(extractProductClassificationFromHtml(html, 'NATBRA-43135'), ['una', 'feminino', 'adocicado', 'deo perfume', 'para sair, ocasiões especiais']);
    assert.deepEqual(extractProductClassificationFromHtml(html, 'NATBRA-1'), []);
    assert.deepEqual(extractProductClassificationFromHtml('<nav>feminino</nav>', 'NATBRA-43135'), []);
});

test('enriches name and categories with one existing request', async () => {
    let count = 0;
    const result = await fetchOfficialProductData({ reference: 'NATBRA-43135', name: 'Una', source_url: 'https://www.minhaloja.natura.com/p/una/NATBRA-43135', classification_terms: ['Una'] }, async () => {
        count += 1;
        return new Response(html);
    });
    assert.equal(count, 1);
    assert.equal(result.name, 'Desodorante Perfume Una Infinito 75 ml');
    assert.ok(result.classification_terms.includes('feminino'));
});

test('transient failure preserves original name and existing classification', async () => {
    const result = await fetchOfficialProductData({ reference: 'NATBRA-1', name: 'Tododia', classification_terms: ['Tododia'] }, async () => { throw new Error('offline'); });
    assert.deepEqual(result, { name: 'Tododia', classification_terms: ['Tododia'] });
});

test('normalization preserves collected tags', () => {
    const result = normalizeProduct({ reference: 'NATBRA-1', name: 'Creme', source_url: 'https://www.minhaloja.natura.com/p/creme/NATBRA-1', price_normal: 'R$ 10,00', price_promo: 'R$ 9,00', brand: 'Tododia', classification_terms: ['todos os tipos de pele'] });
    assert.deepEqual(result.classification_terms, ['todos os tipos de pele', 'Tododia']);
});
