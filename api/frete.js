import { lerFrete, amostraTexto } from '../lib/natura.js';

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    try {
        // Esta rota devolve só o valor, então não precisa da lista de faixas — e assim a
        // leitura para na página de produto, sem tocar na vitrine nem no Browserless.
        const { valor, textos } = await lerFrete({ precisaLista: false });

        if (valor) {
            // Retorna estritamente o valor capturado (ex: 149 ou 99,00) sem manipulação
            res.status(200).send(valor);
        } else {
            res.status(200).send('FALHA_REGEX: O padrão falhou. Texto lido: ' + amostraTexto(textos));
        }
    } catch (error) {
        res.status(500).send('ERRO_TECNICO: ' + error.message);
    }
}
