// Advisory Anthropic vision scorer (Trello #10, Slice 3). DRY-RUN ONLY: reads
// pending candidates (service_role SELECT) and prints structured results.
// It never writes to Supabase — service_role has no UPDATE on
// produto_imagem_candidatos (Slice 1) and persistence is a pending decision.
// Images are downloaded into memory, downscaled, sent, and discarded; no
// disk writes and no image payload logging.

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { createWorkerClient, registrarPontuacao } from './supabase-client.mjs';
import { parseArgs } from './args.mjs';
import { launchSession, closeSession, fetchImageBytes } from './lacoste.mjs';
import { assertLacosteImageUrl, buildPersistParams, normalizeGallery, validateScoring, SCORE_TOOL, SYSTEM_PROMPT, buildPromptText } from './scoring.mjs';

const MODEL = process.env.ANTHROPIC_SCORING_MODEL || 'claude-sonnet-5-5';
const MAX_EDGE_PX = 768;
const JPEG_QUALITY = 70;
const MAX_OUTPUT_TOKENS = 2000;

async function fetchResized(session, url) {
  assertLacosteImageUrl(url);
  const buf = await fetchImageBytes(session, url);
  return sharp(buf)
    .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}

export async function scoreCandidate(anthropic, session, candidate) {
  const gallery = normalizeGallery(candidate.gallery_json);
  const content = [{ type: 'text', text: buildPromptText(candidate) }];
  let imageBytes = 0;
  for (const g of gallery) {
    const jpg = await fetchResized(session, g.url);
    imageBytes += jpg.length;
    content.push({ type: 'text', text: `Image ${g.index}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpg.toString('base64') } });
  }
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [SCORE_TOOL],
    tool_choice: { type: 'auto' }, // forced tool_choice unsupported by this model; the prompt requires the tool call
    messages: [{ role: 'user', content }],
  });
  const block = resp.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error('model returned no tool_use block');
  return { result: validateScoring(block.input, gallery), usage: resp.usage, imageBytes, imageCount: gallery.length };
}

async function main() {
  const { items, dryRun, persist, truncated, requestedCount, limit } = parseArgs();
  if (dryRun && persist) throw new Error('--dry-run and --persist are mutually exclusive');
  if (persist && truncated) throw new Error(`--persist refuses to silently truncate: ${requestedCount} items requested, limit is ${limit}`);
  // Dry-run is the default; production writes need an explicit --persist.
  console.log(persist ? 'MODE: PERSIST (writes via registrar_pontuacao_candidato)' : 'MODE: dry-run (no writes)');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set in .env');
  const supabase = createWorkerClient();
  const anthropic = new Anthropic({ maxRetries: 0 });
  await anthropic.models.retrieve(MODEL); // free validity check before any billable request
  const session = await launchSession();
  try {
  for (const { produto, cor } of items) {
    const { data, error } = await supabase.from('produto_imagem_candidatos').select('*')
      .eq('produto', produto).eq('cor_codigo', cor).eq('status', 'pendente').maybeSingle();
    if (error) throw new Error(`select failed: ${error.message}`);
    if (!data) {
      console.log(JSON.stringify({ produto, cor, error: 'no pending candidate' }));
      continue;
    }
    if (persist && data.scoring_notes) {
      // Avoid paying twice: an already-scored candidate is never re-scored.
      console.log(JSON.stringify({ produto, cor, skipped: 'already scored' }));
      continue;
    }
    try {
      const out = await scoreCandidate(anthropic, session, data);
      console.log(JSON.stringify({ produto, cor, model: MODEL, ...out }, null, 2));
      if (persist) {
        await registrarPontuacao(supabase, buildPersistParams(data.id, out, { model: MODEL, usage: out.usage, imageCount: out.imageCount }));
        console.log(JSON.stringify({ produto, cor, persisted: true }));
      }
    } catch (e) {
      console.log(JSON.stringify({ produto, cor, error: String(e.message).slice(0, 300) }));
    }
  }
  } finally {
    await closeSession(session);
  }
}

if (process.argv[1]?.endsWith('score.mjs')) main().catch((e) => {
  console.error('Unhandled error:', e.message);
  process.exit(1);
});
