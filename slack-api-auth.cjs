#!/usr/bin/env node

const { loadAuth, parseCommonArgs, slackApiCall } = require("./slack-api-common.cjs");

function printHelp() {
  console.log(`
Usage:
  npm run api:auth

Options:
  --workspace URL    Slack workspace URL
  --profile DIR      Browser profile directory. Default: configured profile
  --auth-cache FILE  Auth cache path. Default: configured auth cache
  --refresh          Refresh the auth cache by launching the signed-in browser profile
  --refresh-auth     Alias for --refresh
  --timeout-ms N     Wait timeout. Default: 30000
  --headless         Run without a visible browser window. Default
  --headed           Show the browser window if Slack needs login
`);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const { args, remaining } = parseCommonArgs(process.argv.slice(2));
  for (const arg of remaining) {
    if (arg === "--refresh") args.refreshAuth = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  args.auth = await loadAuth(args);
  const { response, json, auth } = await slackApiCall(args, "auth.test");

  console.log(JSON.stringify({
    ok: json.ok,
    status: response.status,
    error: json.error,
    user: json.user,
    userId: json.user_id,
    team: json.team,
    teamId: json.team_id,
    authSource: auth.source,
    authCachePath: auth.cachePath || args.authCache,
    authCacheAgeMs: auth.cacheAgeMs ?? null,
    authHint: json.authHint,
    tokenLength: auth.tokenLength,
    cookieCount: auth.cookieCount,
    authPageUrl: auth.pageUrl,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
