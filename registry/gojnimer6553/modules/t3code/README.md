---
display_name: T3 Code
description: Run T3 Code, a minimal web GUI for coding agents (Codex, Claude, Cursor, OpenCode), in a Coder workspace.
icon: ../../../../.icons/t3code.svg
verified: false
tags: [ai, agent, web, ide, coding-agent]
---

# T3 Code

Runs [T3 Code](https://github.com/pingdotgg/t3code) headlessly in a Coder workspace and exposes its web UI as a Coder app. T3 Code is a minimal web GUI for coding agents (currently Codex, Claude, Cursor, and OpenCode) — it wraps whichever agent CLI you already have installed and authenticated in the workspace.

This module installs the [`t3`](https://www.npmjs.com/package/t3) npm package, starts `t3 serve` in the background, and keeps the standard [module data layout](https://github.com/coder/registry/blob/main/AGENTS.md#module-data-layout) (`$HOME/.coder-modules/gojnimer6553/t3code/`) so installs and logs survive workspace restarts.

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

## First-time access: pairing

T3 Code protects headless/remote access with a one-time pairing token instead of a static password — this is by design in T3 Code itself, not something this module can bypass. Every time `t3 serve` starts, it prints a fresh pairing URL, token, and QR code to its log.

The first time you open the app in a given browser:

1. Open the **T3 Code** app from the workspace.
2. If you land on the pairing screen, open a workspace terminal and check the log:
   ```sh
   cat $HOME/.coder-modules/gojnimer6553/t3code/logs/start.log
   ```
3. Copy the line starting with `Pairing URL:` and open it (or append its `#token=...` fragment to the app's URL).

T3 Code stores sessions in `~/.t3`, which lives on the workspace's persistent home volume, so pairing is normally a one-time step per browser — subsequent workspace restarts reuse the existing session instead of prompting again. If a session expires or is revoked, restart the module's start script (or the workspace) to get a fresh pairing URL in the log.

## Remote / external access

T3 Code's own auto-issued startup pairing link is only valid for **5 minutes**, which is fine for opening the app right after it starts but too short to rely on for occasional remote access. To get a stable link for reaching this T3 Code instance from outside the Coder dashboard (the official T3 Code desktop app, the hosted web client, or any browser):

1. **The app's URL is public by default** (`share = "public"`, with `subdomain = true`), so Coder proxies it without requiring a Coder login. Grab the resulting URL from the app's tile in the Coder dashboard, or from the Coder API/CLI (`sharing_level`/`subdomain_name` on the workspace agent's app). It's built from your deployment's `wildcard_access_url` — check that setting (`GET /api/v2/deployment/config` as an admin, or ask whoever runs your Coder deployment) rather than assuming a format: some deployments use `<slug>--<workspace>--<owner>.example.com` (dot), others `<slug>--<workspace>--<owner>-example.com` (hyphen).

2. **Set `external_url` to that URL** so a longer-lived pairing link gets minted against it on every start, instead of relying on the 5-minute one:

   ```tf
   module "t3code" {
     count        = data.coder_workspace.me.start_count
     source       = "registry.coder.com/gojnimer6553/t3code/coder"
     version      = "1.0.0"
     agent_id     = coder_agent.main.id
     external_url = "https://t3code--myworkspace--me.coder.example.com"
     pairing_ttl  = "24h" # default; bump to e.g. "30d" if you don't want to re-check it often
   }
   ```

   Each start appends a line like `Pair URL: https://t3code--myworkspace--me.coder.example.com/pair#token=...` to the start log — open that link in any browser (or paste the token into the T3 Code desktop app) to pair. Like all T3 Code pairing links, it's single-use: once a device pairs with it, that device's session persists on its own, and pairing again needs a fresh link (get one by restarting the workspace, or by running `t3 auth pairing create --base-url <external_url>` yourself in a workspace terminal).

3. **Show the current link as a dashboard label (optional).** Modules can't attach a `coder_agent` `metadata` block to an agent they don't own, so add this to your own template's `coder_agent` resource instead. Write it as a plain string literal, not a reference into `module.t3code` — a `metadata.script` that depends on a module which itself depends on that same `coder_agent`'s `id` is a dependency cycle Terraform will refuse to plan, even though nothing about it is actually circular at runtime. The log path below is this module's fixed, documented location (see [module data layout](https://github.com/coder/registry/blob/main/AGENTS.md#module-data-layout)), so no reference is needed:

   ```tf
   resource "coder_agent" "main" {
     # ...
     metadata {
       key          = "t3_pairing_link"
       display_name = "T3 Pairing Link"
       interval     = 10
       timeout      = 5
       script       = <<-EOT
         #!/bin/bash
         LOG="$HOME/.coder-modules/gojnimer6553/t3code/logs/start.log"
         if grep -qa '^Pair URL: ' "$LOG" 2>/dev/null; then
           grep -a '^Pair URL: ' "$LOG" | tail -n1 | sed 's/^Pair URL: //'
         elif grep -qa '^Pairing URL: ' "$LOG" 2>/dev/null; then
           grep -a '^Pairing URL: ' "$LOG" | tail -n1 | sed 's/^Pairing URL: //'
         else
           echo "not ready yet"
         fi
       EOT
     }
   }
   ```

   This prefers the longer-lived link minted against `external_url` (`Pair URL:`) over the auto-issued, 5-minute startup link (`Pairing URL:`) whenever both are present.

   This shows up as a live-refreshing label on the workspace resource, so you never have to open a terminal to grab the link.

Steps 1-3 all assume you're using this module's own `coder_app` (made public) as the externally reachable address. If reachability is arranged some other way instead — Tailscale, a Kubernetes `LoadBalancer`/`Ingress`, a VPN — set `enable_app = false` to skip the Coder dashboard tile (and the `coder_app` resource) entirely, and point `external_url` at that other address instead. See [Headless remote access only](#headless-remote-access-only-no-dashboard-tile) below.

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

### Headless remote access only, no dashboard tile

Useful when reachability is arranged some other way (Tailscale, a Kubernetes `LoadBalancer`/`Ingress`, a VPN) instead of through Coder's own app proxy — `share`/`subdomain` are irrelevant here since no `coder_app` gets created at all:

```tf
module "t3code" {
  count        = data.coder_workspace.me.start_count
  source       = "registry.coder.com/gojnimer6553/t3code/coder"
  version      = "1.0.0"
  agent_id     = coder_agent.main.id
  enable_app   = false
  external_url = "https://t3code.tailnet-name.ts.net"
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
