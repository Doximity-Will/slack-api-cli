# Common Commands

## Search

Search your own messages from the last five minutes:

```sh
slack-api search --query "customer escalation" --since 5m
```

Search all visible authors and include message text:

```sh
slack-api search --query "incident review" --any-author --count 20 --include-snippets
```

Pass Slack-native search modifiers through directly:

```sh
slack-api search --raw-query 'from:<@U123456> "customer escalation"' --include-snippets
```

## Read

Read a message or thread by permalink:

```sh
slack-api read --link 'https://example.slack.com/archives/C0123456789/p1778784641394639'
slack-api thread --link 'https://example.slack.com/archives/C0123456789/p1778784641394639' --include-text
```

## Direct Messages

Read your 1:1 DM history with a user:

```sh
slack-api dm history --user "Alice Smith" --include-text
slack-api dm history --email alice@example.com --since 7d --limit 50
```

Resolve the DM channel without reading messages:

```sh
slack-api dm info --user U123456
```

## Channels

Resolve channels and read recent history:

```sh
slack-api channel search --query general
slack-api channel info --channel '#general'
slack-api channel history --channel '#general' --since 30m --limit 50
```

## Users

Search users and read profiles:

```sh
slack-api user search --query alice --limit 10
slack-api user profile --name "Alice Smith"
slack-api user profile --email someone@example.com
```

## Messages

Post a message:

```sh
slack-api send --channel '#general' --message 'Thanks'
slack-api send --channel '#general' --message 'Thanks' --dry-run
```

Validate or post a thread reply:

```sh
slack-api reply --link 'https://example.slack.com/archives/C0123456789/p1778784641394639' --message 'Thanks'
slack-api reply --link 'https://example.slack.com/archives/C0123456789/p1778784641394639' --message 'Thanks' --send
```

## Reactions

Validate or add a reaction:

```sh
slack-api react --link 'https://example.slack.com/archives/C0123456789/p1778784641394639' --emoji eyes
slack-api react --link 'https://example.slack.com/archives/C0123456789/p1778784641394639' --emoji eyes --add
```

## Files

Search, read, and upload files:

```sh
slack-api file search --query 'budget type:pdfs' --count 20
slack-api file read --file F123456
slack-api file upload --channel '#general' --file /tmp/report.pdf --initial-comment 'Report'
slack-api file upload --channel '#general' --file /tmp/report.pdf --initial-comment 'Report' --send
```

## Emoji

List custom emoji:

```sh
slack-api emoji list --query party --limit 20
slack-api emoji list --names-only
```
