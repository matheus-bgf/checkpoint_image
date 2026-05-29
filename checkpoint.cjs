/**
 * APIs importadas para a execução do código
 */
require('module').globalPaths.push('../../node_modules');
const os = require('os');
const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const http = require('http');
const dotenv = require('dotenv');

/**
 * Carregar variáveis de ambiente do arquivo .env
 */
dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * Configurações específicas da CNPEM
 */
const CNPEM_WAZUH_URL = process.env.WAZUH_CNPEM_URL;
const CNPEM_USERNAME = process.env.WAZUH_CNPEM_USERNAME;
const CNPEM_PASSWORD = process.env.WAZUH_CNPEM_PASSWORD;
const CNPEM_IMG_PATH = path.join(__dirname, 'prints', 'Checkpoint.png');
const CNPEM_CHAT_ID = process.env.WHATSAPP_GRUPO_Copastur;

/**
 * Iniciar o processamento imediatamente
 */
console.log('🟩 Iniciando o checkpoint da CNPEM...');
checkCNPEMCheckpointAndSend()
  .then(() => console.log('🟩 Checkpoint concluído.'))
  .catch(error => console.error('🔴 Erro na execução do checkpoint:', error));

/**
 * Função auxiliar para aguardar um determinado tempo (em ms)
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


/**
 * =========================================================
 * Helpers robustos para Kibana/Wazuh (SPA)
 * =========================================================
 */
function normalizeBaseUrl(url) {
  const u = (url || '').trim();
  if (!u) return '';
  return u.endsWith('/') ? u : u + '/';
}

/**
 * Auto-detecta o "base" real após redirects (inclui basePath)
 * Ex: input https://10.0.0.1/  -> após redirects cai em https://10.0.0.1/414102/login
 * e devolve https://10.0.0.1/414102/
 */
async function detectEffectiveBaseUrl(page) {
  const current = page.url(); // ex: https://host/414102/login?next=...
  const u = new URL(current);

  // remove query/hash
  const pathName = u.pathname;

  // tenta cortar em "/login" se existir
  const idx = pathName.indexOf('/login');
  const basePath = idx >= 0 ? pathName.slice(0, idx + 1) : (pathName.endsWith('/') ? pathName : pathName + '/');

  return `${u.origin}${basePath}`;
}

/**
 * Espera DOM estabilizar (sem mudanças) por X ms
 */
async function waitForDomStability(page, timeoutMs = 240000, stableForMs = 3000) {
  await page.waitForFunction(
    (stableFor) => {
      const now = performance.now();

      if (!window.__lastDomChange) window.__lastDomChange = now;

      if (!window.__domObsStarted) {
        const obs = new MutationObserver(() => {
          window.__lastDomChange = performance.now();
        });
        obs.observe(document.body, { childList: true, subtree: true, attributes: true });
        window.__domObsStarted = true;
      }

      return (now - window.__lastDomChange) > stableFor;
    },
    { timeout: timeoutMs },
    stableForMs
  );
}

/**
 * Espera spinners sumirem (EUI/Kibana)
 */
async function waitForSpinnersGone(page, timeoutMs = 300000) {
  await page.waitForFunction(() => {
    const sels = [
      '.euiLoadingSpinner',
      '[data-test-subj="loadingSpinner"]',
      '[data-test-subj="globalLoadingIndicator"]'
    ];
    return sels.every(sel => document.querySelectorAll(sel).length === 0);
  }, { timeout: timeoutMs });
}

/**
 * Confirma sessão por fetch autenticado respeitando basePath:
 * - SEM "/" no começo
 * - tenta mais de um endpoint, porque builds diferentes mudam
 */
async function assertSessionByFetch(page, timeoutMs = 60000) {
  await page.waitForFunction(async () => {
    try {
      // tenta dois endpoints; basta 1 dar 200
      const r1 = await fetch('api/status', { credentials: 'include' });
      if (r1 && r1.status === 200) return true;

      // fallback comum em Kibana
      const r2 = await fetch('internal/security/me', { credentials: 'include' });
      if (r2 && (r2.status === 200 || r2.status === 204)) return true;

      return false;
    } catch (e) {
      return false;
    }
  }, { timeout: timeoutMs });
}

/**
 * CHECKPOINT – ACESSAR THREAT HUNTER DO WAZUH 4.12
 */
