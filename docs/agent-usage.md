# Agent Usage

When a user asks you to use this project, use the local `slack-api` CLI directly. Do not switch to Slack MCP tools unless the user explicitly asks for them.

## Start Here

Check the installed CLI and cached identity:

```sh
slack-api --help
slack-api whoami
```

Use command-specific help when you are not sure about flags:

```sh
slack-api help dm
slack-api help user
slack-api help search
```

## Common Agent Tasks

Read a 1:1 DM history with a person:

```sh
slack-api dm history --user "Alice Smith" --include-text
```

Find a user:

```sh
slack-api user profile --name "Alice Smith"
slack-api user search --query "Alice Smith"
```

Search messages:

```sh
slack-api search --query "customer escalation" --any-author --include-snippets
```

Use Slack-native search syntax:

```sh
slack-api search --raw-query 'from:<@U123456> "customer escalation"' --include-snippets
```

Read a permalink:

```sh
slack-api read --link 'https://example.slack.com/archives/C0123456789/p1778784641394639' --include-text
```

## Output Defaults

Message text is redacted by default. Add `--include-text` or `--include-snippets` only when the user asked for message content.

Mutating commands are dry-run by default. Do not add flags such as `--send`, `--add`, `--remove`, `--create`, or `--delete` unless the user explicitly asked you to mutate Slack.
