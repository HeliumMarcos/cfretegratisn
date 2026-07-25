const puppeteer = require('puppeteer-core');

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    let browser = null;

    try {
        // CONEXÃO REMOTA: A Vercel não abre o navegador localmente, ela conecta a um servidor externo
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

        const textoBanner = await page.$eval(seletor, el => el.innerText);
        const textoLimpo = textoBanner.replace(/\s+/g, ' ').trim();

        const regex = /frete gr[áa]tis Natura.*?R\$\s*(\d+(?:,\d{2})?)/i;
        const match = textoLimpo.match(regex);

        if (match) {
            let valorFinal = match[1];
            if (!valorFinal.includes(',')) {
                valorFinal += ",00";
            }
            res.status(200).send(valorFinal);
        } else {
            res.status(200).send("FALHA_REGEX: O padrão falhou. Texto lido: " + textoLimpo);
        }

    } catch (error) {
        res.status(500).send("ERRO_TECNICO: " + error.message);
    } finally {
        if (browser !== null) {
            await browser.close();
        }
    }
}
