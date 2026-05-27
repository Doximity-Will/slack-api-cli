#!/usr/bin/env node

const {
  loadAuth,
  normalizeEmojiName,
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
    emoji: "eyes",
    add: false,
    remove: false,
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
    else if (arg === "--emoji") args.emoji = normalizeEmojiName(next());
    else if (arg === "--add") args.add = true;
    else if (arg === "--remove") args.remove = true;
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
  if (!args.emoji) throw new Error("--emoji must not be empty");
  if (args.add && args.remove) throw new Error("Use only one of --add or --remove");

  return args;
}

function printHelp() {
  console.log(`
Usage:
  npm run api:react -- --link SLACK_MESSAGE_LINK --emoji eyes --add
  npm run api:react -- --link SLACK_MESSAGE_LINK --emoji eyes --remove

Options:
  --link URL          Slack message or thread reply permalink
  --channel ID        Slack channel id
  --ts TS             Target message timestamp
  --thread-ts TS      Thread root timestamp. Defaults to --ts
  --emoji NAME        Emoji name, with or without colons. Default: eyes
  --add               Actually add the reaction
  --remove            Actually remove your reaction
                       Default is dry-run: validate target and print planned API call
  --workspace URL     Slack workspace URL
  --profile DIR       Browser profile directory. Default: configured profile
  --auth-cache FILE   Auth cache path. Default: configured auth cache
  --refresh-auth      Refresh auth from the signed-in browser profile before reacting
  --headed            Show the browser window if Slack needs login
`);
}

async function readTarget(args) {
  const { json } = await slackApiCall(args, "conversations.replies", {
    channel: args.channel,
    ts: args.threadTs,
    limit: 100,
    inclusive: true,
  });
  if (!json.ok) throw new Error(`Could not validate reaction target: ${json.error}`);

  const target = (json.messages || []).find((message) => message.ts === args.ts);
  if (!target) throw new Error(`Could not find target message ${args.ts} in thread ${args.threadTs}.`);

  const reactions = Array.isArray(target.reactions)
    ? target.reactions.map((reaction) => ({
      name: reaction.name,
      count: reaction.count ?? null,
      userCount: Array.isArray(reaction.users) ? reaction.users.length : null,
    })).filter((reaction) => reaction.name)
    : [];
  const reactionNames = reactions.map((reaction) => reaction.name);
  return {
    user: target.user || null,
    ts: target.ts,
    reactions,
    reactionNames,
    reactionPresent: reactionNames.includes(args.emoji),
  };
}

function actionMode(args, reaction) {
  if (!args.add && !args.remove) return "dry-run";
  if (!reaction) return args.add ? "not-added" : "not-present";
  if (args.add && reaction.error === "already_reacted") return "already-present";
  if (args.remove && reaction.error === "no_reaction") return "not-present";
  return args.add ? "added" : "removed";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  args.auth = await loadAuth(args);
  const targetBefore = await readTarget(args);

  let reaction = null;
  if (args.add || (args.remove && targetBefore.reactionPresent)) {
    const { response, json } = await slackApiCall(args, args.add ? "reactions.add" : "reactions.remove", {
      channel: args.channel,
      timestamp: args.ts,
      name: args.emoji,
    });
    reaction = {
      status: response.status,
      ok: json.ok || json.error === "already_reacted" || json.error === "no_reaction",
      error: json.error,
    };
  }

  const didMutate = args.add || args.remove;
  const targetAfter = didMutate ? await readTarget(args) : null;
  const ok = didMutate
    ? Boolean(reaction?.ok || (!args.add && !targetBefore.reactionPresent))
    : true;

  console.log(JSON.stringify({
    ok,
    mode: actionMode(args, reaction),
    channelId: args.channel,
    targetTs: args.ts,
    rootTs: args.threadTs,
    isThreadReply: Boolean(args.isThreadReply),
    emoji: `:${args.emoji}:`,
    plannedAction: args.add ? "add" : args.remove ? "remove" : "validate",
    authSource: args.auth.source,
    targetBefore,
    reaction,
    targetAfter,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
