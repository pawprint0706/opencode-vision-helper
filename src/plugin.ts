import type { Plugin } from "@opencode-ai/plugin";

import { adaptPluginClient } from "./plugin-client.js";
import { createVisionAnalyzeTool, type VisionToolDependencies } from "./tool.js";

export function createVisionHelperPlugin(
  dependencies: Partial<VisionToolDependencies> = {},
): Plugin {
  return async ({ client: pluginClient }, options) => {
    const configuredModel = options?.model;
    const defaultModel = typeof configuredModel === "string" ? configuredModel : undefined;
    const configuredTimeout = options?.timeoutMs;
    const timeoutMs = typeof configuredTimeout === "number" ? configuredTimeout : undefined;
    const client = adaptPluginClient(pluginClient);
    return {
      tool: {
        vision_analyze: createVisionAnalyzeTool(client, dependencies, {
          ...(defaultModel ? { defaultModel } : {}),
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        }),
      },
    };
  };
}

export const VisionHelperPlugin: Plugin = createVisionHelperPlugin();
