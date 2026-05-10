#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_CONTRACT_VERSION = "notebooklm_request_v1";
const ALLOWED_STATUSES = new Set(["READY", "NEEDS_CLARIFICATION"]);
const ALLOWED_TARGET_MODES = new Set(["existing", "create"]);
const ALLOWED_ACTIONS = new Set([
  "ask",
  "add-sources",
  "add-research",
  "generate-audio",
  "generate-report",
  "generate-video",
  "generate-quiz",
  "generate-flashcards",
  "download",
]);
const ALLOWED_SOURCE_READINESS_MODES = new Set(["require-all-ready", "allow-partial-ready"]);
const ACTIONS_REQUIRING_LONG_RUNNING_CONFIRMATION = new Set([
  "add-research",
  "generate-audio",
  "generate-report",
  "generate-video",
  "generate-quiz",
  "generate-flashcards",
  "download",
]);

function ensureFileExists(filePath, description) {
  if (!existsSync(filePath)) {
    throw new Error(`${description} not found: ${filePath}`);
  }
}

function parseCliArgs(argv) {
  const args = {
    inputFile: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--input-file") {
      index += 1;
      args.inputFile = requireOptionValue(argv, index, token);
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`Unknown option: ${token}`);
    }

    throw new Error(`Unexpected positional argument: ${token}`);
  }

  if (!args.inputFile) {
    throw new Error("--input-file is required.");
  }

  return args;
}

function requireOptionValue(argv, index, optionName) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value.`);
  }

  return value;
}

function loadJsonFile(filePath, description) {
  ensureFileExists(filePath, description);
  const payload = readFileSync(filePath, "utf8").trim();

  if (!payload) {
    throw new Error(`${description} is empty: ${filePath}`);
  }

  try {
    return JSON.parse(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${description} is not valid JSON: ${message}`);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequiredString(objectValue, fieldName, prefix) {
  const rawValue = objectValue[fieldName];
  if (typeof rawValue !== "string") {
    throw new Error(`${prefix}.${fieldName} must be a non-empty string.`);
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new Error(`${prefix}.${fieldName} must be a non-empty string.`);
  }

  return trimmed;
}

function readOptionalString(objectValue, fieldName, prefix) {
  const rawValue = objectValue[fieldName];

  if (rawValue === undefined || rawValue === null) {
    return undefined;
  }

  if (typeof rawValue !== "string") {
    throw new Error(`${prefix}.${fieldName} must be a string when provided.`);
  }

  const trimmed = rawValue.trim();
  return trimmed || undefined;
}

function readStringArray(objectValue, fieldName, prefix, required = false) {
  const rawValue = objectValue[fieldName];

  if (rawValue === undefined || rawValue === null) {
    if (required) {
      throw new Error(`${prefix}.${fieldName} must be a non-empty array of strings.`);
    }

    return [];
  }

  if (!Array.isArray(rawValue)) {
    throw new Error(`${prefix}.${fieldName} must be an array of strings.`);
  }

  const normalized = rawValue.map((value) => {
    if (typeof value !== "string") {
      throw new Error(`${prefix}.${fieldName} must contain strings only.`);
    }

    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(`${prefix}.${fieldName} must not contain empty strings.`);
    }

    return trimmed;
  });

  if (required && normalized.length === 0) {
    throw new Error(`${prefix}.${fieldName} must be a non-empty array of strings.`);
  }

  return [...new Set(normalized)];
}

