# Setup and Configuration

## First-Time Setup

Run:

```sh
slack-api setup
```

Setup asks for your Slack workspace URL, opens a browser profile, and waits while you sign in. When auth succeeds, setup writes:

- config: `~/.config/slack-api-cli/config.json`
- browser profile: `~/.local/share/slack-api-cli/browser-profile`
- auth cache: `~/.local/share/slack-api-cli/auth.json`

Treat the browser profile and auth cache as sensitive session material.

## Finding Your Workspace URL

In the Slack desktop app, click the workspace name in the top-left menu. The workspace URL is shown in that menu and should look like `https://example.slack.com` or `https://example.enterprise.slack.com`.

## Alternate Setup Options

Pass the workspace URL up front:

```sh
slack-api setup --workspace https://example.slack.com
```

If your Slack login takes longer than the default five-minute setup window:

```sh
slack-api setup --timeout-ms 600000
```

If Slack later rejects the cache, refresh it:

```sh
slack-api auth --refresh --headed
```

Setup checks for Playwright's Chromium browser before opening Slack. If the browser runtime is missing, run the command shown in the terminal. It will look similar to:

```sh
npx playwright@1.59.1 install chromium
slack-api setup
```

## Configuration

Environment variables override saved config:

- `SLACK_WORKSPACE_URL`
- `SLACK_TEAM_ID`
- `SLACK_BROWSER_PROFILE`
- `SLACK_API_AUTH_CACHE`
- `SLACK_API_CONFIG`
- `SLACK_API_CONFIG_DIR`
- `SLACK_API_DATA_DIR`
- `SLACK_HEADLESS`
- `SLACK_INCLUDE_SNIPPETS`
- `SLACK_INCLUDE_TEXT`

Most commands also accept `--workspace`, `--profile`, and `--auth-cache`.

## Local Files To Keep Private

Do not commit or publish:

- auth cache files
- browser profile directories
- result exports containing Slack message data
- local `.env` files

The project `.gitignore` excludes the repo-local paths used during development, but setup stores new user data outside the repository by default.
