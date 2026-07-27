run "defaults_are_correct" {
  command = plan

  variables {
    agent_id = "test-agent"
  }

  assert {
    condition     = var.port == 3773
    error_message = "Default port should be 3773"
  }

  assert {
    condition     = var.install == true
    error_message = "T3 Code installation should be enabled by default"
  }

  assert {
    condition     = var.install_version == "latest"
    error_message = "Default install_version should be 'latest'"
  }

  assert {
    condition     = var.package_manager == "npm"
    error_message = "Default package_manager should be 'npm'"
  }

  assert {
    condition     = var.use_cached == false
    error_message = "use_cached should be disabled by default"
  }

  assert {
    condition     = var.restart_on_kill == false
    error_message = "restart_on_kill should be disabled by default"
  }

  assert {
    condition     = var.subdomain == true
    error_message = "subdomain should be enabled by default"
  }

  assert {
    condition     = var.share == "public"
    error_message = "Default share should be 'public'"
  }

  assert {
    condition     = local.module_dir_name == ".coder-modules/gojnimer6553/t3code"
    error_message = "Module dir name should be '.coder-modules/gojnimer6553/t3code'"
  }

  assert {
    condition     = local.install_prefix == "$HOME/.coder-modules/gojnimer6553/t3code/npm"
    error_message = "Default install_prefix should live under the module's standard data directory"
  }

  assert {
    condition     = resource.coder_app.t3code[0].url == "http://localhost:3773"
    error_message = "App URL should point at localhost on the configured port"
  }

  assert {
    condition     = resource.coder_app.t3code[0].slug == "t3code"
    error_message = "Default slug should be 't3code'"
  }

  assert {
    condition     = var.enable_app == true
    error_message = "enable_app should default to true"
  }

  assert {
    condition     = var.external_url == ""
    error_message = "external_url should default to empty"
  }

  assert {
    condition     = var.pairing_ttl == "24h"
    error_message = "Default pairing_ttl should be '24h'"
  }
}

run "custom_port_configuration" {
  command = apply

  variables {
    agent_id = "test-agent"
    port     = 4001
  }

  assert {
    condition     = resource.coder_app.t3code[0].url == "http://localhost:4001"
    error_message = "App URL should use the configured port"
  }

  assert {
    condition     = [for h in resource.coder_app.t3code[0].healthcheck : h.url][0] == "http://localhost:4001/"
    error_message = "Healthcheck URL should use the configured port"
  }
}

run "custom_install_prefix_overrides_default" {
  command = plan

  variables {
    agent_id       = "test-agent"
    install_prefix = "/opt/t3code"
  }

  assert {
    condition     = local.install_prefix == "/opt/t3code"
    error_message = "Explicit install_prefix should override the computed default"
  }
}

run "install_version_configuration" {
  command = plan

  variables {
    agent_id        = "test-agent"
    install_version = "0.0.28"
  }

  assert {
    condition     = var.install_version == "0.0.28"
    error_message = "install_version should be set correctly"
  }
}

run "invalid_package_manager_rejected" {
  command = plan

  variables {
    agent_id        = "test-agent"
    package_manager = "yarn"
  }

  expect_failures = [
    var.package_manager,
  ]
}

run "invalid_share_rejected" {
  command = plan

  variables {
    agent_id = "test-agent"
    share    = "invalid"
  }

  expect_failures = [
    var.share,
  ]
}

run "invalid_open_in_rejected" {
  command = plan

  variables {
    agent_id = "test-agent"
    open_in  = "invalid"
  }

  expect_failures = [
    var.open_in,
  ]
}

run "negative_restart_delay_rejected" {
  command = plan

  variables {
    agent_id              = "test-agent"
    restart_delay_seconds = -1
  }

  expect_failures = [
    var.restart_delay_seconds,
  ]
}

run "non_integer_max_restart_attempts_rejected" {
  command = plan

  variables {
    agent_id             = "test-agent"
    max_restart_attempts = 1.5
  }

  expect_failures = [
    var.max_restart_attempts,
  ]
}

run "restart_on_kill_configuration" {
  command = plan

  variables {
    agent_id              = "test-agent"
    restart_on_kill       = true
    restart_delay_seconds = 10
    max_restart_attempts  = 3
  }

  assert {
    condition     = var.restart_on_kill == true
    error_message = "restart_on_kill should be enabled when specified"
  }

  assert {
    condition     = var.restart_delay_seconds == 10
    error_message = "restart_delay_seconds should be set correctly"
  }

  assert {
    condition     = var.max_restart_attempts == 3
    error_message = "max_restart_attempts should be set correctly"
  }
}

