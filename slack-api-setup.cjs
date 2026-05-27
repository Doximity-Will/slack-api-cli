#!/usr/bin/env node

const path = require("node:path");
const readline = require("node:readline/promises");

const {
  DEFAULT_AUTH_CACHE,
  DEFAULT_CONFIG_PATH,
  DEFAULT_PROFILE,
  ensurePlaywrightBrowserInstalled,
  loadAuth,
  loadConfig,
  normalizeWorkspaceUrl,
  saveConfig,
  slackApiCall,
} = require("./slack-api-common.cjs");

function parseArgs(argv) {
  const args = {
    workspace: "",
    teamId: "",
    profile: "",
    authCache: "",
    configPath: DEFAULT_CONFIG_PATH,
    timeoutMs: 300_000,
    headless: false,
    skipAuth: false,
    noInput: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };

    if (arg === "--workspace") args.workspace = normalizeWorkspaceUrl(next());
    else if (arg === "--team-id") args.teamId = next();
    else if (arg === "--profile") args.profile = path.resolve(next());
    else if (arg === "--auth-cache") args.authCache = path.resolve(next());
    else if (arg === "--config") args.configPath = path.resolve(next());
    else if (arg === "--timeout-ms") args.timeoutMs = Number(next());
    else if (arg === "--headless") args.headless = true;
    else if (arg === "--headed") args.headless = false;
    else if (arg === "--skip-auth") args.skipAuth = true;
    else if (arg === "--no-input") args.noInput = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 10_000) {
    throw new Error("--timeout-ms must be at least 10000");
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  slack-api setup
  slack-api setup --workspace https://your-workspace.slack.com

Options:
  --workspace URL    Slack workspace URL. You can enter this interactively.
  --team-id ID       Optional Slack team id. setup fills this from auth.test when possible.
  --profile DIR      Browser profile directory. Default: ${DEFAULT_PROFILE}
  --auth-cache FILE  Auth cache file. Default: ${DEFAULT_AUTH_CACHE}
  --config FILE      Config file. Default: ${DEFAULT_CONFIG_PATH}
  --timeout-ms N     Browser sign-in timeout. Default: 300000
  --headed           Show the browser window for sign-in. Default
  --headless         Run without showing the browser window
  --skip-auth        Save config without launching the browser
  --no-input         Do not prompt. Requires --workspace when config is missing.
  --json             Print machine-readable setup result

Workspace URL:
  In the Slack desktop app, click the workspace name in the top-left menu.
  The URL should look like https://example.slack.com or https://example.enterprise.slack.com.
`);
}

async function promptForValue(rl, label, defaultValue) {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await rl.question(`${label}${suffix}: `);
  return answer.trim() || defaultValue;
}

async function readInteractiveConfig(args, existing) {
  if ((args.noInput || !process.stdin.isTTY) && !args.workspace) {
    throw new Error("No workspace URL was provided. Run `slack-api setup --workspace https://your-workspace.slack.com`.");
  }

  if (args.workspace) {
    return {
      workspace: args.workspace,
      teamId: args.teamId || existing.teamId || "",
      profile: args.profile || existing.profile || DEFAULT_PROFILE,
      authCache: args.authCache || existing.authCache || DEFAULT_AUTH_CACHE,
    };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    if (!args.json) {
      console.log("Tip: In the Slack desktop app, click the workspace name in the top-left menu to find the workspace URL.");
      console.log("It should look like https://example.slack.com or https://example.enterprise.slack.com.");
    }
    const workspace = normalizeWorkspaceUrl(await promptForValue(
      rl,
      "Slack workspace URL",
      existing.workspace || "",
    ));
    if (!workspace) {
      throw new Error("Slack workspace URL is required.");
    }

    return {
      workspace,
      teamId: args.teamId || existing.teamId || "",
      profile: args.profile || existing.profile || DEFAULT_PROFILE,
      authCache: args.authCache || existing.authCache || DEFAULT_AUTH_CACHE,
    };
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const existing = loadConfig(args.configPath);
  const config = await readInteractiveConfig(args, existing);

  await saveConfig(config, args.configPath);

  const result = {
    ok: true,
    configPath: args.configPath,
    workspace: config.workspace,
    teamId: config.teamId || null,
    profile: config.profile,
    authCache: config.authCache,
    authRefreshed: false,
    user: null,
  };

  if (!args.skipAuth) {
    ensurePlaywrightBrowserInstalled();

    if (!args.json) {
      console.log("Opening Slack in a browser profile. Complete sign-in if prompted.");
      console.log("The browser will close automatically after Slack is fully signed in and auth.test succeeds.");
    }

    const authArgs = {
      workspace: config.workspace,
      profile: config.profile,
      authCache: config.authCache,
      refreshAuth: true,
      headless: args.headless,
      timeoutMs: args.timeoutMs,
    };
    authArgs.auth = await loadAuth(authArgs);
    const { response, json, auth } = await slackApiCall(authArgs, "auth.test");
    if (!json.ok) {
      throw new Error(`Slack auth.test failed: ${json.error || response.status}`);
    }

    config.teamId = config.teamId || json.team_id || "";
    await saveConfig(config, args.configPath);

    result.teamId = config.teamId || null;
    result.authRefreshed = true;
    result.authSource = auth.source;
    result.user = json.user || null;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Configured ${config.workspace}`);
    console.log(`Config: ${args.configPath}`);
    console.log(`Browser profile: ${config.profile}`);
    console.log(`Auth cache: ${config.authCache}`);
    if (result.user) console.log(`Authenticated as: ${result.user}`);
    console.log("Try: slack-api whoami");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
