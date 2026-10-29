// Lacoste storefront acquisition/verification (Trello #10, Slice 2).
//
// Approach confirmed by direct exploration against the live site (see Slice
// 2 report): a single headed Chromium page visits the BRECOM homepage once
// per run to establish Akamai-trusted session cookies, then every
// PRODUTO:COR combination is resolved via the same-origin
// Product-PartialsData endpoint, called with `fetch()` from that page's
// JS context (never via page.goto() to the endpoint itself — direct
// top-level navigation to /on/demandware.store/... controller URLs gets
// silently bounced to the homepage; this does not happen for in-page
// fetch() calls, nor for the site's own SEO-friendly `/{pid}.html` URLs).
// No per-item page navigation is needed: the same homepage-established
// session context serves every item's fetch() call correctly, which keeps
// this run to one browser instance / one navigation regardless of how many
// combinations are requested.

import { chromium } from 'playwright';

const HOMEPAGE_URL = 'https://www.lacoste.com.br/';
const PARTIALS_PATH = '/on/demandware.store/Sites-BRECOM-Site/pt_BR/Product-PartialsData';
const FETCH_TIMEOUT_MS = 20000;
const NAV_TIMEOUT_MS = 60000;

export async function launchSession() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(HOMEPAGE_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await page.waitForTimeout(1500);

  // Didomi cookie-consent overlay intercepts clicks/layout until dismissed.
  const consentBtn = await page.$('#didomi-notice-agree-button, button[id*="agree" i]');
  if (consentBtn) {
    await consentBtn.click().catch(() => {});
    await page.waitForTimeout(1000);
  }

  const origin = new URL(page.url()).origin;
  return { browser, page, origin };
}

export async function closeSession(session) {
  if (!session) return;
  await session.browser.close().catch(() => {});
}

async function fetchPartialsData(page, origin, produto, cor) {
  const url = `${origin}${PARTIALS_PATH}?pid=${encodeURIComponent(produto)}&color=${encodeURIComponent(cor)}&full=true`;
  const result = await page.evaluate(
    async ({ url, timeoutMs }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(url, { credentials: 'include', signal: controller.signal });
        const text = await resp.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          // Non-JSON body (e.g. an interstitial/challenge page) — surfaced
          // as a NOT_FOUND-equivalent by the caller via `json === null`.
        }
        return { httpStatus: resp.status, json, bodyLength: text.length };
      } catch (err) {
        return { fetchError: err?.message ?? String(err) };
      } finally {
        clearTimeout(timer);
      }
    },
    { url, timeoutMs: FETCH_TIMEOUT_MS }
  );
  return { url, ...result };
}

// The approved conceptual outcomes. AMBIGUOUS is reserved for a JSON shape
// that doesn't fit either confirmed case below — not observed against the
// live API during Slice 2 discovery, but handled rather than silently
// coerced into a false EXACT_MATCH.
export const Outcome = Object.freeze({
  EXACT_MATCH: 'EXACT_MATCH',
  PRODUCT_FOUND_COLOR_NOT_FOUND: 'PRODUCT_FOUND_COLOR_NOT_FOUND',
  AMBIGUOUS: 'AMBIGUOUS',
  NOT_FOUND: 'NOT_FOUND',
});

// Verified fact: an invalid/unavailable color on a valid master PID does
// NOT error — the endpoint silently falls back to a default color variant
// and still returns HTTP 200 with a fully-formed `product` object. HTTP 200
// alone is therefore never sufficient; masterProductId and color.id must be
// checked exactly against what was requested.
function classify(requestedProduto, requestedCor, fetchResult) {
  if (fetchResult.fetchError) {
    return { outcome: Outcome.NOT_FOUND, reason: `fetch_error: ${fetchResult.fetchError}` };
  }
  const { httpStatus, json } = fetchResult;
  if (!json || typeof json !== 'object') {
    return { outcome: Outcome.NOT_FOUND, reason: `non_json_response (http ${httpStatus}, body ${fetchResult.bodyLength ?? 0} chars)` };
  }
  if (json.status === 404 || !json.product) {
    return { outcome: Outcome.NOT_FOUND, reason: `no_product (json.status=${json.status})` };
  }

  const product = json.product;
  const masterProductId = product.masterProductId;
  const colorId = product.color?.id;

  if (!masterProductId || !colorId) {
    return { outcome: Outcome.AMBIGUOUS, reason: 'product present but missing masterProductId/color.id', product };
  }
  if (masterProductId !== requestedProduto) {
    return { outcome: Outcome.NOT_FOUND, reason: `masterProductId mismatch: requested "${requestedProduto}", got "${masterProductId}"`, product };
  }
  if (colorId !== requestedCor) {
    return { outcome: Outcome.PRODUCT_FOUND_COLOR_NOT_FOUND, reason: `color fallback: requested "${requestedCor}", got "${colorId}" (${product.color?.label ?? 'unknown label'})`, product };
  }

  return { outcome: Outcome.EXACT_MATCH, product };
}

// Excludes gallery.images entries of type "look" (outfit/styling shots, not
// product images) before the data is ever written — per the Slice 1 schema
// header's documented assumption.
function extractGalleryImages(product) {
  const images = Array.isArray(product.gallery?.images) ? product.gallery.images : [];
  return images.filter((img) => img.type === 'image');
}

export async function verifyAndAcquire(session, produto, cor) {
  const fetchResult = await fetchPartialsData(session.page, session.origin, produto, cor);
  const classified = classify(produto, cor, fetchResult);

  if (classified.outcome !== Outcome.EXACT_MATCH) {
    return { outcome: classified.outcome, reason: classified.reason, requestUrl: fetchResult.url };
  }

  const product = classified.product;
  const galleryImages = extractGalleryImages(product);

  return {
    outcome: Outcome.EXACT_MATCH,
    requestUrl: fetchResult.url,
    candidate: {
      lacoste_pid: product.masterProductId,
      lacoste_color_id: product.color.id,
      lacoste_color_label: product.color.label ?? null,
      lacoste_product_name: product.name ?? null,
      resolved_url: product.color.url ?? fetchResult.url,
      verification_ok: true,
      gallery_json: galleryImages,
    },
    galleryImageCount: galleryImages.length,
    galleryTotalCount: Array.isArray(product.gallery?.images) ? product.gallery.images.length : 0,
  };
}
