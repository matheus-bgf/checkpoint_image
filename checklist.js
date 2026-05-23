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

        console.log('[INFO] Esperando dashboard renderizar...');

        await page.waitForLoadState('networkidle');

        // Espera extra para os gráficos renderizarem
        await page.waitForTimeout(10000);

        // ================================
        // MINIMIZA MENU LATERAL
        // ================================

        console.log('[INFO] Minimando menu lateral...');

        try {

            const selectors = [
                '[aria-label="Toggle menu"]',
                '[aria-label="Open menu"]',
                '[aria-label="Close menu"]',
                'button[aria-label*="menu"]'
            ];

            for (const selector of selectors) {

                const button = page.locator(selector).first();

                if (await button.count() > 0) {

                    await button.click();

                    console.log('[OK] Menu lateral minimizado.');

                    await page.waitForTimeout(1500);

                    break;
                }
            }

        } catch (error) {

            console.log('[WARN] Não foi possível minimizar o menu lateral.');

        }

        // ================================
        // REMOVE BARRA SUPERIOR
        // ================================

        console.log('[INFO] Removendo barra superior...');

        await page.evaluate(() => {

            const topBar =
                document.querySelector('header');

            if (topBar) {
                topBar.style.display = 'none';
            }

            document.querySelectorAll(`
                .top-nav-bar,
                .page-toolbar,
                .dashboard-controls,
                .toolbar,
                .page-header,
                [data-testid="page-toolbar"],
                [data-testid="dashboard-controls"]
            `).forEach(el => {
                el.style.display = 'none';
            });

            // Ajusta conteúdo principal
            const main =
                document.querySelector('main') ||
                document.querySelector('.app-body') ||
                document.querySelector('.page-scrollbar');

            if (main) {
                main.style.marginTop = '0';
                main.style.paddingTop = '0';
                main.style.width = '100%';
                main.style.maxWidth = '100%';
            }

            document.body.style.margin = '0';
            document.body.style.padding = '0';

        });

        // Espera layout reajustar
        await page.waitForTimeout(1000);

        // Volta para o topo
        await page.evaluate(() => {
            window.scrollTo(0, 0);
        });

        // ================================
        // PREPARA PASTA
        // ================================

        const outputDir = process.env.OUTPUT_DIR || './prints';

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Nome fixo
        const screenshotName =
            process.env.SCREENSHOT_NAME || 'dashboard.png';

        const screenshotPath = path.join(outputDir, screenshotName);

        console.log('[INFO] Removendo print antigo...');

        if (fs.existsSync(screenshotPath)) {
            fs.unlinkSync(screenshotPath);
        }

        // ================================
        // SCREENSHOT
        // ================================

        console.log('[INFO] Tirando screenshot...');

        await page.screenshot({
            path: screenshotPath,
            fullPage: false
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
