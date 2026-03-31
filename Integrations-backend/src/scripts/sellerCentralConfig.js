"use strict";

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

function truthy(value) {
  return String(value || "").trim().toLowerCase() === "true" || String(value || "").trim() === "1";
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_err) {
    return null;
  }
}

function parseList(value) {
  if (!value) return [];
  const parsedJson = parseJson(value);
  if (Array.isArray(parsedJson)) {
    return parsedJson.filter(Boolean).map((entry) => String(entry).trim()).filter(Boolean);
  }
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function loadSelectorMap(env = process.env) {
  const fromMap = parseJson(env.SELLER_CENTRAL_SELECTOR_MAP) || {};
  const continueButtons =
    Array.isArray(fromMap.continueButtons) && fromMap.continueButtons.length > 0
      ? fromMap.continueButtons
      : parseList(env.SELLER_CENTRAL_CONTINUE_SELECTORS);

  return {
    subject: fromMap.subject || env.SELLER_CENTRAL_SUBJECT_SELECTOR || "",
    body: fromMap.body || env.SELLER_CENTRAL_BODY_SELECTOR || "",
    attachmentInput: fromMap.attachmentInput || env.SELLER_CENTRAL_ATTACHMENT_SELECTOR || "",
    continueButtons,
    submit: fromMap.submit || env.SELLER_CENTRAL_SUBMIT_SELECTOR || "",
    confirmation: fromMap.confirmation || env.SELLER_CENTRAL_CONFIRMATION_SELECTOR || "",
    externalCaseId: fromMap.externalCaseId || env.SELLER_CENTRAL_CASE_ID_SELECTOR || "",
    authCheck: fromMap.authCheck || env.SELLER_CENTRAL_AUTH_CHECK_SELECTOR || "",
    orderId: fromMap.orderId || env.SELLER_CENTRAL_ORDER_ID_SELECTOR || "",
    shipmentId: fromMap.shipmentId || env.SELLER_CENTRAL_SHIPMENT_ID_SELECTOR || "",
    asin: fromMap.asin || env.SELLER_CENTRAL_ASIN_SELECTOR || "",
    sku: fromMap.sku || env.SELLER_CENTRAL_SKU_SELECTOR || "",
    quantity: fromMap.quantity || env.SELLER_CENTRAL_QUANTITY_SELECTOR || "",
    amountClaimed: fromMap.amountClaimed || env.SELLER_CENTRAL_AMOUNT_SELECTOR || "",
    claimType: fromMap.claimType || env.SELLER_CENTRAL_CLAIM_TYPE_SELECTOR || "",
  };
}

function getSellerCentralReadiness(env = process.env) {
  const missing = [];
  const warnings = [];
  const selectorMap = loadSelectorMap(env);

  const sessionPath = String(env.SELLER_CENTRAL_SESSION_PATH || "").trim();
  const cookiesJson = String(env.SELLER_CENTRAL_COOKIES_JSON || "").trim();
  const caseUrl = String(env.SELLER_CENTRAL_CASE_URL || "").trim();
  const dryRunEnabled = truthy(env.SELLER_CENTRAL_DRY_RUN_PRE_SUBMIT);

  let sessionSourcePresent = false;
  let sessionSourceType = null;

  if (sessionPath) {
    if (fs.existsSync(sessionPath)) {
      sessionSourcePresent = true;
      sessionSourceType = "session_path";
    } else {
      missing.push("SELLER_CENTRAL_SESSION_PATH (file not found)");
    }
  } else if (cookiesJson) {
    const parsedCookies = parseJson(cookiesJson);
    if (parsedCookies) {
      sessionSourcePresent = true;
      sessionSourceType = "cookies_json";
    } else {
      missing.push("SELLER_CENTRAL_COOKIES_JSON (invalid JSON)");
    }
  } else {
    missing.push("SELLER_CENTRAL_SESSION_PATH or SELLER_CENTRAL_COOKIES_JSON");
  }

  if (sessionPath && cookiesJson) {
    warnings.push("Both SELLER_CENTRAL_SESSION_PATH and SELLER_CENTRAL_COOKIES_JSON are set; session path will take precedence.");
  }

  if (!caseUrl) {
    missing.push("SELLER_CENTRAL_CASE_URL");
  }

  if (dryRunEnabled) {
    warnings.push("SELLER_CENTRAL_DRY_RUN_PRE_SUBMIT=true is enabled; submissions will stop before the final click.");
  }

  return {
    ready: missing.length === 0,
    missing,
    warnings,
    sessionSourcePresent,
    sessionSourceType,
    caseUrlPresent: Boolean(caseUrl),
    selectorConfigPresent: true,
    dryRunEnabled,
    selectorMap,
  };
}

module.exports = {
  truthy,
  loadSelectorMap,
  getSellerCentralReadiness,
};
