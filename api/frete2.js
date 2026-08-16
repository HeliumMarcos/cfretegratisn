import { lerFrete } from '../lib/natura.js';

export default async function handler(req, res) {
    // Define a resposta como texto plano com suporte a quebras de linha reais
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method && !['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).send('METODO_NAO_PERMITIDO: Use GET.');
    }

    try {
        const { linhas } = await lerFrete({ precisaLista: true });

        if (linhas.length > 0) {
            // O uso de \n garante que o HostGator receba e exiba um por linha
            res.setHeader('X-Result-Status', 'ok');
            res.status(200).send(linhas.join('\n'));
        } else {
            res.setHeader('X-Result-Status', 'not-found');
            res.status(404).send('FALHA: Nenhum padrão de frete localizado.');
        }
    } catch (error) {
        res.setHeader('X-Result-Status', 'error');
        res.status(500).send('ERRO_TECNICO: ' + error.message);
    }
}
