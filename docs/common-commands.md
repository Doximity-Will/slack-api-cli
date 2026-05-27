# Common Commands

## Search

Search your own messages from the last five minutes:

```sh
slack-api search --query "customer escalation" --since 5m
```

Search all visible authors and include message text:

```sh
slack-api search --query incident --any-author --count 20 --include-snippets
```

## Read

Read a message or thread by permalink:

```sh
slack-api read --link 'https://example.slack.com/archives/C0123456789/p1778784641394639'
slack-api thread --link 'https://example.slack.com/archives/C0123456789/p1778784641394639' --include-text
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
slack-api user profile --email someone@example.com
```

## Messages

Validate or post a message:

```sh
slack-api send --channel '#general' --message 'Thanks'
slack-api send --channel '#general' --message 'Thanks' --send
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
