#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  authorFilter,
  buildTimeWindow,
  dateFilter,
  isTimestampInWindow,
  loadAuth,
  parseCommonArgs,
  slackApiCall,
  slackSearchQuery,
} = require("./slack-api-common.cjs");

const DEFAULT_QUERY = "";
const DEFAULT_AUTHOR_FILTER = "me";

function parseArgs(argv) {
  const { args, remaining } = parseCommonArgs(argv, {
    query: DEFAULT_QUERY,
    author: process.env.SLACK_SEARCH_FROM || DEFAULT_AUTHOR_FILTER,
    after: "",
    before: "",
    since: "",
    sinceTs: "",
    untilTs: "",
    count: 20,
    out: "",
    includeSnippets: process.env.SLACK_INCLUDE_SNIPPETS === "1",
  });

  for (let index = 0; index < remaining.length; index += 1) {
    const arg = remaining[index];
    const next = () => {
      index += 1;
      if (index >= remaining.length) throw new Error(`Missing value for ${arg}`);
      return remaining[index];
    };

    if (arg === "--query") args.query = next();
    else if (arg === "--from") args.author = next();
    else if (arg === "--any-author") args.author = "";
    else if (arg === "--after") args.after = next();
    else if (arg === "--before") args.before = next();
    else if (arg === "--since" || arg === "--last") args.since = next();
    else if (arg === "--since-ts") args.sinceTs = next();
    else if (arg === "--until-ts") args.untilTs = next();
    else if (arg === "--count") args.count = Number(next());
    else if (arg === "--out") args.out = path.resolve(next());
    else if (arg === "--include-snippets") args.includeSnippets = true;
    else if (arg === "--redact-snippets") args.includeSnippets = false;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.count) || args.count < 1) {
    throw new Error("--count must be at least 1");
  }
  if (!args.query) {
    throw new Error("--query is required");
  }

  args.timeWindow = buildTimeWindow(args);

  return args;
}

function printHelp() {
  console.log(`
Usage:
  npm run api:search -- --query release

Options:
  --query TEXT          Search phrase. Required
  --from VALUE          Slack author filter. Default: ${DEFAULT_AUTHOR_FILTER}
  --any-author          Disable author filtering
  --after YYYY-MM-DD    Add Slack search date modifier after:YYYY-MM-DD
  --before YYYY-MM-DD   Add Slack search date modifier before:YYYY-MM-DD
  --since DURATION      Locally filter results newer than a duration, e.g. 30s, 5m, 12h
  --last DURATION       Alias for --since
  --since-ts TS         Locally filter results at or after a Unix/Slack timestamp
  --until-ts TS         Locally filter results before or at a Unix/Slack timestamp
  --count N             Number of results to request. Default: 20
  --out FILE            Write JSON output to a file instead of stdout
  --include-snippets    Include message text
  --redact-snippets     Redact message text in output. Default
  --workspace URL       Slack workspace URL
  --profile DIR         Browser profile directory. Default: configured profile
  --auth-cache FILE     Auth cache path. Default: configured auth cache
  --refresh-auth        Refresh auth from the signed-in browser profile before searching
  --headed              Show the browser window if Slack needs login
`);
}

function matchTimestampSeconds(match) {
  const parsed = Number(match.ts);
  return Number.isFinite(parsed) ? parsed : null;
}

function filterMatchesByTime(matches, timeWindow) {
  if (timeWindow.sinceTs === null && timeWindow.untilTs === null) return matches;

  return matches.filter((match) => {
    const ts = matchTimestampSeconds(match);
    if (ts === null) return false;
    return isTimestampInWindow(ts, timeWindow);
  });
}

function channelIdFor(match) {
  if (match.channel && typeof match.channel === "object") return match.channel.id || null;
  return match.channel || null;
}

function channelNameFor(match) {
  if (match.channel && typeof match.channel === "object") return match.channel.name || null;
  return null;
}

function sanitizeMatch(match, includeSnippets) {
  return {
    channelId: channelIdFor(match),
    channelName: channelNameFor(match),
    ts: match.ts || null,
    user: match.user || null,
    username: match.username || null,
    permalink: match.permalink || null,
    text: includeSnippets ? (match.text || "") : "[redacted; rerun with --include-snippets to save message text]",
    type: match.type || null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filters = [
    dateFilter("after", args.after),
    dateFilter("before", args.before),
  ].filter(Boolean);
  const query = slackSearchQuery(args.query, args.author, filters);

  args.auth = await loadAuth(args);
  const { response, json, auth } = await slackApiCall(args, "search.messages", {
    query,
    count: args.count,
    sort: "timestamp",
    sort_dir: "desc",
  });

  const matches = json.messages?.matches || [];
  const filteredMatches = filterMatchesByTime(matches, args.timeWindow);
  const output = {
    ok: json.ok,
    status: response.status,
    error: json.error,
    generatedAt: new Date().toISOString(),
    workspace: args.workspace,
    query: args.query,
    authorFilter: authorFilter(args.author) || null,
    slackQuery: query,
    includeSnippets: args.includeSnippets,
    authSource: auth.source,
    authHint: json.authHint,
    timeWindow: {
      since: args.timeWindow.since,
      sinceTs: args.timeWindow.sinceTs,
      untilTs: args.timeWindow.untilTs,
      nowTs: args.timeWindow.nowTs,
    },
    total: json.messages?.total ?? null,
    fetchedResultCount: matches.length,
    resultCount: filteredMatches.length,
    results: filteredMatches.map((match) => sanitizeMatch(match, args.includeSnippets)),
  };

  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  if (args.out) {
    await fs.mkdir(path.dirname(args.out), { recursive: true });
    await fs.writeFile(args.out, serialized);
  } else {
    process.stdout.write(serialized);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
