const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    let browser = null;

    try {
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Espelhamento exato do seu código Python: domcontentloaded e 30s de timeout
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
            // Em vez de tela branca, informa se a Regex falhou ao ler o texto
            res.status(200).send("FALHA_REGEX: O banner foi lido, mas o padrão falhou. Texto lido: " + textoLimpo);
        }

    } catch (error) {
        // Em vez de tela branca, exibe o erro real (Timeout ou WAF)
        res.status(500).send("ERRO_TECNICO: " + error.message);
    } finally {
        if (browser !== null) {
            await browser.close();
        }
    }
}
