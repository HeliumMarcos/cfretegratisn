import { buscarTextosBoxInfo, extrairValor, extrairLista } from '../lib/natura.js';

function esc(texto) {
    return String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function linhaTabela(rotulo, valor) {
    return `<tr><th>${esc(rotulo)}</th><td>${esc(valor)}</td></tr>`;
}

export default async function handler(req, res) {
    const inicio = Date.now();

    const temToken = Boolean(process.env.BROWSERLESS_TOKEN);
    const host = process.env.BROWSERLESS_URL ?? 'https://chrome.browserless.io';
    const versao = process.env.BROWSERLESS_API_VERSION ?? 'v2';

    let erro = null;
    let textos = [];
    let valor = null;
    let linhas = [];

    try {
        textos = await buscarTextosBoxInfo();
        valor = extrairValor(textos).valor;
        linhas = extrairLista(textos);
    } catch (e) {
        erro = e.message;
    }

    const ms = Date.now() - inicio;
    const achouAlgo = valor !== null || linhas.length > 0;

    // Tres estados: erro de infra, conectou mas nao achou frete, e tudo certo.
    let estado, rotulo, detalhe;
    if (erro) {
        estado = 'ruim';
        rotulo = 'FORA DO AR';
        detalhe = erro;
    } else if (!achouAlgo) {
        estado = 'atencao';
        rotulo = 'ATENÇÃO';
        detalhe = `Conectou e leu ${textos.length} bloco(s), mas nenhum tinha frete grátis. `
            + 'Pode ser a promoção que saiu do ar ou o layout do site que mudou.';
    } else {
        estado = 'bom';
        rotulo = 'FUNCIONANDO';
        detalhe = 'As duas rotas estão respondendo com dados reais.';
    }

    const infos = [
        linhaTabela('Token', temToken ? 'configurado' : 'AUSENTE — defina BROWSERLESS_TOKEN'),
        linhaTabela('Host', host),
        linhaTabela('Formato da API', versao),
        linhaTabela('Blocos lidos', textos.length),
        linhaTabela('Tempo de resposta', `${ms} ms`),
        linhaTabela('Verificado em', new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })),
    ].join('');

    const amostraFrete = valor !== null
        ? `<pre>${esc(valor)}</pre>`
        : '<p class="vazio">sem valor</p>';

    const amostraFrete2 = linhas.length > 0
        ? `<pre>${esc(linhas.join('\n'))}</pre>`
        : '<p class="vazio">sem linhas</p>';

    const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Status — scraper Natura</title>
<style>
  :root { --bg:#0b0e13; --card:#151a22; --linha:#242c38; --txt:#e8edf5; --fraco:#8b96a8;
          --bom:#2fbf71; --atencao:#e0a72b; --ruim:#e2564d; }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f4f6fa; --card:#fff; --linha:#e2e7ef; --txt:#131820; --fraco:#5d6b80; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px 16px; background:var(--bg); color:var(--txt);
         font:16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width:640px; margin:0 auto; }
  h1 { font-size:1.05rem; font-weight:600; color:var(--fraco); margin:0 0 16px;
       text-transform:uppercase; letter-spacing:.09em; }
  .badge { display:flex; align-items:center; gap:12px; background:var(--card);
           border:1px solid var(--linha); border-left:5px solid var(--cor);
           border-radius:12px; padding:18px 20px; margin-bottom:14px; }
  .bom { --cor:var(--bom); } .atencao { --cor:var(--atencao); } .ruim { --cor:var(--ruim); }
  .bolinha { width:13px; height:13px; border-radius:50%; background:var(--cor); flex:none; }
  .rotulo { font-size:1.35rem; font-weight:700; letter-spacing:.02em; color:var(--cor); }
  .detalhe { background:var(--card); border:1px solid var(--linha); border-radius:12px;
             padding:14px 18px; margin-bottom:14px; color:var(--fraco); font-size:.93rem;
             overflow-wrap:anywhere; }
  section { background:var(--card); border:1px solid var(--linha); border-radius:12px;
            padding:6px 18px 16px; margin-bottom:14px; }
  h2 { font-size:.76rem; font-weight:700; color:var(--fraco); text-transform:uppercase;
       letter-spacing:.09em; margin:16px 0 8px; }
  table { width:100%; border-collapse:collapse; font-size:.93rem; }
  th { text-align:left; font-weight:500; color:var(--fraco); padding:8px 0;
       border-bottom:1px solid var(--linha); white-space:nowrap; }
  td { text-align:right; padding:8px 0; border-bottom:1px solid var(--linha);
       overflow-wrap:anywhere; }
  tr:last-child th, tr:last-child td { border-bottom:0; }
  pre { margin:0; padding:12px 14px; background:var(--bg); border:1px solid var(--linha);
        border-radius:8px; font-size:.88rem; white-space:pre-wrap; overflow-wrap:anywhere; }
  .vazio { margin:0; color:var(--fraco); font-style:italic; font-size:.9rem; }
  code { font-size:.88rem; }
  footer { color:var(--fraco); font-size:.83rem; text-align:center; margin-top:20px; }
  a { color:inherit; }
</style>
</head>
<body>
<main>
  <h1>Scraper Natura</h1>

  <div class="badge ${estado}">
    <span class="bolinha"></span>
    <span class="rotulo">${rotulo}</span>
  </div>

  <p class="detalhe">${esc(detalhe)}</p>

  <section>
    <h2>Rota /api/frete</h2>
    ${amostraFrete}
    <h2>Rota /api/frete2</h2>
    ${amostraFrete2}
  </section>

  <section>
    <h2>Diagnóstico</h2>
    <table>${infos}</table>
  </section>

  <footer>Esta página consulta o site da Natura ao vivo a cada acesso.</footer>
</main>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(erro ? 503 : 200).send(html);
}
