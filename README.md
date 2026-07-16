# Slack API CLI

A local Slack CLI for fast terminal workflows against the Slack workspace you already use.

This project does not create a Slack app and does not use Slack OAuth. It opens a local browser profile, lets you sign in to Slack normally, extracts the browser session token and cookies, and stores them in a private local auth cache.

## Quick Start

Requirement:

- Node.js 20 or newer

Install the CLI:

```sh
npm install -g slack-api-cli
```

Check that the binary is available:

```sh
slack-api --help
```

Run first-time setup:

```sh
slack-api setup
```

When prompted, enter your Slack workspace URL and complete sign-in in the browser:

```text
Tip: In the Slack desktop app, click the workspace name in the top-left menu to find the workspace URL.
Slack workspace URL: https://example.slack.com
Opening Slack in a browser profile...
Authenticated as: alex
```

Validate the cached session:

```sh
slack-api whoami
```

Search recent messages:

```sh
slack-api search --query "customer escalation" --since 5m
```

Read your 1:1 DM history with a person:

```sh
slack-api dm history --user "Alice Smith" --include-text
```

Read a message or thread by permalink:

```sh
slack-api read --link 'https://example.slack.com/archives/C0123456789/p1778784641394639'
```

## Privacy Defaults

Search and read commands redact message text by default. Add `--include-snippets` or `--include-text` only when you intentionally want message text in terminal output or saved JSON.

The `send` command posts by default; use `--dry-run` to preview instead. Other mutating commands are dry-run by default. Commands such as `reply`, `react`, and `draft` validate what would happen, then require an explicit flag such as `--add`, `--remove`, `--create`, or `--delete`.

## More Docs

- [Setup and configuration](docs/setup-and-configuration.md)
- [Common commands](docs/common-commands.md)
- [Agent usage](docs/agent-usage.md)

## Notes

This CLI depends on Slack's browser behavior and private web API endpoints. It may break when Slack changes its web client, and some workspace policies may restrict specific endpoints.
