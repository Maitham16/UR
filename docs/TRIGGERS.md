# Inbound event receiver

`ur trigger serve` is a persistent HTTP bridge for GitHub,
Slack, Gmail Pub/Sub, Microsoft Teams/Graph, and generic event producers. It
acknowledges accepted events with HTTP `202`, then runs UR asynchronously.

The default loopback listener accepts unconfigured routes for convenient local
automation. Add `--require-auth` when you want every local route verified. Any
non-loopback bind keeps authentication required.

```sh
export UR_TRIGGER_GITHUB_SECRET='the GitHub webhook secret'
export UR_TRIGGER_SLACK_SIGNING_SECRET='the Slack app signing secret'
export UR_TRIGGER_GMAIL_TOKEN='a random Pub/Sub push token'
export UR_TRIGGER_TEAMS_TOKEN='the Graph clientState or proxy bearer token'
export UR_TRIGGER_GENERIC_TOKEN='a random bearer token'

ur trigger serve --host 127.0.0.1 --port 8787
```

Put a TLS-terminating reverse proxy in front of the loopback listener. Do not
send webhook secrets over plain HTTP or bind directly to an untrusted network.
Routes are:

| Producer | Route | Verification |
| --- | --- | --- |
| GitHub | `POST /events/github` | `X-Hub-Signature-256` HMAC-SHA256 over the raw body |
| Slack | `POST /events/slack` | Slack `v0` signature plus a five-minute timestamp window |
| Gmail Pub/Sub | `POST /events/gmail` | configured bearer, `X-UR-Trigger-Token`, `X-Goog-Channel-Token`, or `?token=` |
| Microsoft Teams/Graph | `POST /events/teams` | configured bearer/query token or matching `clientState` on every notification |
| Generic JSON | `POST /events/generic` | configured bearer, `X-UR-Trigger-Token`, or `?token=` |

`GET /healthz` reports enabled routes and queue depth without exposing secrets.
A provider route with no configured secret returns `503` when authentication is
required; invalid authentication returns `401`. `--insecure-development`
remains as an explicit compatibility alias for relaxed loopback mode and is
refused on non-loopback hosts.

## Provider setup

For GitHub, use JSON payloads and configure the same secret in the repository
webhook and `UR_TRIGGER_GITHUB_SECRET`. Issue and PR comments containing `/ur`
dispatch the text following that keyword. GitHub ping events only check health.

For Slack, point the app's Event Subscriptions URL at `/events/slack` and
subscribe to the relevant mention/message events. URL verification challenges
are answered after signature verification. Bot-authored events are ignored to
prevent loops.

For Gmail, create a Pub/Sub push subscription for the Gmail watch topic. A
convenient authenticated endpoint is
`https://receiver.example/events/gmail?token=<random-token>`, with the same
token in `UR_TRIGGER_GMAIL_TOKEN`. Gmail notifications contain a mailbox and
history ID, not the email body, so the launched agent needs an authenticated
Gmail tool/connector to inspect the change.

For Teams, use Microsoft Graph change notifications with
`clientState` equal to `UR_TRIGGER_TEAMS_TOKEN`, or have an authenticating proxy
add that token as a bearer header. Graph subscription validation tokens are
echoed as plain text but never dispatch an agent. Bot Framework message
activities containing `/ur` are also understood when the proxy authenticates
them.

Generic events accept either an explicit `prompt` or text containing `/ur`:

```json
{
  "id": "build-4815",
  "session_key": "production-deploys",
  "actor": "deploy-controller",
  "prompt": "Investigate the failed production deployment and report the cause."
}
```

Prefer `Authorization: Bearer ...` over query tokens when the producer supports
headers. Give every event a unique delivery `id` so retries are reliably
deduplicated.

## Durable sessions and safety

UR stores only hashed delivery/context identifiers plus generated session UUIDs
beside that project's private session transcripts under the UR configuration
home (override with `--state-file`). The first
event for a GitHub issue/PR, Slack thread, Teams conversation, Gmail mailbox, or
generic `session_key` starts a session; later events resume that same session.
Runs for one conversation are serialized, while unrelated conversations can run
in parallel.

Delivery IDs are deduplicated for 24 hours and the delivery cache is bounded.
Bodies default to 1 MiB, compressed bodies are rejected, the queue is bounded,
and UR's normal tool permission/sandbox rules remain active. Receiver-only
`UR_TRIGGER_*` secrets are removed from the launched agent's environment.
Optional comma-
separated allow-lists add actor/mailbox authorization:

```sh
export UR_TRIGGER_GITHUB_ACTORS='octocat,release-bot'
export UR_TRIGGER_SLACK_ACTORS='U0123,U0456'
export UR_TRIGGER_GMAIL_MAILBOXES='ops@example.com'
export UR_TRIGGER_TEAMS_ACTORS='aad-object-id'
export UR_TRIGGER_GENERIC_ACTORS='deploy-controller'
```

Use `--dry-run` to verify routing and authentication without launching UR.
Capacity controls are `--max-body-bytes`, `--max-concurrency`, and
`--max-queue`.
