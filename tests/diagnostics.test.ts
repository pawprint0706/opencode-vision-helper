import { describe, expect, it } from "vitest";

import {
  CLOUD_UPLOAD_NOTICE_VERSION,
  HELPER_CONFIG_SCHEMA,
  type HelperConfig,
} from "../src/config.js";
import { type DiagnosticServices, diagnoseInstallation } from "../src/diagnostics.js";
import { AppError } from "../src/errors.js";

function config(model = "opencode-go/vision"): HelperConfig {
  return {
    schema: HELPER_CONFIG_SCHEMA,
    consent: {
      cloudUpload: true,
      noticeVersion: CLOUD_UPLOAD_NOTICE_VERSION,
      acceptedAt: "2026-08-05T00:00:00.000Z",
    },
    openCode: { permission: "ask", model },
  };
}

function services(overrides: Partial<DiagnosticServices> = {}): DiagnosticServices {
  return {
    doctorOpenCode: async () => ({
      opencode_version: "1.18.13",
      connected_providers: ["opencode-go"],
      image_models: ["opencode-go/vision"],
      ok: true,
    }),
    readConfigState: async () => ({
      path: "helper-config.json",
      revision: "revision",
      config: config(),
    }),
    diagnoseRegistration: async () => ({
      configPath: "opencode.json",
      manifestPath: "registration.json",
      npmPluginEntries: 1,
      legacyWrapperPresent: false,
      legacyWrapperOwned: false,
      pluginRegistered: true,
      duplicateRegistration: false,
      permission: "ask",
      permissionSource: "vision_analyze",
      ownershipManifestPresent: true,
    }),
    ...overrides,
  };
}

describe("installation diagnostics", () => {
  it("reports a ready saved model, consent, plugin, and matching permission", async () => {
    await expect(
      diagnoseInstallation("project", undefined, { services: services() }),
    ).resolves.toEqual({
      opencode_version: "1.18.13",
      connected_providers: ["opencode-go"],
      image_models: ["opencode-go/vision"],
      helper_config: {
        status: "valid",
        path: "helper-config.json",
        consent_valid: true,
        model: "opencode-go/vision",
        provider: "opencode-go",
        provider_connected: true,
        image_capable: true,
      },
      opencode_registration: {
        status: "valid",
        config_path: "opencode.json",
        plugin_registered: true,
        npm_plugin_entries: 1,
        legacy_wrapper_present: false,
        legacy_wrapper_owned: false,
        duplicate_registration: false,
        permission: "ask",
        permission_source: "vision_analyze",
        permission_matches_helper: true,
        ownership_manifest_present: true,
        project_or_agent_override_possible: true,
        restart_required: "unknown",
      },
      ok: true,
    });
  });

  it("reports missing setup and registration without hiding OpenCode health", async () => {
    const result = await diagnoseInstallation("project", undefined, {
      services: services({
        readConfigState: async () => ({ path: "helper-config.json", revision: null }),
        diagnoseRegistration: async () => ({
          configPath: "opencode.json",
          manifestPath: "registration.json",
          npmPluginEntries: 0,
          legacyWrapperPresent: false,
          legacyWrapperOwned: false,
          pluginRegistered: false,
          duplicateRegistration: false,
          permissionSource: "unset",
          ownershipManifestPresent: false,
        }),
      }),
    });

    expect(result).toMatchObject({
      opencode_version: "1.18.13",
      helper_config: { status: "missing", consent_valid: false },
      opencode_registration: { status: "valid", plugin_registered: false },
      ok: false,
    });
  });

  it("reports invalid local state as sanitized diagnostics", async () => {
    const result = await diagnoseInstallation("project", undefined, {
      configLocation: { configPath: "broken-helper.json" },
      services: services({
        readConfigState: async () => {
          throw new AppError("CONFIGURATION", "The helper configuration is invalid.");
        },
        diagnoseRegistration: async () => {
          throw new AppError("CONFIGURATION", "The OpenCode config cannot be parsed.");
        },
      }),
    });

    expect(result).toMatchObject({
      helper_config: {
        status: "invalid",
        consent_valid: false,
        error: "The helper configuration is invalid.",
      },
      opencode_registration: {
        status: "invalid",
        plugin_registered: false,
        error: "The OpenCode config cannot be parsed.",
      },
      ok: false,
    });
  });

  it("reports provider and image-capability drift for the saved model", async () => {
    const result = await diagnoseInstallation("project", undefined, {
      services: services({
        readConfigState: async () => ({
          path: "helper-config.json",
          revision: "revision",
          config: config("opencode/missing-vision"),
        }),
      }),
    });

    expect(result.helper_config).toMatchObject({
      provider: "opencode",
      provider_connected: false,
      image_capable: false,
    });
    expect(result.ok).toBe(false);
  });
});
