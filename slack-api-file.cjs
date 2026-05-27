#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const {
  fetchSlackPrivateUrl,
  loadAuth,
  parseCommonArgs,
  parsePositiveInt,
  readMessageText,
  resolveChannel,
  slackApiCall,
} = require("./slack-api-common.cjs");
const {
  buildUploadFiles,
  summarizeUploadFile,
  uploadAndShareFiles,
} = require("./slack-api-upload.cjs");

const COMMAND_ALIASES = {
  find: "search",
  info: "read",
  get: "read",
  download: "read",
  add: "upload",
  post: "upload",
  share: "upload",
};

function parseArgs(argv) {
  const { args, remaining } = parseCommonArgs(argv, {
    command: "search",
    query: "",
    file: "",
    channel: "",
    message: "",
    messageFile: "",
    blocksFile: "",
    attachments: [],
    attachmentTitles: [],
    attachmentAltTexts: [],
    attachmentSnippetTypes: [],
    threadTs: "",
    send: false,
    count: 20,
    page: 1,
    sort: "timestamp",
    sortDir: "desc",
    includeContent: false,
    maxBytes: 256 * 1024,
    downloadTo: "",
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
    else if (arg === "--file" || arg === "-f") {
      const value = next();
      if (args.command === "upload") args.attachments.push(path.resolve(value));
      else args.file = value;
    } else if (arg === "--attach" || arg === "--attachment") args.attachments.push(path.resolve(next()));
    else if (arg === "--channel" || arg === "-c") args.channel = next();
    else if (arg === "--message" || arg === "-m" || arg === "--initial-comment") args.message = next();
    else if (arg === "--message-file") args.messageFile = path.resolve(next());
    else if (arg === "--blocks-file") args.blocksFile = path.resolve(next());
    else if (arg === "--thread-ts") args.threadTs = next();
    else if (arg === "--file-title") args.attachmentTitles.push(next());
    else if (arg === "--file-alt-text" || arg === "--alt-text") args.attachmentAltTexts.push(next());
    else if (arg === "--snippet-type") args.attachmentSnippetTypes.push(next());
    else if (arg === "--send") args.send = true;
    else if (arg === "--count") args.count = parsePositiveInt(next(), "--count");
    else if (arg === "--page") args.page = parsePositiveInt(next(), "--page");
    else if (arg === "--sort") args.sort = next();
    else if (arg === "--sort-dir") args.sortDir = next();
    else if (arg === "--include-content") args.includeContent = true;
    else if (arg === "--max-bytes") args.maxBytes = parsePositiveInt(next(), "--max-bytes");
    else if (arg === "--download-to") args.downloadTo = path.resolve(next());
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["search", "read", "upload"].includes(args.command)) {
    throw new Error(`Unknown file command: ${args.command}`);
  }
  if (args.command === "upload") {
    if (!args.channel) throw new Error("--channel is required for file upload");
    if (args.attachments.length === 0) throw new Error("--file or --attach is required for file upload");
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  slack-api file search --query 'budget type:pdfs' --count 20
  slack-api file read --file F123456
  slack-api file read --file F123456 --include-content
  slack-api file read --file F123456 --download-to /tmp/slack-file
  slack-api file upload --channel '#general' --file /tmp/report.pdf --initial-comment 'Report' --send

Commands:
  search       Search Slack files via search.files
  read         Read file metadata via files.info and optionally fetch content
  upload       Upload and share one or more local files

Options:
  --query TEXT         File search query. Supports Slack file filters like type:pdfs
  --file ID|URL        File ID or Slack file URL for read/download; local path for upload
  --attach FILE        Local file path for upload. Repeat for multiple files
  --channel ID|#name   Channel id or channel name for upload
  --message TEXT       Initial comment for upload
  --initial-comment TEXT
                       Alias for --message
  --message-file FILE  Read upload initial comment from file
  --blocks-file FILE   JSON Slack blocks payload for upload without initial comment
  --thread-ts TS       Upload as a reply in this thread
  --file-title TEXT    Title override. Repeat in file order
  --file-alt-text TEXT Alt text. Repeat in file order
  --snippet-type TYPE  Slack snippet type for text/code files
  --send               Actually upload/share files. Default is dry-run
  --count N           Search result count. Default: 20
  --page N            Search page. Default: 1
  --sort VALUE        Search sort. Default: timestamp
  --sort-dir asc|desc Search sort direction. Default: desc
  --include-content   For text-like files, include content in JSON output
  --max-bytes N       Max bytes to include/download from a file. Default: 262144
  --download-to FILE  Write fetched file bytes to a local file
  --workspace URL     Slack workspace URL
  --auth-cache FILE   Auth cache path
  --refresh-auth      Refresh auth from browser profile first
`);
}

function parseFileId(value) {
  const raw = String(value || "").trim();
  if (/^F[A-Z0-9]+$/.test(raw)) return raw;

  try {
    const url = new URL(raw);
    const match = url.pathname.match(/\/files\/[^/]+\/(F[A-Z0-9]+)/);
    if (match) return match[1];
  } catch {
    // Fall through to the explicit error below.
  }

  throw new Error("--file must be a Slack file ID like F123 or a Slack file URL");
}

async function readBlocks(args) {
  if (!args.blocksFile) return null;
  const raw = await fs.readFile(args.blocksFile, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("--blocks-file must contain a JSON array");
  return parsed;
}

function summarizeFile(file) {
  return {
    id: file.id || null,
    created: file.created || null,
    timestamp: file.timestamp || null,
    name: file.name || null,
    title: file.title || null,
    mimetype: file.mimetype || null,
    filetype: file.filetype || null,
    prettyType: file.pretty_type || null,
    user: file.user || null,
    size: file.size || null,
    mode: file.mode || null,
    editable: Boolean(file.editable),
    isExternal: Boolean(file.is_external),
    urlPrivate: file.url_private || null,
    urlPrivateDownload: file.url_private_download || null,
    permalink: file.permalink || null,
    channels: file.channels || [],
    groups: file.groups || [],
    ims: file.ims || [],
    shares: file.shares || null,
    preview: file.preview || file.plain_text || null,
  };
}

function isTextLike(file, contentType) {
  const values = [
    contentType,
    file.mimetype,
    file.filetype,
    file.pretty_type,
  ].join(" ").toLowerCase();
  return /text|json|xml|csv|markdown|md|yaml|yml|javascript|typescript|ruby|python|swift|shell|html|css/.test(values);
}

async function runSearch(args) {
  const { response, json, auth } = await slackApiCall(args, "search.files", {
    query: args.query,
    count: args.count,
    page: args.page,
    sort: args.sort,
    sort_dir: args.sortDir,
  });
  const matches = json.files?.matches || [];

  return {
    ok: json.ok,
    status: response.status,
    error: json.error,
    authSource: auth.source,
    query: args.query,
    total: json.files?.total ?? null,
    pagination: json.files?.pagination || null,
    resultCount: matches.length,
    results: matches.map(summarizeFile),
  };
}

async function runRead(args) {
  const fileId = parseFileId(args.file);
  const { response, json, auth } = await slackApiCall(args, "files.info", {
    file: fileId,
    count: 20,
  });
  const file = json.file || null;
  const output = {
    ok: json.ok,
    status: response.status,
    error: json.error,
    authSource: auth.source,
    fileId,
    file: file ? summarizeFile(file) : null,
    comments: json.comments || [],
  };

  if (!json.ok || !file || (!args.includeContent && !args.downloadTo)) return output;

  const privateUrl = file.url_private_download || file.url_private;
  if (!privateUrl) {
    output.contentError = "file_has_no_private_download_url";
    return output;
  }

  let download;
  try {
    download = await fetchSlackPrivateUrl(args, privateUrl);
  } catch (error) {
    output.contentError = error.message;
    return output;
  }
  output.contentStatus = download.response.status;
  output.contentType = download.contentType;
  output.contentBytes = download.buffer.length;

  const limitedBuffer = download.buffer.subarray(0, args.maxBytes);
  output.contentTruncated = download.buffer.length > args.maxBytes;

  if (args.downloadTo) {
    await fs.mkdir(path.dirname(args.downloadTo), { recursive: true });
    await fs.writeFile(args.downloadTo, limitedBuffer);
    output.downloadedTo = args.downloadTo;
  }

  if (args.includeContent) {
    if (isTextLike(file, download.contentType)) {
      output.contentText = limitedBuffer.toString("utf8");
    } else {
      output.contentHint = "File did not look text-like; use --download-to to save bytes locally.";
    }
  }

  return output;
}

async function runUpload(args) {
  const resolved = await resolveChannel(args, args.channel);
  const text = await readMessageText(args);
  const blocks = await readBlocks(args);
  const uploadFiles = await buildUploadFiles(args.attachments, {
    titles: args.attachmentTitles,
    altTexts: args.attachmentAltTexts,
    snippetTypes: args.attachmentSnippetTypes,
  });

  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      candidates: resolved.candidates,
    };
  }

  const shareBlocks = text ? null : blocks;
  const blocksIgnored = Boolean(text && blocks);
  const payload = {
    files: uploadFiles.map((file) => ({
      title: file.title,
      filename: file.filename,
      length: file.length,
    })),
    channel_id: resolved.channelId,
    initial_comment: text || null,
    blocks: shareBlocks,
    thread_ts: args.threadTs || null,
  };

  if (!args.send) {
    return {
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
      hint: "Rerun with --send to upload and share these file attachment(s).",
    };
  }

  const upload = await uploadAndShareFiles(args, uploadFiles, {
    channelId: resolved.channelId,
    threadTs: args.threadTs || null,
    initialComment: text || null,
    blocks: shareBlocks,
  });

  return {
    ok: upload.ok,
    status: upload.status || null,
    error: upload.error,
    action: "files.completeUploadExternal",
    authSource: upload.authSource,
    channelId: resolved.channelId,
    channel: resolved.channel,
    blocksIgnored,
    upload,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  args.auth = await loadAuth(args);

  const output = args.command === "search"
    ? await runSearch(args)
    : args.command === "read"
      ? await runRead(args)
      : await runUpload(args);

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
