import express from 'express';
import TurndownService from 'turndown';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

/**
 * Lightweight web-search sidecar for RU deployments where firecrawl.dev and
 * api.jina.ai are unreachable. Exposes two surfaces that mimic the upstream
 * providers so `@librechat/agents` talks to it unchanged:
 *
 *   POST /v2/scrape  — Firecrawl-compatible: fetches the page server-side
 *                      (RU-native egress) and returns cleaned markdown.
 *   POST /rerank     — Jina-compatible: forwards to AiTunnel's native rerank
 *                      endpoint and passes the (already matching) response back.
 *
 * Wiring is done entirely via .env on the LibreChat API container:
 *   FIRECRAWL_API_URL=http://websearch-helper:8787
 *   JINA_API_URL=http://websearch-helper:8787/rerank
 */

const PORT = Number(process.env.PORT) || 8787;
const AITUNNEL_BASE_URL = (process.env.AITUNNEL_BASE_URL || 'https://api.aitunnel.ru/v1').replace(
  /\/+$/,
  '',
);
const AITUNNEL_API_KEY = process.env.AITUNNEL_API_KEY || '';
const RERANK_MODEL = process.env.RERANK_MODEL || 'rerank-4-fast';
const SCRAPE_TIMEOUT_MS = Number(process.env.SCRAPE_TIMEOUT_MS) || 6500;
const SCRAPE_CONCURRENCY = Number(process.env.SCRAPE_CONCURRENCY) || 3;
const MAX_HTML_BYTES = Number(process.env.MAX_HTML_BYTES) || 5_000_000;
const MAX_CONTENT_CHARS = Number(process.env.MAX_CONTENT_CHARS) || 100_000;
const USER_AGENT =
  process.env.SCRAPE_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndown.remove(['script', 'style', 'noscript', 'iframe']);

/** Minimal fair semaphore so concurrent scrapes can't exhaust the small box. */
let activeScrapes = 0;
const scrapeWaiters = [];

function acquireScrapeSlot() {
  return new Promise((resolve) => {
    if (activeScrapes < SCRAPE_CONCURRENCY) {
      activeScrapes += 1;
      resolve();
      return;
    }
    scrapeWaiters.push(resolve);
  });
}

function releaseScrapeSlot() {
  const next = scrapeWaiters.shift();
  if (next) {
    next();
    return;
  }
  activeScrapes -= 1;
}

/**
 * @param {string} url
 * @returns {Promise<{ ok: boolean; statusCode: number; contentType: string; html?: string; unsupported?: boolean }>}
 */
async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru,en;q=0.8',
      },
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      return { ok: false, statusCode: response.status, contentType };
    }
    if (!/html/i.test(contentType)) {
      return { ok: false, statusCode: response.status, contentType, unsupported: true };
    }
    const body = await response.text();
    const html = body.length > MAX_HTML_BYTES ? body.slice(0, MAX_HTML_BYTES) : body;
    return { ok: true, statusCode: response.status, contentType, html };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rewrites every href/src to an absolute URL against the page URL. Relative
 * links (e.g. "/cinema/...") would otherwise reach `@librechat/agents`, whose
 * reference formatter calls `new URL(link)` without a base and throws.
 * @param {Document} document
 * @param {string} baseUrl
 */
function absolutizeUrls(document, baseUrl) {
  const fix = (selector, attr) => {
    document.querySelectorAll(selector).forEach((el) => {
      const raw = el.getAttribute(attr);
      if (!raw) {
        return;
      }
      try {
        el.setAttribute(attr, new URL(raw, baseUrl).href);
      } catch {
        el.removeAttribute(attr);
      }
    });
  };
  fix('a[href]', 'href');
  fix('img[src]', 'src');
}

/**
 * @param {string} html
 * @param {string} url
 * @returns {{ markdown: string; contentHtml: string; title: string; excerpt: string }}
 */
function extractArticle(html, url) {
  const { document } = parseHTML(html);
  absolutizeUrls(document, url);
  let article = null;
  try {
    article = new Readability(document).parse();
  } catch {
    article = null;
  }

  let contentHtml = article?.content || '';
  const title = (article?.title || document.querySelector('title')?.textContent || '').trim();
  const excerpt = (article?.excerpt || '').trim();

  if (!contentHtml) {
    const { document: fallbackDoc } = parseHTML(html);
    absolutizeUrls(fallbackDoc, url);
    const body = fallbackDoc.querySelector('body');
    if (body) {
      body
        .querySelectorAll('script,style,noscript,nav,header,footer,aside,form,iframe')
        .forEach((el) => el.remove());
      contentHtml = body.innerHTML || '';
    }
  }

  let markdown = '';
  try {
    markdown = turndown.turndown(contentHtml || '').trim();
  } catch {
    markdown = '';
  }
  if (markdown.length > MAX_CONTENT_CHARS) {
    markdown = markdown.slice(0, MAX_CONTENT_CHARS);
  }

  return { markdown, contentHtml, title, excerpt };
}

/**
 * @param {string} url
 * @returns {Promise<object>} Firecrawl-shaped response
 */
async function scrapeOne(url) {
  let fetched;
  try {
    fetched = await fetchHtml(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `fetch failed: ${message}` };
  }

  if (!fetched.ok) {
    const reason = fetched.unsupported
      ? `unsupported content-type: ${fetched.contentType}`
      : `status ${fetched.statusCode}`;
    return { success: false, error: reason };
  }

  const { markdown, contentHtml, title, excerpt } = extractArticle(fetched.html, url);
  if (!markdown) {
    return { success: false, error: 'no extractable content' };
  }

  return {
    success: true,
    data: {
      markdown,
      html: contentHtml,
      metadata: {
        title,
        description: excerpt,
        sourceURL: url,
        url,
        statusCode: fetched.statusCode,
      },
    },
  };
}

const app = express();
app.use(express.json({ limit: '25mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, rerankModel: RERANK_MODEL, aiTunnelKey: AITUNNEL_API_KEY ? 'set' : 'missing' });
});

app.post(['/v2/scrape', '/v1/scrape', '/scrape'], async (req, res) => {
  const url = req.body?.url;
  if (typeof url !== 'string' || url.length === 0) {
    res.json({ success: false, error: 'missing url' });
    return;
  }

  await acquireScrapeSlot();
  try {
    const result = await scrapeOne(url);
    if (!result.success) {
      console.error(`[scrape] ${url} -> ${result.error}`);
    }
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[scrape] ${url} -> ${message}`);
    res.json({ success: false, error: message });
  } finally {
    releaseScrapeSlot();
  }
});

app.post('/rerank', async (req, res) => {
  const { query, documents, top_n: topN } = req.body || {};
  if (typeof query !== 'string' || !Array.isArray(documents) || documents.length === 0) {
    res.json({ results: [] });
    return;
  }

  try {
    const response = await fetch(`${AITUNNEL_BASE_URL}/rerank`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AITUNNEL_API_KEY}`,
      },
      body: JSON.stringify({ model: RERANK_MODEL, query, documents, top_n: topN ?? 5 }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`[rerank] AiTunnel ${response.status}: ${text.slice(0, 200)}`);
      res.json({ results: [] });
      return;
    }

    const json = await response.json();
    res.json(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[rerank] error: ${message}`);
    res.json({ results: [] });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[websearch-helper] listening on :${PORT} | rerank model: ${RERANK_MODEL}`);
  if (!AITUNNEL_API_KEY) {
    console.warn('[websearch-helper] AITUNNEL_API_KEY is not set — reranking will fall back to default order.');
  }
});
