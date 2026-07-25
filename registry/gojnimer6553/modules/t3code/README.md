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
