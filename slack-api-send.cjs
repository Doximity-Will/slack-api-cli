#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  loadAuth,
  parseCommonArgs,
  readMessageText,
  resolveChannel,
  slackApiCall,
} = require("./slack-api-common.cjs");
const {
  buildUploadFiles,
  summarizeUploadFile,
  uploadAndShareFiles,
} = require("./slack-api-upload.cjs");

function parseArgs(argv) {
  const { args, remaining } = parseCommonArgs(argv, {
    channel: "",
    message: "",
    messageFile: "",
    blocksFile: "",
    attachments: [],
    attachmentTitles: [],
    attachmentAltTexts: [],
    attachmentSnippetTypes: [],
    send: true,
    unfurlLinks: true,
    unfurlMedia: true,
  });

  for (let index = 0; index < remaining.length; index += 1) {
    const arg = remaining[index];
    const next = () => {
      index += 1;
      if (index >= remaining.length) throw new Error(`Missing value for ${arg}`);
      return remaining[index];
    };

    if (arg === "--channel" || arg === "-c") args.channel = next();
    else if (arg === "--message" || arg === "-m") args.message = next();
    else if (arg === "--message-file") args.messageFile = path.resolve(next());
    else if (arg === "--blocks-file") args.blocksFile = path.resolve(next());
    else if (arg === "--attach" || arg === "--attachment") args.attachments.push(path.resolve(next()));
    else if (arg === "--file-title") args.attachmentTitles.push(next());
    else if (arg === "--file-alt-text" || arg === "--alt-text") args.attachmentAltTexts.push(next());
    else if (arg === "--snippet-type") args.attachmentSnippetTypes.push(next());
    else if (arg === "--send") args.send = true;
    else if (arg === "--dry-run") args.send = false;
    else if (arg === "--no-unfurl-links") args.unfurlLinks = false;
    else if (arg === "--no-unfurl-media") args.unfurlMedia = false;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.channel) throw new Error("--channel is required");
  if (!args.message && !args.messageFile && !args.blocksFile && args.attachments.length === 0) {
    throw new Error("--message, --message-file, --blocks-file, or --attach is required");
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  slack-api send --channel '#general' --message 'hello'
  slack-api send --channel C123456 --message-file /tmp/message.txt --dry-run

Options:
  --channel ID|#name    Channel id or channel name
  --message TEXT        Message text
  --message-file FILE   Read message text from file
  --blocks-file FILE    JSON Slack blocks payload
  --attach FILE         Upload and attach a local file. Repeat for multiple files
  --file-title TEXT     Title override. Repeat in --attach order
  --file-alt-text TEXT  Alt text. Repeat in --attach order
  --snippet-type TYPE   Slack snippet type for text/code files. Repeat in --attach order
  --send                Post the top-level message. This is the default.
  --dry-run             Preview the message without posting it.
  --no-unfurl-links     Disable link unfurls
  --no-unfurl-media     Disable media unfurls
  --workspace URL       Slack workspace URL
  --auth-cache FILE     Auth cache path
  --refresh-auth        Refresh auth from browser profile first
`);
}

async function readBlocks(args) {
  if (!args.blocksFile) return null;
  const raw = await fs.readFile(args.blocksFile, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("--blocks-file must contain a JSON array");
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  args.auth = await loadAuth(args);
  const resolved = await resolveChannel(args, args.channel);
  const text = await readMessageText(args);
  const blocks = await readBlocks(args);
  const uploadFiles = await buildUploadFiles(args.attachments, {
    titles: args.attachmentTitles,
    altTexts: args.attachmentAltTexts,
    snippetTypes: args.attachmentSnippetTypes,
  });

  if (!resolved.ok) {
    console.log(JSON.stringify({
      ok: false,
      error: resolved.error,
      candidates: resolved.candidates,
    }, null, 2));
    return;
  }

  if (uploadFiles.length > 0) {
    const shareBlocks = text ? null : blocks;
    const payload = {
      files: uploadFiles.map((file) => ({
        title: file.title,
        filename: file.filename,
        length: file.length,
      })),
      channel_id: resolved.channelId,
      initial_comment: text || null,
      blocks: shareBlocks,
    };
    const blocksIgnored = Boolean(text && blocks);

    if (!args.send) {
      console.log(JSON.stringify({
        ok: true,
        dryRun: true,
        action: "files.getUploadURLExternal + upload_url + files.completeUploadExternal",
        channel: resolved.channel,
        payload,
        attachments: uploadFiles.map(summarizeUploadFile),
        blocksIgnored,
        warning: blocksIgnored
          ? "Slack ignores blocks on file posts when initial_comment/message text is provided."
          : null,
        hint: "Rerun without --dry-run to upload and share these file attachment(s)."
      }, null, 2));
      return;
    }

    const upload = await uploadAndShareFiles(args, uploadFiles, {
      channelId: resolved.channelId,
      initialComment: text || null,
      blocks: shareBlocks,
    });
    console.log(JSON.stringify({
      ok: upload.ok,
      status: upload.status || null,
      error: upload.error,
      action: "files.completeUploadExternal",
      authSource: upload.authSource,
      channelId: resolved.channelId,
      channel: resolved.channel,
      blocksIgnored,
      upload,
    }, null, 2));
    return;
  }

  const payload = {
    channel: resolved.channelId,
    text,
    blocks,
    unfurl_links: args.unfurlLinks,
    unfurl_media: args.unfurlMedia,
    client_msg_id: crypto.randomUUID(),
  };

  if (!args.send) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      action: "chat.postMessage",
      channel: resolved.channel,
      payload,
      hint: "Rerun without --dry-run to post this top-level message.",
    }, null, 2));
    return;
  }

  const { response, json, auth } = await slackApiCall(args, "chat.postMessage", payload);
  console.log(JSON.stringify({
    ok: json.ok,
    status: response.status,
    error: json.error,
    authSource: auth.source,
    channelId: resolved.channelId,
    channel: resolved.channel,
    ts: json.ts || null,
    message: json.message || null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
