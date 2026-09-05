import { lerFrete, amostraTexto } from '../lib/natura.js';
import { consultShipping } from '../lib/shipping-campaigns.js';

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Accept');

    if (req.method && !['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).send('METODO_NAO_PERMITIDO: Use GET.');
    }

    try {
        // Contrato v2: mantém fonte, validade e condições. Clientes legados seguem
        // recebendo a referência numérica, sem perder silenciosamente restrições.
        if (String(req.headers?.accept ?? '').includes('application/json') || req.query?.format === 'json') {
            const result = await consultShipping();
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Vary', 'Accept');
            res.setHeader('X-Result-Status', result.status === 'error' ? 'error' : 'ok');
            return res.status(result.status === 'error' ? 503 : 200).json(result);
        }
        // Compatibilidade: texto puro não transporta condições de campanhas.
        const { valor, textos } = await lerFrete();

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
