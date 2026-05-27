#!/usr/bin/env node

const {
  listUsers,
  loadAuth,
  parseCommonArgs,
  parsePositiveInt,
  resolveUser,
  slackApiCall,
  summarizeUser,
} = require("./slack-api-common.cjs");

const COMMAND_ALIASES = {
  lookup: "search",
  find: "search",
  info: "profile",
  read: "profile",
};

function parseArgs(argv) {
  const { args, remaining } = parseCommonArgs(argv, {
    command: "search",
    query: "",
    user: "",
    email: "",
    includeDeleted: false,
    includeBots: false,
    limit: 25,
    maxPages: 20,
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
    else if (arg === "--user" || arg === "-u") args.user = next();
    else if (arg === "--email") args.email = next();
    else if (arg === "--include-deleted") args.includeDeleted = true;
    else if (arg === "--include-bots") args.includeBots = true;
    else if (arg === "--limit") args.limit = parsePositiveInt(next(), "--limit");
    else if (arg === "--max-pages") args.maxPages = parsePositiveInt(next(), "--max-pages");
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["search", "profile"].includes(args.command)) {
    throw new Error(`Unknown user command: ${args.command}`);
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  slack-api user search --query alice
  slack-api user profile --user U123456
  slack-api user profile --email someone@example.com

Commands:
  search       Search visible workspace users by id/name/email/title
  profile      Resolve a user and read users.info plus users.profile.get

Options:
  --query TEXT          Search query
  --user ID|NAME|EMAIL  User ID, name, display name, or email for profile lookup
  --email EMAIL         Exact email lookup for profile
  --include-deleted     Include deactivated users in search/resolve
  --include-bots        Include bot users in search/resolve
  --limit N             Result limit. Default: 25
  --max-pages N         Max users.list pages. Default: 20
  --workspace URL       Slack workspace URL
  --auth-cache FILE     Auth cache path
  --refresh-auth        Refresh auth from browser profile first
`);
}

function userMatchesQuery(user, query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return true;
  const profile = user.profile || {};
  return [
    user.id,
    user.name,
    user.real_name,
    profile.real_name,
    profile.display_name,
    profile.email,
    profile.title,
  ].some((value) => String(value || "").toLowerCase().includes(normalized));
}

async function runSearch(args) {
  const listed = await listUsers(args, {
    maxPages: args.maxPages,
    limit: 200,
  });
  const results = listed.items
    .filter((user) => userMatchesQuery(user, args.query))
    .filter((user) => args.includeDeleted || !user.deleted)
    .filter((user) => args.includeBots || !user.is_bot)
    .slice(0, args.limit)
    .map(summarizeUser);

  return {
    ok: listed.ok,
    error: listed.error,
    query: args.query || null,
    resultCount: results.length,
    scannedCount: listed.items.length,
    pages: listed.pages,
    results,
  };
}

async function runProfile(args) {
  const value = args.email || args.user || args.query;
  const resolved = await resolveUser(args, value, {
    includeDeleted: args.includeDeleted,
    includeBots: args.includeBots,
    maxPages: args.maxPages,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      candidates: resolved.candidates,
    };
  }

  const { response, json, auth } = await slackApiCall(args, "users.info", {
    user: resolved.userId,
    include_locale: true,
  });
  const { json: profileJson } = await slackApiCall(args, "users.profile.get", {
    user: resolved.userId,
    include_labels: true,
  });

  return {
    ok: json.ok,
    status: response.status,
    error: json.error,
    authSource: auth.source,
    userId: resolved.userId,
    user: json.user ? summarizeUser(json.user) : resolved.user,
    rawUser: json.user || null,
    profileOk: profileJson.ok,
    profileError: profileJson.error,
    profile: profileJson.profile || null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  args.auth = await loadAuth(args);

  const output = args.command === "search"
    ? await runSearch(args)
    : await runProfile(args);

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
