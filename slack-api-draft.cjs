#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  DEFAULT_TEAM_ID,
  loadAuth,
  loadPlaywright,
  looksLikeChannelId,
  parseCommonArgs,
  readMessageText,
  resolveChannel,
  slackApiCall,
} = require("./slack-api-common.cjs");

const COMMAND_ALIASES = new Map([
  ["create", "create"],
  ["new", "create"],
  ["add", "create"],
  ["info", "info"],
  ["read", "info"],
  ["show", "info"],
  ["delete", "delete"],
  ["remove", "delete"],
  ["rm", "delete"],
]);

function parseArgs(argv) {
  const { args, remaining } = parseCommonArgs(argv, {
    command: "create",
    channel: "",
    message: "",
    messageFile: "",
    blocksFile: "",
    threadTs: "",
    alsoSendToChannel: false,
    create: false,
    draftId: "",
    deleteDraft: false,
    matchText: "",
    draftIndex: null,
    teamId: DEFAULT_TEAM_ID,
    includeRaw: false,
  });

  let explicitCommand = false;
  if (remaining[0] && !remaining[0].startsWith("-")) {
    const rawCommand = remaining.shift();
    const command = COMMAND_ALIASES.get(rawCommand);
    if (!command) throw new Error(`Unknown draft command: ${rawCommand}`);
    args.command = command;
    explicitCommand = true;
  }

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
    else if (arg === "--thread-ts") args.threadTs = next();
    else if (arg === "--also-send-to-channel") args.alsoSendToChannel = true;
    else if (arg === "--create") args.create = true;
    else if (arg === "--draft-id" || arg === "--id") args.draftId = next();
    else if (arg === "--delete") args.deleteDraft = true;
    else if (arg === "--match-text") args.matchText = next();
    else if (arg === "--draft-index" || arg === "--index") args.draftIndex = Number(next());
    else if (arg === "--team-id") args.teamId = next();
    else if (arg === "--include-raw") args.includeRaw = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!explicitCommand && args.deleteDraft) args.command = "delete";

  if (args.command !== "create" && args.create) {
    throw new Error("--create only applies to `slack-api draft create`");
  }
  if (args.command !== "delete" && args.deleteDraft) {
    throw new Error("--delete only applies to `slack-api draft delete`");
  }

  if (args.command === "create") {
    if (!args.channel) throw new Error("--channel is required");
    if (!args.message && !args.messageFile && !args.blocksFile) {
      throw new Error("--message, --message-file, or --blocks-file is required");
    }
  } else if (args.command === "info" && !args.draftId) {
    throw new Error("--draft-id is required");
  } else if (args.command === "delete") {
    if (!args.channel && !args.matchText) {
      throw new Error("--channel or --match-text is required for UI draft deletion");
    }
    if (args.draftIndex !== null && (!Number.isInteger(args.draftIndex) || args.draftIndex < 1)) {
      throw new Error("--draft-index must be a positive integer");
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  slack-api draft --channel '#general' --message 'draft text'
  slack-api draft create --channel C123456 --message-file /tmp/message.txt --create
  slack-api draft info --draft-id D123456
  slack-api draft delete --channel '#general' --match-text 'draft text'
  slack-api draft delete --channel '#general' --match-text 'draft text' --delete

Commands:
  create                  Validate or create a Slack draft. Default command
  info                    Read draft metadata from drafts.info
  delete                  Validate or delete a draft through Slack's Drafts UI

Options:
  --channel ID|#name        Channel id or channel name
  --message TEXT            Draft text
  --message-file FILE       Read draft text from file
  --blocks-file FILE        JSON Slack rich_text blocks payload
  --thread-ts TS            Create a thread-reply draft for this root timestamp
  --also-send-to-channel    Broadcast thread reply draft to channel
  --create                  Actually create the draft. Default is dry-run
  --draft-id ID             Draft id for info
  --match-text TEXT         Text that must appear in the visible draft card
  --draft-index N           Pick the Nth matching visible draft card. Default: require one match
  --delete                  Actually delete the draft through the UI. Default is dry-run
  --team-id ID              Slack app team/workspace id. Default: ${DEFAULT_TEAM_ID}
  --include-raw             Include the raw Slack API payload for info
  --workspace URL           Slack workspace URL
  --profile DIR             Browser profile directory for UI deletion
  --auth-cache FILE         Auth cache path
  --refresh-auth            Refresh auth from browser profile first
  --headless                Run UI deletion without a visible browser window. Default
  --headed                  Show the browser window

Notes:
  This uses Slack's browser draft endpoints, not an official app token.
  Draft deletion drives Slack's Drafts & sent UI because direct drafts.delete returns team_is_restricted.
`);
}

function textToRichTextBlocks(text) {
  return [{
    type: "rich_text",
    elements: [{
      type: "rich_text_section",
      elements: [{
        type: "text",
        text,
      }],
    }],
  }];
}

async function readBlocks(args, text) {
  if (!args.blocksFile) return textToRichTextBlocks(text);
  const raw = await fs.readFile(args.blocksFile, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("--blocks-file must contain a JSON array");
  return parsed;
}

function restrictedDraftHint(json, method) {
  if (json.error !== "team_is_restricted") return null;
  return `Slack rejected ${method} with team_is_restricted. This private browser endpoint may be restricted in this workspace/session.`;
}

async function runCreate(args) {
  args.auth = await loadAuth(args);
  const resolved = await resolveChannel(args, args.channel);
  const text = await readMessageText(args);
  const blocks = await readBlocks(args, text);

  if (!resolved.ok) {
    console.log(JSON.stringify({
      ok: false,
      error: resolved.error,
      candidates: resolved.candidates,
    }, null, 2));
    return;
  }

  const destination = {
    channel_id: resolved.channelId,
  };
  if (args.threadTs) {
    destination.thread_ts = args.threadTs;
    destination.broadcast = args.alsoSendToChannel;
  }

  const payload = {
    client_msg_id: crypto.randomUUID(),
    destinations: [destination],
    blocks,
    file_ids: [],
    is_from_composer: true,
  };

  if (!args.create) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      action: "drafts.create",
      channel: resolved.channel,
      payload,
      hint: "Rerun with --create to create this Slack draft.",
    }, null, 2));
    return;
  }

  const { response, json, auth } = await slackApiCall(args, "drafts.create", payload);
  console.log(JSON.stringify({
    ok: json.ok,
    status: response.status,
    error: json.error,
    responseMetadata: json.response_metadata || null,
    authSource: auth.source,
    channelId: resolved.channelId,
    channel: resolved.channel,
    draftId: json.draft?.id || null,
    draft: json.draft || null,
    raw: json,
  }, null, 2));
}

async function runInfo(args) {
  args.auth = await loadAuth(args);
  const { response, json, auth } = await slackApiCall(args, "drafts.info", {
    draft_id: args.draftId,
  });

  const output = {
    ok: json.ok,
    status: response.status,
    error: json.error,
    responseMetadata: json.response_metadata || null,
    authSource: auth.source,
    draftId: args.draftId,
    draft: json.draft || null,
    hint: restrictedDraftHint(json, "drafts.info") || json.authHint || null,
  };

  if (args.includeRaw || !json.ok) output.raw = json;
  console.log(JSON.stringify(output, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function browserUiFailure(error) {
  const message = String(error?.message || error);
  if (/mach_port_rendezvous|Permission denied \(1100\)|Target page, context or browser has been closed|kill EPERM/i.test(message)) {
    return [
      "Could not use Slack's browser UI because Chromium was blocked by the current sandbox.",
      "Rerun this `slack-api draft delete ...` command with escalated permissions in Codex.",
      "",
      `Original error: ${message}`,
    ].join("\n");
  }
  return message;
}

async function launchUiContext(args) {
  const { chromium } = loadPlaywright();
  await fs.mkdir(args.profile, { recursive: true });

  try {
    return await chromium.launchPersistentContext(args.profile, {
      headless: args.headless,
      viewport: { width: 1440, height: 1000 },
    });
  } catch (error) {
    throw new Error(browserUiFailure(error));
  }
}

async function waitForSlackClient(page, args) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < args.timeoutMs) {
    let state;
    try {
      state = await page.evaluate(() => {
        const text = document.body?.innerText || "";
        return {
          href: location.href,
          title: document.title,
          hasClient: /app\.slack\.com\/client|\.slack\.com\/client/.test(location.href),
          hasLoginText: /sign in|continue|magic code|password|two-factor|2fa|single sign-on|sso/i.test(text),
        };
      });
    } catch (error) {
      if (/Execution context was destroyed|Target closed|Navigation/i.test(String(error.message || error))) {
        await sleep(1_000);
        continue;
      }
      throw error;
    }

    if (state.hasClient) return state;
    if (state.hasLoginText && args.headless) {
      throw new Error("Slack is asking for interactive login. Rerun with `--headed`, complete login, then rerun headless.");
    }
    await sleep(1_000);
  }

  throw new Error("Timed out waiting for Slack client.");
}

async function resolveDeleteTarget(args) {
  if (!args.channel) {
    return {
      ok: true,
      channelId: null,
      channel: null,
      channelMatchText: "",
      warning: null,
    };
  }

  const rawChannel = String(args.channel).trim();
  try {
    const resolved = await resolveChannel(args, rawChannel);
    if (resolved.ok) {
      return {
        ok: true,
        channelId: resolved.channelId,
        channel: resolved.channel,
        channelMatchText: resolved.channel?.name || rawChannel.replace(/^#/, ""),
        warning: null,
      };
    }

    return {
      ok: true,
      channelId: looksLikeChannelId(rawChannel) ? rawChannel : null,
      channel: null,
      channelMatchText: looksLikeChannelId(rawChannel) && args.matchText ? "" : rawChannel.replace(/^#/, ""),
      warning: {
        error: resolved.error,
        candidates: resolved.candidates,
      },
    };
  } catch (error) {
    return {
      ok: true,
      channelId: looksLikeChannelId(rawChannel) ? rawChannel : null,
      channel: null,
      channelMatchText: looksLikeChannelId(rawChannel) && args.matchText ? "" : rawChannel.replace(/^#/, ""),
      warning: {
        error: String(error.message || error),
      },
    };
  }
}

async function openDraftsPage(page, args, channelId) {
  const startUrl = channelId
    ? `https://app.slack.com/client/${args.teamId}/${channelId}`
    : `https://app.slack.com/client/${args.teamId}`;
  await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: args.timeoutMs });
  await waitForSlackClient(page, args);

  const draftsLink = page.locator('[data-qa="channel_sidebar_pdrafts"]').first();
  await draftsLink.waitFor({ state: "attached", timeout: args.timeoutMs });
  await draftsLink.click({ timeout: 5_000 });
  await page.locator('[data-qa="drafts_page"]').waitFor({ state: "visible", timeout: args.timeoutMs });
  await sleep(1_500);
}

