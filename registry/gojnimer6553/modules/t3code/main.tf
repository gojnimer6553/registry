terraform {
  required_version = ">= 1.9"

  required_providers {
    coder = {
      source  = "coder/coder"
      version = ">= 2.13"
    }
  }
}

variable "agent_id" {
  type        = string
  description = "The ID of a Coder agent."
}

data "coder_workspace" "me" {}

data "coder_workspace_owner" "me" {}

variable "icon" {
  type        = string
  description = "The icon to use for the app."
  default     = "/icon/t3code.svg"
}

variable "slug" {
  type        = string
  description = "The slug of the coder_app resource."
  default     = "t3code"
}

variable "display_name" {
  type        = string
  description = "The display name for the T3 Code application and its install/start scripts."
  default     = "T3 Code"
}

variable "port" {
  type        = number
  description = "The port to run the T3 Code server on."
  default     = 3773
}

variable "install" {
  type        = bool
  description = "Whether to install T3 Code. Set to false to run a pre-installed copy instead (see install_prefix)."
  default     = true
}

variable "install_version" {
  type        = string
  description = "The npm version or dist-tag of the `t3` package to install."
  default     = "latest"
}

variable "use_cached" {
  type        = bool
  description = "Skip installing when a copy already exists at install_prefix, instead of always reinstalling on start."
  default     = false
}

variable "package_manager" {
  type        = string
  description = "Package manager used to install T3 Code. One of 'npm', 'pnpm', or 'bun'; must already be available on the agent."
  default     = "npm"

  validation {
    condition     = contains(["npm", "pnpm", "bun"], var.package_manager)
    error_message = "The 'package_manager' variable must be one of: 'npm', 'pnpm', 'bun'."
  }
}

variable "registry_url" {
  type        = string
  description = "The npm-compatible registry URL to install T3 Code from. Override this for private registries or mirrors."
  default     = "https://registry.npmjs.org"
}

variable "node_version" {
  type        = string
  description = "Node.js version to bootstrap into $HOME when no `node` is found on PATH. Only used as a fallback; ignored if node is already installed. Must satisfy T3 Code's engines requirement (^22.16 || ^23.11 || >=24.10)."
  default     = "24.10.0"
}

variable "install_prefix" {
  type        = string
  description = "Directory T3 Code is installed into (as a local npm/pnpm/bun package). Defaults to a path under this module's standard data directory so installs persist across workspace restarts."
  default     = null
}

variable "additional_arguments" {
  type        = string
  description = "Additional space-separated command-line arguments appended to `t3 serve` (for example: `--base-dir /custom/path`). Values containing spaces are not supported."
  default     = ""
}

variable "restart_on_kill" {
  type        = bool
  description = "Restart the T3 Code server after it exits unexpectedly."
  default     = false
}

variable "restart_delay_seconds" {
  type        = number
  description = "How long to wait before restarting the server after it exits, when restart_on_kill is enabled."
  default     = 5

  validation {
    condition     = var.restart_delay_seconds >= 0
    error_message = "The 'restart_delay_seconds' variable must be greater than or equal to 0."
  }
}

variable "max_restart_attempts" {
  type        = number
  description = "Maximum number of restart attempts before giving up, when restart_on_kill is enabled. Set to 0 for unlimited restarts."
  default     = 0

  validation {
    condition     = var.max_restart_attempts >= 0 && floor(var.max_restart_attempts) == var.max_restart_attempts
    error_message = "The 'max_restart_attempts' variable must be a whole number greater than or equal to 0."
  }
}

variable "share" {
  type        = string
  description = "Determines visibility of the app. Must be one of 'owner', 'authenticated', or 'public'. Defaults to 'public' since T3 Code gates all real access behind its own pairing-token/session system regardless of this setting -- see 'Remote / external access' in the README."
  default     = "public"

  validation {
    condition     = contains(["owner", "authenticated", "public"], var.share)
    error_message = "Incorrect value. Please set either 'owner', 'authenticated', or 'public'."
  }
}

variable "subdomain" {
  type        = bool
  description = <<-EOT
    Determines whether the app will be accessed via its own subdomain or whether it will be accessed via a path on Coder.
    If wildcards have not been setup by the administrator then apps with "subdomain" set to true will not be accessible.
  EOT
  default     = true
}

variable "open_in" {
  type        = string
  description = <<-EOT
    Determines where the app will be opened. Valid values are `"tab"` and `"slim-window"` (default).
    `"tab"` opens in a new tab in the same browser window.
    `"slim-window"` opens a new browser window without navigation controls.
  EOT
  default     = "slim-window"

  validation {
    condition     = contains(["tab", "slim-window"], var.open_in)
    error_message = "The 'open_in' variable must be one of: 'tab', 'slim-window'."
  }
}

