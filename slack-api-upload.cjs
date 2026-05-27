const fs = require("node:fs/promises");
const path = require("node:path");

const { slackApiCall } = require("./slack-api-common.cjs");

function repeatedOptionError(flag, count, fileCount) {
  return `${flag} was provided ${count} times, but only ${fileCount} file attachment(s) were provided`;
}

function optionAt(values, index) {
  return values[index] === undefined ? "" : String(values[index]);
}

async function buildUploadFiles(filePaths, options = {}) {
  const paths = filePaths || [];
  const titles = options.titles || [];
  const altTexts = options.altTexts || [];
  const snippetTypes = options.snippetTypes || [];

  if (titles.length > paths.length) throw new Error(repeatedOptionError("--file-title", titles.length, paths.length));
  if (altTexts.length > paths.length) throw new Error(repeatedOptionError("--file-alt-text", altTexts.length, paths.length));
  if (snippetTypes.length > paths.length) throw new Error(repeatedOptionError("--snippet-type", snippetTypes.length, paths.length));

  return Promise.all(paths.map(async (rawPath, index) => {
    const filePath = path.resolve(rawPath);
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`Attachment file does not exist: ${filePath}`);
      throw new Error(`Could not stat attachment file ${filePath}: ${error.message}`);
    }

    if (!stat.isFile()) throw new Error(`Attachment path is not a file: ${filePath}`);

    const filename = path.basename(filePath);
    return {
      path: filePath,
      filename,
      title: optionAt(titles, index) || filename,
      altText: optionAt(altTexts, index),
      snippetType: optionAt(snippetTypes, index),
      length: stat.size,
    };
  }));
}

function summarizeUploadFile(file) {
  return {
    path: file.path,
    filename: file.filename,
    title: file.title,
    length: file.length,
    altText: file.altText || null,
    snippetType: file.snippetType || null,
  };
}

function summarizeCompletedFile(file) {
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
    isExternal: Boolean(file.is_external),
    permalink: file.permalink || null,
    channels: file.channels || [],
    groups: file.groups || [],
    ims: file.ims || [],
    shares: file.shares || null,
  };
}

function assertSlackUploadUrl(uploadUrl) {
  let parsed;
  try {
    parsed = new URL(uploadUrl);
  } catch {
    throw new Error(`Slack returned an invalid upload URL: ${uploadUrl}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const isSlackOwned = hostname === "slack.com"
    || hostname.endsWith(".slack.com")
    || hostname.endsWith(".slack-files.com");

  if (parsed.protocol !== "https:" || !isSlackOwned) {
    throw new Error(`Refusing to upload file bytes to non-Slack upload URL: ${hostname}`);
  }
}

function uploadNetworkFailure(error) {
  const message = String(error?.message || error);
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|network/i.test(message)) {
    return [
      "Slack file upload failed before Slack responded.",
      "In Codex sandboxed sessions this usually means external network access was blocked.",
      "Rerun the same `slack-api ...` command with escalated permissions and approve the `slack-api` command prefix if prompted.",
      "",
      `Original error: ${message}`,
    ].join("\n");
  }
  return message;
}

async function uploadBytes(uploadUrl, file) {
  assertSlackUploadUrl(uploadUrl);
  const buffer = await fs.readFile(file.path);

  let response;
  try {
    response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
      },
      body: buffer,
    });
  } catch (error) {
    throw new Error(uploadNetworkFailure(error));
  }

  const responseText = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    responseText: responseText.slice(0, 500),
  };
}

async function uploadFilesToSlack(args, files) {
  const uploads = [];
  let authSource = args.auth?.source || null;

  for (const file of files) {
    const getUploadPayload = {
      filename: file.filename,
      length: file.length,
      alt_text: file.altText,
      snippet_type: file.snippetType,
    };
    const { response, json, auth } = await slackApiCall(args, "files.getUploadURLExternal", getUploadPayload);
    authSource = auth.source;

    const upload = {
      file: summarizeUploadFile(file),
      getUpload: {
        ok: json.ok,
        status: response.status,
        error: json.error,
        fileId: json.file_id || null,
      },
      upload: null,
    };
    uploads.push(upload);

    if (!json.ok || !json.upload_url || !json.file_id) {
      return {
        ok: false,
        phase: "get-upload-url",
        error: json.error || "missing_upload_url_or_file_id",
        authSource,
        uploads,
      };
    }

    const byteUpload = await uploadBytes(json.upload_url, file);
    upload.upload = byteUpload;
    if (!byteUpload.ok) {
      return {
        ok: false,
        phase: "upload-bytes",
        error: "upload_failed",
        authSource,
        uploads,
      };
    }
  }

  return {
    ok: true,
    phase: "uploaded",
    error: null,
    authSource,
    uploads,
  };
}

async function uploadAndShareFiles(args, files, share) {
  if (!files.length) throw new Error("uploadAndShareFiles requires at least one file");

  const uploadResult = await uploadFilesToSlack(args, files);
  if (!uploadResult.ok) return uploadResult;

  const completePayload = {
    files: uploadResult.uploads.map((upload) => ({
      id: upload.getUpload.fileId,
      title: upload.file.title,
    })),
    channel_id: share.channelId,
    initial_comment: share.initialComment,
    blocks: share.blocks,
    thread_ts: share.threadTs,
  };

  const { response, json, auth } = await slackApiCall(args, "files.completeUploadExternal", completePayload);
  return {
    ok: json.ok,
    phase: json.ok ? "complete" : "complete-upload",
    error: json.error,
    status: response.status,
    authSource: auth.source,
    uploads: uploadResult.uploads,
    complete: {
      ok: json.ok,
      status: response.status,
      error: json.error,
      files: (json.files || []).map(summarizeCompletedFile),
    },
    responseMetadata: json.response_metadata || null,
  };
}

module.exports = {
  buildUploadFiles,
  summarizeUploadFile,
  uploadAndShareFiles,
};