async function visibleDrafts(page, target) {
  return page.evaluate((target) => {
    const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const includes = (text, needle) => !needle || text.toLowerCase().includes(needle.toLowerCase());
    const cards = Array.from(document.querySelectorAll('[data-qa="drafts_page_draft"]'));
    const all = cards.map((card, index) => {
      const text = compact(card.innerText || card.textContent);
      return {
        index,
        text,
        snippet: text.slice(0, 500),
        hasDeleteButton: Boolean(card.querySelector('[data-qa="drafts_page_draft_delete"]')),
      };
    });
    const matching = all.filter((card) => includes(card.text, target.channelMatchText) && includes(card.text, target.matchText));
    const draftTabText = compact(document.querySelector('[data-qa="outbox_tab_drafts"]')?.innerText || "");
    return {
      draftTabText,
      totalCards: all.length,
      matchingCount: matching.length,
      matching,
    };
  }, target);
}

async function runDelete(args) {
  const target = await resolveDeleteTarget(args);
  if (!target.ok) {
    console.log(JSON.stringify({
      ok: false,
      error: target.error,
      candidates: target.candidates,
    }, null, 2));
    return;
  }

  const context = await launchUiContext(args);
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(args.timeoutMs);

  try {
    await openDraftsPage(page, args, target.channelId);
    const matchTarget = {
      channelMatchText: target.channelMatchText,
      matchText: args.matchText,
    };
    const before = await visibleDrafts(page, matchTarget);
    const selected = args.draftIndex === null ? null : before.matching[args.draftIndex - 1] || null;

    if (before.matchingCount === 0) {
      console.log(JSON.stringify({
        ok: false,
        error: "draft_not_found",
        mode: "ui-delete",
        dryRun: !args.deleteDraft,
        channel: target.channel,
        channelMatchText: target.channelMatchText,
        resolutionWarning: target.warning || null,
        matchText: args.matchText || null,
        before,
        pageUrl: page.url(),
      }, null, 2));
      return;
    }

    if (args.draftIndex !== null && !selected) {
      console.log(JSON.stringify({
        ok: false,
        error: "draft_index_out_of_range",
        mode: "ui-delete",
        dryRun: !args.deleteDraft,
        channel: target.channel,
        channelMatchText: target.channelMatchText,
        resolutionWarning: target.warning || null,
        matchText: args.matchText || null,
        requestedDraftIndex: args.draftIndex,
        before,
        pageUrl: page.url(),
      }, null, 2));
      return;
    }

    if (!selected && before.matchingCount !== 1) {
      console.log(JSON.stringify({
        ok: false,
        error: "ambiguous_draft_match",
        mode: "ui-delete",
        dryRun: !args.deleteDraft,
        channel: target.channel,
        channelMatchText: target.channelMatchText,
        resolutionWarning: target.warning || null,
        matchText: args.matchText || null,
        before,
        hint: "Add --match-text or --draft-index N to select exactly one visible draft.",
        pageUrl: page.url(),
      }, null, 2));
      return;
    }

    const chosen = selected || before.matching[0];
    if (!args.deleteDraft) {
      console.log(JSON.stringify({
        ok: true,
        dryRun: true,
        action: "ui.drafts.delete",
        channel: target.channel,
        channelMatchText: target.channelMatchText,
        resolutionWarning: target.warning || null,
        matchText: args.matchText || null,
        selectedDraft: chosen,
        before,
        hint: "Rerun with --delete to delete this Slack draft through the Drafts & sent UI.",
        pageUrl: page.url(),
      }, null, 2));
      return;
    }

    const card = page.locator('[data-qa="drafts_page_draft"]').nth(chosen.index);
    await card.hover({ timeout: 5_000 });
    const deleteButton = card.locator('[data-qa="drafts_page_draft_delete"]').first();
    try {
      await deleteButton.waitFor({ state: "visible", timeout: 5_000 });
      await deleteButton.click({ timeout: 5_000 });
    } catch {
      await deleteButton.waitFor({ state: "attached", timeout: 5_000 });
      await deleteButton.click({ timeout: 5_000, force: true });
    }
    await sleep(1_000);

    let confirmed = false;
    const confirmButton = page.locator('button:has-text("Delete"), button:has-text("Discard")').last();
    if (await confirmButton.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
      await confirmButton.click({ timeout: 5_000 });
      confirmed = true;
    }

    let after = await visibleDrafts(page, matchTarget);
    const startedAt = Date.now();
    while (Date.now() - startedAt < Math.min(args.timeoutMs, 15_000)) {
      const exactStillPresent = after.matching.some((draft) => draft.text === chosen.text);
      if (!exactStillPresent && after.matchingCount < before.matchingCount) break;
      await sleep(500);
      after = await visibleDrafts(page, matchTarget);
    }

    const exactStillPresent = after.matching.some((draft) => draft.text === chosen.text);
    const deleted = !exactStillPresent && after.matchingCount < before.matchingCount;
    console.log(JSON.stringify({
      ok: deleted,
      error: deleted ? null : "draft_still_visible_after_delete",
      mode: "ui-delete",
      deleted,
      confirmed,
      channel: target.channel,
      channelMatchText: target.channelMatchText,
      resolutionWarning: target.warning || null,
      matchText: args.matchText || null,
      deletedDraft: chosen,
      before,
      after,
      pageUrl: page.url(),
    }, null, 2));
  } finally {
    await context.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "create") return runCreate(args);
  if (args.command === "info") return runInfo(args);
  if (args.command === "delete") return runDelete(args);
  throw new Error(`Unsupported draft command: ${args.command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
