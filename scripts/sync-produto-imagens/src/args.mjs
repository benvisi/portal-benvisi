// CLI argument parsing for the acquisition worker. Deliberately explicit
// bounded input: this slice has no catalog-enumeration path, so running
// with no --produtos is a usage error, not a silent full-catalog scan.

export const DEFAULT_LIMIT = 5;

function parseFlags(argv) {
  const flags = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) {
      flags[raw.slice(2)] = true;
    } else {
      flags[raw.slice(2, eq)] = raw.slice(eq + 1);
    }
  }
  return flags;
}

// Splits "REF:COR" on the first colon only, trims boundary whitespace, and
// never normalizes internal characters (no stripping "BR", hyphens, etc —
// Linx/Lacoste references are passed through exactly as given).
function parseProdutoCor(token, index) {
  const trimmed = token.trim();
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) {
    throw new Error(`--produtos item #${index + 1} ("${trimmed}") is missing the required ":" separator (expected REF:COR)`);
  }
  const produto = trimmed.slice(0, colonIdx).trim();
  const cor = trimmed.slice(colonIdx + 1).trim();
  if (!produto || !cor) {
    throw new Error(`--produtos item #${index + 1} ("${trimmed}") must have a non-empty REF and COR on both sides of ":"`);
  }
  return { produto, cor };
}

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = parseFlags(argv);

  const dryRun = flags['dry-run'] === true || flags['dry-run'] === 'true';

  let limit = DEFAULT_LIMIT;
  if (flags.limit !== undefined) {
    const parsed = Number.parseInt(flags.limit, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`--limit must be a positive integer, got "${flags.limit}"`);
    }
    limit = parsed;
  }

  if (flags.produtos === undefined) {
    throw new Error(
      'No --produtos list given, and this slice has no full-catalog acquisition path. ' +
      'Pass explicit combinations, e.g. --produtos=46SMA0045BR:02H,FH2349-23:02S,NF2142AA:A91'
    );
  }
  if (flags.produtos === true) {
    throw new Error('--produtos requires a value, e.g. --produtos=REF:COR,REF:COR');
  }

  const rawItems = String(flags.produtos).split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (rawItems.length === 0) {
    throw new Error('--produtos was given but contained no items');
  }

  const parsedItems = rawItems.map((item, i) => parseProdutoCor(item, i));

  let items = parsedItems;
  let truncated = false;
  if (parsedItems.length > limit) {
    items = parsedItems.slice(0, limit);
    truncated = true;
  }

  return { items, limit, dryRun, truncated, requestedCount: parsedItems.length };
}
