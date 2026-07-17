#!/usr/bin/env node

const {
  DEFAULT_CONVERSATION_TYPES,
  buildTimeWindow,
  getChannelMembers,
  isTimestampInWindow,
  listConversations,
  loadAuth,
  parseCommonArgs,
  parsePositiveInt,
  resolveChannel,
  slackApiCall,
  summarizeChannel,
  summarizeMessage,
  summarizeUser,
} = require("./slack-api-common.cjs");

const COMMAND_ALIASES = {
  lookup: "search",
  find: "search",
  read: "history",
  messages: "history",
  member: "members",
};

function parseArgs(argv) {
  const { args, remaining } = parseCommonArgs(argv, {
    command: "search",
    query: "",
    channel: "",
    types: DEFAULT_CONVERSATION_TYPES,
    limit: 50,
    maxPages: 20,
    oldest: "",
    latest: "",
    since: "",
    sinceTs: "",
    untilTs: "",
    includeText: process.env.SLACK_INCLUDE_TEXT === "1",
    resolveUsers: false,
    includePages: false,
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

    if (arg === "--query" || arg === "-q") args.query = next();
    else if (arg === "--channel" || arg === "-c") args.channel = next();
    else if (arg === "--types") args.types = next();
    else if (arg === "--limit") args.limit = parsePositiveInt(next(), "--limit");
    else if (arg === "--max-pages") args.maxPages = parsePositiveInt(next(), "--max-pages");
    else if (arg === "--oldest") args.oldest = next();
    else if (arg === "--latest") args.latest = next();
    else if (arg === "--since" || arg === "--last") args.since = next();
    else if (arg === "--since-ts") args.sinceTs = next();
    else if (arg === "--until-ts") args.untilTs = next();
    else if (arg === "--include-text") args.includeText = true;
    else if (arg === "--redact-text") args.includeText = false;
    else if (arg === "--resolve-users") args.resolveUsers = true;
    else if (arg === "--include-pages") args.includePages = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["search", "info", "history", "members"].includes(args.command)) {
    throw new Error(`Unknown channel command: ${args.command}`);
  }

  args.timeWindow = buildTimeWindow(args);
  return args;
}

function printHelp() {
  console.log(`
Usage:
  slack-api channel search --query platform
  slack-api channel info --channel '#general'
  slack-api channel history --channel '#general' --since 30m --limit 50 --include-text
  slack-api channel members --channel '#general' --limit 100

Commands:
  search       Search visible channels, DMs, and MPDMs by name/topic/purpose
  info         Resolve a channel name/id and return metadata
  history      Read recent channel history via conversations.history
  members      List channel member user IDs via conversations.members

Options:
  --query TEXT         Search text for channel search
  --channel ID|#name   Channel id or channel name
  --types CSV          Conversation types. Default: ${DEFAULT_CONVERSATION_TYPES}
  --limit N            Result/message/member limit. Default: 50
  --max-pages N        Max pages for list/lookup pagination. Default: 20
  --since DURATION     For history, read newer than duration: 30s, 5m, 12h
  --last DURATION      Alias for --since
  --since-ts TS        For history, read messages at/after Slack timestamp
  --until-ts TS        For history, read messages before/at Slack timestamp
  --oldest TS          Pass oldest directly to conversations.history
  --latest TS          Pass latest directly to conversations.history
  --include-text       Include message text
  --redact-text        Redact message text. Default
  --resolve-users      For members, also fetch users.info for returned user IDs
  --include-pages      Include pagination metadata in search output
  --workspace URL      Slack workspace URL
  --auth-cache FILE    Auth cache path
  --refresh-auth       Refresh auth from browser profile first
`);
}

function channelMatchesQuery(channel, query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return true;
  return [
    channel.id,
    channel.name,
    channel.name_normalized,
    channel.topic?.value,
    channel.purpose?.value,
    channel.user,
  ].some((value) => String(value || "").toLowerCase().includes(normalized));
}

async function runSearch(args) {
  const listed = await listConversations(args, {
    types: args.types,
    limit: 1000,
    maxPages: args.maxPages,
  });
  const results = listed.items
    .filter((channel) => channelMatchesQuery(channel, args.query))
    .slice(0, args.limit)
    .map(summarizeChannel);

  return {
    ok: listed.ok,
    error: listed.error,
    query: args.query || null,
    types: args.types,
    resultCount: results.length,
    scannedCount: listed.items.length,
    pageCount: listed.pages.length,
    pages: args.includePages ? listed.pages : undefined,
    results,
  };
}

async function runInfo(args) {
  const resolved = await resolveChannel(args, args.channel, {
    types: args.types,
    maxPages: args.maxPages,
  });
  return {
    ok: resolved.ok,
    error: resolved.error,
    channelId: resolved.channelId,
    channel: resolved.channel,
    candidates: resolved.ok ? undefined : resolved.candidates,
  };
}

async function runHistory(args) {
  const resolved = await resolveChannel(args, args.channel, {
    types: args.types,
    maxPages: args.maxPages,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      channelId: null,
      channel: null,
      candidates: resolved.candidates,
    };
  }

  const oldest = args.oldest || (args.timeWindow.sinceTs === null ? "" : args.timeWindow.sinceTs);
  const latest = args.latest || (args.timeWindow.untilTs === null ? "" : args.timeWindow.untilTs);
  const { response, json, auth } = await slackApiCall(args, "conversations.history", {
    channel: resolved.channelId,
    limit: args.limit,
    oldest,
    latest,
    inclusive: true,
  });
  const messages = (json.messages || []).map((message) => ({ ...message, channel: resolved.channelId }));
  const filteredMessages = messages.filter((message) => {
    if (!args.oldest && !args.latest) return isTimestampInWindow(message.ts, args.timeWindow);
    return true;
  });

  return {
    ok: json.ok,
    status: response.status,
    error: json.error,
    channelId: resolved.channelId,
    channel: resolved.channel,
    includeText: args.includeText,
    authSource: auth.source,
    hasMore: Boolean(json.has_more),
    responseMetadata: json.response_metadata || null,
    timeWindow: args.timeWindow,
    messageCount: filteredMessages.length,
    messages: filteredMessages.map((message) => summarizeMessage(args, message, args.includeText)),
  };
}

async function runMembers(args) {
  const resolved = await resolveChannel(args, args.channel, {
    types: args.types,
    maxPages: args.maxPages,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      channelId: null,
      channel: null,
      candidates: resolved.candidates,
    };
  }

  const membersResult = await getChannelMembers(args, resolved.channelId, { limit: args.limit });
  const memberIds = membersResult.members;
  let users = [];
  if (membersResult.ok && args.resolveUsers) {
    users = await Promise.all(memberIds.map(async (userId) => {
      const { json: userJson } = await slackApiCall(args, "users.info", { user: userId });
      return userJson.ok ? summarizeUser(userJson.user) : { id: userId, error: userJson.error };
    }));
  }

  return {
    ok: membersResult.ok,
    error: membersResult.error,
    channelId: resolved.channelId,
    channel: resolved.channel,
    authSource: membersResult.authSource,
    hasMore: membersResult.hasMore,
    responseMetadata: membersResult.responseMetadata || null,
    memberCount: memberIds.length,
    members: memberIds,
    users: args.resolveUsers ? users : undefined,
    note: membersResult.note || undefined,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  args.auth = await loadAuth(args);

  const output = args.command === "search"
    ? await runSearch(args)
    : args.command === "info"
      ? await runInfo(args)
      : args.command === "history"
        ? await runHistory(args)
        : await runMembers(args);

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
