import { FAST_PADRAO } from '../lib/natura.js';

function lerFast(req) {
    const bruto = req?.query?.fast
        ?? new URL(req?.url ?? '/', 'http://local').searchParams.get('fast');
    if (bruto === '1') return true;
    if (bruto === '0') return false;
    return FAST_PADRAO;
}

export default function handler(req, res) {
    if (req.method && !['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).send('Método não permitido. Use GET.');
    }

    const fast = lerFast(req);
    const normalAtual = fast ? '' : ' aria-current="page" class="atual"';
    const rapidoAtual = fast ? ' aria-current="page" class="atual"' : '';
    const dataUrl = `/api/status-data?fast=${fast ? '1' : '0'}`;

    const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="robots" content="noindex,nofollow">
<title>Status — scraper Natura</title>
<style>
  :root {
    --bg:#0b0e13; --card:#151a22; --card-2:#10151c; --linha:#2c3543;
    --txt:#e8edf5; --fraco:#9aa6b8; --bom:#42d486; --atencao:#f0b63c;
    --ruim:#ff7068; --carregando:#78a9ff; --foco:#9cc1ff;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg:#f4f6fa; --card:#fff; --card-2:#f7f9fc; --linha:#d5dce7;
      --txt:#131820; --fraco:#536176; --bom:#176b43; --atencao:#765000;
      --ruim:#a8231a; --carregando:#285ea8; --foco:#174ea6;
    }
  }
  * { box-sizing:border-box; }
  body { margin:0; padding:24px 16px 36px; background:var(--bg); color:var(--txt);
         font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  main { max-width:720px; margin:0 auto; }
  header { margin-bottom:16px; }
  h1 { font-size:1.05rem; font-weight:700; color:var(--fraco); margin:0;
       text-transform:uppercase; letter-spacing:.09em; }
  h2 { font-size:.8rem; font-weight:800; color:var(--fraco); text-transform:uppercase;
       letter-spacing:.09em; margin:0 0 12px; }
  h3 { font-size:.92rem; margin:0 0 8px; }
  .badge { display:flex; align-items:center; gap:12px; background:var(--card);
           border:1px solid var(--linha); border-left:5px solid var(--cor);
           border-radius:12px; padding:18px 20px; margin-bottom:14px; }
  .bom { --cor:var(--bom); } .atencao { --cor:var(--atencao); }
  .ruim { --cor:var(--ruim); } .carregando { --cor:var(--carregando); }
  .bolinha { width:13px; height:13px; border-radius:50%; background:var(--cor); flex:none; }
  .rotulo { font-size:1.35rem; font-weight:800; letter-spacing:.02em; color:var(--cor); }
  .detalhe { background:var(--card); border:1px solid var(--linha); border-radius:12px;
             padding:14px 18px; margin:0 0 14px; color:var(--fraco); font-size:.95rem;
             overflow-wrap:anywhere; }
  section, details { background:var(--card); border:1px solid var(--linha); border-radius:12px;
                     padding:18px; margin-bottom:14px; }
  .resultados { display:block; }
  .resultado { min-width:0; background:var(--card-2); border:1px solid var(--linha);
               border-radius:10px; padding:14px; }
  .resultado output { display:block; min-height:48px; white-space:pre-wrap; overflow-wrap:anywhere;
                      font:600 .93rem/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; }
  .resultado[data-ok="true"] { border-color:var(--bom); }
  .resultado[data-ok="false"] { border-color:var(--atencao); }
  .vazio { color:var(--fraco); font-style:italic; }
  .acoes { display:flex; flex-wrap:wrap; gap:10px; align-items:stretch; }
  nav { display:flex; flex:1 1 260px; gap:10px; }
  nav a, button { min-height:46px; border:1px solid var(--linha); border-radius:9px;
                  background:var(--card-2); color:var(--txt); font:inherit; font-size:.95rem;
                  font-weight:700; line-height:1.2;
                  text-decoration:none; display:inline-flex; align-items:center;
                  justify-content:center; padding:11px 16px; cursor:pointer; }
  nav a { flex:1; }
  nav a.atual { border-color:var(--bom); color:var(--bom); box-shadow:inset 0 0 0 1px var(--bom); }
  button:hover, nav a:hover { background:var(--bg); }
  button:disabled { cursor:wait; opacity:.65; }
  :focus-visible { outline:3px solid var(--foco); outline-offset:3px; }
  details { padding:0; overflow:hidden; }
  summary { cursor:pointer; padding:16px 18px; color:var(--txt); font-weight:750; }
  details[open] summary { border-bottom:1px solid var(--linha); }
  .diagnostico { padding:8px 18px 18px; }
  table { width:100%; border-collapse:collapse; font-size:.92rem; }
  .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px;
             overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  th { text-align:left; font-weight:600; color:var(--fraco); padding:9px 10px 9px 0;
       border-bottom:1px solid var(--linha); vertical-align:top; }
  td { text-align:right; padding:9px 0; border-bottom:1px solid var(--linha);
       overflow-wrap:anywhere; }
  tr:last-child th, tr:last-child td { border-bottom:0; }
  pre { margin:12px 0 0; padding:12px 14px; background:var(--card-2);
        border:1px solid var(--linha); border-radius:8px; font-size:.86rem;
        white-space:pre-wrap; overflow-wrap:anywhere; }
  footer { color:var(--fraco); font-size:.83rem; text-align:center; margin-top:20px; }
  @media (max-width:540px) {
    body { padding:16px 12px 28px; }
    section { padding:15px; }
    th { width:42%; }
  }
</style>
</head>
<body>
<main>
  <header><h1>Scraper Natura</h1></header>
  <output id="estado" class="badge carregando" role="status" aria-live="polite" aria-busy="true">
    <span class="bolinha" aria-hidden="true"></span>
    <span id="rotulo" class="rotulo">CONSULTANDO</span>
  </output>
  <p id="detalhe" class="detalhe">Buscando os valores atuais de frete grátis…</p>

  <section aria-labelledby="resultados-titulo">
    <h2 id="resultados-titulo">Resultado da rota</h2>
    <div class="resultados">
      <article id="resultado-frete" class="resultado" aria-labelledby="frete-titulo">
        <h3 id="frete-titulo">/api/frete</h3>
        <output id="frete-valor" class="vazio">aguardando…</output>
      </article>
    </div>
  </section>

  <section aria-labelledby="acoes-titulo">
    <h2 id="acoes-titulo">Consulta</h2>
    <div class="acoes">
      <nav aria-label="Modo de consulta">
        <a href="/?fast=0"${normalAtual}>Normal</a>
        <a href="/?fast=1"${rapidoAtual}>Rápido</a>
      </nav>
      <button id="recarregar" type="button">Atualizar agora</button>
    </div>
  </section>

  <details>
    <summary>Diagnóstico técnico</summary>
    <div class="diagnostico">
      <table>
        <caption class="sr-only">Detalhes técnicos da última consulta</caption>
        <tbody id="linhas-diagnostico"></tbody>
      </table>
      <h2 style="margin-top:18px">Texto lido</h2>
      <pre id="texto-lido">aguardando…</pre>
    </div>
  </details>
  <footer id="rodape">Esta página consulta o site da Natura ao vivo.</footer>
</main>
<script>
(() => {
  const dataUrl = ${JSON.stringify(dataUrl)};
  const estado = document.querySelector('#estado');
  const rotulo = document.querySelector('#rotulo');
  const detalhe = document.querySelector('#detalhe');
  const botao = document.querySelector('#recarregar');
  const freteCard = document.querySelector('#resultado-frete');
  const freteValor = document.querySelector('#frete-valor');
  const linhasDiagnostico = document.querySelector('#linhas-diagnostico');
  const textoLido = document.querySelector('#texto-lido');
  const rodape = document.querySelector('#rodape');
  let controlador;

  function textoResultado(elemento, valor, vazio) {
    elemento.textContent = valor || vazio;
    elemento.classList.toggle('vazio', !valor);
  }

  function preencherDiagnostico(dados) {
    linhasDiagnostico.replaceChildren();
    const rotulos = {
      token:'Token', host:'Host', apiBrowserless:'Formato da API', fastPedido:'Modo pedido',
      modo:'Modo aplicado', fonteValor:'Fonte do valor',
      produto:'Produto', espera:'Espera', tentativas:'Tentativas',
      blocosLidos:'Blocos lidos', erroFallback:'Erro do fallback'
    };
    for (const [chave, rotuloLinha] of Object.entries(rotulos)) {
      const linha = document.createElement('tr');
      const cabecalho = document.createElement('th');
      const valor = document.createElement('td');
      cabecalho.scope = 'row';
      cabecalho.textContent = rotuloLinha;
      valor.textContent = String(dados[chave] ?? '—');
      linha.append(cabecalho, valor);
      linhasDiagnostico.append(linha);
    }
    textoLido.textContent = dados.textoLido || 'nada foi lido';
  }

  function renderizar(dados) {
    const classe = ['bom','atencao','ruim'].includes(dados.estado) ? dados.estado : 'ruim';
    estado.className = 'badge ' + classe;
    estado.setAttribute('aria-busy', 'false');
    rotulo.textContent = dados.rotulo || 'SEM RESPOSTA';
    detalhe.textContent = dados.detalhe || 'A consulta não retornou detalhes.';
    const frete = dados.resultados?.frete ?? { ok:false, valor:null };
    freteCard.dataset.ok = String(Boolean(frete.ok));
    textoResultado(freteValor, frete.valor, 'sem valor confiável');
    preencherDiagnostico(dados.diagnostico ?? {});
    const quando = dados.verificadoEm ? new Date(dados.verificadoEm).toLocaleString('pt-BR') : 'agora';
    const duracao = Number.isFinite(dados.duracaoMs) ? ' em ' + dados.duracaoMs + ' ms' : '';
    rodape.textContent = 'Última verificação: ' + quando + duracao + '.';
  }

  function mostrarErroLocal(mensagem) {
    renderizar({
      estado:'ruim', rotulo:'SEM RESPOSTA', detalhe:mensagem,
      resultados:{frete:{ok:false,valor:null}},
      diagnostico:{erroFallback:mensagem,textoLido:'nada foi lido'},
      verificadoEm:new Date().toISOString()
    });
  }

  async function carregar() {
    controlador?.abort();
    controlador = new AbortController();
    const timeout = setTimeout(() => controlador.abort(), 29000);
    botao.disabled = true;
    botao.textContent = 'Atualizando…';
    estado.className = 'badge carregando';
    estado.setAttribute('aria-busy', 'true');
    rotulo.textContent = 'CONSULTANDO';
    detalhe.textContent = 'Buscando os valores atuais de frete grátis…';
    try {
      const resposta = await fetch(dataUrl, {cache:'no-store',signal:controlador.signal});
      const dados = await resposta.json();
      renderizar(dados);
    } catch (erro) {
      const mensagem = erro?.name === 'AbortError'
        ? 'A consulta excedeu 29 segundos. Tente novamente.'
        : 'Não foi possível consultar o serviço. Verifique sua conexão e tente novamente.';
      mostrarErroLocal(mensagem);
    } finally {
      clearTimeout(timeout);
      botao.disabled = false;
      botao.textContent = 'Atualizar agora';
    }
  }

  botao.addEventListener('click', carregar);
  carregar();
})();
</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(html);
}
