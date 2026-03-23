"use strict";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function truthy(value) {
  return String(value || "").trim().toLowerCase() === "true" || String(value || "").trim() === "1";
}

function envSelectorMap() {
  if (process.env.SELLER_CENTRAL_SELECTOR_MAP) {
    try {
      return JSON.parse(process.env.SELLER_CENTRAL_SELECTOR_MAP);
    } catch (_err) {
      // Fall through to individual env vars.
    }
  }

  return {
    subject: process.env.SELLER_CENTRAL_SUBJECT_SELECTOR,
    body: process.env.SELLER_CENTRAL_BODY_SELECTOR,
    attachmentInput: process.env.SELLER_CENTRAL_ATTACHMENT_SELECTOR,
    submit: process.env.SELLER_CENTRAL_SUBMIT_SELECTOR,
    confirmation: process.env.SELLER_CENTRAL_CONFIRMATION_SELECTOR,
    externalCaseId: process.env.SELLER_CENTRAL_CASE_ID_SELECTOR,
    authCheck: process.env.SELLER_CENTRAL_AUTH_CHECK_SELECTOR,
    orderId: process.env.SELLER_CENTRAL_ORDER_ID_SELECTOR,
    shipmentId: process.env.SELLER_CENTRAL_SHIPMENT_ID_SELECTOR,
    asin: process.env.SELLER_CENTRAL_ASIN_SELECTOR,
    sku: process.env.SELLER_CENTRAL_SKU_SELECTOR,
    quantity: process.env.SELLER_CENTRAL_QUANTITY_SELECTOR,
    amountClaimed: process.env.SELLER_CENTRAL_AMOUNT_SELECTOR,
    claimType: process.env.SELLER_CENTRAL_CLAIM_TYPE_SELECTOR,
  };
}

function validateConfig(payload, selectors) {
  if (!process.env.SELLER_CENTRAL_CASE_URL) {
    return "SELLER_CENTRAL_CASE_URL is not configured.";
  }
  if (!(process.env.SELLER_CENTRAL_SESSION_PATH || process.env.SELLER_CENTRAL_COOKIES_JSON)) {
    return "Seller Central session is unavailable.";
  }
  const requiredSelectors = ["subject", "body", "attachmentInput", "submit"];
  for (const key of requiredSelectors) {
    if (!selectors[key]) {
      return `Missing Seller Central selector config for ${key}.`;
    }
  }
  if (!payload.attachments || payload.attachments.length === 0) {
    return "No attachment files were provided to the browser adapter.";
  }
  return null;
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
    await page.setCookie(...cookies);
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

async function run() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Missing input payload path.");
  }

  const payload = readJsonFile(inputPath);
  const selectors = envSelectorMap();
  const configError = validateConfig(payload, selectors);
  if (configError) {
    return {
      downstream_submission_attempted: false,
      downstream_submission_confirmed: false,
      external_case_id: null,
      status: "failed",
      raw_response_or_trace: { configError },
      failure_reason: configError,
      submission_id: payload.submission_id,
    };
  }

  const browser = await puppeteer.launch({
    headless: !truthy(process.env.SELLER_CENTRAL_HEADFUL),
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let submissionAttempted = false;

  try {
    const page = await browser.newPage();
    await applySession(page);
    await page.goto(process.env.SELLER_CENTRAL_CASE_URL, {
      waitUntil: "networkidle2",
      timeout: Number(process.env.SELLER_CENTRAL_NAVIGATION_TIMEOUT_MS || 60000),
    });

    if (selectors.authCheck) {
      const authHandle = await page.$(selectors.authCheck);
      if (!authHandle) {
        return {
          downstream_submission_attempted: false,
          downstream_submission_confirmed: false,
          external_case_id: null,
          status: "failed",
          raw_response_or_trace: {
            url: page.url(),
            title: await page.title(),
            screenshot: await maybeScreenshot(page, "auth-failed"),
          },
          failure_reason: "Authenticated Seller Central session was not detected.",
          submission_id: payload.submission_id,
        };
      }
    }

    await fillField(page, selectors.subject, payload.subject);
    await fillField(page, selectors.body, payload.body);
    await fillField(page, selectors.orderId, payload.order_id);
    await fillField(page, selectors.shipmentId, payload.shipment_id);
    await fillField(page, selectors.asin, payload.asin);
    await fillField(page, selectors.sku, payload.sku);
    await fillField(page, selectors.quantity, payload.quantity);
    await fillField(page, selectors.amountClaimed, payload.amount_claimed);
    await fillField(page, selectors.claimType, payload.claim_type);

    const uploadHandle = await page.waitForSelector(selectors.attachmentInput, { timeout: 15000 });
    const attachmentPaths = payload.attachments.map((attachment) => attachment.path);
    await uploadHandle.uploadFile(...attachmentPaths);
    const uploadedCount = await page.$eval(selectors.attachmentInput, (element) => {
      if (!("files" in element) || !element.files) return 0;
      return element.files.length;
    });

    if (uploadedCount !== payload.attachments.length) {
      return {
        downstream_submission_attempted: false,
        downstream_submission_confirmed: false,
        external_case_id: null,
        status: "failed",
        raw_response_or_trace: {
          url: page.url(),
          title: await page.title(),
          uploadedCount,
          expectedCount: payload.attachments.length,
          screenshot: await maybeScreenshot(page, "upload-mismatch"),
        },
        failure_reason: "Seller Central did not retain all uploaded attachments before submit.",
        submission_id: payload.submission_id,
      };
    }

    await page.waitForSelector(selectors.submit, { timeout: 15000 });
    await page.click(selectors.submit);
    submissionAttempted = true;

    let confirmationText = null;
    let externalCaseId = null;
    let confirmed = false;

    if (selectors.confirmation) {
      try {
        await page.waitForSelector(selectors.confirmation, {
          timeout: Number(process.env.SELLER_CENTRAL_CONFIRM_TIMEOUT_MS || 30000),
        });
        confirmationText = await extractText(page, selectors.confirmation);
        confirmed = true;
      } catch (_err) {
        confirmed = false;
      }
    }

    if (selectors.externalCaseId) {
      externalCaseId = await extractText(page, selectors.externalCaseId);
      if (externalCaseId) {
        confirmed = true;
      }
    }

    return {
      downstream_submission_attempted: submissionAttempted,
      downstream_submission_confirmed: confirmed,
      external_case_id: externalCaseId,
      status: confirmed ? "submission_confirmed" : "submission_attempted",
      raw_response_or_trace: {
        url: page.url(),
        title: await page.title(),
        confirmationText,
        attachmentCount: uploadedCount,
        screenshot: await maybeScreenshot(page, confirmed ? "confirmed" : "attempted"),
      },
      failure_reason: confirmed ? null : "Seller Central submit was attempted but no visible confirmation was captured.",
      submission_id: payload.submission_id,
    };
  } catch (error) {
    return {
      downstream_submission_attempted: submissionAttempted,
      downstream_submission_confirmed: false,
      external_case_id: null,
      status: submissionAttempted ? "submission_attempted" : "failed",
      raw_response_or_trace: {
        errorName: error.name,
        stack: error.stack,
      },
      failure_reason: error.message || "Seller Central browser automation failed.",
      submission_id: payload.submission_id,
    };
  } finally {
    await browser.close();
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