run "subdomain_disabled_configuration" {
  command = plan

  variables {
    agent_id  = "test-agent"
    subdomain = false
  }

  assert {
    condition     = resource.coder_app.t3code[0].subdomain == false
    error_message = "subdomain should be disabled when specified"
  }
}

run "custom_display_and_slug" {
  command = plan

  variables {
    agent_id     = "test-agent"
    slug         = "t3"
    display_name = "T3"
    icon         = "/custom/icon.svg"
    order        = 5
    group        = "AI Tools"
  }

  assert {
    condition     = resource.coder_app.t3code[0].slug == "t3"
    error_message = "Custom slug should be set"
  }

  assert {
    condition     = resource.coder_app.t3code[0].display_name == "T3"
    error_message = "Custom display_name should be set"
  }

  assert {
    condition     = resource.coder_app.t3code[0].icon == "/custom/icon.svg"
    error_message = "Custom icon should be set"
  }

  assert {
    condition     = resource.coder_app.t3code[0].order == 5
    error_message = "Custom order should be set"
  }

  assert {
    condition     = resource.coder_app.t3code[0].group == "AI Tools"
    error_message = "Custom group should be set"
  }
}

run "custom_scripts_configuration" {
  command = plan

  variables {
    agent_id            = "test-agent"
    pre_install_script  = "#!/bin/bash\necho 'pre-install'"
    post_install_script = "#!/bin/bash\necho 'post-install'"
  }

  assert {
    condition     = var.pre_install_script != null
    error_message = "Pre-install script should be set"
  }

  assert {
    condition     = var.post_install_script != null
    error_message = "Post-install script should be set"
  }

  assert {
    condition     = can(regex("pre-install", var.pre_install_script))
    error_message = "Pre-install script should contain expected content"
  }

  assert {
    condition     = can(regex("post-install", var.post_install_script))
    error_message = "Post-install script should contain expected content"
  }
}

run "install_disabled_configuration" {
  command = plan

  variables {
    agent_id = "test-agent"
    install  = false
  }

  assert {
    condition     = var.install == false
    error_message = "install should be disabled when specified"
  }
}

run "additional_arguments_configuration" {
  command = plan

  variables {
    agent_id             = "test-agent"
    additional_arguments = "--base-dir /custom/path"
  }

  assert {
    condition     = var.additional_arguments == "--base-dir /custom/path"
    error_message = "additional_arguments should be set correctly"
  }
}

run "scripts_output_is_populated" {
  command = plan

  variables {
    agent_id = "test-agent"
  }

  assert {
    condition     = length(output.scripts) > 0
    error_message = "scripts output should list at least the install and start scripts"
  }
}

run "enable_app_false_omits_coder_app" {
  command = plan

  variables {
    agent_id   = "test-agent"
    enable_app = false
  }

  assert {
    condition     = length(resource.coder_app.t3code) == 0
    error_message = "No coder_app resource should be created when enable_app is false"
  }
}

run "invalid_external_url_rejected" {
  command = plan

  variables {
    agent_id     = "test-agent"
    external_url = "not-a-url"
  }

  expect_failures = [
    var.external_url,
  ]
}

run "external_url_configuration" {
  command = plan

  variables {
    agent_id     = "test-agent"
    external_url = "https://t3code--myworkspace--me.coder.example.com"
    pairing_ttl  = "30d"
  }

  assert {
    condition     = var.external_url == "https://t3code--myworkspace--me.coder.example.com"
    error_message = "external_url should be set correctly"
  }

  assert {
    condition     = var.pairing_ttl == "30d"
    error_message = "pairing_ttl should be set correctly"
  }
}

run "headless_only_configuration" {
  command = plan

  variables {
    agent_id     = "test-agent"
    enable_app   = false
    external_url = "https://t3code.tailnet-name.ts.net"
  }

  assert {
    condition     = length(resource.coder_app.t3code) == 0
    error_message = "No coder_app resource should be created when enable_app is false"
  }

  assert {
    condition     = var.external_url == "https://t3code.tailnet-name.ts.net"
    error_message = "external_url should still be usable when enable_app is false"
  }
}
