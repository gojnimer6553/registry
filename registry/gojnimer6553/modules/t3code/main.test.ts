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

      // The pairing proxy fronting this real server: default
      // redirector_port is port + 1 (3774 here).
      const health = await httpGetInContainer(id, 3774, "/healthz");
      expect(health.status).toBe(200);
      expect(health.body).toBe("ok");

      const root = await httpGetInContainer(id, 3774, "/");
      expect(root.status).toBe(302);
      expect(root.location).toMatch(/^pair#token=.+/);

      // A real browser strips the fragment before sending the request, so
      // this hits the same static SPA shell "/pair" serves for any route --
      // confirms the proxy forwards non-root paths to the real server too.
      const pairPage = await httpGetInContainer(id, 3774, "/pair");
      expect(pairPage.status).toBe(200);
      expect(pairPage.body.toLowerCase()).toContain("<html");
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

  // Fake t3 binary whose "serve" subcommand runs a trivial upstream HTTP
  // server (so the redirector's proxy passthrough has something real to
  // forward to) and whose "auth pairing create --json" prints a fake
  // credential (so the redirector's mint-and-redirect path is exercised
  // without a real T3 Code install).
  const fakeT3WithUpstreamServer = [
    "#!/bin/bash",
    'case "$1" in',
    "  serve)",
    "    shift",
    '    port=""',
    '    while [ "$#" -gt 0 ]; do',
    '      if [ "$1" = "--port" ]; then port="$2"; fi',
    "      shift",
    "    done",
    "    exec node -e '",
    '      const http = require("http");',
    '      const crypto = require("crypto");',
    "      const port = parseInt(process.argv[1], 10);",
    "      const server = http.createServer((req, res) => {",
    '        res.writeHead(200, { "Content-Type": "text/plain" });',
    '        res.end("upstream:" + req.url);',
    "      });",
    '      server.on("upgrade", (req, socket) => {',
    '        const key = req.headers["sec-websocket-key"];',
    "        const accept = crypto",
    '          .createHash("sha1")',
    '          .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")',
    '          .digest("base64");',
    "        socket.write(",
    '          "HTTP/1.1 101 Switching Protocols\\r\\n" +',
    '            "Upgrade: websocket\\r\\n" +',
    '            "Connection: Upgrade\\r\\n" +',
    '            "Sec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n",',
    "        );",
    "        // Not real WS framing -- just raw-echoes bytes, to prove the",
    "        // proxy relays the upgraded socket in both directions.",
    '        socket.on("data", (chunk) => socket.write(chunk));',
    "      });",
    '      server.listen(port, "127.0.0.1");',
    '    \' -- "$port"',
    "    ;;",
    "  auth)",
    '    echo \'{"id":"fake-id","credential":"FAKETOKEN123","scopes":[],"expiresAt":"2099-01-01T00:00:00.000Z"}\'',
    "    ;;",
    "esac",
  ].join("\n");

  // Issues one HTTP GET from inside the container (no curl dependency: the
  // test image only guarantees node) and reports status/location/body.
  const httpGetInContainer = async (
    id: string,
    port: number,
    path: string,
  ): Promise<{ status: number; location: string; body: string }> => {
    const script = [
      'const http = require("http");',
      `const req = http.get({ host: "127.0.0.1", port: ${port}, path: ${JSON.stringify(path)} }, (res) => {`,
      '  let body = "";',
      '  res.on("data", (c) => (body += c));',
      '  res.on("end", () => {',
      '    console.log("STATUS:" + res.statusCode);',
      '    console.log("LOCATION:" + (res.headers.location || ""));',
      '    console.log("BODY:" + body);',
      "    process.exit(0);",
      "  });",
      "});",
      'req.on("error", (e) => { console.log("ERROR:" + e.message); process.exit(1); });',
    ].join("\n");
    const output = await execContainer(id, ["node", "-e", script]);
    const status = Number(/STATUS:(\d+)/.exec(output.stdout)?.[1] ?? "0");
    const location = /LOCATION:(.*)/.exec(output.stdout)?.[1] ?? "";
    const body = /BODY:([\s\S]*)/.exec(output.stdout)?.[1]?.trim() ?? "";
    return { status, location, body };
  };

  // Polls "/healthz" until it returns 200. For the redirector this proves
  // both the redirector itself and the real upstream behind it are ready;
  // the fake upstream server used directly (enable_app=false case) answers
  // 200 on every path regardless, so this works there too.
  const waitForPort = async (
    id: string,
    port: number,
    timeoutMs = 30000,
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { status } = await httpGetInContainer(id, port, "/healthz");
      if (status === 200) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for port ${port} to accept connections`);
  };

  it("mints a pairing token and redirects when the app is opened, and proxies other paths through to T3 Code", async () => {
    const state = await runTerraformApply(import.meta.dir, {
      agent_id: "foo",
      install: false,
      port: 4004,
      redirector_port: 4104,
    });
    const { install, start } = collectScripts(state);

    const id = await runContainer("node:22-bookworm-slim");
    try {
      await writeCoder(id, "#!/bin/bash\nexit 0\n");
      await execContainer(id, ["bash", "-c", install]);
      await installFakeT3Binary(id, fakeT3WithUpstreamServer);

      const output = await execContainer(id, ["bash", "-c", start]);
      expect(output.exitCode).toBe(0);

      await waitForPort(id, 4104);

      const root = await httpGetInContainer(id, 4104, "/");
      expect(root.status).toBe(302);
      expect(root.location).toBe("pair#token=FAKETOKEN123");

      const proxied = await httpGetInContainer(id, 4104, "/some/path?x=1");
      expect(proxied.status).toBe(200);
      expect(proxied.body).toBe("upstream:/some/path?x=1");

      const health = await httpGetInContainer(id, 4104, "/healthz");
      expect(health.status).toBe(200);
      expect(health.body).toBe("ok");
    } finally {
      await removeContainer(id);
    }
  }, 60000);

  it("passes WebSocket upgrades through to T3 Code", async () => {
    const state = await runTerraformApply(import.meta.dir, {
      agent_id: "foo",
      install: false,
      port: 4006,
      redirector_port: 4106,
    });
    const { install, start } = collectScripts(state);

    const id = await runContainer("node:22-bookworm-slim");
    try {
      await writeCoder(id, "#!/bin/bash\nexit 0\n");
      await execContainer(id, ["bash", "-c", install]);
      await installFakeT3Binary(id, fakeT3WithUpstreamServer);

      const output = await execContainer(id, ["bash", "-c", start]);
      expect(output.exitCode).toBe(0);
      await waitForPort(id, 4106);

      // The well-known key/accept pair from RFC 6455 section 1.3, so the
      // expected Sec-WebSocket-Accept value can be hardcoded here instead
      // of computed, keeping the in-container client script trivial.
      const wsKey = "dGhlIHNhbXBsZSBub25jZQ==";
      const expectedAccept = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=";
      const script = [
        'const net = require("net");',
        `const socket = net.connect(4106, "127.0.0.1", () => {`,
        "  socket.write(",
        '    ["GET /ws HTTP/1.1", "Host: localhost", "Connection: Upgrade", "Upgrade: websocket",',
        `      "Sec-WebSocket-Key: ${wsKey}", "Sec-WebSocket-Version: 13", "", ""].join("\\r\\n"),`,
        "  );",
        "});",
        "let buf = Buffer.alloc(0);",
        "let handshakeDone = false;",
        'socket.on("data", (chunk) => {',
        "  buf = Buffer.concat([buf, chunk]);",
        "  if (!handshakeDone) {",
        '    const text = buf.toString("utf8");',
        '    const idx = text.indexOf("\\r\\n\\r\\n");',
        "    if (idx === -1) return;",
        "    handshakeDone = true;",
        "    const headerText = text.slice(0, idx);",
        '    console.log("STATUS_LINE:" + headerText.split("\\r\\n")[0]);',
        "    const acceptMatch = /Sec-WebSocket-Accept:\\s*(.+)/i.exec(headerText);",
        '    console.log("ACCEPT:" + (acceptMatch ? acceptMatch[1].trim() : ""));',
        '    socket.write("hello-through-proxy");',
        "  } else {",
        '    console.log("ECHO:" + chunk.toString("utf8"));',
        "    socket.end();",
        "    process.exit(0);",
        "  }",
        "});",
        'socket.on("error", (e) => { console.log("ERROR:" + e.message); process.exit(1); });',
        'setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 5000);',
      ].join("\n");

      const result = await execContainer(id, ["node", "-e", script]);
      expect(result.stdout).toContain("STATUS_LINE:HTTP/1.1 101");
      expect(result.stdout).toContain("ACCEPT:" + expectedAccept);
      expect(result.stdout).toContain("ECHO:hello-through-proxy");
    } finally {
      await removeContainer(id);
    }
  }, 60000);

  it("does not start the pairing proxy when enable_app is false", async () => {
    const state = await runTerraformApply(import.meta.dir, {
      agent_id: "foo",
      install: false,
      port: 4005,
      redirector_port: 4105,
      enable_app: false,
    });
    const { install, start } = collectScripts(state);

    const id = await runContainer("node:22-bookworm-slim");
    try {
      await writeCoder(id, "#!/bin/bash\nexit 0\n");
      await execContainer(id, ["bash", "-c", install]);
      await installFakeT3Binary(id, fakeT3WithUpstreamServer);

      const output = await execContainer(id, ["bash", "-c", start]);
      expect(output.exitCode).toBe(0);
      expect(output.stdout).not.toContain("pairing proxy");

      // The main server itself still starts and is reachable directly.
      await waitForPort(id, 4005);
      const direct = await httpGetInContainer(id, 4005, "/direct");
      expect(direct.status).toBe(200);
      expect(direct.body).toBe("upstream:/direct");

      // Nothing should ever come up on the (unused) redirector port.
      const redirector = await httpGetInContainer(id, 4105, "/");
      expect(redirector.status).toBe(0);
    } finally {
      await removeContainer(id);
    }
  }, 60000);
});