async function checkCNPEMCheckpointAndSend() {

  console.log('CNPEM_URL:', CNPEM_WAZUH_URL);

  const initialBase = normalizeBaseUrl(CNPEM_WAZUH_URL);

  if (!initialBase) {
    console.error('❌ WAZUH_CNPEM_URL não definido no .env');
    return;
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    ignoreHTTPSErrors: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-certificate-errors',
      '--allow-insecure-localhost',
      '--disable-dev-shm-usage',
      '--window-size=1920,1080',
      '--no-default-browser-check',
      '--no-first-run',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });

  const page = await browser.newPage();

  page.setDefaultNavigationTimeout(180000);
  page.setDefaultTimeout(180000);

  await page.setViewport({
    width: 1920,
    height: 1080
  });

  page.on('pageerror', (err) =>
    console.error('⚠ pageerror:', err)
  );

  page.on('error', (err) =>
    console.error('⚠ puppeteer error:', err)
  );

  page.on('requestfailed', (req) =>
    console.log(
      'REQ FAIL:',
      req.url(),
      req.failure()?.errorText
    )
  );

  const unauthorizedUrls = [];

  page.on('response', (res) => {
    if (res.status() === 401) {
      const url = res.url();

      unauthorizedUrls.push(url);

      console.log('⚠ 401 em:', url);
    }
  });

  try {

    console.log('🟩 Acessando login...');

    await page.goto(`${initialBase}login`, {
      waitUntil: 'networkidle2',
      timeout: 180000
    });

    await page.waitForSelector(
      'input[data-test-subj="user-name"]',
      { timeout: 60000 }
    );

    await page.waitForSelector(
      'input[data-test-subj="password"]',
      { timeout: 60000 }
    );

    await page.type(
      'input[data-test-subj="user-name"]',
      CNPEM_USERNAME,
      { delay: 50 }
    );

    await page.type(
      'input[data-test-subj="password"]',
      CNPEM_PASSWORD,
      { delay: 50 }
    );

    await Promise.allSettled([
      page.click('button[data-test-subj="submit"]'),
      page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: 60000
      })
    ]);

    console.log('🟩 Login enviado.');

    const effectiveBaseUrl =
      await detectEffectiveBaseUrl(page);

    console.log(
      '🟩 BaseUrl efetiva:',
      effectiveBaseUrl
    );

    await assertSessionByFetch(page, 60000);

    console.log(
      '🟩 Sessão autenticada.'
    );

    await page.goto(
      `${effectiveBaseUrl}app/wz-home`,
      {
        waitUntil: 'domcontentloaded',
        timeout: 90000
      }
    );

    await wait(1500);

    await waitForSpinnersGone(page, 300000)
      .catch(() => {});

    await waitForDomStability(
      page,
      180000,
      2500
    ).catch(() => {});

    console.log(
      '🟩 Wazuh Home carregado.'
    );

    await page.goto(
      `${effectiveBaseUrl}threat-hunting#/overview/?tab=general&tabView=dashboard&_a=(filters:!(),query:(language:kuery,query:''))&_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-12h,to:now))`,
      {
        waitUntil: 'domcontentloaded',
        timeout: 300000
      }
    );

    await wait(10000);

    await waitForSpinnersGone(
      page,
      300000
    ).catch(() => {});

    await waitForDomStability(
      page,
      900000,
      10000
    );

    if (unauthorizedUrls.length > 0) {

      const top = unauthorizedUrls
        .slice(0, 8)
        .join('\n');

      console.warn(
        `⚠ Detectei ${unauthorizedUrls.length} respostas 401.\n\n${top}`
      );
    }

    console.log(
      '🟩 Threat Hunter carregado.'
    );

    const imgDir =
      path.dirname(CNPEM_IMG_PATH);

    if (!fs.existsSync(imgDir)) {
      fs.mkdirSync(imgDir, {
        recursive: true
      });
    }

    await wait(10000);

    await page.screenshot({
      path: CNPEM_IMG_PATH,
      fullPage: false
    });

    console.log(
      `📸 Screenshot salvo em ${CNPEM_IMG_PATH}`
    );

  } catch (error) {

    console.error(
      '🔴 Erro ao capturar Threat Hunter:',
      error
    );

    console.error(
      `❌ ${error.message}`
    );

  } finally {

    try {
      await browser.close();
    } catch {}

  }
}