---
display_name: T3 Code
description: Run T3 Code, a minimal web GUI for coding agents (Codex, Claude, Cursor, OpenCode), in a Coder workspace.
icon: ../../../../.icons/t3code.svg
verified: false
tags: [ai, agent, web, ide, coding-agent]
---

# T3 Code

Runs [T3 Code](https://github.com/pingdotgg/t3code) headlessly in a Coder workspace and exposes its web UI as a Coder app. T3 Code is a minimal web GUI for coding agents (currently Codex, Claude, Cursor, and OpenCode) — it wraps whichever agent CLI you already have installed and authenticated in the workspace.

This module installs the [`t3`](https://www.npmjs.com/package/t3) npm package, starts `t3 serve` in the background fronted by a small pairing proxy (see [One-click pairing](#one-click-pairing) below), and keeps the standard [module data layout](https://github.com/coder/registry/blob/main/AGENTS.md#module-data-layout) (`$HOME/.coder-modules/gojnimer6553/t3code/`) so installs and logs survive workspace restarts.

```tf
module "t3code" {
  count    = data.coder_workspace.me.start_count
  source   = "registry.coder.com/gojnimer6553/t3code/coder"
  version  = "1.0.0"
  agent_id = coder_agent.main.id
}
```

> [!IMPORTANT]
> Install and authenticate at least one supported provider in the workspace image before using T3 Code — for example, install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`. See the [T3 Code README](https://github.com/pingdotgg/t3code#installation) for the full provider list.

## One-click pairing

T3 Code protects access with a pairing token instead of a static password — this is by design in T3 Code itself, not something this module bypasses. Left alone, that means checking logs or a terminal for a token every time a session expires.

Instead, this module puts a small local reverse proxy in front of the real T3 Code server, and points the Coder app at the proxy instead of at T3 Code directly:

- Opening the app (`GET /`) mints a fresh one-time pairing token and redirects straight to `/pair#token=...` — no token to find or copy.
- Every other request, including WebSocket upgrades (T3 Code's UI is WebSocket-backed), is transparently forwarded to the real server untouched.

So clicking the **T3 Code** app tile just works. T3 Code stores the resulting session in `~/.t3`, on the workspace's persistent home volume, so this only actually mints a new token when a browser doesn't already have a valid session — restarting the workspace doesn't force you to re-pair.

If you'd rather handle pairing yourself (for example, scripting it against `t3 auth pairing create`), set `enable_app = false` to skip the proxy and dashboard tile entirely; `t3 serve` still runs on `port`, unproxied.

## Examples

### Pin the installed version

```tf
module "t3code" {
  count           = data.coder_workspace.me.start_count
  source          = "registry.coder.com/gojnimer6553/t3code/coder"
  version         = "1.0.0"
  agent_id        = coder_agent.main.id
  install_version = "0.0.28"
}
```

### Run on a custom port, shared with the whole org

```tf
module "t3code" {
  count    = data.coder_workspace.me.start_count
  source   = "registry.coder.com/gojnimer6553/t3code/coder"
  version  = "1.0.0"
  agent_id = coder_agent.main.id
  port     = 4001
  share    = "authenticated"
}
```

### Automatically restart the server if it crashes

```tf
module "t3code" {
  count                 = data.coder_workspace.me.start_count
  source                = "registry.coder.com/gojnimer6553/t3code/coder"
  version               = "1.0.0"
  agent_id              = coder_agent.main.id
  restart_on_kill       = true
  restart_delay_seconds = 5
}
```

### Use a package manager other than npm

```tf
module "t3code" {
  count           = data.coder_workspace.me.start_count
  source          = "registry.coder.com/gojnimer6553/t3code/coder"
  version         = "1.0.0"
  agent_id        = coder_agent.main.id
  package_manager = "bun"
}
```

### Headless: no dashboard tile, no pairing proxy

Useful when reachability and pairing are handled some other way entirely (Tailscale, a Kubernetes `LoadBalancer`/`Ingress`, a VPN, or your own scripting against `t3 auth pairing create`) — `share`/`subdomain`/`redirector_port` are irrelevant here since no `coder_app` or proxy get created at all; `t3 serve` just runs on `port`:

```tf
module "t3code" {
  count      = data.coder_workspace.me.start_count
  source     = "registry.coder.com/gojnimer6553/t3code/coder"
  version    = "1.0.0"
  agent_id   = coder_agent.main.id
  enable_app = false
}
```

### Skip installation and use a pre-baked image

```tf
module "t3code" {
  count          = data.coder_workspace.me.start_count
  source         = "registry.coder.com/gojnimer6553/t3code/coder"
  version        = "1.0.0"
  agent_id       = coder_agent.main.id
  install        = false
  install_prefix = "/opt/t3code"
}
```

## Notes

- T3 Code (the `t3` npm package) requires Node.js `^22.16 || ^23.11 || >=24.10`. If `node` is not already on `PATH`, the install script bootstraps a pinned Node.js runtime under `$HOME/.local/share/coder-t3code/` automatically; override the version with `node_version` if needed.
- The `t3` package depends on [`node-pty`](https://www.npmjs.com/package/node-pty), a native module. When no prebuilt binary matches the workspace's platform/Node version, npm compiles it from source, which requires `python3`, `make`, and a C++ compiler (`g++`) to be present in the workspace image. Without them, installation fails with a `node-gyp`/Python error.
- Workspaces without outbound network access to npm should set `install = false` and pre-bake T3 Code into the image instead.
- The pairing proxy (see [One-click pairing](#one-click-pairing)) listens on `redirector_port`, which defaults to `port + 1`; override it if that collides with something else in the workspace.
