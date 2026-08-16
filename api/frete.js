import { lerFrete, amostraTexto } from '../lib/natura.js';

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method && !['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).send('METODO_NAO_PERMITIDO: Use GET.');
    }

    try {
        // Esta rota devolve só o valor, então não precisa da lista de faixas — e assim a
        // leitura para na página de produto, sem tocar na vitrine nem no Browserless.
        const { valor, textos } = await lerFrete({ precisaLista: false });

        if (valor !== null) {
            // Retorna estritamente o valor capturado (ex: 149 ou 99,00) sem manipulação
            res.setHeader('X-Result-Status', 'ok');
            res.status(200).send(valor);
        } else {
            res.setHeader('X-Result-Status', 'not-found');
            res.status(404).send('FALHA_REGEX: O padrão falhou. Texto lido: ' + amostraTexto(textos));
        }
    } catch (error) {
        res.setHeader('X-Result-Status', 'error');
        res.status(500).send('ERRO_TECNICO: ' + error.message);
    }
}
