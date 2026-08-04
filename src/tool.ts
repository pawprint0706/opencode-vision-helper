import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { tool, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";

import { createAbortScope, DEFAULT_ANALYSIS_TIMEOUT_MS } from "./abort.js";
import { AppError, asAppError } from "./errors.js";
import { prepareImage, type PreparedImage } from "./imaging.js";
import { analyzeWithClient, type AnalysisResult, type AnalyzeOptions } from "./opencode.js";
import { DEFAULT_PROMPT, formatReport } from "./report.js";

export type VisionToolDependencies = {
  prepareImage(path: string): Promise<PreparedImage>;
  analyze(client: OpencodeClient, options: AnalyzeOptions): Promise<AnalysisResult>;
  canonicalize(path: string): Promise<string>;
};

export type VisionToolOptions = {
  defaultModel?: string;
  timeoutMs?: number;
};

const DEFAULT_DEPENDENCIES: VisionToolDependencies = {
  prepareImage,
  analyze: analyzeWithClient,
  canonicalize: realpath,
};

function isWithin(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

function formatToolResult(result: AnalysisResult): string {
  if (result.report) {
    return formatReport(result.report);
  }
  return result.text ?? "";
}

export function createVisionAnalyzeTool(
  client: OpencodeClient,
  dependencies: VisionToolDependencies = DEFAULT_DEPENDENCIES,
  options: VisionToolOptions = {},
): ToolDefinition {
  return tool({
    description:
      "Analyze one existing local image with an image-capable OpenCode Go or Zen model. " +
      "This uploads the selected image to the configured cloud provider; use it only when " +
      "the user has approved that transmission.",
    args: {
      image: tool.schema
        .string()
        .min(1)
        .describe("Absolute path or path relative to the current OpenCode session directory."),
      prompt: tool.schema
        .string()
        .min(1)
        .optional()
        .describe("Optional question. Omit it for the structured UI issue report."),
      model: tool.schema
        .string()
        .min(1)
        .optional()
        .describe("Optional opencode-go/<id> or opencode/<id> vision model."),
    },
    async execute(args, context: ToolContext) {
      try {
        const model = args.model ?? options.defaultModel ?? process.env.OPENCODE_VISION_MODEL;
        if (!model) {
          throw new AppError("CONFIGURATION", "No vision model was selected.");
        }

        const candidate = resolve(context.directory, args.image);
        let imagePath: string;
        let worktreePath: string;
        try {
          imagePath = await dependencies.canonicalize(candidate);
          worktreePath = await dependencies.canonicalize(context.worktree);
        } catch (error) {
          throw new AppError("BAD_REQUEST", "The image path or OpenCode worktree is unavailable.", {
            cause: error,
          });
        }
        if (!isWithin(worktreePath, imagePath)) {
          await context.ask({
            permission: "external_directory",
            patterns: [imagePath],
            always: [`${dirname(imagePath)}/*`],
            metadata: {
              reason: "Analyze and upload an image outside the current worktree",
              image: imagePath,
            },
          });
        }

        context.metadata({
          title: "Analyze image",
          metadata: { image: imagePath, model },
        });
        const image = await dependencies.prepareImage(imagePath);
        const structured = args.prompt === undefined;
        const abortScope = createAbortScope(
          options.timeoutMs ?? DEFAULT_ANALYSIS_TIMEOUT_MS,
          context.abort,
        );
        let result: AnalysisResult;
        try {
          result = await dependencies.analyze(client, {
            directory: context.directory,
            image,
            model,
            prompt: args.prompt ?? DEFAULT_PROMPT,
            structured,
            uploadApproved: true,
            signal: abortScope.signal,
          });
        } finally {
          abortScope.dispose();
        }
        return {
          title: "Vision analysis",
          output: formatToolResult(result),
          metadata: {
            model: result.model,
            cost: result.cost,
            session_id: result.session_id,
            warnings: result.warnings,
          },
        };
      } catch (error) {
        return JSON.stringify(asAppError(error).toJSON());
      }
    },
  });
}
