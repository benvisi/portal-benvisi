// Slice 0 validation only: confirms every worker dependency loads/imports
// correctly in this environment. No network calls — no Lacoste navigation,
// no Anthropic API call, no Supabase connection. Later slices replace this
// with the real acquisition/scoring/publish entrypoints.

const results = [];

function report(name, ok, detail) {
  results.push({ name, ok, detail });
  const status = ok ? "OK" : "FAIL";
  console.log(`[${status}] ${name}${detail ? " — " + detail : ""}`);
}

// --- Playwright: import + confirm a Chromium binary is installed ----------
try {
  const { chromium } = await import("playwright");
  const executablePath = chromium.executablePath();
  const fs = await import("node:fs");
  const installed = fs.existsSync(executablePath);
  report(
    "playwright",
    installed,
    installed
      ? `chromium binary found at ${executablePath}`
      : `chromium binary NOT found at ${executablePath} — run "npx playwright install chromium"`,
  );
} catch (err) {
  report("playwright", false, String(err));
}

// --- Sharp: import + run a trivial in-memory operation ---------------------
try {
  const sharp = (await import("sharp")).default;
  // Synthesize a 4x4 image with sharp itself (no hand-typed fixture bytes to
  // get wrong) and re-encode it to webp — proves the native binding actually
  // works, not just that the module resolves.
  const out = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 0, b: 0 } },
  })
    .webp()
    .toBuffer();
  report("sharp", out.length > 0, `native binding OK, encoded ${out.length}-byte webp`);
} catch (err) {
  report("sharp", false, String(err));
}

// --- Anthropic SDK: import + instantiate client (no API call) -------------
try {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: "sk-ant-placeholder-not-a-real-key" });
  report("@anthropic-ai/sdk", typeof client.messages?.create === "function", "client constructed");
} catch (err) {
  report("@anthropic-ai/sdk", false, String(err));
}

console.log("");
const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.log(`${failed.length}/${results.length} dependency check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`All ${results.length} dependency checks passed.`);
}
