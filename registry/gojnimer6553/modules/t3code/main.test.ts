import { describe, expect, it, setDefaultTimeout } from "bun:test";
import {
  execContainer,
  readFileContainer,
  removeContainer,
  runContainer,
  runTerraformApply,
  runTerraformInit,
  testRequiredVariables,
  writeCoder,
  writeFileContainer,
  type TerraformState,
} from "~test";

// coder-utils orchestrates this module's scripts and produces multiple
// coder_script resources (install, start). Collect them by their
// coder-utils-generated display_name so each can be executed in run order.
interface ModuleScripts {
  install: string;
  start: string;
}

const collectScripts = (state: TerraformState): ModuleScripts => {
  const byDisplayName: Record<string, string> = {};
  for (const resource of state.resources) {
    if (resource.type !== "coder_script") continue;
    for (const instance of resource.instances) {
      const attrs = instance.attributes as Record<string, unknown>;
      const displayName = attrs.display_name as string | undefined;
      const script = attrs.script as string | undefined;
      if (displayName && script) {
        byDisplayName[displayName] = script;
      }
    }
  }
  const install = byDisplayName["T3 Code: Install Script"];
  const start = byDisplayName["T3 Code: Start Script"];
  if (!install) {
    throw new Error("install script not found in terraform state");
  }
  if (!start) {
    throw new Error("start script not found in terraform state");
  }
  return { install, start };
};

const T3_BIN_PATH =
  "/root/.coder-modules/gojnimer6553/t3code/npm/node_modules/.bin/t3";
const START_LOG_PATH =
  "/root/.coder-modules/gojnimer6553/t3code/logs/start.log";

const installFakeT3Binary = async (id: string, script: string) => {
  await execContainer(id, [
    "mkdir",
    "-p",
    "/root/.coder-modules/gojnimer6553/t3code/npm/node_modules/.bin",
  ]);
  await writeFileContainer(id, T3_BIN_PATH, script);
  await execContainer(id, ["chmod", "755", T3_BIN_PATH]);
};

const waitForLogContains = async (
  id: string,
  path: string,
  needle: string,
  timeoutMs = 60000,
): Promise<string> => {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      last = await readFileContainer(id, path);
      if (last.includes(needle)) {
        return last;
      }
    } catch {
      // Log file may not exist yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Timed out waiting for ${path} to contain "${needle}". Last contents:\n${last}`,
  );
};

setDefaultTimeout(240 * 1000);

