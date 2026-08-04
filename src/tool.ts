import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { tool, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin";
import type { OpencodeClient, Part } from "@opencode-ai/sdk/v2";

import { createAbortScope, DEFAULT_ANALYSIS_TIMEOUT_MS } from "./abort.js";
import { selectMessageImage } from "./attachment.js";
import { AppError, asAppError, mapOpenCodeError } from "./errors.js";
import {
  prepareImage,
  prepareImageBuffer,
  type PreparedImage,
} from "./imaging.js";
import { analyzeWithClient, type AnalysisResult, type AnalyzeOptions } from "./opencode.js";
import { DEFAULT_PROMPT, formatReport } from "./report.js";

export type VisionToolDependencies = {
  prepareImage(path: string): Promise<PreparedImage>;
  prepareImageBuffer(bytes: Uint8Array, filename: string): Promise<PreparedImage>;
  analyze(client: OpencodeClient, options: AnalyzeOptions): Promise<AnalysisResult>;
  canonicalize(path: string): Promise<string>;
  messageParts(
    client: OpencodeClient,
    context: ToolContext,
    signal: AbortSignal,
  ): Promise<Part[]>;
};

export type VisionToolOptions = {
  defaultModel?: string;
  timeoutMs?: number;
};

const DEFAULT_DEPENDENCIES: VisionToolDependencies = {
  prepareImage,
  prepareImageBuffer,
  analyze: analyzeWithClient,
  canonicalize: realpath,
  messageParts: loadCurrentMessageParts,
};

export async function loadCurrentMessageParts(
  client: OpencodeClient,
  context: ToolContext,
  signal: AbortSignal,
): Promise<Part[]> {
  const getMessage = async (messageID: string) =>
    client.session.message(
      {
        sessionID: context.sessionID,
        messageID,
        directory: context.directory,
      },
      { throwOnError: true, signal },
    );
  try {
    const current = await getMessage(context.messageID);
    const hasCurrentImage = current.data.parts.some(
      (part) => part.type === "file" && part.mime.startsWith("image/"),
    );
    if (hasCurrentImage || current.data.info.role !== "assistant") {
      return current.data.parts;
    }
    const parent = await getMessage(current.data.info.parentID);
    return parent.data.parts;
  } catch (error) {
    throw mapOpenCodeError(error, "OPENCODE_UNAVAILABLE", signal);
  }
}

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
  dependencies: Partial<VisionToolDependencies> = {},
  options: VisionToolOptions = {},
): ToolDefinition {
  const services = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  return tool({
    description:
      "Analyze one local image or the current message's sole image attachment with an " +
      "image-capable OpenCode Go or Zen model. " +
      "This uploads the selected image to the configured cloud provider; use it only when " +
      "the user has approved that transmission.",
    args: {
      image: tool.schema
        .string()
        .min(1)
        .optional()
        .describe(
          "Optional absolute or session-relative path. Omit it to use the current message's sole image attachment.",
        ),
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

        const abortScope = createAbortScope(
          options.timeoutMs ?? DEFAULT_ANALYSIS_TIMEOUT_MS,
          context.abort,
        );
        try {
          const preparePath = async (inputPath: string): Promise<PreparedImage> => {
            const candidate = resolve(context.directory, inputPath);
            let imagePath: string;
            let worktreePath: string;
            try {
              imagePath = await services.canonicalize(candidate);
              worktreePath = await services.canonicalize(context.worktree);
            } catch (error) {
              throw new AppError(
                "BAD_REQUEST",
                "The image path or OpenCode worktree is unavailable.",
                { cause: error },
              );
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
            return services.prepareImage(imagePath);
          };

          let image: PreparedImage;
          if (args.image) {
            image = await preparePath(args.image);
          } else {
            const parts = await services.messageParts(client, context, abortScope.signal);
            const attachment = selectMessageImage(parts);
            image = attachment.kind === "path"
              ? await preparePath(attachment.path)
              : await services.prepareImageBuffer(attachment.bytes, attachment.filename);
          }

          context.metadata({
            title: "Analyze image",
            metadata: { image: image.path, model },
          });
          const structured = args.prompt === undefined;
          const result = await services.analyze(client, {
            directory: context.directory,
            image,
            model,
            prompt: args.prompt ?? DEFAULT_PROMPT,
            structured,
            uploadApproved: true,
            signal: abortScope.signal,
          });
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
        } finally {
          abortScope.dispose();
        }
      } catch (error) {
        return JSON.stringify(asAppError(error).toJSON());
      }
    },
  });
}
