const puppeteer = require('puppeteer-core');

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    let browser = null;

    try {
        browser = await puppeteer.connect({
            browserWSEndpoint: 'wss://chrome.browserless.io?token=2Ux9B22vueQgoFx1aeb6ba3810f2ee90cfb06f8d5ae127f48'
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.goto("https://www.minhaloja.natura.com/c/promocoes?consultoria=helium&marca=natura", { 
            waitUntil: 'domcontentloaded', 
            timeout: 30000 
        });

        const seletor = '[data-testid="box-info"]';
        await page.waitForSelector(seletor, { visible: true, timeout: 10000 });

        // Extrai o texto de TODOS os banners promocionais simultaneamente
        const textos = await page.$$eval(seletor, els => els.map(el => el.innerText));
        
        let todosValores = [];

        textos.forEach(texto => {
            const textoLimpo = texto.replace(/\s+/g, ' ').trim();
            
            // Filtra os blocos que contêm regras de frete
            if (/frete/i.test(textoLimpo)) {
                // Regex global para extrair múltiplos valores na mesma frase
                const regex = /R\$\s*(\d+(?:,\d{2})?)/gi;
                let match;
                
                // Laço de repetição para capturar todos os resultados
                while ((match = regex.exec(textoLimpo)) !== null) {
                    todosValores.push(match[1]);
                }
            }
        });

        if (todosValores.length > 0) {
            // Remove valores duplicados caso a loja repita banners
            const valoresUnicos = [...new Set(todosValores)];
            
            // Retorna os valores brutos separados por uma barra vertical
            res.status(200).send(valoresUnicos.join(' | '));
        } else {
            res.status(200).send("FALHA_REGEX: Nenhum valor localizado nos textos.");
        }

    } catch (error) {
        res.status(500).send("ERRO_TECNICO: " + error.message);
    } finally {
        if (browser !== null) {
            await browser.close();
        }
    }
}
