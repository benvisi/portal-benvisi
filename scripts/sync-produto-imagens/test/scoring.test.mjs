import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGallery, validateScoring } from '../src/scoring.mjs';

const gal = normalizeGallery([
  { desktopUrl: '//imagesa1.lacoste.com/a.jpg', alt: 'a', type: 'image' },
  { desktopUrl: '//imagesa1.lacoste.com/b.jpg', alt: 'b', type: 'image' },
  { desktopUrl: '//imagesa1.lacoste.com/c.jpg', alt: 'c', type: 'image' },
]);
const ev = (index, over = {}) => ({ index, has_person: false, shows_full_product: true, is_crop_or_detail: false, angle: 'front', product_only_still: true, notes: '', ...over });
const ok = () => ({
  images: [ev(0), ev(1, { angle: 'back' }), ev(2, { has_person: true })],
  primary: { index: 0, reason: 'r' },
  secondary: { index: 1, reason: 'r' },
  confidence: 'high',
  limitations: [],
});

test('normalizes protocol-relative urls', () => assert.equal(gal[0].url, 'https://imagesa1.lacoste.com/a.jpg'));
test('valid output resolves URLs from gallery', () => {
  const r = validateScoring(ok(), gal);
  assert.equal(r.primary.url, gal[0].url);
  assert.equal(r.secondary.url, gal[1].url);
});
test('null primary and secondary allowed', () => {
  const o = ok(); o.secondary.index = null; o.primary.index = null;
  assert.equal(validateScoring(o, gal).primary.url, null);
});
test('out-of-range index rejected', () => { const o = ok(); o.primary.index = 7; assert.throws(() => validateScoring(o, gal)); });
test('secondary equal to primary rejected', () => { const o = ok(); o.secondary.index = 0; assert.throws(() => validateScoring(o, gal)); });
test('selecting an image flagged has_person rejected', () => { const o = ok(); o.primary.index = 2; assert.throws(() => validateScoring(o, gal)); });
test('missing or duplicate evaluations rejected', () => {
  const o = ok(); o.images.pop(); assert.throws(() => validateScoring(o, gal));
  const d = ok(); d.images[1].index = 0; assert.throws(() => validateScoring(d, gal));
});
test('bad enum and non-object rejected', () => {
  const o = ok(); o.confidence = 'sure'; assert.throws(() => validateScoring(o, gal));
  assert.throws(() => validateScoring(null, gal));
});
test('non-array gallery rejected', () => assert.throws(() => normalizeGallery(null)));
