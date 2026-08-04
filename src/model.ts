import type { Provider } from "@opencode-ai/sdk/v2";

import { AppError } from "./errors.js";

export const ALLOWED_PROVIDER_IDS = ["opencode-go", "opencode"] as const;
export type AllowedProviderId = (typeof ALLOWED_PROVIDER_IDS)[number];

export type ModelRef = {
  providerID: AllowedProviderId;
  modelID: string;
};

export function parseModelRef(value: string): ModelRef {
  const slash = value.indexOf("/");
  const providerID = value.slice(0, slash);
  const modelID = value.slice(slash + 1);
  if (
    slash <= 0 ||
    !ALLOWED_PROVIDER_IDS.includes(providerID as AllowedProviderId) ||
    modelID.trim() === ""
  ) {
    throw new AppError(
      "CONFIGURATION",
      `Unsupported model '${value}'. Expected opencode-go/<id> or opencode/<id>.`,
    );
  }
  return { providerID: providerID as AllowedProviderId, modelID };
}
export function selectVisionModel(
  ref: ModelRef,
  providers: Provider[],
  connectedProviderIDs: string[],
): Provider["models"][string] {
  if (!connectedProviderIDs.includes(ref.providerID)) {
    throw new AppError(
      "PROVIDER_NOT_CONNECTED",
      `OpenCode provider '${ref.providerID}' is not connected.`,
    );
  }
  const provider = providers.find((candidate) => candidate.id === ref.providerID);
  const model = provider?.models[ref.modelID];
  if (!model) {
    throw new AppError(
      "MODEL_NOT_FOUND",
      `Model '${ref.providerID}/${ref.modelID}' is not available.`,
    );
  }
  if (!model.capabilities.input.image) {
    throw new AppError(
      "MODEL_NOT_VISION_CAPABLE",
      `Model '${ref.providerID}/${ref.modelID}' does not accept image input.`,
    );
  }
  return model;
}

export function imageModels(providers: Provider[], connected: string[]): string[] {
  return providers
    .filter(
      (provider) =>
        ALLOWED_PROVIDER_IDS.includes(provider.id as AllowedProviderId) &&
        connected.includes(provider.id),
    )
    .flatMap((provider) =>
      Object.values(provider.models)
        .filter((model) => model.capabilities.input.image)
        .map((model) => `${provider.id}/${model.id}`),
    )
    .sort();
}
