#!/usr/bin/env node

const {
  loadAuth,
  parseCommonArgs,
  parsePermalink,
  slackApiCall,
} = require("./slack-api-common.cjs");

function parseArgs(argv) {
  const { args, remaining } = parseCommonArgs(argv, {
    link: "",
    channel: "",
    ts: "",
    threadTs: "",
    limit: 50,
    includeText: process.env.SLACK_INCLUDE_TEXT === "1",
  });

  for (let index = 0; index < remaining.length; index += 1) {
    const arg = remaining[index];
    const next = () => {
      index += 1;
      if (index >= remaining.length) throw new Error(`Missing value for ${arg}`);
      return remaining[index];
    };

    if (arg === "--link") args.link = next();
    else if (arg === "--channel") args.channel = next();
    else if (arg === "--ts") args.ts = next();
    else if (arg === "--thread-ts") args.threadTs = next();
    else if (arg === "--limit") args.limit = Number(next());
    else if (arg === "--include-text") args.includeText = true;
    else if (arg === "--redact-text") args.includeText = false;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.link) {
    const target = parsePermalink(args.link);
    args.channel = target.channelId;
    args.ts = target.messageTs;
    args.threadTs = target.rootTs;
    args.isThreadReply = target.isThreadReply;
  }

  if (!args.channel) throw new Error("--link or --channel is required");
  if (!args.ts) throw new Error("--link or --ts is required");
  if (!args.threadTs) args.threadTs = args.ts;
  if (!Number.isFinite(args.limit) || args.limit < 1) {
    throw new Error("--limit must be at least 1");
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  slack-api read --link SLACK_MESSAGE_LINK
  slack-api read --channel C123 --ts 1778748406.056539

Options:
  --link URL          Slack message or thread reply permalink
  --channel ID        Slack channel id
  --ts TS             Target message timestamp
  --thread-ts TS      Thread root timestamp. Defaults to --ts
  --limit N           Max thread messages. Default: 50
  --include-text      Include message text
  --redact-text       Redact message text in output. Default
  --workspace URL     Slack workspace URL
  --profile DIR       Browser profile directory. Default: configured profile
  --auth-cache FILE   Auth cache path. Default: configured auth cache
  --refresh-auth      Refresh auth from the signed-in browser profile before reading
  --headed            Show the browser window if Slack needs login
`);
}

function sanitizeMessage(message, includeText) {
  return {
    user: message.user || null,
    username: message.username || null,
    type: message.type || null,
    subtype: message.subtype || null,
    ts: message.ts || null,
    threadTs: message.thread_ts || null,
    parentUserId: message.parent_user_id || null,
    text: includeText ? (message.text || "") : "[redacted; rerun with --include-text to save message text]",
    reactionNames: Array.isArray(message.reactions)
      ? message.reactions.map((reaction) => reaction.name).filter(Boolean)
      : [],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  args.auth = await loadAuth(args);
  const { response, json, auth } = await slackApiCall(args, "conversations.replies", {
    channel: args.channel,
    ts: args.threadTs,
    limit: args.limit,
    inclusive: true,
  });

  const messages = json.messages || [];
  const target = messages.find((message) => message.ts === args.ts);
  const output = {
    ok: json.ok,
    status: response.status,
    error: json.error,
    channelId: args.channel,
    targetTs: args.ts,
    rootTs: args.threadTs,
    isThreadReply: Boolean(args.isThreadReply),
    includeText: args.includeText,
    authSource: auth.source,
    authHint: json.authHint,
    hasMore: Boolean(json.has_more),
    messageCount: messages.length,
    target: target ? sanitizeMessage(target, args.includeText) : null,
    messages: messages.map((message) => sanitizeMessage(message, args.includeText)),
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
