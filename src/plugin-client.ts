import type { PluginInput } from "@opencode-ai/plugin";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";

type LegacyRequestOptions = {
  throwOnError?: boolean;
  signal?: AbortSignal;
};

type LegacyClient = {
  provider: {
    list(options: Record<string, unknown>): Promise<unknown>;
  };
  tool: {
    ids(options: Record<string, unknown>): Promise<unknown>;
  };
  session: {
    create(options: Record<string, unknown>): Promise<unknown>;
    delete(options: Record<string, unknown>): Promise<unknown>;
    abort(options: Record<string, unknown>): Promise<unknown>;
    prompt(options: Record<string, unknown>): Promise<unknown>;
    message(options: Record<string, unknown>): Promise<unknown>;
  };
};

function query(directory?: string): { directory?: string } {
  return directory ? { directory } : {};
}

/**
 * The stable plugin API currently supplies the legacy SDK client while the core uses the
 * v2 SDK. Both clients target the same OpenCode routes; only their argument shapes differ.
 * Keep that translation here so the plugin reuses OpenCode's authenticated, live client.
 */
export function adaptPluginClient(client: PluginInput["client"]): OpencodeClient {
  const legacy = client as unknown as LegacyClient;
  return {
    provider: {
      list(parameters: { directory?: string } = {}, options: LegacyRequestOptions = {}) {
        return legacy.provider.list({ ...options, query: query(parameters.directory) });
      },
    },
    tool: {
      ids(parameters: { directory?: string } = {}, options: LegacyRequestOptions = {}) {
        return legacy.tool.ids({ ...options, query: query(parameters.directory) });
      },
    },
    session: {
      create(
        parameters: { directory?: string; [key: string]: unknown } = {},
        options: LegacyRequestOptions = {},
      ) {
        const { directory, ...body } = parameters;
        return legacy.session.create({ ...options, body, query: query(directory) });
      },
      delete(
        parameters: { sessionID: string; directory?: string },
        options: LegacyRequestOptions = {},
      ) {
        return legacy.session.delete({
          ...options,
          path: { id: parameters.sessionID },
          query: query(parameters.directory),
        });
      },
      abort(
        parameters: { sessionID: string; directory?: string },
        options: LegacyRequestOptions = {},
      ) {
        return legacy.session.abort({
          ...options,
          path: { id: parameters.sessionID },
          query: query(parameters.directory),
        });
      },
      prompt(
        parameters: { sessionID: string; directory?: string; [key: string]: unknown },
        options: LegacyRequestOptions = {},
      ) {
        const { sessionID, directory, ...body } = parameters;
        return legacy.session.prompt({
          ...options,
          body,
          path: { id: sessionID },
          query: query(directory),
        });
      },
      message(
        parameters: { sessionID: string; messageID: string; directory?: string },
        options: LegacyRequestOptions = {},
      ) {
        return legacy.session.message({
          ...options,
          path: { id: parameters.sessionID, messageID: parameters.messageID },
          query: query(parameters.directory),
        });
      },
    },
  } as unknown as OpencodeClient;
}
