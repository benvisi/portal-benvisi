// The Lacoste CDN serves product images as AVIF to Chromium (confirmed by a
// scheduled-task probe: the bytes start with an "ftypavif" box). The
// publication pipeline must decode that format and output the immutable WebP.
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { toWebp, sha256 } from "../src/publishing.mjs";

async function avifFixture(width, height) {
  return sharp({ create: { width, height, channels: 3, background: "#336699" } })
    .avif({ quality: 50 })
    .toBuffer();
}

test("fixture is a real AVIF (ftypavif box)", async () => {
  const avif = await avifFixture(640, 480);
  assert.equal(avif.subarray(4, 12).toString("latin1"), "ftypavif");
});

test("toWebp decodes AVIF input and returns a valid WebP within bounds", async () => {
  const avif = await avifFixture(2400, 1600);
  const out = await toWebp(avif);
  assert.equal(out.data.subarray(0, 4).toString("latin1"), "RIFF");
  assert.equal(out.data.subarray(8, 12).toString("latin1"), "WEBP");
  assert.equal(Math.max(out.width, out.height), 1200);
  const meta = await sharp(out.data).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, out.width);
});

test("AVIF conversion is deterministic (crash-retry finds an identical object)", async () => {
  const avif = await avifFixture(800, 800);
  const a = await toWebp(avif);
  const b = await toWebp(avif);
  assert.equal(sha256(a.data), sha256(b.data));
});
