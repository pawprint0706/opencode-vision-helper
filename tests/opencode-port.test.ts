import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk/v2";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withOpenCode } from "../src/opencode.js";

vi.mock("@opencode-ai/sdk/v2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@opencode-ai/sdk/v2")>();
  return {
    ...actual,
    createOpencode: vi.fn(),
  };
});

const createOpencodeMock = vi.mocked(createOpencode);

const fakeClient = {} as OpencodeClient;

function fakeInstance() {
  const close = vi.fn();
  createOpencodeMock.mockResolvedValue({
    client: fakeClient,
    server: { url: "http://127.0.0.1:40000", close },
  } as Awaited<ReturnType<typeof createOpencode>>);
  return { close };
}

const blockers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    blockers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  vi.clearAllMocks();
});

describe("OpenCode server lifecycle", () => {
  it("spawns the server on an available port and closes it after the callback", async () => {
    const { close } = fakeInstance();
    const result = await withOpenCode(async (client) => {
      expect(client).toBe(fakeClient);
      return "done";
    });
    expect(result).toBe("done");
    expect(createOpencodeMock).toHaveBeenCalledTimes(1);
    const options = createOpencodeMock.mock.calls[0]?.[0];
    expect(options).toMatchObject({ timeout: 10_000 });
    expect(options?.port).toBeTypeOf("number");
    expect(options?.port).toBeGreaterThanOrEqual(10_000);
    expect(options?.port).toBeLessThanOrEqual(50_000);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("avoids a port already occupied by another process", async () => {
    const blocker = createServer();
    blockers.push(blocker);
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", resolve);
    });
    const blockedPort = (blocker.address() as AddressInfo).port;

    fakeInstance();
    await withOpenCode(async () => {});
    const options = createOpencodeMock.mock.calls[0]?.[0];
    expect(options?.port).not.toBe(blockedPort);
  });

  it("passes the abort signal through and maps startup failures", async () => {
    createOpencodeMock.mockRejectedValue(new Error("spawn failed"));
    const controller = new AbortController();
    await expect(withOpenCode(async () => {}, controller.signal)).rejects.toMatchObject({
      code: "OPENCODE_UNAVAILABLE",
    });
    const options = createOpencodeMock.mock.calls[0]?.[0];
    expect(options?.signal).toBe(controller.signal);
  });

  it("strips the inherited server password while spawning and restores it after", async () => {
    const previous = process.env.OPENCODE_SERVER_PASSWORD;
    process.env.OPENCODE_SERVER_PASSWORD = "secret";
    let passwordDuringSpawn: string | undefined;
    fakeInstance();
    createOpencodeMock.mockImplementationOnce(async (_options) => {
      passwordDuringSpawn = process.env.OPENCODE_SERVER_PASSWORD;
      return {
        client: fakeClient,
        server: { url: "http://127.0.0.1:40000", close: vi.fn() },
      } as Awaited<ReturnType<typeof createOpencode>>;
    });
    try {
      await withOpenCode(async () => {});
      expect(passwordDuringSpawn).toBeUndefined();
      expect(process.env.OPENCODE_SERVER_PASSWORD).toBe("secret");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCODE_SERVER_PASSWORD;
      } else {
        process.env.OPENCODE_SERVER_PASSWORD = previous;
      }
    }
  });
});
