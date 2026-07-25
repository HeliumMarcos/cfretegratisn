const puppeteer = require('puppeteer-core');

export default async function handler(req, res) {
    // Define a resposta como texto plano com suporte a quebras de linha reais
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    let browser = null;

    try {
        browser = await puppeteer.connect({
            browserWSEndpoint: 'wss://chrome.browserless.io?token=SUA_CHAVE_AQUI' // Mantenha sua chave real aqui
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.goto("https://www.minhaloja.natura.com/c/promocoes?consultoria=helium&marca=natura", { 
            waitUntil: 'domcontentloaded', 
            timeout: 30000 
        });

        const seletor = '[data-testid="box-info"]';
        await page.waitForSelector(seletor, { visible: true, timeout: 10000 });

        const textos = await page.$$eval(seletor, els => els.map(el => el.innerText));
        
        let resultados = [];

        textos.forEach(texto => {
            const textoLimpo = texto.replace(/\s+/g, ' ').trim();
            
            if (/frete/i.test(textoLimpo)) {
                // Regex expandido: Grupo 1 captura o texto antes do R$ / Grupo 2 captura o valor numérico
                const regex = /frete gr[áa]tis\s+(.*?)\s*R\$\s*(\d+(?:,\d{2})?)/gi;
                let match;
                
                while ((match = regex.exec(textoLimpo)) !== null) {
                    // Limpa preposições e termos genéricos para extrair apenas o nome da marca/categoria
                    let especificacao = match[1]
                        .replace(/acima de|a partir de|nas compras|em compras/gi, '')
                        .trim();
                    
                    // Padronização: se a string ficar vazia, assume "Geral". Caso contrário, capitaliza a primeira letra.
                    if (especificacao.length > 0) {
                        especificacao = especificacao.charAt(0).toUpperCase() + especificacao.slice(1).toLowerCase();
                    } else {
                        especificacao = "Geral";
                    }

                    // Constrói a formatação exata solicitada
                    const linha = `Frete Grátis de "${especificacao}" : ${match[2]}`;
                    
                    // Evita linhas duplicadas na saída
                    if (!resultados.includes(linha)) {
                        resultados.push(linha);
                    }
                }
            }
        });

        if (resultados.length > 0) {
            // O uso de \n garante que o HostGator receba e exiba um por linha
            res.status(200).send(resultados.join('\n'));
        } else {
            res.status(200).send("FALHA: Nenhum padrão de frete localizado.");
        }

    } catch (error) {
        res.status(500).send("ERRO_TECNICO: " + error.message);
    } finally {
        if (browser !== null) {
            await browser.close();
        }
    }
}
