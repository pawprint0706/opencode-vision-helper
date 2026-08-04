#!/usr/bin/env node

import { createServer } from "node:http";

function option(name, fallback) {
  const prefix = `--${name}=`;
  return (
    process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback
  );
}

function send(response, body, status = 200) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

const provider = {
  id: "opencode-go",
  name: "OpenCode Go",
  source: "api",
  env: [],
  options: {},
  models: {
    vision: {
      id: "vision",
      providerID: "opencode-go",
      api: { id: "test", url: "https://example.invalid", npm: "test" },
      name: "Vision",
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 10_000, output: 1_000 },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-01-01",
    },
  },
};

const hostname = option("hostname", "127.0.0.1");
const port = Number(option("port", "4096"));
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${hostname}:${port}`);
  if (request.method === "GET" && url.pathname === "/provider") {
    send(response, { all: [provider], default: {}, connected: ["opencode-go"] });
    return;
  }
  if (request.method === "GET" && url.pathname === "/experimental/tool/ids") {
    send(response, ["bash", "vision_analyze"]);
    return;
  }
  if (request.method === "POST" && url.pathname === "/session") {
    send(response, { id: "packaged-cli-session" });
    return;
  }
  if (request.method === "POST" && url.pathname === "/session/packaged-cli-session/message") {
    send(response, {
      info: {
        cost: 0.003,
        structured: { summary: "Packaged CLI result", issues: [] },
      },
      parts: [],
    });
    return;
  }
  if (request.method === "DELETE" && url.pathname === "/session/packaged-cli-session") {
    send(response, true);
    return;
  }
  send(response, { name: "NotFoundError" }, 404);
});

server.listen(port, hostname, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  process.stdout.write(`opencode server listening on http://${hostname}:${actualPort}\n`);
});

const close = () => server.close(() => process.exit(0));
process.once("SIGINT", close);
process.once("SIGTERM", close);
