#!/usr/bin/env node

const {
  loadAuth,
  parseCommonArgs,
  parsePositiveInt,
  slackApiCall,
} = require("./slack-api-common.cjs");

function parseArgs(argv) {
  const { args, remaining } = parseCommonArgs(argv, {
    query: "",
    limit: 200,
    includeUrls: true,
  });

  if (remaining[0] && !remaining[0].startsWith("-") && remaining[0] !== "list") {
    throw new Error(`Unknown emoji command: ${remaining[0]}`);
  }
  if (remaining[0] === "list") remaining.shift();

  for (let index = 0; index < remaining.length; index += 1) {
    const arg = remaining[index];
    const next = () => {
      index += 1;
      if (index >= remaining.length) throw new Error(`Missing value for ${arg}`);
      return remaining[index];
    };

    if (arg === "--query" || arg === "-q") args.query = next();
    else if (arg === "--limit") args.limit = parsePositiveInt(next(), "--limit");
    else if (arg === "--include-urls") args.includeUrls = true;
    else if (arg === "--names-only") args.includeUrls = false;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  slack-api emoji
  slack-api emoji list --query party --limit 50
  slack-api emoji list --names-only

Options:
  --query TEXT       Filter emoji names/aliases
  --limit N          Max emojis to return. Default: 200
  --include-urls     Include emoji URLs/alias values. Default
  --names-only       Return only emoji names
  --workspace URL    Slack workspace URL
  --auth-cache FILE  Auth cache path
  --refresh-auth     Refresh auth from browser profile first
`);
}

function emojiMatches(name, value, query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return true;
  return name.toLowerCase().includes(normalized) || String(value || "").toLowerCase().includes(normalized);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  args.auth = await loadAuth(args);
  const { response, json, auth } = await slackApiCall(args, "emoji.list");
  const entries = Object.entries(json.emoji || {})
    .filter(([name, value]) => emojiMatches(name, value, args.query))
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, args.limit);
  const results = args.includeUrls
    ? entries.map(([name, value]) => ({ name, value }))
    : entries.map(([name]) => name);

  console.log(JSON.stringify({
    ok: json.ok,
    status: response.status,
    error: json.error,
    authSource: auth.source,
    query: args.query || null,
    total: json.emoji ? Object.keys(json.emoji).length : null,
    resultCount: results.length,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
