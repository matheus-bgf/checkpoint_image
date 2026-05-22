require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function main() {
    const browser = await chromium.launch({
        headless: process.env.HEADLESS !== 'false'
    });

    const page = await browser.newPage({
        viewport: {
            width: Number(process.env.VIEWPORT_WIDTH || 1920),
            height: Number(process.env.VIEWPORT_HEIGHT || 1080)
        }
    });

    try {
        console.log('[INFO] Acessando login do Grafana...');

        await page.goto(process.env.GRAFANA_LOGIN_URL, {
            waitUntil: 'networkidle',
            timeout: 60000
        });

        console.log('[INFO] Fazendo login...');

        await page.fill(
            process.env.GRAFANA_USER_SELECTOR || 'input[name="user"]',
            process.env.GRAFANA_USER
        );

        await page.fill(
            process.env.GRAFANA_PASSWORD_SELECTOR || 'input[name="password"]',
            process.env.GRAFANA_PASSWORD
        );

        await page.click(
            process.env.GRAFANA_LOGIN_BUTTON_SELECTOR || 'button[type="submit"]'
        );

        await page.waitForLoadState('networkidle');

        console.log('[INFO] Abrindo dashboard...');

        await page.goto(process.env.GRAFANA_DASHBOARD_URL, {
            waitUntil: 'networkidle',
            timeout: 120000
        });

        if (process.env.WAIT_SELECTOR) {
            console.log('[INFO] Esperando painel carregar...');

            await page.waitForSelector(process.env.WAIT_SELECTOR, {
                timeout: 120000
            });
        }

        const outputDir = process.env.OUTPUT_DIR || './prints';

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Nome fixo
        const screenshotName =
            process.env.SCREENSHOT_NAME || 'dashboard.png';

        const screenshotPath = path.join(outputDir, screenshotName);

        console.log('[INFO] Removendo print antigo...');

        // Remove o arquivo antigo se existir
        if (fs.existsSync(screenshotPath)) {
            fs.unlinkSync(screenshotPath);
        }

        console.log('[INFO] Tirando screenshot...');

        await page.screenshot({
            path: screenshotPath,
            fullPage: process.env.FULL_PAGE !== 'false'
        });

        console.log(`[OK] Screenshot salvo em: ${screenshotPath}`);
    } catch (error) {
        console.error('[ERRO]', error);
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
}

main();