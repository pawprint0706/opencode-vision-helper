import {
  type HelperConfig,
  type HelperConfigLocationOptions,
  hasValidCloudUploadConsent,
  readHelperConfigState,
  resolveHelperConfigPath,
} from "./config.js";
import { AppError, asAppError } from "./errors.js";
import { doctor as doctorOpenCode, type DoctorResult as OpenCodeDoctorResult } from "./opencode.js";
import {
  diagnoseOpenCodeRegistration,
  type OpenCodeRegistrationDiagnostic,
  type OpenCodeRegistrationOptions,
} from "./registration.js";

export type HelperConfigDiagnostic = {
  status: "valid" | "missing" | "invalid";
  path: string;
  consent_valid: boolean;
  model?: string;
  provider?: string;
  provider_connected?: boolean;
  image_capable?: boolean;
  error?: string;
};

export type RegistrationDiagnostic = {
  status: "valid" | "invalid";
  config_path?: string;
  plugin_registered: boolean;
  npm_plugin_entries?: number;
  legacy_wrapper_present?: boolean;
  legacy_wrapper_owned?: boolean;
  project_legacy_wrapper_present?: boolean;
  project_legacy_wrapper_owned?: boolean;
  duplicate_registration?: boolean;
  permission?: unknown;
  permission_source?: OpenCodeRegistrationDiagnostic["permissionSource"];
  permission_matches_helper: boolean;
  ownership_manifest_present?: boolean;
  project_or_agent_override_possible: true;
  restart_required: "unknown";
  error?: string;
};

export type InstallationDoctorResult = OpenCodeDoctorResult & {
  helper_config: HelperConfigDiagnostic;
  opencode_registration: RegistrationDiagnostic;
};

export type DiagnosticServices = {
  doctorOpenCode: typeof doctorOpenCode;
  readConfigState: typeof readHelperConfigState;
  diagnoseRegistration: typeof diagnoseOpenCodeRegistration;
};

export type DiagnosticOptions = {
  configLocation?: HelperConfigLocationOptions;
  registrationLocation?: OpenCodeRegistrationOptions;
  services?: DiagnosticServices;
};

const DEFAULT_SERVICES: DiagnosticServices = {
  doctorOpenCode,
  readConfigState: readHelperConfigState,
  diagnoseRegistration: diagnoseOpenCodeRegistration,
};

function providerFromConfig(config: HelperConfig): string {
  return config.openCode.model.slice(0, config.openCode.model.indexOf("/"));
}

function invalidMessage(error: unknown): string {
  return error instanceof AppError ? error.message : asAppError(error).message;
}

export async function diagnoseInstallation(
  directory: string,
  signal?: AbortSignal,
  options: DiagnosticOptions = {},
): Promise<InstallationDoctorResult> {
  const services = options.services ?? DEFAULT_SERVICES;
  const openCode = await services.doctorOpenCode(directory, signal);
  const [configOutcome, registrationOutcome] = await Promise.allSettled([
    services.readConfigState(options.configLocation ?? {}),
    services.diagnoseRegistration({
      ...(options.registrationLocation ?? {}),
      projectDirectory: directory,
    }),
  ]);

  let config: HelperConfig | undefined;
  let helperConfig: HelperConfigDiagnostic;
  if (configOutcome.status === "rejected") {
    helperConfig = {
      status: "invalid",
      path: resolveHelperConfigPath(options.configLocation ?? {}),
      consent_valid: false,
      error: invalidMessage(configOutcome.reason),
    };
  } else if (!configOutcome.value.config) {
    helperConfig = {
      status: "missing",
      path: configOutcome.value.path,
      consent_valid: false,
    };
  } else {
    config = configOutcome.value.config;
    const provider = providerFromConfig(config);
    helperConfig = {
      status: "valid",
      path: configOutcome.value.path,
      consent_valid: hasValidCloudUploadConsent(config),
      model: config.openCode.model,
      provider,
      provider_connected: openCode.connected_providers.includes(provider),
      image_capable: openCode.image_models.includes(config.openCode.model),
    };
  }

  let registration: RegistrationDiagnostic;
  if (registrationOutcome.status === "rejected") {
    registration = {
      status: "invalid",
      plugin_registered: false,
      permission_matches_helper: false,
      project_or_agent_override_possible: true,
      restart_required: "unknown",
      error: invalidMessage(registrationOutcome.reason),
    };
  } else {
    const state = registrationOutcome.value;
    registration = {
      status: "valid",
      config_path: state.configPath,
      plugin_registered: state.pluginRegistered,
      npm_plugin_entries: state.npmPluginEntries,
      legacy_wrapper_present: state.legacyWrapperPresent,
      legacy_wrapper_owned: state.legacyWrapperOwned,
      ...(state.projectLegacyWrapperPresent !== undefined
        ? { project_legacy_wrapper_present: state.projectLegacyWrapperPresent }
        : {}),
      ...(state.projectLegacyWrapperOwned !== undefined
        ? { project_legacy_wrapper_owned: state.projectLegacyWrapperOwned }
        : {}),
      duplicate_registration: state.duplicateRegistration,
      ...(state.permission !== undefined ? { permission: state.permission } : {}),
      permission_source: state.permissionSource,
      permission_matches_helper:
        config !== undefined && state.permission === config.openCode.permission,
      ownership_manifest_present: state.ownershipManifestPresent,
      project_or_agent_override_possible: true,
      restart_required: "unknown",
    };
  }

  const ready =
    openCode.ok &&
    helperConfig.status === "valid" &&
    helperConfig.consent_valid &&
    helperConfig.provider_connected === true &&
    helperConfig.image_capable === true &&
    registration.status === "valid" &&
    registration.plugin_registered &&
    !registration.duplicate_registration &&
    registration.permission_matches_helper;
  return {
    ...openCode,
    helper_config: helperConfig,
    opencode_registration: registration,
    ok: ready,
  };
}
