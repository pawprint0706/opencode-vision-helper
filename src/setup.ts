import { createInterface, type Interface as ReadlineInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

import {
  CLOUD_UPLOAD_NOTICE_VERSION,
  type CloudUploadConsent,
  HELPER_CONFIG_SCHEMA,
  type HelperConfig,
  type HelperConfigLocationOptions,
  type HelperPermission,
  hasValidCloudUploadConsent,
  readHelperConfigState,
  writeHelperConfig,
} from "./config.js";
import { AppError } from "./errors.js";
import { ALLOWED_PROVIDER_IDS, type AllowedProviderId } from "./model.js";
import { doctor } from "./opencode.js";
import {
  createOpenCodeManualRegistrationPlan,
  inspectOpenCodeRegistration,
  type OpenCodeManualRegistrationPlan,
  type OpenCodeRegistrationOptions,
  registerOpenCodePlugin,
  verifyOpenCodeManualRegistration,
} from "./registration.js";

export type SetupChoice = {
  value: string;
  label: string;
  hint?: string;
};

export interface SetupPrompter {
  readonly interactive: boolean;
  write(message: string): void;
  confirm(question: string, defaultValue: boolean): Promise<boolean>;
  select(question: string, choices: SetupChoice[], defaultValue: string): Promise<string>;
  close(): void;
}

export type SetupServices = {
  doctor: typeof doctor;
  readConfigState: typeof readHelperConfigState;
  writeConfig: typeof writeHelperConfig;
  inspectRegistration: typeof inspectOpenCodeRegistration;
  createManualRegistrationPlan: typeof createOpenCodeManualRegistrationPlan;
  verifyManualRegistration: typeof verifyOpenCodeManualRegistration;
  registerPlugin: typeof registerOpenCodePlugin;
  now: () => Date;
};

export type InteractiveSetupOptions = {
  directory?: string;
  configLocation?: HelperConfigLocationOptions;
  registrationLocation?: OpenCodeRegistrationOptions;
  registerOpenCode?: boolean;
  prompter?: SetupPrompter;
  services?: SetupServices;
};

export type SetupResult =
  | {
      status: "configured";
      changed: boolean;
      configPath: string;
      consentReused: boolean;
      permission: HelperPermission;
      model: string;
      openCodeRegistration: "registered" | "already-registered" | "manual" | "skipped";
      registrationChanged: boolean;
      openCodeConfigPath?: string;
    }
  | {
      status: "manual-registration-required";
      changed: boolean;
      configPath: string;
      consentReused: boolean;
      permission: HelperPermission;
      model: string;
      openCodeConfigPaths: string[];
    }
  | {
      status: "canceled";
      reason:
        | "cloud-upload-declined"
        | "automatic-upload-declined"
        | "permission-change-declined"
        | "final-confirmation-declined";
    };

const DEFAULT_SETUP_SERVICES: SetupServices = {
  doctor,
  readConfigState: readHelperConfigState,
  writeConfig: writeHelperConfig,
  inspectRegistration: inspectOpenCodeRegistration,
  createManualRegistrationPlan: createOpenCodeManualRegistrationPlan,
  verifyManualRegistration: verifyOpenCodeManualRegistration,
  registerPlugin: registerOpenCodePlugin,
  now: () => new Date(),
};

function isInteractiveStream(stream: Readable | Writable): boolean {
  return "isTTY" in stream && stream.isTTY === true;
}

export class TerminalSetupPrompter implements SetupPrompter {
  readonly interactive: boolean;
  readonly #readline: ReadlineInterface;
  readonly #output: Writable;
  #interrupted = false;

  constructor(input: Readable = process.stdin, output: Writable = process.stdout) {
    this.interactive = isInteractiveStream(input) && isInteractiveStream(output);
    this.#output = output;
    this.#readline = createInterface({ input, output });
    this.#readline.on("SIGINT", () => {
      this.#interrupted = true;
      this.#readline.close();
    });
  }

  write(message: string): void {
    this.#output.write(message);
  }

  async #question(prompt: string): Promise<string> {
    let closeListener: (() => void) | undefined;
    const inputClosed = new Promise<never>((_resolve, reject) => {
      closeListener = () => {
        reject(
          new AppError(
            "SETUP_CANCELED",
            this.#interrupted ? "Setup was canceled." : "Setup input was closed before completion.",
          ),
        );
      };
      this.#readline.once("close", closeListener);
    });
    try {
      const answer = await Promise.race([this.#readline.question(prompt), inputClosed]);
      if (this.#interrupted) {
        throw new AppError("SETUP_CANCELED", "Setup was canceled.");
      }
      return answer.trim();
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError("SETUP_CANCELED", "Setup input was closed before completion.", {
        cause: error,
      });
    } finally {
      if (closeListener) {
        this.#readline.removeListener("close", closeListener);
      }
    }
  }

  async confirm(question: string, defaultValue: boolean): Promise<boolean> {
    const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
    while (true) {
      const answer = (await this.#question(`${question}${suffix}`)).toLowerCase();
      if (!answer) {
        return defaultValue;
      }
      if (answer === "y" || answer === "yes") {
        return true;
      }
      if (answer === "n" || answer === "no") {
        return false;
      }
      this.write("Please answer yes or no.\n");
    }
  }

  async select(question: string, choices: SetupChoice[], defaultValue: string): Promise<string> {
    const defaultIndex = choices.findIndex((choice) => choice.value === defaultValue);
    if (choices.length === 0 || defaultIndex < 0) {
      throw new AppError("CONFIGURATION", `No valid choices are available for ${question}.`);
    }
    this.write(`${question}\n`);
    choices.forEach((choice, index) => {
      const hint = choice.hint ? ` — ${choice.hint}` : "";
      this.write(`  ${index + 1}) ${choice.label}${hint}\n`);
    });
    while (true) {
      const answer = await this.#question(`Select [${defaultIndex + 1}]: `);
      if (!answer) {
        return defaultValue;
      }
      const selectedIndex = Number(answer) - 1;
      const selected = Number.isInteger(selectedIndex) ? choices[selectedIndex] : undefined;
      const byValue = choices.find((choice) => choice.value === answer);
      if (selected) {
        return selected.value;
      }
      if (byValue) {
        return byValue.value;
      }
      this.write(`Choose a number from 1 to ${choices.length}.\n`);
    }
  }

  close(): void {
    this.#readline.close();
  }
}

function providerLabel(providerID: AllowedProviderId): string {
  if (providerID === "opencode-go") {
    return "OpenCode Go";
  }
  if (providerID === "opencode") {
    return "OpenCode Zen";
  }
  return "Ollama Cloud";
}

function providerFromModel(model: string): AllowedProviderId | undefined {
  return ALLOWED_PROVIDER_IDS.find((providerID) => model.startsWith(`${providerID}/`));
}

function modelsForProvider(models: string[], providerID: AllowedProviderId): string[] {
  return models.filter((model) => model.startsWith(`${providerID}/`)).sort();
}

function sameConfig(left: HelperConfig | undefined, right: HelperConfig): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}

