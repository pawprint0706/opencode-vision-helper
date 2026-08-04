import type { Plugin } from "@opencode-ai/plugin";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

import { createVisionAnalyzeTool } from "./tool.js";

export const VisionHelperPlugin: Plugin = async ({ serverUrl, directory }, options) => {
  const configuredModel = options?.model;
  const defaultModel = typeof configuredModel === "string" ? configuredModel : undefined;
  const client = createOpencodeClient({
    baseUrl: serverUrl.toString(),
    directory,
  });
  return {
    tool: {
      vision_analyze: createVisionAnalyzeTool(
        client,
        undefined,
        defaultModel ? { defaultModel } : {},
      ),
    },
  };
};
