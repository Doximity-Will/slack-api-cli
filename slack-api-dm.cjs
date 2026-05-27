#!/usr/bin/env node

const {
  buildTimeWindow,
  isTimestampInWindow,
  loadAuth,
  parseCommonArgs,
  parsePositiveInt,
  resolveUser,
  slackApiCall,
  summarizeChannel,
  summarizeMessage,
} = require("./slack-api-common.cjs");

const COMMAND_ALIASES = {
  read: "history",
  messages: "history",
  lookup: "info",
};

function parseArgs(argv) {
  const { args, remaining } = parseCommonArgs(argv, {
    command: "history",
    user: "",
    email: "",
    query: "",
    limit: 30,
    maxPages: 20,
    oldest: "",
    latest: "",
    since: "",
    sinceTs: "",
    untilTs: "",
    includeText: process.env.SLACK_INCLUDE_TEXT === "1",
    includeDeleted: false,
    includeBots: false,
  });

  if (remaining[0] && !remaining[0].startsWith("-")) {
    const rawCommand = remaining.shift();
    args.command = COMMAND_ALIASES[rawCommand] || rawCommand;
  }

  for (let index = 0; index < remaining.length; index += 1) {
    const arg = remaining[index];
    const next = () => {
      index += 1;
      if (index >= remaining.length) throw new Error(`Missing value for ${arg}`);
      return remaining[index];
    };

    if (arg === "--user" || arg === "-u" || arg === "--name") args.user = next();
    else if (arg === "--email") args.email = next();
    else if (arg === "--query" || arg === "-q") args.query = next();
    else if (arg === "--limit") args.limit = parsePositiveInt(next(), "--limit");
    else if (arg === "--max-pages") args.maxPages = parsePositiveInt(next(), "--max-pages");
    else if (arg === "--oldest") args.oldest = next();
    else if (arg === "--latest") args.latest = next();
    else if (arg === "--since" || arg === "--last") args.since = next();
    else if (arg === "--since-ts") args.sinceTs = next();
    else if (arg === "--until-ts") args.untilTs = next();
    else if (arg === "--include-text") args.includeText = true;
    else if (arg === "--redact-text") args.includeText = false;
    else if (arg === "--include-deleted") args.includeDeleted = true;
    else if (arg === "--include-bots") args.includeBots = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["info", "history"].includes(args.command)) {
    throw new Error(`Unknown dm command: ${args.command}`);
  }
  if (!userLookupValue(args)) {
    throw new Error("--user, --name, --email, or --query is required");
  }

  args.timeWindow = buildTimeWindow(args);
  return args;
}

function printHelp() {
  console.log(`
Usage:
  slack-api dm history --user "Alice Smith" --include-text
  slack-api dm history --email alice@example.com --since 7d --limit 50
  slack-api dm info --user U123456

Commands:
  history      Resolve a user and read your 1:1 DM history with them
  info         Resolve a user and return the 1:1 DM channel metadata

Options:
  --user ID|NAME|EMAIL  User ID, name, display name, or email
  --name NAME           Alias for --user
  --email EMAIL         Exact email lookup
  --query TEXT          Alias-style user search query
  --limit N             Message limit. Default: 30
  --max-pages N         Max users.list pages while resolving names. Default: 20
  --since DURATION      Read messages newer than duration: 30s, 5m, 12h, 7d
  --last DURATION       Alias for --since
  --since-ts TS         Read messages at/after Slack timestamp
  --until-ts TS         Read messages before/at Slack timestamp
  --oldest TS           Pass oldest directly to conversations.history
  --latest TS           Pass latest directly to conversations.history
  --include-text        Include message text
  --redact-text         Redact message text. Default
  --include-deleted     Include deactivated users while resolving
  --include-bots        Include bot users while resolving
  --workspace URL       Slack workspace URL
  --auth-cache FILE     Auth cache path
  --refresh-auth        Refresh auth from browser profile first

Notes:
  dm uses conversations.open to resolve the 1:1 DM channel, then conversations.history to read it.
  It never sends a message.
`);
}

function userLookupValue(args) {
  return args.email || args.user || args.query;
}

async function resolveDm(args) {
  const value = userLookupValue(args);
  const resolved = await resolveUser(args, value, {
    includeDeleted: args.includeDeleted,
    includeBots: args.includeBots,
    maxPages: args.maxPages,
  });

  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      userId: null,
      user: null,
      channelId: null,
      channel: null,
      candidates: resolved.candidates,
    };
  }

  const { response, json, auth } = await slackApiCall(args, "conversations.open", {
    users: resolved.userId,
    return_im: true,
  });

  return {
    ok: json.ok,
    status: response.status,
    error: json.error,
    authSource: auth.source,
    userId: resolved.userId,
    user: resolved.user,
    channelId: json.channel?.id || null,
    channel: json.channel ? summarizeChannel(json.channel) : null,
  };
}

async function runInfo(args) {
  return resolveDm(args);
}

async function runHistory(args) {
  const dm = await resolveDm(args);
  if (!dm.ok) return dm;

  const oldest = args.oldest || (args.timeWindow.sinceTs === null ? "" : args.timeWindow.sinceTs);
  const latest = args.latest || (args.timeWindow.untilTs === null ? "" : args.timeWindow.untilTs);
  const { response, json, auth } = await slackApiCall(args, "conversations.history", {
    channel: dm.channelId,
    limit: args.limit,
    oldest,
    latest,
    inclusive: true,
  });
  const messages = (json.messages || []).map((message) => ({ ...message, channel: dm.channelId }));
  const filteredMessages = messages.filter((message) => {
    if (!args.oldest && !args.latest) return isTimestampInWindow(message.ts, args.timeWindow);
    return true;
  });

  return {
    ok: json.ok,
    status: response.status,
    error: json.error,
    authSource: auth.source,
    userId: dm.userId,
    user: dm.user,
    channelId: dm.channelId,
    channel: dm.channel,
    includeText: args.includeText,
    hasMore: Boolean(json.has_more),
    responseMetadata: json.response_metadata || null,
    timeWindow: args.timeWindow,
    messageCount: filteredMessages.length,
    messages: filteredMessages.map((message) => summarizeMessage(args, message, args.includeText)),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  args.auth = await loadAuth(args);

  const output = args.command === "info"
    ? await runInfo(args)
    : await runHistory(args);

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
