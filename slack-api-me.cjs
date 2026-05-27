#!/usr/bin/env node

const {
  loadAuth,
  parseCommonArgs,
  slackApiCall,
  summarizeUser,
} = require("./slack-api-common.cjs");

function parseArgs(argv) {
  const { args, remaining } = parseCommonArgs(argv, {
    includeRaw: false,
  });

  for (const arg of remaining) {
    if (arg === "--include-raw") args.includeRaw = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  slack-api me

Options:
  --include-raw      Include raw users.info and users.profile.get payloads
  --workspace URL    Slack workspace URL
  --auth-cache FILE  Auth cache path
  --refresh-auth     Refresh auth from browser profile first

Output includes:
  userId             Current Slack user ID
  mention            Slack mention token, e.g. <@U123>
  search.fromUserId  Slack search filter for "from me", e.g. from:<@U123>
  search.fromName    Slack search filter using username, e.g. from:alice
`);
}

function summarizeProfile(profile) {
  if (!profile) return null;
  return {
    realName: profile.real_name || null,
    displayName: profile.display_name || null,
    firstName: profile.first_name || null,
    lastName: profile.last_name || null,
    title: profile.title || null,
    email: profile.email || null,
    statusText: profile.status_text || null,
    statusEmoji: profile.status_emoji || null,
    statusExpiration: profile.status_expiration || 0,
    avatarHash: profile.avatar_hash || null,
    image72: profile.image_72 || null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  args.auth = await loadAuth(args);

  const { response: authResponse, json: authJson, auth } = await slackApiCall(args, "auth.test");
  const userId = authJson.user_id || null;
  let userJson = null;
  let profileJson = null;

  if (authJson.ok && userId) {
    ({ json: userJson } = await slackApiCall(args, "users.info", {
      user: userId,
      include_locale: true,
    }));
    ({ json: profileJson } = await slackApiCall(args, "users.profile.get", {
      user: userId,
      include_labels: true,
    }));
  }

  const username = userJson?.user?.name || authJson.user || null;
  const output = {
    ok: authJson.ok,
    status: authResponse.status,
    error: authJson.error,
    authSource: auth.source,
    team: authJson.team || null,
    teamId: authJson.team_id || null,
    userId,
    username,
    mention: userId ? `<@${userId}>` : null,
    search: {
      fromUserId: userId ? `from:<@${userId}>` : null,
      fromName: username ? `from:${username}` : null,
    },
    userOk: userJson?.ok ?? false,
    userError: userJson?.error || null,
    user: userJson?.user ? summarizeUser(userJson.user) : null,
    profileOk: profileJson?.ok ?? false,
    profileError: profileJson?.error || null,
    profile: summarizeProfile(profileJson?.profile),
  };

  if (args.includeRaw) {
    output.rawUser = userJson?.user || null;
    output.rawProfile = profileJson?.profile || null;
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
