import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { assertLacosteImageUrl } from "../src/scoring.mjs";
import { scoreCandidate } from "../src/score.mjs";

test("host allowlist accepts lacoste.com and subdomains over https", () => {
  assertLacosteImageUrl("https://imagesa1.lacoste.com/a.jpg");
  assertLacosteImageUrl("https://lacoste.com/a.jpg");
});

test("host allowlist rejects deceptive hosts", () => {
  for (const u of [
    "https://lacoste.com.evil.com/a.jpg",
    "https://evil-lacoste.com/a.jpg",
    "https://notlacoste.com/a.jpg",
    "https://lacoste.com@evil.com/a.jpg",
    "https://user:pw@imagesa1.lacoste.com/a.jpg",
    "http://imagesa1.lacoste.com/a.jpg",
    "ftp://imagesa1.lacoste.com/a.jpg",
    "//imagesa1.lacoste.com/a.jpg",
    "not a url",
  ])
    assert.throws(() => assertLacosteImageUrl(u), undefined, u);
});

const candidate = {
  lacoste_product_name: "X",
  produto: "P",
  lacoste_color_label: "Black",
  cor_codigo: "C",
  gallery_json: [0, 1].map((i) => ({
    desktopUrl: `//imagesa1.lacoste.com/${i}.jpg`,
    type: "image",
    alt: "",
  })),
};
const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } })
  .png()
  .toBuffer();
const sessionWith = (fn) => ({
  page: { context: () => ({ newPage: async () => ({ goto: fn, close: async () => {} }) }) },
});
const okSession = sessionWith(async () => ({
  ok: () => true,
  status: () => 200,
  body: async () => png,
}));
const ev = (index) => ({
  index,
  has_person: false,
  shows_full_product: true,
  is_crop_or_detail: false,
  angle: "front",
  product_only_still: true,
  notes: "",
});
const fakeAnthropic = (content) => ({ messages: { create: async () => ({ content, usage: {} }) } });

test("model response without tool call is an explicit error", async () => {
  await assert.rejects(
    scoreCandidate(fakeAnthropic([{ type: "text", text: "hi" }]), okSession, candidate),
    /no tool_use/,
  );
});

test("inaccessible image fails the candidate and never calls the model", async () => {
  let called = false;
  const anthropic = {
    messages: {
      create: async () => {
        called = true;
      },
    },
  };
  const denied = sessionWith(async () => ({
    ok: () => false,
    status: () => 403,
    body: async () => Buffer.alloc(0),
  }));
  await assert.rejects(scoreCandidate(anthropic, denied, candidate), /image http 403/);
  assert.equal(called, false);
});

test("oversized image rejected", async () => {
  const big = sessionWith(async () => ({
    ok: () => true,
    status: () => 200,
    body: async () => Buffer.alloc(8 * 1024 * 1024 + 1),
  }));
  await assert.rejects(scoreCandidate(fakeAnthropic([]), big, candidate), /too large/);
});

test("invalid selection from model is rejected", async () => {
  const input = {
    images: [ev(0), ev(1)],
    primary: { index: 9, reason: "x" },
    secondary: { index: null, reason: "y" },
    confidence: "high",
    limitations: [],
  };
  await assert.rejects(
    scoreCandidate(fakeAnthropic([{ type: "tool_use", input }]), okSession, candidate),
    /not null or a valid gallery index/,
  );
});

test("valid response passes and resolves URL from gallery", async () => {
  const input = {
    images: [ev(0), ev(1)],
    primary: { index: 1, reason: "x" },
    secondary: { index: null, reason: "y" },
    confidence: "high",
    limitations: [],
  };
  const out = await scoreCandidate(
    fakeAnthropic([{ type: "tool_use", input }]),
    okSession,
    candidate,
  );
  assert.equal(out.result.primary.url, "https://imagesa1.lacoste.com/1.jpg");
});
