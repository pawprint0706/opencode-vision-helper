import type { Plugin } from "@opencode-ai/plugin";

import { adaptPluginClient } from "./plugin-client.js";
import { createVisionAnalyzeTool } from "./tool.js";

export const VisionHelperPlugin: Plugin = async ({ client: pluginClient }, options) => {
  const configuredModel = options?.model;
  const defaultModel = typeof configuredModel === "string" ? configuredModel : undefined;
  const configuredTimeout = options?.timeoutMs;
  const timeoutMs = typeof configuredTimeout === "number" ? configuredTimeout : undefined;
  const client = adaptPluginClient(pluginClient);
  return {
    tool: {
      vision_analyze: createVisionAnalyzeTool(client, undefined, {
        ...(defaultModel ? { defaultModel } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      }),
    },
  };
};
