const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    let browser = null;
    const url = "https://www.minhaloja.natura.com/c/promocoes?consultoria=helium&marca=natura";

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
        
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

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
            res.status(200).send("");
        }

    } catch (error) {
        res.status(200).send("");
    } finally {
        if (browser !== null) {
            await browser.close();
        }
    }
}
