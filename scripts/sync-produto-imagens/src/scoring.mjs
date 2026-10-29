// Pure scoring helpers for the advisory vision scorer (Trello #10, Slice 3):
// gallery normalization, prompt/tool-schema construction and strict
// validation of the model's selections against the ORIGINAL gallery. No I/O.

export const MAX_IMAGES = 10;

// Strict allowlist: https only, host is lacoste.com or a true subdomain.
export function assertLacosteImageUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('invalid image url'); }
  if (u.protocol !== 'https:' || u.username || u.password || !/^([a-z0-9-]+\.)*lacoste\.com$/i.test(u.hostname)) {
    throw new Error('refusing non-Lacoste image host');
  }
  return u;
}

export function normalizeGallery(galleryJson) {
  if (!Array.isArray(galleryJson)) throw new Error('gallery_json is not an array');
  return galleryJson.slice(0, MAX_IMAGES).map((img, index) => {
    const raw = typeof img?.desktopUrl === 'string' ? img.desktopUrl : '';
    const url = raw.startsWith('//') ? `https:${raw}` : raw;
    return { index, url, alt: typeof img?.alt === 'string' ? img.alt : '', type: img?.type ?? null };
  });
}

const ANGLES = ['front', 'back', 'side', 'top', 'three_quarter', 'detail', 'inside', 'lifestyle', 'other'];

const slotSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['index', 'reason'],
  properties: { index: { type: ['integer', 'null'] }, reason: { type: 'string' } },
};

export const SCORE_TOOL = {
  name: 'report_gallery_scoring',
  description: 'Report an advisory evaluation of the product image gallery. Refer to images ONLY by their 0-based index.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['images', 'primary', 'secondary', 'confidence', 'limitations'],
    properties: {
      images: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['index', 'has_person', 'shows_full_product', 'is_crop_or_detail', 'angle', 'product_only_still', 'notes'],
          properties: {
            index: { type: 'integer' },
            has_person: { type: 'boolean' },
            shows_full_product: { type: 'boolean' },
            is_crop_or_detail: { type: 'boolean' },
            angle: { type: 'string', enum: ANGLES },
            product_only_still: { type: 'boolean' },
            notes: { type: 'string' },
          },
        },
      },
      primary: slotSchema,
      secondary: slotSchema,
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      limitations: { type: 'array', items: { type: 'string' } },
    },
  },
};

export const SYSTEM_PROMPT = `You evaluate retail product photo galleries. You are advisory only; a human decides.
Images are labelled "Image N" (0-based). Judge by actual visual content, never by file name, alt text or type label.
Primary = the single best product-only still: no person/model, whole product visible, uncropped, clean background, ideally front or most representative view.
Secondary = optional; only if it shows a materially different, useful view (e.g. back, inside, side) of the same product, also with no person. Otherwise index null.
If no image qualifies as primary, set primary.index null and explain. Never invent indices. State uncertainty in limitations and lower confidence when images are ambiguous.`;

export function buildPromptText(candidate) {
  return `Product: ${candidate.lacoste_product_name} (ref ${candidate.produto}, color ${candidate.lacoste_color_label} / ${candidate.cor_codigo}). Evaluate the gallery as a set and respond ONLY by calling the report_gallery_scoring tool.`;
}

const isIdx = (v, n) => Number.isInteger(v) && v >= 0 && v < n;

// Throws on any contract violation; returns a clean result otherwise.
export function validateScoring(input, gallery) {
  const n = gallery.length;
  if (!input || typeof input !== 'object') throw new Error('scoring output is not an object');
  if (!Array.isArray(input.images)) throw new Error('images must be an array');
  const seen = new Set();
  for (const im of input.images) {
    if (!isIdx(im?.index, n)) throw new Error(`image evaluation has out-of-range index ${im?.index}`);
    if (seen.has(im.index)) throw new Error(`duplicate evaluation for index ${im.index}`);
    seen.add(im.index);
    for (const k of ['has_person', 'shows_full_product', 'is_crop_or_detail', 'product_only_still']) {
      if (typeof im[k] !== 'boolean') throw new Error(`image ${im.index}: ${k} must be boolean`);
    }
    if (!ANGLES.includes(im.angle)) throw new Error(`image ${im.index}: invalid angle`);
  }
  if (seen.size !== n) throw new Error(`expected evaluations for ${n} images, got ${seen.size}`);
  for (const slot of ['primary', 'secondary']) {
    const s = input[slot];
    if (!s || typeof s.reason !== 'string') throw new Error(`${slot} missing reason`);
    if (s.index !== null && !isIdx(s.index, n)) throw new Error(`${slot}.index ${s.index} is not null or a valid gallery index`);
  }
  if (input.secondary.index !== null && input.secondary.index === input.primary.index) throw new Error('secondary must differ from primary');
  if (!['high', 'medium', 'low'].includes(input.confidence)) throw new Error('invalid confidence');
  if (!Array.isArray(input.limitations) || input.limitations.some((l) => typeof l !== 'string')) throw new Error('limitations must be string[]');

  const byIndex = new Map(input.images.map((im) => [im.index, im]));
  for (const slot of ['primary', 'secondary']) {
    const i = input[slot].index;
    if (i !== null && byIndex.get(i).has_person) throw new Error(`${slot} index ${i} was itself flagged has_person`);
  }
  // Selections resolve to URLs from OUR gallery, never from model text.
  const url = (i) => (i === null ? null : gallery[i].url);
  return {
    images: [...input.images].sort((a, b) => a.index - b.index),
    primary: { index: input.primary.index, url: url(input.primary.index), reason: input.primary.reason },
    secondary: { index: input.secondary.index, url: url(input.secondary.index), reason: input.secondary.reason },
    confidence: input.confidence,
    limitations: input.limitations,
  };
}