function requireSelectedChoice<T extends string>(
  value: string,
  choices: readonly T[],
  question: string,
): T {
  if (!choices.includes(value as T)) {
    throw new AppError("CONFIGURATION", `The setup prompt returned an invalid ${question}.`);
  }
  return value as T;
}

export async function runInteractiveSetup(
  options: InteractiveSetupOptions = {},
): Promise<SetupResult> {
  const prompter = options.prompter ?? new TerminalSetupPrompter();
  const services = options.services ?? DEFAULT_SETUP_SERVICES;
  const directory = options.directory ?? process.cwd();
  const configLocation = options.configLocation ?? {};
  const registrationLocation = options.registrationLocation ?? {};
  const shouldRegisterOpenCode = options.registerOpenCode !== false;
  try {
    if (!prompter.interactive) {
      throw new AppError(
        "BAD_REQUEST",
        "Interactive setup requires a terminal. Run it directly in a TTY.",
      );
    }

    prompter.write("Checking OpenCode and connected vision models...\n");
    const health = await services.doctor(directory);
    const connectedProviders = ALLOWED_PROVIDER_IDS.filter((providerID) =>
      health.connected_providers.includes(providerID),
    );
    if (connectedProviders.length === 0) {
      throw new AppError(
        "PROVIDER_NOT_CONNECTED",
        "OpenCode Go, Zen, or Ollama Cloud is not connected. Use /connect in OpenCode, then rerun setup.",
      );
    }
    const providersWithModels = connectedProviders.filter(
      (providerID) => modelsForProvider(health.image_models, providerID).length > 0,
    );
    if (providersWithModels.length === 0) {
      throw new AppError(
        "MODEL_NOT_FOUND",
        "No connected OpenCode Go, Zen, or Ollama Cloud model currently accepts image input.",
      );
    }

    const state = await services.readConfigState(configLocation);
    const current = state.config;
    const consentReused = current !== undefined && hasValidCloudUploadConsent(current);
    let consent: CloudUploadConsent;
    if (consentReused) {
      consent = current.consent;
      prompter.write(
        `Existing cloud-upload consent for notice version ${CLOUD_UPLOAD_NOTICE_VERSION} will be retained.\n`,
      );
    } else {
      prompter.write(
        "\nCloud upload notice\n" +
          "The image you choose will be sent to an OpenCode Go, Zen, or Ollama Cloud model.\n" +
          "Provider costs and data-retention policies may apply. Image contents are untrusted,\n" +
          "and every tool is disabled in the isolated analysis session. Setup itself sends no image.\n",
      );
      if (!(await prompter.confirm("Do you agree to this cloud image transmission?", false))) {
        prompter.write("Setup canceled. No configuration was changed.\n");
        return { status: "canceled", reason: "cloud-upload-declined" };
      }
      consent = {
        cloudUpload: true,
        noticeVersion: CLOUD_UPLOAD_NOTICE_VERSION,
        acceptedAt: services.now().toISOString(),
      };
    }

    const permission = requireSelectedChoice(
      await prompter.select(
        "Choose the OpenCode permission for vision_analyze:",
        [
          {
            value: "ask",
            label: "ask (recommended)",
            hint: "request approval before each model call in normal mode",
          },
          {
            value: "allow",
            label: "allow",
            hint: "permit automatic cloud uploads when the model calls the tool",
          },
        ],
        current?.openCode.permission ?? "ask",
      ),
      ["ask", "allow"] as const,
      "permission",
    );
    if (
      permission === "allow" &&
      !(await prompter.confirm(
        "Allow future vision_analyze calls to upload images without a confirmation UI?",
        false,
      ))
    ) {
      prompter.write("Setup canceled. Automatic uploads were not enabled.\n");
      return { status: "canceled", reason: "automatic-upload-declined" };
    }

    const currentProvider = current ? providerFromModel(current.openCode.model) : undefined;
    const defaultProvider =
      currentProvider && providersWithModels.includes(currentProvider)
        ? currentProvider
        : providersWithModels[0];
    if (!defaultProvider) {
      throw new AppError("MODEL_NOT_FOUND", "No selectable vision provider is available.");
    }
    const providerID = requireSelectedChoice(
      await prompter.select(
        "Choose the provider for delegated vision analysis:",
        providersWithModels.map((value) => ({
          value,
          label: `${providerLabel(value)} (${value})`,
        })),
        defaultProvider,
      ),
      providersWithModels,
      "provider",
    );

    const availableModels = modelsForProvider(health.image_models, providerID);
    const defaultModel =
      current && availableModels.includes(current.openCode.model)
        ? current.openCode.model
        : availableModels[0];
    if (!defaultModel) {
      throw new AppError(
        "MODEL_NOT_FOUND",
        `No image-capable model is available for ${providerID}.`,
      );
    }
    const model = requireSelectedChoice(
      await prompter.select(
        `Choose an image-capable ${providerLabel(providerID)} model:`,
        availableModels.map((value) => ({ value, label: value })),
        defaultModel,
      ),
      availableModels,
      "model",
    );

    let registrationPlan: Awaited<ReturnType<typeof inspectOpenCodeRegistration>> | undefined;
    let manualRegistration: OpenCodeManualRegistrationPlan | undefined;
    let automaticRegistrationError: string | undefined;
    if (shouldRegisterOpenCode) {
      try {
        registrationPlan = await services.inspectRegistration(permission, registrationLocation);
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== "CONFIGURATION") {
          throw error;
        }
        manualRegistration = await services.createManualRegistrationPlan(
          permission,
          registrationLocation,
        );
        automaticRegistrationError = error.message;
      }
    }

    const registrationSummary = registrationPlan
      ? `  OpenCode global config: ${registrationPlan.configPath}\n` +
        "  OpenCode merge:\n" +
        `${JSON.stringify(registrationPlan.snippet, null, 2)}\n` +
        `  Existing helper plugin: ${registrationPlan.pluginPresent ? "registered" : "not registered"}\n` +
        `  Existing vision_analyze permission: ${
          registrationPlan.currentPermission === undefined
            ? "not set"
            : JSON.stringify(registrationPlan.currentPermission)
        }\n`
      : manualRegistration
        ? "  OpenCode registration: manual merge required\n" +
          `  Automatic merge unavailable: ${automaticRegistrationError}\n` +
          "  Review these OpenCode config target(s):\n" +
          manualRegistration.configPaths.map((path) => `    - ${path}\n`).join("") +
          "  Merge this snippet without replacing unrelated settings:\n" +
          `${JSON.stringify(manualRegistration.snippet, null, 2)}\n`
        : "  OpenCode registration: skipped (--config-only)\n";

    prompter.write(
      "\nSetup summary\n" +
        `  OpenCode: ${health.opencode_version}\n` +
        `  Permission: ${permission}\n` +
        `  Vision model: ${model}\n` +
        `  Helper config: ${state.path}\n` +
        registrationSummary,
    );
    if (
      registrationPlan?.permissionChange &&
      !(await prompter.confirm(
        `Replace only permission.vision_analyze with ${JSON.stringify(permission)}?`,
        false,
      ))
    ) {
      prompter.write("Setup canceled. The existing OpenCode permission was not changed.\n");
      return { status: "canceled", reason: "permission-change-declined" };
    }
    const finalQuestion = registrationPlan
      ? "Save the helper config and register the OpenCode plugin?"
      : manualRegistration
        ? "Save the helper config and continue with the manual OpenCode merge?"
        : "Save only the helper config?";
    if (!(await prompter.confirm(finalQuestion, false))) {
      prompter.write("Setup canceled. No configuration was changed.\n");
      return { status: "canceled", reason: "final-confirmation-declined" };
    }

    const config: HelperConfig = {
      schema: HELPER_CONFIG_SCHEMA,
      consent,
      openCode: { permission, model },
    };
    const changed = !sameConfig(current, config);
    if (changed) {
      await services.writeConfig(config, {
        ...configLocation,
        expectedRevision: state.revision,
      });
    }
    let registration: Awaited<ReturnType<typeof registerOpenCodePlugin>> | undefined;
    if (registrationPlan) {
      try {
        registration = await services.registerPlugin(permission, {
          ...registrationLocation,
          expectedRevision: registrationPlan.revision,
          allowPermissionChange: registrationPlan.permissionChange,
        });
      } catch (error) {
        const detail =
          error instanceof AppError ? error.message : "Unexpected registration failure.";
        throw new AppError(
          "CONFIGURATION",
          `Helper configuration ${changed ? "was saved" : "is unchanged"}, but OpenCode registration failed: ${detail}`,
          { cause: error, stage: "opencode-registration" },
        );
      }
    }
    if (manualRegistration) {
      prompter.write(
        `${changed ? "Configuration saved" : "Configuration unchanged"}: ${state.path}\n` +
          "Automatic OpenCode registration was not attempted. Merge the displayed snippet into exactly one intended config, and do not load the legacy wrapper beside the npm plugin.\n",
      );
      if (
        !(await prompter.confirm(
          "Have you completed and reviewed the manual OpenCode merge?",
          false,
        ))
      ) {
        prompter.write(
          "Setup is incomplete until the manual OpenCode merge is finished. Rerun setup afterward to verify registration.\n",
        );
        return {
          status: "manual-registration-required",
          changed,
          configPath: state.path,
          consentReused,
          permission,
          model,
          openCodeConfigPaths: manualRegistration.configPaths,
        };
      }
      const manualVerification = await services.verifyManualRegistration(
        manualRegistration,
        registrationLocation,
      );
      if (!manualVerification.complete) {
        prompter.write(
          `Manual OpenCode registration could not be verified: ${manualVerification.reason ?? "the expected entries are missing"}\n` +
            "Setup is incomplete. Correct the merge and rerun setup.\n",
        );
        return {
          status: "manual-registration-required",
          changed,
          configPath: state.path,
          consentReused,
          permission,
          model,
          openCodeConfigPaths: manualRegistration.configPaths,
        };
      }
      prompter.write(
        "Manual OpenCode registration confirmed. Restart OpenCode, then run opencode-vision-helper doctor. Project or agent permissions can override this global setting.\n",
      );
      return {
        status: "configured",
        changed,
        configPath: state.path,
        consentReused,
        permission,
        model,
        openCodeRegistration: "manual",
        registrationChanged: false,
        ...(manualRegistration.configPaths.length === 1
          ? { openCodeConfigPath: manualRegistration.configPaths[0] }
          : {}),
      };
    }
    prompter.write(
      `${changed ? "Configuration saved" : "Configuration unchanged"}: ${state.path}\n` +
        (registration
          ? `OpenCode plugin ${registration.status}: ${registration.configPath}\n` +
            "Restart OpenCode, then run opencode-vision-helper doctor. " +
            "Project or agent permissions can override this global setting.\n"
          : "OpenCode registration was skipped. Install only one ownership-checked legacy wrapper before restarting OpenCode.\n"),
    );
    return {
      status: "configured",
      changed,
      configPath: state.path,
      consentReused,
      permission,
      model,
      openCodeRegistration: registration?.status ?? "skipped",
      registrationChanged: registration?.changed ?? false,
      ...(registration ? { openCodeConfigPath: registration.configPath } : {}),
    };
  } finally {
    prompter.close();
  }
}
