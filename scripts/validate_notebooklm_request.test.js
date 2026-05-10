import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ACTIONS_REQUIRING_LONG_RUNNING_CONFIRMATION,
  ALLOWED_ACTIONS,
  ALLOWED_SOURCE_READINESS_MODES,
  ALLOWED_STATUSES,
  ALLOWED_TARGET_MODES,
  DEFAULT_CONTRACT_VERSION,
  extractCreatedNotebookId,
  loadNotebooklmRequest,
  normalizeNotebooklmRequest,
  parseCliArgs,
  validateNotebooklmRequestContract,
} from "./validate_notebooklm_request.js";

function createTempJsonFile(payload) {
  const directoryPath = mkdtempSync(join(tmpdir(), "notebooklm-request-"));
  const filePath = join(directoryPath, "payload.json");
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return {
    cleanup() {
      rmSync(directoryPath, { force: true, recursive: true });
    },
    filePath,
  };
}

describe("validate_notebooklm_request", () => {
  test("requires an input file", () => {
    expect(() => parseCliArgs([])).toThrow("--input-file is required.");
  });

  test("rejects unknown options", () => {
    expect(() => parseCliArgs(["--bad-option", "x"])).toThrow("Unknown option: --bad-option");
  });

  test("validates a READY generate-audio request", () => {
    const payload = validateNotebooklmRequestContract({
      contractVersion: DEFAULT_CONTRACT_VERSION,
      status: "READY",
      request: {
        action: "generate-audio",
        notebookTarget: {
          targetMode: "existing",
          notebookId: "abc123de-1111-2222-3333-444455556666",
        },
        input: {
          generationInstructions: "Summarize key policy tradeoffs for analysts.",
        },
        options: {
          language: "en",
          sourceReadinessMode: "require-all-ready",
          sourceIds: ["src_001", "src_002", "src_001"],
        },
        confirmation: {
          userConfirmed: true,
          userConfirmedLongRunning: true,
        },
      },
      openQuestions: [],
    });

    expect(payload.status).toBe("READY");
    expect(payload.request.action).toBe("generate-audio");
    expect(payload.request.options.sourceIds).toEqual(["src_001", "src_002"]);
  });

  test("requires open questions when status is NEEDS_CLARIFICATION", () => {
    expect(() =>
      validateNotebooklmRequestContract({
        contractVersion: DEFAULT_CONTRACT_VERSION,
        status: "NEEDS_CLARIFICATION",
        request: {
          action: "add-sources",
          notebookTarget: {
            targetMode: "existing",
            notebookTitle: "Climate Policy",
          },
          input: {
            sources: [],
          },
          options: {},
          confirmation: {
            userConfirmed: false,
          },
        },
        openQuestions: [],
        }),
    ).toThrow(
      "notebooklmRequestContract.openQuestions must contain at least one question when status is NEEDS_CLARIFICATION.",
    );
  });

  test("limits clarification mode to one active question", () => {
    expect(() =>
      validateNotebooklmRequestContract({
        contractVersion: DEFAULT_CONTRACT_VERSION,
        status: "NEEDS_CLARIFICATION",
        request: {
          action: "ask",
          notebookTarget: {
            targetMode: "existing",
            notebookTitle: "Climate Policy",
          },
          input: {
            askPrompt: "What stands out so far?",
          },
          options: {
            sourceReadinessMode: "allow-partial-ready",
          },
          confirmation: {},
        },
        openQuestions: ["Question 1", "Question 2"],
      }),
    ).toThrow(
      "notebooklmRequestContract.openQuestions must contain at most one question when status is NEEDS_CLARIFICATION.",
    );
  });

  test("enforces one explicit notebook target", () => {
    expect(() =>
      normalizeNotebooklmRequest({
        action: "ask",
        notebookTarget: {
          targetMode: "existing",
          notebookId: "id-1",
          notebookTitle: "Title",
        },
        input: {
          askPrompt: "What are the main findings?",
        },
        options: {},
        confirmation: {},
      }),
    ).toThrow("request.notebookTarget must include exactly one of notebookId or notebookTitle.");
  });

  test("supports create-notebook target mode", () => {
    const normalized = normalizeNotebooklmRequest({
      action: "add-research",
      notebookTarget: {
        targetMode: "create",
        createNotebookTitle: "风水人群商品蓝海",
      },
      input: {
        researchQuery: "中国大陆近90天 风水 玄学 商品 蓝海",
      },
      options: {},
      confirmation: {
        userConfirmed: true,
        userConfirmedLongRunning: true,
      },
    });

    expect(normalized.notebookTarget.targetMode).toBe("create");
    expect(normalized.notebookTarget.createNotebookTitle).toBe("风水人群商品蓝海");
  });

  test("rejects mixed existing and create notebook targeting", () => {
    expect(() =>
      normalizeNotebooklmRequest({
        action: "add-research",
        notebookTarget: {
          targetMode: "create",
          createNotebookTitle: "New Notebook",
          notebookId: "id-1",
        },
        input: {
          researchQuery: "topic",
        },
        options: {},
        confirmation: {
          userConfirmed: true,
          userConfirmedLongRunning: true,
        },
      }),
    ).toThrow("request.notebookTarget with targetMode 'create' must not include notebookId or notebookTitle.");
  });

  test("defaults ask requests to partial-ready source mode", () => {
    const normalized = normalizeNotebooklmRequest({
      action: "ask",
      notebookTarget: {
        notebookTitle: "Climate Policy Tradeoffs",
      },
      input: {
        askPrompt: "What are the strongest product signals so far?",
      },
      options: {},
      confirmation: {},
    });

    expect(normalized.options.sourceReadinessMode).toBe("allow-partial-ready");
  });

  test("requires long-running confirmation for generate actions", () => {
    expect(() =>
      validateNotebooklmRequestContract({
        contractVersion: DEFAULT_CONTRACT_VERSION,
        status: "READY",
        request: {
          action: "generate-report",
          notebookTarget: {
            targetMode: "existing",
            notebookTitle: "Climate Policy Tradeoffs",
          },
          input: {
            generationInstructions: "Generate a briefing-doc report.",
          },
          options: {
            language: "en",
            sourceReadinessMode: "require-all-ready",
          },
          confirmation: {
            userConfirmed: true,
          },
        },
        openQuestions: [],
      }),
    ).toThrow("request.confirmation.userConfirmedLongRunning must be true for action 'generate-report'.");
  });

  test("rejects partial-ready mode for generate actions", () => {
    expect(() =>
      validateNotebooklmRequestContract({
        contractVersion: DEFAULT_CONTRACT_VERSION,
        status: "READY",
        request: {
          action: "generate-report",
          notebookTarget: {
            targetMode: "existing",
            notebookTitle: "Climate Policy Tradeoffs",
          },
          input: {
            generationInstructions: "Generate a briefing-doc report.",
          },
          options: {
            sourceReadinessMode: "allow-partial-ready",
          },
          confirmation: {
            userConfirmed: true,
            userConfirmedLongRunning: true,
          },
        },
        openQuestions: [],
      }),
    ).toThrow("request.options.sourceReadinessMode must be 'require-all-ready' for action 'generate-report'.");
  });

  test("requires filesystem-write confirmation for downloads", () => {
    expect(() =>
      validateNotebooklmRequestContract({
        contractVersion: DEFAULT_CONTRACT_VERSION,
        status: "READY",
        request: {
          action: "download",
          notebookTarget: {
            targetMode: "existing",
            notebookId: "abc123de-1111-2222-3333-444455556666",
          },
          input: {
            download: {
              artifactType: "audio",
              outputPath: "./output/podcast.mp3",
            },
          },
          options: {
            sourceReadinessMode: "require-all-ready",
          },
          confirmation: {
            userConfirmed: true,
            userConfirmedLongRunning: true,
          },
        },
        openQuestions: [],
      }),
    ).toThrow("request.confirmation.userConfirmedFilesystemWrite must be true for action 'download'.");
  });

  test("loads and validates request file from disk", () => {
    const tempFile = createTempJsonFile({
      contractVersion: DEFAULT_CONTRACT_VERSION,
      status: "READY",
        request: {
          action: "ask",
          notebookTarget: {
            targetMode: "existing",
            notebookTitle: "Climate Policy Tradeoffs",
          },
        input: {
          askPrompt: "What are the top 3 tradeoffs?",
        },
          options: {
            sourceReadinessMode: "allow-partial-ready",
            sourceIds: ["src_001", "src_002"],
          },
        confirmation: {},
      },
      openQuestions: [],
    });

    try {
      const payload = loadNotebooklmRequest(tempFile.filePath);
      expect(payload.request.action).toBe("ask");
      expect(payload.request.notebookTarget.notebookTitle).toBe("Climate Policy Tradeoffs");
    } finally {
      tempFile.cleanup();
    }
  });

  test("exports stable request constants", () => {
    expect(DEFAULT_CONTRACT_VERSION).toBe("notebooklm_request_v1");
    expect(ALLOWED_STATUSES).toEqual(new Set(["READY", "NEEDS_CLARIFICATION"]));
    expect(ALLOWED_ACTIONS.has("generate-audio")).toBe(true);
    expect(ACTIONS_REQUIRING_LONG_RUNNING_CONFIRMATION.has("download")).toBe(true);
    expect(ALLOWED_TARGET_MODES.has("create")).toBe(true);
    expect(ALLOWED_SOURCE_READINESS_MODES.has("allow-partial-ready")).toBe(true);
  });

  test("extracts notebook IDs from both create payload shapes", () => {
    expect(extractCreatedNotebookId({ id: "abc-123" })).toBe("abc-123");
    expect(extractCreatedNotebookId({ notebook: { id: "def-456" } })).toBe("def-456");
  });
});
