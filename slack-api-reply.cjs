#!/usr/bin/env node

const path = require("node:path");
const {
  loadAuth,
  parseCommonArgs,
  parsePermalink,
  readMessageText,
  slackApiCall,
} = require("./slack-api-common.cjs");
const {
  buildUploadFiles,
  summarizeUploadFile,
  uploadAndShareFiles,
} = require("./slack-api-upload.cjs");

function parseArgs(argv) {
  const { args, remaining } = parseCommonArgs(argv, {
    link: "",
    channel: "",
    ts: "",
    threadTs: "",
    message: "",
    messageFile: "",
    attachments: [],
    attachmentTitles: [],
    attachmentAltTexts: [],
    attachmentSnippetTypes: [],
    send: false,
    alsoSendToChannel: false,
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
    else if (arg === "--message") args.message = next();
    else if (arg === "--message-file") args.messageFile = path.resolve(next());
    else if (arg === "--attach" || arg === "--attachment") args.attachments.push(path.resolve(next()));
    else if (arg === "--file-title") args.attachmentTitles.push(next());
    else if (arg === "--file-alt-text" || arg === "--alt-text") args.attachmentAltTexts.push(next());
    else if (arg === "--snippet-type") args.attachmentSnippetTypes.push(next());
    else if (arg === "--send") args.send = true;
    else if (arg === "--also-send-to-channel") args.alsoSendToChannel = true;
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
  if (!args.message && !args.messageFile && args.attachments.length === 0) {
    throw new Error("--message, --message-file, or --attach is required");
  }
  if (args.attachments.length > 0 && args.alsoSendToChannel) {
    throw new Error("--also-send-to-channel is not supported for file attachment replies by Slack's external upload API");
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  slack-api reply --link SLACK_MESSAGE_LINK --message "Thanks" --send

Options:
  --link URL                 Slack message or thread reply permalink
  --channel ID               Slack channel id
  --ts TS                    Target message timestamp
  --thread-ts TS             Thread root timestamp. Defaults to --ts
  --message TEXT             Reply text
  --message-file FILE        Read reply text from a file
  --attach FILE              Upload and attach a local file. Repeat for multiple files
  --file-title TEXT          Title override. Repeat in --attach order
  --file-alt-text TEXT       Alt text. Repeat in --attach order
  --snippet-type TYPE        Slack snippet type for text/code files. Repeat in --attach order
  --send                     Actually post the reply
                            Default is dry-run: validate target and print planned API call
  --also-send-to-channel     Broadcast the reply to the channel
                             Text-only replies only; Slack file uploads cannot broadcast
  --workspace URL            Slack workspace URL
  --profile DIR              Browser profile directory. Default: configured profile
  --auth-cache FILE          Auth cache path. Default: configured auth cache
  --refresh-auth             Refresh auth from the signed-in browser profile before replying
  --headed                   Show the browser window if Slack needs login
`);
}

async function validateThreadTarget(args) {
  const { json } = await slackApiCall(args, "conversations.replies", {
    channel: args.channel,
    ts: args.threadTs,
    limit: 200,
    inclusive: true,
  });
  if (!json.ok) throw new Error(`Could not validate thread target: ${json.error}`);

  const messages = json.messages || [];
  const targetFound = messages.some((message) => message.ts === args.ts);
  if (!targetFound) {
    throw new Error(`Could not find target message ${args.ts} in thread ${args.threadTs}.`);
  }

  return { messageCount: messages.length, targetFound };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const message = await readMessageText(args);
  const uploadFiles = await buildUploadFiles(args.attachments, {
    titles: args.attachmentTitles,
    altTexts: args.attachmentAltTexts,
    snippetTypes: args.attachmentSnippetTypes,
  });
  if (!message.trim() && uploadFiles.length === 0) throw new Error("Message is empty.");

  args.auth = await loadAuth(args);
  const validation = await validateThreadTarget(args);

  let post = null;
  let upload = null;
  if (args.send) {
    if (uploadFiles.length > 0) {
      upload = await uploadAndShareFiles(args, uploadFiles, {
        channelId: args.channel,
        threadTs: args.threadTs,
        initialComment: message.trim() ? message : null,
      });
    } else {
      const { response, json } = await slackApiCall(args, "chat.postMessage", {
        channel: args.channel,
        thread_ts: args.threadTs,
        text: message,
        reply_broadcast: args.alsoSendToChannel,
      });
      post = {
        status: response.status,
        ok: json.ok,
        error: json.error,
        channel: json.channel,
        ts: json.ts,
        messageTs: json.message?.ts,
      };
    }
  }

  console.log(JSON.stringify({
    ok: upload ? upload.ok : post ? post.ok : true,
    mode: args.send ? "sent" : "dry-run",
    error: upload?.error || post?.error,
    action: uploadFiles.length > 0
      ? "files.getUploadURLExternal + upload_url + files.completeUploadExternal"
      : "chat.postMessage",
    channelId: args.channel,
    targetTs: args.ts,
    rootTs: args.threadTs,
    isThreadReply: Boolean(args.isThreadReply),
    messageLength: message.length,
    attachments: uploadFiles.map(summarizeUploadFile),
    alsoSendToChannel: args.alsoSendToChannel,
    authSource: upload?.authSource || args.auth.source,
    validation,
    post,
    upload,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