variable "order" {
  type        = number
  description = "The order determines the position of app in the UI presentation. The lowest order is shown first and apps with equal order are sorted by name (ascending order)."
  default     = null
}

variable "group" {
  type        = string
  description = "The name of a group that this app belongs to."
  default     = null
}

variable "pre_install_script" {
  type        = string
  description = "Custom script to run before installing T3 Code. Can be used for dependency ordering between modules (e.g., waiting for git-clone to complete before T3 Code starts)."
  default     = null
}

variable "post_install_script" {
  type        = string
  description = "Custom script to run after installing T3 Code, before it starts."
  default     = null
}

variable "enable_app" {
  type        = bool
  description = "Whether to create the Coder app (dashboard tile) for T3 Code. Set to false for a headless-only setup where T3 Code is reached exclusively through external_url/remote access."
  default     = true
}

variable "external_url" {
  type        = string
  description = "Publicly reachable base URL for this T3 Code instance (for example, the coder_app's own public URL when share is \"public\"). When set, T3 Code mints an additional pairing link scoped to this URL on every start (see pairing_ttl) so you can pair a browser or the T3 desktop app directly, without going through the Coder dashboard. Leave empty to skip this."
  default     = ""

  validation {
    condition     = var.external_url == "" || can(regex("^https?://", var.external_url))
    error_message = "The 'external_url' variable must be empty or start with http:// or https://."
  }
}

variable "pairing_ttl" {
  type        = string
  description = "TTL for the pairing link minted against external_url (for example: `1h`, `24h`, `30d`). T3 Code's own auto-issued startup pairing token only lasts 5 minutes; this gives you a longer window to actually use the link. Only relevant when external_url is set."
  default     = "24h"
}

locals {
  module_dir_name  = ".coder-modules/gojnimer6553/t3code"
  module_directory = "$HOME/${local.module_dir_name}"
  install_prefix   = coalesce(var.install_prefix, "$HOME/${local.module_dir_name}/npm")

  install_script = templatefile("${path.module}/scripts/install.sh.tftpl", {
    ARG_INSTALL         = tostring(var.install)
    ARG_USE_CACHED      = tostring(var.use_cached)
    ARG_VERSION         = var.install_version
    ARG_PACKAGE_MANAGER = var.package_manager
    ARG_REGISTRY_URL    = trimsuffix(var.registry_url, "/")
    ARG_NODE_VERSION    = var.node_version
    ARG_INSTALL_PREFIX  = local.install_prefix
  })

  start_script = templatefile("${path.module}/scripts/start.sh.tftpl", {
    ARG_PORT                  = tostring(var.port)
    ARG_MODULE_DIRECTORY      = local.module_directory
    ARG_INSTALL_PREFIX        = local.install_prefix
    ARG_RESTART_ON_KILL       = tostring(var.restart_on_kill)
    ARG_RESTART_DELAY_SECONDS = tostring(var.restart_delay_seconds)
    ARG_MAX_RESTART_ATTEMPTS  = tostring(var.max_restart_attempts)
    ARG_ADDITIONAL_ARGUMENTS  = base64encode(var.additional_arguments)
    ARG_EXTERNAL_URL          = base64encode(var.external_url)
    ARG_PAIRING_TTL           = var.pairing_ttl
  })
}

module "coder_utils" {
  source  = "registry.coder.com/coder/coder-utils/coder"
  version = "0.0.1"

  agent_id            = var.agent_id
  module_directory    = local.module_directory
  display_name_prefix = var.display_name
  icon                = var.icon
  pre_install_script  = var.pre_install_script
  post_install_script = var.post_install_script
  install_script      = local.install_script
  start_script        = local.start_script
}

resource "coder_app" "t3code" {
  count        = var.enable_app ? 1 : 0
  agent_id     = var.agent_id
  slug         = var.slug
  display_name = var.display_name
  url          = "http://localhost:${var.port}"
  icon         = var.icon
  subdomain    = var.subdomain
  share        = var.share
  order        = var.order
  group        = var.group
  open_in      = var.open_in

  healthcheck {
    url       = "http://localhost:${var.port}/"
    interval  = 5
    threshold = 6
  }
}

# Pass-through of coder-utils script outputs so upstream modules can serialize
# their own coder_script resources behind this module's install pipeline
# using `coder exp sync want <self> <each name>`.
output "scripts" {
  description = "Ordered list of coder exp sync names for the coder_script resources this module actually creates, in run order (pre_install, install, post_install, start). Scripts that were not configured are absent from the list."
  value       = module.coder_utils.scripts
}