function assertBoolean(value, fieldPath) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${fieldPath} must be a boolean when provided.`);
  }

  return value;
}

function readOptionalEnum(objectValue, fieldName, prefix, allowedValues) {
  const rawValue = readOptionalString(objectValue, fieldName, prefix);
  if (rawValue === undefined) {
    return undefined;
  }

  if (!allowedValues.has(rawValue)) {
    throw new Error(`${prefix}.${fieldName} must be one of: ${Array.from(allowedValues).join(", ")}.`);
  }

  return rawValue;
}

function normalizeNotebookTarget(rawNotebookTarget, requireComplete = true) {
  if (!isPlainObject(rawNotebookTarget)) {
    throw new Error("request.notebookTarget must be a JSON object.");
  }

  const targetMode = readOptionalEnum(rawNotebookTarget, "targetMode", "request.notebookTarget", ALLOWED_TARGET_MODES);
  const notebookId = readOptionalString(rawNotebookTarget, "notebookId", "request.notebookTarget");
  const notebookTitle = readOptionalString(rawNotebookTarget, "notebookTitle", "request.notebookTarget");
  const createNotebookTitle = readOptionalString(rawNotebookTarget, "createNotebookTitle", "request.notebookTarget");

  const normalizedTargetMode = targetMode ?? (createNotebookTitle ? "create" : "existing");

  if (!ALLOWED_TARGET_MODES.has(normalizedTargetMode)) {
    throw new Error(`request.notebookTarget.targetMode must be one of: ${Array.from(ALLOWED_TARGET_MODES).join(", ")}.`);
  }

  if (normalizedTargetMode === "create") {
    if (notebookId || notebookTitle) {
      throw new Error("request.notebookTarget with targetMode 'create' must not include notebookId or notebookTitle.");
    }

    if (requireComplete && !createNotebookTitle) {
      throw new Error("request.notebookTarget.createNotebookTitle is required when targetMode is 'create'.");
    }

    return compactObject({
      createNotebookTitle,
      targetMode: normalizedTargetMode,
    });
  }

  if (notebookId && notebookTitle) {
    throw new Error("request.notebookTarget must include exactly one of notebookId or notebookTitle.");
  }

  if (createNotebookTitle) {
    throw new Error("request.notebookTarget.createNotebookTitle is only allowed when targetMode is 'create'.");
  }

  if (requireComplete && !notebookId && !notebookTitle) {
    throw new Error("request.notebookTarget must include exactly one of notebookId or notebookTitle.");
  }

  return compactObject({
    notebookId,
    notebookTitle,
    targetMode: normalizedTargetMode,
  });
}

function normalizeDownloadInput(rawDownload, requireComplete = true) {
  if (rawDownload === undefined || rawDownload === null) {
    if (requireComplete) {
      throw new Error("request.input.download is required for action 'download'.");
    }

    return undefined;
  }

  if (!isPlainObject(rawDownload)) {
    throw new Error("request.input.download must be a JSON object.");
  }

  const artifactType = requireComplete
    ? readRequiredString(rawDownload, "artifactType", "request.input.download")
    : readOptionalString(rawDownload, "artifactType", "request.input.download");
  const outputPath = requireComplete
    ? readRequiredString(rawDownload, "outputPath", "request.input.download")
    : readOptionalString(rawDownload, "outputPath", "request.input.download");
  const format = readOptionalString(rawDownload, "format", "request.input.download");

  return compactObject({
    artifactType,
    format,
    outputPath,
  });
}

function normalizeRequestInput(rawInput, action, requireComplete = true) {
  if (!isPlainObject(rawInput)) {
    throw new Error("request.input must be a JSON object.");
  }

  const askPrompt = readOptionalString(rawInput, "askPrompt", "request.input");
  const generationInstructions = readOptionalString(rawInput, "generationInstructions", "request.input");
  const researchQuery = readOptionalString(rawInput, "researchQuery", "request.input");
  const sources = readStringArray(rawInput, "sources", "request.input", false);
  const download = normalizeDownloadInput(rawInput.download, action === "download" && requireComplete);

  return compactObject({
    askPrompt,
    download,
    generationInstructions,
    researchQuery,
    sources,
  });
}

function getDefaultSourceReadinessMode(action) {
  return action === "ask" ? "allow-partial-ready" : "require-all-ready";
}

function normalizeRequestOptions(rawOptions, action) {
  if (rawOptions === undefined || rawOptions === null) {
    return {
      sourceReadinessMode: getDefaultSourceReadinessMode(action),
    };
  }

  if (!isPlainObject(rawOptions)) {
    throw new Error("request.options must be a JSON object when provided.");
  }

  const language = readOptionalString(rawOptions, "language", "request.options");
  const sourceIds = readStringArray(rawOptions, "sourceIds", "request.options", false);
  const sourceReadinessMode =
    readOptionalEnum(rawOptions, "sourceReadinessMode", "request.options", ALLOWED_SOURCE_READINESS_MODES) ??
    getDefaultSourceReadinessMode(action);

  return compactObject({
    language,
    sourceReadinessMode,
    sourceIds,
  });
}

function normalizeRequestConfirmation(rawConfirmation) {
  if (rawConfirmation === undefined || rawConfirmation === null) {
    return {};
  }

  if (!isPlainObject(rawConfirmation)) {
    throw new Error("request.confirmation must be a JSON object when provided.");
  }

  return compactObject({
    userConfirmed: assertBoolean(rawConfirmation.userConfirmed, "request.confirmation.userConfirmed"),
    userConfirmedFilesystemWrite: assertBoolean(
      rawConfirmation.userConfirmedFilesystemWrite,
      "request.confirmation.userConfirmedFilesystemWrite",
    ),
    userConfirmedLongRunning: assertBoolean(
      rawConfirmation.userConfirmedLongRunning,
      "request.confirmation.userConfirmedLongRunning",
    ),
  });
}

function isGenerateAction(action) {
  return action.startsWith("generate-");
}

function validateAction(rawAction, requireComplete = true) {
  if (rawAction === undefined || rawAction === null) {
    if (requireComplete) {
      throw new Error("request.action must be a non-empty string.");
    }

    return undefined;
  }

  if (typeof rawAction !== "string") {
    throw new Error("request.action must be a non-empty string.");
  }

  const action = rawAction.trim();
  if (!action) {
    throw new Error("request.action must be a non-empty string.");
  }

  if (!ALLOWED_ACTIONS.has(action)) {
    throw new Error(`request.action must be one of: ${Array.from(ALLOWED_ACTIONS).join(", ")}.`);
  }

  return action;
}

function assertActionSpecificReadiness(normalizedRequest) {
  const { action, confirmation, input, options } = normalizedRequest;

  if (action === "ask" && !input.askPrompt) {
    throw new Error("request.input.askPrompt is required for action 'ask'.");
  }

  if (action === "add-sources" && (!Array.isArray(input.sources) || input.sources.length === 0)) {
    throw new Error("request.input.sources must be a non-empty array for action 'add-sources'.");
  }

  if (action === "add-research" && !input.researchQuery) {
    throw new Error("request.input.researchQuery is required for action 'add-research'.");
  }

  if (isGenerateAction(action) && !input.generationInstructions) {
    throw new Error(`request.input.generationInstructions is required for action '${action}'.`);
  }

  if (action === "download" && !input.download) {
    throw new Error("request.input.download is required for action 'download'.");
  }

  if (action === "ask" && options.sourceReadinessMode !== "allow-partial-ready") {
    throw new Error("request.options.sourceReadinessMode must be 'allow-partial-ready' for action 'ask'.");
  }

  if ((isGenerateAction(action) || action === "download") && options.sourceReadinessMode !== "require-all-ready") {
    throw new Error(`request.options.sourceReadinessMode must be 'require-all-ready' for action '${action}'.`);
  }

  if (ACTIONS_REQUIRING_LONG_RUNNING_CONFIRMATION.has(action) && confirmation.userConfirmedLongRunning !== true) {
    throw new Error(`request.confirmation.userConfirmedLongRunning must be true for action '${action}'.`);
  }

  if (ACTIONS_REQUIRING_LONG_RUNNING_CONFIRMATION.has(action) && confirmation.userConfirmed !== true) {
    throw new Error(`request.confirmation.userConfirmed must be true for action '${action}'.`);
  }

  if (action === "download" && confirmation.userConfirmedFilesystemWrite !== true) {
    throw new Error("request.confirmation.userConfirmedFilesystemWrite must be true for action 'download'.");
  }
}

function normalizeNotebooklmRequest(rawRequest, requireComplete = true) {
  if (!isPlainObject(rawRequest)) {
    throw new Error("request must be a JSON object.");
  }

  const action = validateAction(rawRequest.action, requireComplete);
  const notebookTarget = normalizeNotebookTarget(rawRequest.notebookTarget, requireComplete);
  const input = normalizeRequestInput(rawRequest.input ?? {}, action, requireComplete);
  const options = normalizeRequestOptions(rawRequest.options, action);
  const confirmation = normalizeRequestConfirmation(rawRequest.confirmation);

  const normalized = {
    action,
    confirmation,
    input,
    notebookTarget,
    options,
  };

  if (requireComplete) {
    assertActionSpecificReadiness(normalized);
  }

  return normalized;
}

function validateNotebooklmRequestContract(rawPayload) {
  if (!isPlainObject(rawPayload)) {
    throw new Error("NotebookLM request contract must be a JSON object.");
  }

  const contractVersion = readRequiredString(rawPayload, "contractVersion", "notebooklmRequestContract");
  if (contractVersion !== DEFAULT_CONTRACT_VERSION) {
    throw new Error(`notebooklmRequestContract.contractVersion must be '${DEFAULT_CONTRACT_VERSION}'.`);
  }

  const status = readRequiredString(rawPayload, "status", "notebooklmRequestContract");
  if (!ALLOWED_STATUSES.has(status)) {
    throw new Error("notebooklmRequestContract.status must be 'READY' or 'NEEDS_CLARIFICATION'.");
  }

  const openQuestions = readStringArray(rawPayload, "openQuestions", "notebooklmRequestContract", false);
  const request = normalizeNotebooklmRequest(rawPayload.request, status === "READY");

  if (status === "READY" && openQuestions.length > 0) {
    throw new Error("notebooklmRequestContract.openQuestions must be empty when status is READY.");
  }

  if (status === "NEEDS_CLARIFICATION" && openQuestions.length === 0) {
    throw new Error(
      "notebooklmRequestContract.openQuestions must contain at least one question when status is NEEDS_CLARIFICATION.",
    );
  }

  if (status === "NEEDS_CLARIFICATION" && openQuestions.length > 1) {
    throw new Error("notebooklmRequestContract.openQuestions must contain at most one question when status is NEEDS_CLARIFICATION.");
  }

  return {
    contractVersion,
    openQuestions,
    request,
    status,
  };
}

function extractCreatedNotebookId(rawPayload) {
  if (!isPlainObject(rawPayload)) {
    throw new Error("Created notebook payload must be a JSON object.");
  }

  if (typeof rawPayload.id === "string" && rawPayload.id.trim()) {
    return rawPayload.id.trim();
  }

  if (isPlainObject(rawPayload.notebook) && typeof rawPayload.notebook.id === "string" && rawPayload.notebook.id.trim()) {
    return rawPayload.notebook.id.trim();
  }

  throw new Error("Created notebook payload must contain id or notebook.id.");
}

function loadNotebooklmRequest(filePath) {
  return validateNotebooklmRequestContract(loadJsonFile(filePath, "NotebookLM request file"));
}

function compactObject(rawValue) {
  const compacted = {};

  for (const [key, value] of Object.entries(rawValue)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value) && value.length === 0) {
      continue;
    }

    if (isPlainObject(value) && Object.keys(value).length === 0) {
      continue;
    }

    compacted[key] = value;
  }

  return compacted;
}

if (import.meta.main) {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    const inputFile = resolve(args.inputFile);
    const payload = loadNotebooklmRequest(inputFile);
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ error: message, ok: false }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

export {
  ACTIONS_REQUIRING_LONG_RUNNING_CONFIRMATION,
  ALLOWED_ACTIONS,
  ALLOWED_STATUSES,
  ALLOWED_SOURCE_READINESS_MODES,
  ALLOWED_TARGET_MODES,
  DEFAULT_CONTRACT_VERSION,
  extractCreatedNotebookId,
  isPlainObject,
  loadJsonFile,
  loadNotebooklmRequest,
  normalizeNotebooklmRequest,
  parseCliArgs,
  validateNotebooklmRequestContract,
};
