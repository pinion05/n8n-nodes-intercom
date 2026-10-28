# n8n-nodes-intercom

n8n community node for the [pi-intercom](https://www.npmjs.com/package/pi-intercom) broker HTTP gateway (**intercom-web**) — query live [pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) sessions and inject messages that trigger turns in running sessions.

## Operations

| Resource | Operation | Endpoint |
|---|---|---|
| Message | **Send** — inject a message into a specific session (dropdown of live sessions) | `POST /send` |
| Message | **Broadcast** — inject into all sessions | `POST /broadcast` |
| Session | **List Sessions** — live sessions (one item per session) | `GET /sessions` |
| Session | **Health** | `GET /health` |

- **Gateway Base URL** (default `http://127.0.0.1:8891`) — the intercom-web gateway
- The **To** dropdown loads live sessions (name · model · status · id prefix), sorted by recent activity; values are session ids. Expressions work too: `={{ $json.targetSession }}`

Output: the gateway JSON response (`delivered`, `messageId`, …). For List: one item per session.

## Requirements

- A self-hosted n8n on the same machine (or network) as your pi sessions
- The intercom-web gateway running (python stdlib server over the pi-intercom broker unix socket), default port `8891`

## Install (self-hosted, from source)

```bash
cd ~/.n8n/nodes && npm install <path-to-this-repo>
# then restart n8n
```

Once published to npm: *Settings → Community Nodes → install `n8n-nodes-intercom`*.

## Notes

- Injection triggers a turn in the receiving session; in-flight turns are not interrupted (processed after settle)
- `delivered: true` means the broker socket accepted it; for full receipts (`injected`/`acknowledged`) use a raw broker client
- Gateway is typically unauthenticated — keep it on a trusted network

## License

MIT
