"use strict";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { getSellerCentralReadiness, truthy } = require("./sellerCentralConfig");

const execFileAsync = promisify(execFile);

function resolveBrowserExecutable() {
  const explicit = String(process.env.PUPPETEER_EXECUTABLE_PATH || process.env.SELLER_CENTRAL_BROWSER_PATH || "").trim();
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeSameSite(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "strict") return "Strict";
  if (normalized === "lax") return "Lax";
  if (normalized === "none" || normalized === "no_restriction" || normalized === "no restriction") {
    return "None";
  }
  return undefined;
}

function normalizeCookie(rawCookie) {
  if (!rawCookie || typeof rawCookie !== "object") {
    return null;
  }

  const name = String(rawCookie.name || "").trim();
  if (!name) {
    return null;
  }

  const normalized = {
    name,
    value: String(rawCookie.value || ""),
  };

  const domain = String(rawCookie.domain || "").trim();
  const pathValue = String(rawCookie.path || "").trim();
  if (domain) {
    normalized.domain = domain;
  }
  if (pathValue) {
    normalized.path = pathValue;
  }

  if (typeof rawCookie.secure === "boolean") {
    normalized.secure = rawCookie.secure;
  }
  if (typeof rawCookie.httpOnly === "boolean") {
    normalized.httpOnly = rawCookie.httpOnly;
  }

  const sameSite = normalizeSameSite(rawCookie.sameSite);
  if (sameSite) {
    normalized.sameSite = sameSite;
  }

  const expires =
    typeof rawCookie.expires === "number"
      ? rawCookie.expires
      : typeof rawCookie.expirationDate === "number"
        ? rawCookie.expirationDate
        : null;

  if (Number.isFinite(expires) && expires > 0) {
    normalized.expires = expires;
  }

  return normalized;
}

async function applySession(page) {
  let sessionData = null;

  if (process.env.SELLER_CENTRAL_SESSION_PATH) {
    sessionData = readJsonFile(process.env.SELLER_CENTRAL_SESSION_PATH);
  } else if (process.env.SELLER_CENTRAL_COOKIES_JSON) {
    sessionData = { cookies: JSON.parse(process.env.SELLER_CENTRAL_COOKIES_JSON) };
  }

  if (!sessionData) {
    return;
  }

  const cookies = Array.isArray(sessionData) ? sessionData : sessionData.cookies || [];
  if (cookies.length > 0) {
    const normalizedCookies = cookies
      .map((cookie) => normalizeCookie(cookie))
      .filter(Boolean);
    if (normalizedCookies.length > 0) {
      await page.setCookie(...normalizedCookies);
    }
  }

  const origins = Array.isArray(sessionData.origins) ? sessionData.origins : [];
  for (const originState of origins) {
    if (!originState || !originState.origin) continue;
    await page.goto(originState.origin, { waitUntil: "domcontentloaded" });
    const localStorageEntries = Array.isArray(originState.localStorage) ? originState.localStorage : [];
    if (localStorageEntries.length > 0) {
      await page.evaluate((entries) => {
        for (const entry of entries) {
          window.localStorage.setItem(entry.name, entry.value);
        }
      }, localStorageEntries);
    }
  }
}

