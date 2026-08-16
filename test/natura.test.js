import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Script } from 'node:vm';

import {
    extrairDeHtml,
    extrairLimiar,
    extrairLista,
    extrairValor,
    limiarDeJson,
} from '../lib/natura.js';
import { classificarResultado } from '../api/status-data.js';
import statusHandler from '../api/status.js';

test('extrai e normaliza as faixas do HTML da vitrine', () => {
    const html = `
        <div>Frete grátis Avon acima de R$ 79,90</div>
        <div>Frete grátis Natura acima de R$ 149,00</div>
    `;
    assert.deepEqual(extrairDeHtml(html), {
        valor: '149',
        linhas: [
            'Frete Grátis de "Natura" : 149',
            'Frete Grátis de "Avon" : 79,90',
        ],
    });
});

test('prefere o limiar sem centavos presente no aria-label', () => {
    const html = '<span aria-label="frete grátis a partir de 149 Reais">R$ 279,90</span>';
    assert.equal(extrairLimiar(html), '149');
});

test('aceita chave JSON de frete apenas quando representa um limiar plausível', () => {
    assert.deepEqual(limiarDeJson('{"freeShippingThreshold":"149,00"}'), {
        valor: '149',
        chave: 'freeShippingThreshold',
    });
    assert.equal(limiarDeJson('{"shippingCategory":"9,00"}'), null);
});

test('prioriza Natura e remove duplicações no texto renderizado', () => {
    const textos = [
        'Frete grátis Avon acima de R$ 79,90. Frete grátis Natura acima de R$ 149,00.',
        'Frete grátis Natura acima de R$ 149,00.',
    ];
    assert.equal(extrairValor(textos).valor, '149');
    assert.deepEqual(extrairLista(textos), [
        'Frete Grátis de "Natura" : 149',
        'Frete Grátis de "Avon" : 79,90',
    ]);
});

test('classifica sucesso completo, parcial e ausência de promoção', () => {
    assert.equal(classificarResultado({ valorOk: true, listaOk: true }).estado, 'bom');
    assert.equal(classificarResultado({ valorOk: true, listaOk: false }).rotulo, 'DEGRADADO');
    assert.equal(classificarResultado({ valorOk: false, listaOk: false }).rotulo, 'SEM PROMOÇÃO');
});

test('precisaLista impede que uma página de produto finja ser uma lista completa', async (t) => {
    const servidor = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        if (req.url === '/produto') {
            res.end('<span aria-label="frete grátis a partir de 149 Reais">Frete</span>');
        } else {
            res.end('<html><body>Vitrine sem promoção publicada.</body></html>');
        }
    });
    await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => servidor.close(resolve)));

    const endereco = servidor.address();
    const base = `http://127.0.0.1:${endereco.port}`;
    const anteriores = {
        loja: process.env.NATURA_STORE_URL,
        produtos: process.env.NATURA_PRODUTO_URLS,
        token: process.env.BROWSERLESS_TOKEN,
    };
    process.env.NATURA_STORE_URL = `${base}/vitrine`;
    process.env.NATURA_PRODUTO_URLS = `${base}/produto`;
    delete process.env.BROWSERLESS_TOKEN;

    t.after(() => {
        if (anteriores.loja === undefined) delete process.env.NATURA_STORE_URL;
        else process.env.NATURA_STORE_URL = anteriores.loja;
        if (anteriores.produtos === undefined) delete process.env.NATURA_PRODUTO_URLS;
        else process.env.NATURA_PRODUTO_URLS = anteriores.produtos;
        if (anteriores.token === undefined) delete process.env.BROWSERLESS_TOKEN;
        else process.env.BROWSERLESS_TOKEN = anteriores.token;
    });

    const modulo = await import(`../lib/natura.js?orquestracao=${Date.now()}`);
    const soValor = await modulo.lerFrete({ precisaLista: false });
    assert.equal(soValor.valor, '149');
    assert.equal(soValor.fonteValor, modulo.FONTE_PRODUTO);

    const listaCompleta = await modulo.lerFrete({ precisaLista: true });
    assert.equal(listaCompleta.valor, '149');
    assert.deepEqual(listaCompleta.linhas, []);
    assert.equal(listaCompleta.valorOk, true);
    assert.equal(listaCompleta.listaOk, false);
    assert.equal(listaCompleta.completo, false);
});

test('painel entrega loading, retry e semântica acessível antes da consulta', () => {
    const resposta = {
        headers: {},
        setHeader(nome, valor) { this.headers[nome] = valor; },
        status(codigo) { this.statusCode = codigo; return this; },
        send(corpo) { this.body = corpo; return this; },
    };
    statusHandler({ method: 'GET', query: { fast: '1' }, url: '/?fast=1' }, resposta);
    assert.equal(resposta.statusCode, 200);
    assert.match(resposta.body, /aria-live="polite"/);
    assert.match(resposta.body, />CONSULTANDO</);
    assert.match(resposta.body, /Atualizar agora/);
    assert.match(resposta.body, /aria-current="page" class="atual">Rápido/);
    assert.match(resposta.body, /<details>/);
    assert.match(resposta.body, /scope = 'row'/);
    const inicioScript = resposta.body.indexOf('<script>') + '<script>'.length;
    const fimScript = resposta.body.indexOf('</script>');
    assert.doesNotThrow(() => new Script(resposta.body.slice(inicioScript, fimScript)));
});
