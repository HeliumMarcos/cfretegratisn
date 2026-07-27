import { buscarTextosBoxInfo, extrairLista } from '../lib/natura.js';

export default async function handler(req, res) {
    // Define a resposta como texto plano com suporte a quebras de linha reais
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    try {
        const textos = await buscarTextosBoxInfo();
        const resultados = extrairLista(textos);

        if (resultados.length > 0) {
            // O uso de \n garante que o HostGator receba e exiba um por linha
            res.status(200).send(resultados.join('\n'));
        } else {
            res.status(200).send('FALHA: Nenhum padrão de frete localizado.');
        }
    } catch (error) {
        res.status(500).send('ERRO_TECNICO: ' + error.message);
    }
}