async function fillField(page, selector, value) {
  if (!selector || value === null || value === undefined || value === "") {
    return;
  }
  await page.waitForSelector(selector, { timeout: 15000 });
  await page.$eval(
    selector,
    (element, nextValue) => {
      const valueString = String(nextValue);
      if ("value" in element) {
        element.focus();
        element.value = valueString;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (element.isContentEditable) {
        element.textContent = valueString;
        element.dispatchEvent(new InputEvent("input", { bubbles: true, data: valueString }));
      } else {
        element.textContent = valueString;
      }
    },
    value,
  );
}

async function maybeScreenshot(page, prefix) {
  const traceDir = process.env.SELLER_CENTRAL_TRACE_DIR;
  if (!traceDir) return null;
  fs.mkdirSync(traceDir, { recursive: true });
  const screenshotPath = path.join(traceDir, `${prefix}-${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

async function extractText(page, selector) {
  if (!selector) return null;
  const handle = await page.$(selector);
  if (!handle) return null;
  const text = await page.$eval(selector, (element) => (element.textContent || "").trim());
  return text || null;
}

async function inspectSubmitButton(page, selector) {
  await page.waitForSelector(selector, { timeout: 15000 });
  return page.$eval(selector, (element) => {
    element.scrollIntoView({ behavior: "instant", block: "center" });
    const disabled = Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true";
    const rect = element.getBoundingClientRect();
    return {
      disabled,
      text: (element.textContent || "").trim(),
      visible: rect.width > 0 && rect.height > 0,
    };
  });
}

function extractQueryParams(value) {
  try {
    const parsed = new URL(String(value || ""));
    return {
      popupUrl: parsed.toString(),
      caseId: parsed.searchParams.get("caseID") || parsed.searchParams.get("caseId") || null,
      contactRequestId: parsed.searchParams.get("contactRequestId") || null,
    };
  } catch (_error) {
    return {
      popupUrl: String(value || "") || null,
      caseId: null,
      contactRequestId: null,
    };
  }
}

function buildTranscriptSnapshot(chatState) {
  const sample = String(chatState?.bodySample || "").replace(/\s+/g, " ").trim();
  if (!sample) return null;
  return sample.slice(0, 4000);
}

async function run() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Missing input payload path.");
  }

  const payload = readJsonFile(inputPath);
  const readiness = getSellerCentralReadiness(process.env);
  if (!readiness.ready) {
    return {
      downstream_submission_attempted: false,
      downstream_submission_confirmed: false,
      pre_submit_path_completed: false,
      external_case_id: null,
      status: "failed",
      raw_response_or_trace: { readiness },
      failure_reason: readiness.missing.join("; "),
      submission_id: payload.submission_id,
    };
  }

  const fnsku = String(payload.fnsku || "").trim();
  if (!fnsku) {
    return {
      downstream_submission_attempted: false,
      downstream_submission_confirmed: false,
      pre_submit_path_completed: false,
      external_case_id: null,
      status: "failed",
      raw_response_or_trace: {
        readiness,
      },
      failure_reason: "Seller Central chat initiation requires a real FNSKU.",
      submission_id: payload.submission_id,
    };
  }

  const intakeDetails = String(payload.body || payload.subject || "").trim();
  if (!intakeDetails) {
    return {
      downstream_submission_attempted: false,
      downstream_submission_confirmed: false,
      pre_submit_path_completed: false,
      external_case_id: null,
      status: "failed",
      raw_response_or_trace: {
        readiness,
      },
      failure_reason: "Seller Central chat initiation requires intake details.",
      submission_id: payload.submission_id,
    };
  }

  const probeScriptPath = path.resolve(__dirname, "probeSellerCentralChat.js");
  const probeEnv = {
    ...process.env,
    SELLER_CENTRAL_PROBE_URL: String(process.env.SELLER_CENTRAL_CASE_URL || "https://sellercentral.amazon.com/help/center?redirectSource=HelpHub"),
    SELLER_CENTRAL_CLICK_TEXTS: JSON.stringify(["Create new issue", "Inventory lost in FBA warehouse"]),
    SELLER_CENTRAL_FIRST_TEXT_INPUT_VALUE: fnsku,
    SELLER_CENTRAL_POST_FILL_CLICK_TEXTS: JSON.stringify(["Continue", "Contact an associate"]),
    SELLER_CENTRAL_INTAKE_DETAILS_VALUE: intakeDetails,
    SELLER_CENTRAL_FINAL_EXPECTED_TEXTS: JSON.stringify([
      "chat now",
      "type your message",
      "contact associates",
      "provide additional details about your issue",
    ]),
    SELLER_CENTRAL_FINAL_EXPECTED_TIMEOUT_MS: String(process.env.SELLER_CENTRAL_FINAL_EXPECTED_TIMEOUT_MS || "25000"),
    SELLER_CENTRAL_CHAT_OBSERVE_TIMEOUT_MS: String(process.env.SELLER_CENTRAL_CHAT_OBSERVE_TIMEOUT_MS || "20000"),
    SELLER_CENTRAL_STEP_WAIT_MS: String(process.env.SELLER_CENTRAL_STEP_WAIT_MS || "5000"),
  };

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [probeScriptPath], {
      cwd: process.cwd(),
      env: probeEnv,
      timeout: Number(process.env.SELLER_CENTRAL_EXEC_TIMEOUT_MS || 180000),
      maxBuffer: 10 * 1024 * 1024,
    });

    const probeResult = JSON.parse(String(stdout || "{}"));
    const popupUrl =
      probeResult.finalUrl ||
      probeResult.chatUi?.pageUrl ||
      probeResult.chatSurface?.openSurface?.pageUrl ||
      null;
    const { caseId, contactRequestId } = extractQueryParams(popupUrl);
    const chatState = probeResult.chatUi?.opened
      ? probeResult.chatUi
      : probeResult.chatSurface?.openSurface || { opened: false };
    const composerDetected = Array.isArray(chatState.inputs) && chatState.inputs.length > 0;
    const transcriptSnapshot = buildTranscriptSnapshot(chatState);
    const visibleInitialMessage = /me sent at|hello,|margin analytics has joined the chat/i.test(transcriptSnapshot || "");
    const supportHeader = /chat with amazon support/i.test(transcriptSnapshot || "") ? "Chat with Amazon Support" : null;
    const chatOpened = Boolean(chatState.opened && popupUrl);
    const authoritativeProof = Boolean(chatOpened && composerDetected && caseId && (visibleInitialMessage || supportHeader));

    return {
      downstream_submission_attempted: Boolean(chatOpened || probeResult.chatTransition),
      downstream_submission_confirmed: authoritativeProof,
      pre_submit_path_completed: true,
      external_case_id: caseId,
      case_id: caseId,
      contact_request_id: contactRequestId,
      submission_channel: "seller_central_chat",
      status: authoritativeProof ? "submission_confirmed" : "failed",
      raw_response_or_trace: {
        popup_url: popupUrl,
        case_id: caseId,
        contactRequestId,
        support_header: supportHeader,
        transcript_snapshot: transcriptSnapshot,
        screenshot: probeResult.screenshotPath || null,
        chat_surface: chatOpened,
        composer_detected: composerDetected,
        attachment_count: Array.isArray(payload.attachments) ? payload.attachments.length : 0,
        probe_result: {
          finalUrl: probeResult.finalUrl || null,
          activePageContext: probeResult.activePageContext || null,
          chatTransition: probeResult.chatTransition || null,
        },
        stderr: String(stderr || "").trim() || null,
      },
      failure_reason: authoritativeProof
        ? null
        : "Seller Central chat popup did not return authoritative case proof.",
      submission_id: payload.submission_id || caseId || null,
    };
  } catch (error) {
    return {
      downstream_submission_attempted: false,
      downstream_submission_confirmed: false,
      pre_submit_path_completed: false,
      external_case_id: null,
      status: "failed",
      raw_response_or_trace: {
        errorName: error.name,
        stack: error.stack,
      },
      failure_reason: error.message || "Seller Central browser automation failed.",
      submission_id: payload.submission_id,
    };
  }
}

run()
  .then((result) => {
    process.stdout.write(JSON.stringify(result));
  })
  .catch((error) => {
    process.stdout.write(
      JSON.stringify({
        downstream_submission_attempted: false,
        downstream_submission_confirmed: false,
        pre_submit_path_completed: false,
        external_case_id: null,
        status: "failed",
        raw_response_or_trace: {
          errorName: error.name,
          stack: error.stack,
        },
        failure_reason: error.message || "Seller Central browser automation failed before execution.",
        submission_id: null,
      }),
    );
    process.exitCode = 1;
  });