describe("t3code", async () => {
  await runTerraformInit(import.meta.dir);

  testRequiredVariables(import.meta.dir, {
    agent_id: "foo",
  });

  it("skips installation when install=false", async () => {
    const state = await runTerraformApply(import.meta.dir, {
      agent_id: "foo",
      install: false,
    });
    const { install, start } = collectScripts(state);

    const id = await runContainer("alpine/curl");
    try {
      await writeCoder(id, "#!/bin/sh\nexit 0\n");
      await execContainer(id, ["sh", "-c", "apk add --no-cache bash"]);

      const output = await execContainer(id, ["bash", "-c", install]);
      expect(output.exitCode).toBe(0);
      expect(output.stdout).toContain(
        "⏭️  install=false; skipping T3 Code installation.",
      );

      // The start script should fail fast: no t3 binary was ever installed.
      const startOutput = await execContainer(id, ["bash", "-c", start]);
      expect(startOutput.exitCode).not.toBe(0);
      expect(startOutput.stderr + startOutput.stdout).toContain(
        "t3 binary not found",
      );
    } finally {
      await removeContainer(id);
    }
  });

  it("installs T3 Code via npm and serves a pairing URL", async () => {
    const state = await runTerraformApply(import.meta.dir, {
      agent_id: "foo",
      port: 3773,
    });
    const { install, start } = collectScripts(state);

    const id = await runContainer("node:22-bookworm-slim");
    try {
      await writeCoder(id, "#!/bin/bash\nexit 0\n");
      // node-pty (a t3 dependency) falls back to compiling from source when
      // no prebuilt binary matches; provision the toolchain a real base
      // image would need.
      await execContainer(id, [
        "bash",
        "-c",
        "apt-get update && apt-get install -y --no-install-recommends python3 make g++",
      ]);

      const installOutput = await execContainer(id, ["bash", "-c", install]);
      if (installOutput.exitCode !== 0) {
        console.log("STDOUT:\n" + installOutput.stdout);
        console.log("STDERR:\n" + installOutput.stderr);
      }
      expect(installOutput.exitCode).toBe(0);
      expect(installOutput.stdout).toContain(
        "🥳 T3 Code has been installed to",
      );

      const startOutput = await execContainer(id, ["bash", "-c", start]);
      expect(startOutput.exitCode).toBe(0);
      expect(startOutput.stdout).toContain("T3 Code launcher started");

      // Note: our own launcher echoes the phrase "Pairing URL:" as part of
      // its instructions, so wait on the real server's startup banner line
      // instead to avoid matching that instructional text.
      const log = await waitForLogContains(
        id,
        START_LOG_PATH,
        "T3 Code server is ready.",
        120000,
      );
      expect(log).toContain("Connection string:");
      expect(log).toContain("Token:");
      expect(log).toMatch(/Pairing URL: http:\/\/.+\/pair#token=/);
    } finally {
      await removeContainer(id);
    }
  }, 240000);

  it("bootstraps node when missing and installs T3 Code", async () => {
    const state = await runTerraformApply(import.meta.dir, {
      agent_id: "foo",
      port: 3774,
    });
    const { install } = collectScripts(state);

    // No `node` here: forces the install script's ensure_node() fallback.
    // Uses a glibc-based (not musl/Alpine) image since ensure_node downloads
    // official nodejs.org builds, which are not musl-compatible.
    const id = await runContainer("debian:bookworm-slim");
    try {
      await writeCoder(id, "#!/bin/bash\nexit 0\n");
      await execContainer(id, [
        "bash",
        "-c",
        "apt-get update && apt-get install -y --no-install-recommends curl ca-certificates python3 make g++",
      ]);

      const installOutput = await execContainer(id, ["bash", "-c", install]);
      if (installOutput.exitCode !== 0) {
        console.log("STDOUT:\n" + installOutput.stdout);
        console.log("STDERR:\n" + installOutput.stderr);
      }
      expect(installOutput.exitCode).toBe(0);
      expect(installOutput.stdout).toContain("bootstrapping Node.js");
      expect(installOutput.stdout).toContain(
        "🥳 T3 Code has been installed to",
      );
    } finally {
      await removeContainer(id);
    }
  }, 240000);

  it("passes additional_arguments through to `t3 serve`", async () => {
    const state = await runTerraformApply(import.meta.dir, {
      agent_id: "foo",
      install: false,
      port: 4001,
      additional_arguments: "--verbose --base-dir /custom/path",
    });
    const { install, start } = collectScripts(state);

    const id = await runContainer("alpine/curl");
    try {
      await writeCoder(id, "#!/bin/sh\nexit 0\n");
      await execContainer(id, ["sh", "-c", "apk add --no-cache bash"]);
      // Run install first (install=false, so it only prints a skip message)
      // so coder-utils' wrapper creates the module's scripts/logs directories
      // that the start script depends on.
      await execContainer(id, ["bash", "-c", install]);
      await installFakeT3Binary(
        id,
        [
          "#!/bin/bash",
          "i=1",
          'for arg in "$@"; do',
          '  echo "arg$i=$arg"',
          "  i=$((i + 1))",
          "done",
        ].join("\n"),
      );

      const output = await execContainer(id, ["bash", "-c", start]);
      expect(output.exitCode).toBe(0);

      const log = await waitForLogContains(id, START_LOG_PATH, "arg1=", 30000);
      expect(log).toContain("arg1=serve");
      expect(log).toContain("arg2=--port");
      expect(log).toContain("arg3=4001");
      expect(log).toContain("arg4=--verbose");
      expect(log).toContain("arg5=--base-dir");
      expect(log).toContain("arg6=/custom/path");
    } finally {
      await removeContainer(id);
    }
  }, 60000);

  it("does not restart the server by default when it exits", async () => {
    const state = await runTerraformApply(import.meta.dir, {
      agent_id: "foo",
      install: false,
      port: 4002,
    });
    const { install, start } = collectScripts(state);

    const id = await runContainer("alpine/curl");
    try {
      await writeCoder(id, "#!/bin/sh\nexit 0\n");
      await execContainer(id, ["sh", "-c", "apk add --no-cache bash"]);
      await execContainer(id, ["bash", "-c", install]);
      await installFakeT3Binary(
        id,
        [
          "#!/bin/bash",
          'run_count_file="/tmp/t3-run-count"',
          "run_count=0",
          '[ -f "$run_count_file" ] && run_count=$(cat "$run_count_file")',
          "run_count=$((run_count + 1))",
          'printf "%s" "$run_count" > "$run_count_file"',
          'echo "run=$run_count"',
          "exit 0",
        ].join("\n"),
      );

      const output = await execContainer(id, ["bash", "-c", start]);
      expect(output.exitCode).toBe(0);

      await waitForLogContains(id, START_LOG_PATH, "run=1", 30000);
      // Give a would-be restart a couple of seconds to (not) happen.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const finalLog = await readFileContainer(id, START_LOG_PATH);
      expect(finalLog).toContain("t3 serve exited with code 0");
      expect(finalLog).not.toContain("run=2");
    } finally {
      await removeContainer(id);
    }
  }, 60000);

  it("restarts the server after a clean exit when restart_on_kill is enabled", async () => {
    const state = await runTerraformApply(import.meta.dir, {
      agent_id: "foo",
      install: false,
      port: 4003,
      restart_on_kill: true,
      restart_delay_seconds: 1,
      max_restart_attempts: 1,
    });
    const { install, start } = collectScripts(state);

    const id = await runContainer("alpine/curl");
    try {
      await writeCoder(id, "#!/bin/sh\nexit 0\n");
      await execContainer(id, ["sh", "-c", "apk add --no-cache bash"]);
      await execContainer(id, ["bash", "-c", install]);
      await installFakeT3Binary(
        id,
        [
          "#!/bin/bash",
          'run_count_file="/tmp/t3-run-count"',
          "run_count=0",
          '[ -f "$run_count_file" ] && run_count=$(cat "$run_count_file")',
          "run_count=$((run_count + 1))",
          'printf "%s" "$run_count" > "$run_count_file"',
          'echo "run=$run_count"',
          "exit 0",
        ].join("\n"),
      );

      const output = await execContainer(id, ["bash", "-c", start]);
      expect(output.exitCode).toBe(0);

      await waitForLogContains(id, START_LOG_PATH, "run=2", 15000);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const log = await readFileContainer(id, START_LOG_PATH);
      const runCount = await readFileContainer(id, "/tmp/t3-run-count");
      expect(log).toContain("run=1");
      expect(log).toContain("t3 serve exited with code 0");
      expect(log).toContain("Restarting t3 serve in 1s (attempt 1)...");
      expect(log).toContain("run=2");
      expect(log).toContain("Reached max_restart_attempts (1); giving up.");
      expect(runCount.trim()).toBe("2");
    } finally {
      await removeContainer(id);
    }
  }, 60000);

  it("mints an external pairing link when external_url is set", async () => {
    const state = await runTerraformApply(import.meta.dir, {
      agent_id: "foo",
      install: false,
      port: 4004,
      external_url: "https://t3code.example.test",
      pairing_ttl: "1h",
    });
    const { install, start } = collectScripts(state);

    const id = await runContainer("alpine/curl");
    try {
      await writeCoder(id, "#!/bin/sh\nexit 0\n");
      await execContainer(id, ["sh", "-c", "apk add --no-cache bash"]);
      await execContainer(id, ["bash", "-c", install]);
      await installFakeT3Binary(
        id,
        [
          "#!/bin/bash",
          'case "$1" in',
          "  serve)",
          "    shift",
          "    i=1",
          '    for arg in "$@"; do',
          '      echo "arg$i=$arg"',
          "      i=$((i + 1))",
          "    done",
          "    ;;",
          "  auth)",
          '    base_url=""',
          '    while [ "$#" -gt 0 ]; do',
          '      if [ "$1" = "--base-url" ]; then',
          '        base_url="$2"',
          "      fi",
          "      shift",
          "    done",
          '    echo "Issued client pairing token fake-id."',
          '    echo "Token: FAKE123"',
          '    echo "Pair URL: ${base_url}/pair#token=FAKE123"',
          '    echo "Expires at: 2099-01-01T00:00:00.000Z"',
          "    ;;",
          "esac",
        ].join("\n"),
      );

      const output = await execContainer(id, ["bash", "-c", start]);
      expect(output.exitCode).toBe(0);

      const log = await waitForLogContains(
        id,
        START_LOG_PATH,
        "Pair URL:",
        30000,
      );
      expect(log).toContain(
        "Minting an external pairing link for https://t3code.example.test (ttl: 1h)...",
      );
      expect(log).toContain(
        "Pair URL: https://t3code.example.test/pair#token=FAKE123",
      );
      // The external mint must complete before the server starts (see
      // start.sh.tftpl comment on avoiding a DB migration race), so its
      // output should appear earlier in the log than the launcher message.
      expect(log.indexOf("Pair URL:")).toBeLessThan(
        log.indexOf("T3 Code launcher started"),
      );
    } finally {
      await removeContainer(id);
    }
  }, 60000);

  it("does not attempt to mint an external pairing link by default", async () => {
    const state = await runTerraformApply(import.meta.dir, {
      agent_id: "foo",
      install: false,
      port: 4005,
    });
    const { install, start } = collectScripts(state);

    const id = await runContainer("alpine/curl");
    try {
      await writeCoder(id, "#!/bin/sh\nexit 0\n");
      await execContainer(id, ["sh", "-c", "apk add --no-cache bash"]);
      await execContainer(id, ["bash", "-c", install]);
      await installFakeT3Binary(
        id,
        [
          "#!/bin/bash",
          'case "$1" in',
          "  serve) echo serve-called ;;",
          "  auth) echo auth-called ;;",
          "esac",
        ].join("\n"),
      );

      const output = await execContainer(id, ["bash", "-c", start]);
      expect(output.exitCode).toBe(0);

      await waitForLogContains(id, START_LOG_PATH, "launcher started", 30000);
      const log = await readFileContainer(id, START_LOG_PATH);
      expect(log).not.toContain("auth-called");
      expect(log).not.toContain("Minting an external pairing link");
    } finally {
      await removeContainer(id);
    }
  }, 60000);
});
