import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { type ToolContext, type ToolDefinition, tool } from "@opencode-ai/plugin";
import type { Message, OpencodeClient, Part } from "@opencode-ai/sdk/v2";

import { createAbortScope, DEFAULT_ANALYSIS_TIMEOUT_MS } from "./abort.js";
import { selectMessageImage } from "./attachment.js";
import {
  hasValidCloudUploadConsent,
  readHelperConfig,
  resolveConfiguredVisionModel,
} from "./config.js";
import { AppError, asAppError, mapOpenCodeError } from "./errors.js";
import { type PreparedImage, prepareImage, prepareImageBuffer } from "./imaging.js";
import {
  ALLOWED_PROVIDER_IDS,
  type ModelRef,
  parseModelRef,
  requireNonVisionCaller,
} from "./model.js";
import { type AnalysisResult, type AnalyzeOptions, analyzeWithClient } from "./opencode.js";
import { DEFAULT_PROMPT, formatReport } from "./report.js";

export type VisionToolDependencies = {
  prepareImage(path: string): Promise<PreparedImage>;
  prepareImageBuffer(bytes: Uint8Array, filename: string): Promise<PreparedImage>;
  analyze(client: OpencodeClient, options: AnalyzeOptions): Promise<AnalysisResult>;
  canonicalize(path: string): Promise<string>;
  messageParts(client: OpencodeClient, context: ToolContext, signal: AbortSignal): Promise<Part[]>;
  validateCaller(
    client: OpencodeClient,
    context: ToolContext,
    signal: AbortSignal,
  ): Promise<ModelRef>;
  readConfig: typeof readHelperConfig;
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
  validateCaller: validateCallingModel,
  readConfig: readHelperConfig,
};

function callingModelRef(info: Message): ModelRef {
  const providerID = info.role === "assistant" ? info.providerID : info.model.providerID;
  const modelID = info.role === "assistant" ? info.modelID : info.model.modelID;
  if (
    !ALLOWED_PROVIDER_IDS.includes(providerID as ModelRef["providerID"]) ||
    modelID.trim() === ""
  ) {
    throw new AppError(
      "CALLER_MODEL_UNVERIFIED",
      `The calling model '${providerID}/${modelID}' is outside the supported OpenCode Go and Zen providers.`,
    );
  }
  return { providerID: providerID as ModelRef["providerID"], modelID };
}

export async function validateCallingModel(
  client: OpencodeClient,
  context: ToolContext,
  signal: AbortSignal,
): Promise<ModelRef> {
  try {
    const [message, state] = await Promise.all([
      client.session.message(
        {
          sessionID: context.sessionID,
          messageID: context.messageID,
          directory: context.directory,
        },
        { throwOnError: true, signal },
      ),
      client.provider.list({ directory: context.directory }, { throwOnError: true, signal }),
    ]);
    const ref = callingModelRef(message.data.info);
    requireNonVisionCaller(ref, state.data.all, state.data.connected);
    return ref;
  } catch (error) {
    throw mapOpenCodeError(error, "OPENCODE_UNAVAILABLE", signal);
  }
}

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
  return (
    pathFromRoot === "" ||
    (!isAbsolute(pathFromRoot) && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`))
  );
}

function formatToolResult(result: AnalysisResult): string {
  if (result.report) {
    return formatReport(result.report);
  }
  return result.text ?? "";
}

function toolResultTitle(result: AnalysisResult): string {
  return result.warnings?.length ? "Vision analysis (cleanup warning)" : "Vision analysis";
}

async function requirePermission(
  context: ToolContext,
  request: Parameters<ToolContext["ask"]>[0],
  message: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    await context.ask(request);
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw mapOpenCodeError(error, "OPENCODE_UNAVAILABLE", signal);
    }
    throw new AppError("UPLOAD_NOT_APPROVED", message, { cause: error });
  }
}

export function createVisionAnalyzeTool(
  client: OpencodeClient,
  dependencies: Partial<VisionToolDependencies> = {},
  options: VisionToolOptions = {},
): ToolDefinition {
  const services = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  return tool({
    description:
      "Fallback for a calling model without image input: analyze one local image or the " +
      "current message's sole image attachment with an " +
      "image-capable OpenCode Go or Zen model. " +
      "Do not call this when you can analyze images directly; execution verifies the calling " +
      "model against OpenCode metadata and refuses image-capable or unverifiable callers. " +
      "This uploads the selected image to the configured cloud provider; use it only when " +
      "the user has approved that transmission through opencode-vision-helper setup.",
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
        const overrideModel =
          args.model ?? options.defaultModel ?? process.env.OPENCODE_VISION_MODEL;
        if (overrideModel) {
          parseModelRef(overrideModel);
        }

        const abortScope = createAbortScope(
          options.timeoutMs ?? DEFAULT_ANALYSIS_TIMEOUT_MS,
          context.abort,
        );
        try {
          abortScope.signal.throwIfAborted();
          await services.validateCaller(client, context, abortScope.signal);
          const config = await services.readConfig();
          if (!config || !hasValidCloudUploadConsent(config)) {
            throw new AppError(
              "CONSENT_REQUIRED",
              "The native vision tool requires current cloud-upload consent from opencode-vision-helper setup.",
            );
          }
          const model = resolveConfiguredVisionModel(
            config,
            args.model,
            options.defaultModel,
            process.env.OPENCODE_VISION_MODEL,
          );
          if (!model) {
            throw new AppError("CONFIGURATION", "No vision model was selected.");
          }
          parseModelRef(model);
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
              await requirePermission(
                context,
                {
                  permission: "external_directory",
                  patterns: [imagePath],
                  always: [`${dirname(imagePath)}/*`],
                  metadata: {
                    reason: "Analyze and upload an image outside the current worktree",
                    image: imagePath,
                  },
                },
                "OpenCode did not approve access to the external image.",
                abortScope.signal,
              );
            }
            return services.prepareImage(imagePath);
          };

          let image: PreparedImage;
          if (args.image) {
            image = await preparePath(args.image);
          } else {
            const parts = await services.messageParts(client, context, abortScope.signal);
            const attachment = selectMessageImage(parts);
            image =
              attachment.kind === "path"
                ? await preparePath(attachment.path)
                : await services.prepareImageBuffer(attachment.bytes, attachment.filename);
          }

          await requirePermission(
            context,
            {
              permission: "vision_analyze",
              patterns: [model],
              always: [model],
              metadata: {
                reason: "Upload the selected image for cloud vision analysis",
                image: image.path,
                model,
              },
            },
            "OpenCode did not approve image upload.",
            abortScope.signal,
          );
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
            title: toolResultTitle(result),
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
