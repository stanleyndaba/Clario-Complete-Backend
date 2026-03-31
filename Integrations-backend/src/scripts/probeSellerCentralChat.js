"use strict";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { truthy } = require("./sellerCentralConfig");

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

async function applyCookies(page) {
  if (!process.env.SELLER_CENTRAL_COOKIES_JSON) {
    throw new Error("SELLER_CENTRAL_COOKIES_JSON is required");
  }

  const parsed = JSON.parse(process.env.SELLER_CENTRAL_COOKIES_JSON);
  const cookies = (Array.isArray(parsed) ? parsed : parsed.cookies || [])
    .map((cookie) => normalizeCookie(cookie))
    .filter(Boolean);

  if (cookies.length === 0) {
    throw new Error("No usable cookies were parsed from SELLER_CENTRAL_COOKIES_JSON");
  }

  await page.setCookie(...cookies);
  return cookies.length;
}

async function collectFrameSnapshot(frame) {
  try {
    return await frame.evaluate(() => {
      const seen = new Set();
      const results = [];

      function pushRecord(node, extra = {}) {
        if (!node || results.length >= 140) return;
        const text = String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
        if (!text || text.length < 2) return;
        const key = `${node.tagName}:${text}`;
        if (seen.has(key)) return;
        seen.add(key);
        results.push({
          tag: String(node.tagName || "").toLowerCase(),
          text: text.slice(0, 200),
          id: node.id || null,
          role: node.getAttribute?.("role") || null,
          name: node.getAttribute?.("name") || null,
          ariaLabel: node.getAttribute?.("aria-label") || null,
          type: node.getAttribute?.("type") || null,
          href: node.getAttribute?.("href") || null,
          ...extra,
        });
      }

      function visitRoot(root) {
        if (!root || results.length >= 140) return;

        const selector = [
          "button",
          "a",
          "input",
          "textarea",
          "[role='button']",
          "[role='link']",
          "[role='radio']",
          "[role='textbox']",
          "[contenteditable='true']",
          "label",
          "h1",
          "h2",
          "h3",
          "span",
          "div",
        ].join(",");

        const nodes = root.querySelectorAll(selector);
        for (const node of nodes) {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            rect.width === 0 ||
            rect.height === 0
          ) {
            continue;
          }

          pushRecord(node);

          if (node.shadowRoot) {
            visitRoot(node.shadowRoot);
          }

          if (results.length >= 140) {
            break;
          }
        }
      }

      visitRoot(document);
      const fullText = String(document.body?.innerText || "").replace(/\s+/g, " ").trim();
      const keywordHits = [
        "Create new issue",
        "Inventory lost in FBA warehouse",
        "Enter FNSKU",
        "Enter Reference ID",
        "Order ID",
        "Contact associate",
        "Contact an associate",
        "Chat now",
        "Continue",
        "Upload files",
        "Investigate an Item Lost in Warehouse",
      ].map((needle) => ({
        needle,
        found: fullText.toLowerCase().includes(needle.toLowerCase()),
      }));

      return {
        title: document.title || null,
        url: window.location.href,
        bodySample: fullText.slice(0, 4000),
        keywordHits,
        elements: results,
      };
    });
  } catch (error) {
    return {
      error: error.message || String(error),
      url: frame.url(),
    };
  }
}

async function findClickableByText(frame, targetText) {
  const handle = await frame.evaluateHandle((desiredText) => {
    const STOP_WORDS = new Set(["a", "an", "the"]);
    const normalizeText = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const normalizeComparable = (value) =>
      normalizeText(value)
        .split(" ")
        .filter((token) => token && !STOP_WORDS.has(token))
        .join(" ");

    const normalizedNeedle = normalizeText(desiredText);
    const comparableNeedle = normalizeComparable(desiredText);
    if (!normalizedNeedle) {
      return null;
    }

    function isInteractive(node) {
      if (!node || !node.tagName) return false;
      const tag = String(node.tagName || "").toLowerCase();
      if (["button", "a", "kat-button"].includes(tag)) return true;
      if (tag === "input") {
        const type = String(node.getAttribute("type") || "").toLowerCase();
        if (["button", "submit", "radio", "checkbox"].includes(type)) return true;
      }
      const role = String(node.getAttribute?.("role") || "").toLowerCase();
      if (["button", "link", "radio", "tab"].includes(role)) return true;
      if (node.hasAttribute?.("onclick")) return true;
      if (typeof node.tabIndex === "number" && node.tabIndex >= 0) return true;
      const className = String(node.className || "").toLowerCase();
      if (/(^|\\s)(button|btn|option|select)(\\s|$)/.test(className)) return true;
      try {
        const style = window.getComputedStyle(node);
        if (style.cursor === "pointer") return true;
      } catch (_error) {
        // ignore style lookup failures
      }
      return false;
    }

    function findInteractiveDescendant(node) {
      if (!node || !node.querySelectorAll) return null;
      const descendants = node.querySelectorAll([
        "button",
        "a",
        "kat-button",
        "[role='button']",
        "[role='link']",
        "[role='radio']",
        "[role='tab']",
        "input[type='button']",
        "input[type='submit']",
        "label",
      ].join(","));
      for (const descendant of descendants) {
        if (isInteractive(descendant)) {
          return descendant;
        }
      }
      return null;
    }

    function promoteToInteractive(node) {
      let current = node;
      while (current && current !== document.body) {
        if (isInteractive(current)) {
          return current;
        }
        current = current.parentElement || current.parentNode?.host || null;
      }
      return findInteractiveDescendant(node);
    }

    function scoreNode(node, text) {
      const tag = String(node.tagName || "").toLowerCase();
      let score = 0;
      if (tag === "button") score += 100;
      if (tag === "a") score += 90;
      if (tag === "input") {
        const type = String(node.getAttribute("type") || "").toLowerCase();
        if (["button", "submit", "radio", "checkbox"].includes(type)) {
          score += 80;
        }
      }
      const role = String(node.getAttribute?.("role") || "").toLowerCase();
      if (["button", "link", "radio", "tab"].includes(role)) score += 70;
      if (node.hasAttribute?.("onclick")) score += 25;
      if (node.tabIndex >= 0) score += 10;
      if (text === normalizedNeedle) score += 15;
      score -= Math.min(text.length, 300) / 10;
      return score;
    }

    function searchRoot(root) {
      if (!root) return null;
      const interactiveSelector = [
        "button",
        "a",
        "kat-button",
        "[role='button']",
        "[role='link']",
        "[role='radio']",
        "input[type='button']",
        "input[type='submit']",
        "label",
      ].join(",");
      const wrapperSelector = [
        "div",
        "span",
      ].join(",");
      function searchNestedShadowRoots() {
        const allNodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
        for (const node of allNodes) {
          if (node.shadowRoot) {
            const nested = searchRoot(node.shadowRoot);
            if (nested) {
              return nested;
            }
          }
        }
        return null;
      }

      function findBest(nodes) {
        let bestNode = null;
        let bestScore = -1;
        for (const node of nodes) {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            rect.width === 0 ||
            rect.height === 0
          ) {
            continue;
          }

          const text = normalizeText(node.innerText || node.textContent || "");
          const comparableText = normalizeComparable(text);
          const matches =
            text &&
            (
              text === normalizedNeedle ||
              text.includes(normalizedNeedle) ||
              (comparableNeedle && comparableText === comparableNeedle) ||
              (comparableNeedle && comparableText.includes(comparableNeedle))
            );
          if (matches) {
            const clickable = promoteToInteractive(node);
            if (!clickable || !isInteractive(clickable)) {
              continue;
            }
            const clickableText = normalizeText(clickable.innerText || clickable.textContent || text);
            const score = scoreNode(clickable, clickableText);
            if (score > bestScore) {
              bestScore = score;
              bestNode = clickable;
            }
          }
        }
        return bestNode;
      }

      const interactiveMatch = findBest(root.querySelectorAll(interactiveSelector));
      if (interactiveMatch) {
        return interactiveMatch;
      }
      const interactiveShadowMatch = searchNestedShadowRoots();
      if (interactiveShadowMatch) {
        return interactiveShadowMatch;
      }

      const wrapperNodes = root.querySelectorAll(wrapperSelector);
      let bestNode = null;
      let bestScore = -1;
      for (const node of wrapperNodes) {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.width === 0 ||
          rect.height === 0
        ) {
          continue;
        }

        const text = normalizeText(node.innerText || node.textContent || "");
        const comparableText = normalizeComparable(text);
        const matches =
          text &&
          (
            text === normalizedNeedle ||
            text.includes(normalizedNeedle) ||
            (comparableNeedle && comparableText === comparableNeedle) ||
            (comparableNeedle && comparableText.includes(comparableNeedle))
          );
        if (matches) {
          const clickable = promoteToInteractive(node) || node;
          const clickableText = normalizeText(clickable.innerText || clickable.textContent || text);
          const score = scoreNode(clickable, clickableText);
          if (score > bestScore) {
            bestScore = score;
            bestNode = clickable;
          }
        }
      }
      if (bestNode) {
        return bestNode;
      }
      return searchNestedShadowRoots();
    }

    return searchRoot(document);
  }, targetText);

  return handle.asElement();
}

async function collectTextCandidates(frame, targetText) {
  try {
    return await frame.evaluate((desiredText) => {
      const STOP_WORDS = new Set(["a", "an", "the"]);
      const normalizeText = (value) =>
        String(value || "")
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      const normalizeComparable = (value) =>
        normalizeText(value)
          .split(" ")
          .filter((token) => token && !STOP_WORDS.has(token))
          .join(" ");

      const normalizedNeedle = normalizeText(desiredText);
      const comparableNeedle = normalizeComparable(desiredText);
      const results = [];
      const seen = new Set();

      function isVisible(node) {
        if (!node || !node.getBoundingClientRect) return false;
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        try {
          const style = window.getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden";
        } catch (_error) {
          return true;
        }
      }

      function isInteractive(node) {
        if (!node || !node.tagName) return false;
        const tag = String(node.tagName || "").toLowerCase();
        if (["button", "a", "kat-button"].includes(tag)) return true;
        if (tag === "input") {
          const type = String(node.getAttribute("type") || "").toLowerCase();
          if (["button", "submit", "radio", "checkbox"].includes(type)) return true;
        }
        const role = String(node.getAttribute?.("role") || "").toLowerCase();
        if (["button", "link", "radio", "tab"].includes(role)) return true;
        if (node.hasAttribute?.("onclick")) return true;
        if (typeof node.tabIndex === "number" && node.tabIndex >= 0) return true;
        try {
          return window.getComputedStyle(node).cursor === "pointer";
        } catch (_error) {
          return false;
        }
      }

      function nextParent(node) {
        return node?.parentElement || node?.parentNode?.host || null;
      }

      function describeNode(node) {
        if (!node) return null;
        const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
        let cursor = null;
        try {
          cursor = window.getComputedStyle(node).cursor || null;
        } catch (_error) {
          cursor = null;
        }
        return {
          tag: String(node.tagName || "").toLowerCase(),
          id: node.id || null,
          role: node.getAttribute?.("role") || null,
          ariaLabel: node.getAttribute?.("aria-label") || null,
          name: node.getAttribute?.("name") || null,
          type: node.getAttribute?.("type") || null,
          className: String(node.className || "").slice(0, 200) || null,
          text: String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240),
          interactive: isInteractive(node),
          tabIndex: typeof node.tabIndex === "number" ? node.tabIndex : null,
          cursor,
          rect: rect
            ? {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              }
            : null,
          shadowHostTag: node.getRootNode?.() instanceof ShadowRoot
            ? String(node.getRootNode().host?.tagName || "").toLowerCase() || null
            : null,
        };
      }

      function pushCandidate(node) {
        if (!node || !isVisible(node)) return;
        const text = String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
        if (!text) return;
        const normalized = normalizeText(text);
        const comparable = normalizeComparable(text);
        const matches =
          normalized &&
          (
            normalized === normalizedNeedle ||
            normalized.includes(normalizedNeedle) ||
            (comparableNeedle && comparable === comparableNeedle) ||
            (comparableNeedle && comparable.includes(comparableNeedle))
          );
        if (!matches) return;

        const descriptor = describeNode(node);
        const key = JSON.stringify(descriptor);
        if (seen.has(key)) return;
        seen.add(key);

        const ancestors = [];
        let current = nextParent(node);
        while (current && ancestors.length < 6) {
          ancestors.push(describeNode(current));
          current = nextParent(current);
        }

        let clickableAncestor = null;
        current = node;
        while (current) {
          if (isInteractive(current)) {
            clickableAncestor = describeNode(current);
            break;
          }
          current = nextParent(current);
        }

        results.push({
          node: descriptor,
          clickableAncestor,
          ancestors,
        });
      }

      function walkRoot(root) {
        if (!root) return;
        const nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
        for (const node of nodes) {
          pushCandidate(node);
          if (node.shadowRoot) {
            walkRoot(node.shadowRoot);
          }
        }
      }

      pushCandidate(document.body);
      walkRoot(document);
      return results.slice(0, 20);
    }, targetText);
  } catch (error) {
    return [{ error: error.message || String(error) }];
  }
}

async function describeElementHandle(element) {
  if (!element) return null;
  try {
    const description = await element.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      let cursor = null;
      try {
        cursor = window.getComputedStyle(node).cursor || null;
      } catch (_error) {
        cursor = null;
      }

      return {
        tag: String(node.tagName || "").toLowerCase(),
        id: node.id || null,
        role: node.getAttribute?.("role") || null,
        ariaLabel: node.getAttribute?.("aria-label") || null,
        name: node.getAttribute?.("name") || null,
        type: node.getAttribute?.("type") || null,
        className: String(node.className || "").slice(0, 200) || null,
        text: String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240),
        tabIndex: typeof node.tabIndex === "number" ? node.tabIndex : null,
        cursor,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        shadowHostTag: node.getRootNode?.() instanceof ShadowRoot
          ? String(node.getRootNode().host?.tagName || "").toLowerCase() || null
          : null,
      };
    });
    const box = await element.boundingBox();
    return {
      ...description,
      box: box
        ? {
            x: Math.round(box.x),
            y: Math.round(box.y),
            width: Math.round(box.width),
            height: Math.round(box.height),
          }
        : null,
    };
  } catch (error) {
    return {
      error: error.message || String(error),
    };
  }
}

async function findNearestClickableAncestor(element) {
  if (!element) return null;
  const handle = await element.evaluateHandle((node) => {
    function isInteractive(candidate) {
      if (!candidate || !candidate.tagName) return false;
      const tag = String(candidate.tagName || "").toLowerCase();
      if (["button", "a", "kat-button"].includes(tag)) return true;
      if (tag === "input") {
        const type = String(candidate.getAttribute("type") || "").toLowerCase();
        if (["button", "submit", "radio", "checkbox"].includes(type)) return true;
      }
      const role = String(candidate.getAttribute?.("role") || "").toLowerCase();
      if (["button", "link", "radio", "tab"].includes(role)) return true;
      if (candidate.hasAttribute?.("onclick")) return true;
      if (typeof candidate.tabIndex === "number" && candidate.tabIndex >= 0) return true;
      try {
        return window.getComputedStyle(candidate).cursor === "pointer";
      } catch (_error) {
        return false;
      }
    }

    let current = node;
    while (current) {
      if (isInteractive(current)) {
        return current;
      }
      current = current.parentElement || current.parentNode?.host || null;
    }
    return node;
  });

  return handle.asElement();
}

async function clickElementWithStrategies(page, element) {
  const strategies = [];
  const ancestor = await findNearestClickableAncestor(element);
  const targets = [];
  if (element) {
    targets.push({ label: "matched-node", handle: element });
  }
  if (ancestor && ancestor !== element) {
    targets.push({ label: "clickable-ancestor", handle: ancestor });
  }

  for (const target of targets) {
    const details = await describeElementHandle(target.handle);

    try {
      await target.handle.evaluate((node) => node.scrollIntoView({ behavior: "instant", block: "center", inline: "center" }));
    } catch (_error) {
      // Ignore scroll failures and continue trying click strategies.
    }

    try {
      await target.handle.click({ delay: 50 });
      strategies.push({ strategy: `${target.label}:direct-click`, attempted: true, succeeded: true, target: details });
      return { clicked: true, strategies, clickedElement: details };
    } catch (error) {
      strategies.push({
        strategy: `${target.label}:direct-click`,
        attempted: true,
        succeeded: false,
        target: details,
        error: error.message || String(error),
      });
    }

    const box = await target.handle.boundingBox();
    if (box && box.width > 0 && box.height > 0) {
      const centerX = box.x + (box.width / 2);
      const centerY = box.y + (box.height / 2);

      try {
        await page.mouse.click(centerX, centerY, { delay: 50 });
        strategies.push({
          strategy: `${target.label}:box-center-click`,
          attempted: true,
          succeeded: true,
          target: details,
          box: {
            x: Math.round(box.x),
            y: Math.round(box.y),
            width: Math.round(box.width),
            height: Math.round(box.height),
          },
        });
        return { clicked: true, strategies, clickedElement: details };
      } catch (error) {
        strategies.push({
          strategy: `${target.label}:box-center-click`,
          attempted: true,
          succeeded: false,
          target: details,
          box: {
            x: Math.round(box.x),
            y: Math.round(box.y),
            width: Math.round(box.width),
            height: Math.round(box.height),
          },
          error: error.message || String(error),
        });
      }

      try {
        await page.mouse.move(centerX, centerY);
        await page.mouse.down();
        await new Promise((resolve) => setTimeout(resolve, 40));
        await page.mouse.up();
        strategies.push({
          strategy: `${target.label}:mouse-sequence`,
          attempted: true,
          succeeded: true,
          target: details,
          box: {
            x: Math.round(box.x),
            y: Math.round(box.y),
            width: Math.round(box.width),
            height: Math.round(box.height),
          },
        });
        return { clicked: true, strategies, clickedElement: details };
      } catch (error) {
        strategies.push({
          strategy: `${target.label}:mouse-sequence`,
          attempted: true,
          succeeded: false,
          target: details,
          box: {
            x: Math.round(box.x),
            y: Math.round(box.y),
            width: Math.round(box.width),
            height: Math.round(box.height),
          },
          error: error.message || String(error),
        });
      }
    }

    try {
      await target.handle.evaluate((node) => {
        const eventOptions = { bubbles: true, cancelable: true, composed: true };
        node.dispatchEvent(new MouseEvent("mousemove", eventOptions));
        node.dispatchEvent(new MouseEvent("mousedown", eventOptions));
        node.dispatchEvent(new MouseEvent("mouseup", eventOptions));
        node.dispatchEvent(new MouseEvent("click", eventOptions));
      });
      strategies.push({ strategy: `${target.label}:dispatch-mouse-events`, attempted: true, succeeded: true, target: details });
      return { clicked: true, strategies, clickedElement: details };
    } catch (error) {
      strategies.push({
        strategy: `${target.label}:dispatch-mouse-events`,
        attempted: true,
        succeeded: false,
        target: details,
        error: error.message || String(error),
      });
    }
  }

  return {
    clicked: false,
    strategies,
    clickedElement: null,
  };
}

async function findElementAcrossFrames(page, targetText) {
  const preferredFrame = await findBestContentFrame(page, [targetText]);
  const orderedFrames = [];
  const seen = new Set();
  if (preferredFrame) {
    orderedFrames.push(preferredFrame);
    seen.add(preferredFrame);
  }
  for (const frame of page.frames()) {
    if (!seen.has(frame)) {
      orderedFrames.push(frame);
      seen.add(frame);
    }
  }

  const frameDiagnostics = [];
  for (const frame of orderedFrames) {
    const candidates = await collectTextCandidates(frame, targetText);
    frameDiagnostics.push({
      url: frame.url(),
      name: frame.name() || null,
      candidates,
    });
    const element = await findClickableByText(frame, targetText);
    if (element) {
      return {
        frame,
        element,
        frameDiagnostics,
      };
    }
  }

  return {
    frame: null,
    element: null,
    frameDiagnostics,
  };
}

async function waitForElementAcrossFrames(page, targetText, timeoutMs = 15000) {
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt < timeoutMs) {
    latest = await findElementAcrossFrames(page, targetText);
    if (latest.element) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return latest || {
    frame: null,
    element: null,
    frameDiagnostics: [],
  };
}

async function inspectChatUi(page) {
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const state = await frame.evaluate(() => {
        const visibleInputs = [];
        const selectors = [
          "textarea",
          "input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='file'])",
          "[contenteditable='true']",
        ];
        for (const selector of selectors) {
          const nodes = document.querySelectorAll(selector);
          for (const node of nodes) {
            const style = window.getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            const disabled = Boolean(node.disabled) || node.getAttribute?.("aria-disabled") === "true";
            const writable =
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              rect.width > 0 &&
              rect.height > 0 &&
              !disabled &&
              !node.readOnly;
            if (writable) {
              visibleInputs.push({
                tag: String(node.tagName || "").toLowerCase(),
                role: node.getAttribute?.("role") || null,
                ariaLabel: node.getAttribute?.("aria-label") || null,
                placeholder: node.getAttribute?.("placeholder") || null,
              });
            }
          }
        }

        const bodyText = String(document.body?.innerText || "").replace(/\s+/g, " ").trim();
        const keywords = [
          "chat",
          "amazon support",
          "support associate",
          "type your message",
          "send",
          "message",
        ].filter((keyword) => bodyText.toLowerCase().includes(keyword));

        return {
          bodyText: bodyText.slice(0, 3000),
          visibleInputs,
          keywords,
          opened: visibleInputs.length > 0 && keywords.length > 0,
        };
      });

      if (state.opened) {
        return {
          opened: true,
          frameUrl: frame.url(),
          frameName: frame.name() || null,
          indicators: state.keywords,
          inputs: state.visibleInputs,
          bodySample: state.bodyText,
        };
      }
    } catch (_error) {
      // Ignore detached or restricted frame errors.
    }
  }

  return {
    opened: false,
  };
}

function pushLimited(list, item, limit = 80) {
  list.push(item);
  if (list.length > limit) {
    list.splice(0, list.length - limit);
  }
}

function createRuntimeRecorder(browser) {
  const events = {
    targets: [],
    popups: [],
    console: [],
    pageErrors: [],
    requests: [],
    responses: [],
    requestFailures: [],
  };
  const trackedPages = new WeakSet();

  function looksRelevantUrl(url) {
    return /(chat|contact|support|hill|meld|amazonconnect|connect|messages?)/i.test(String(url || ""));
  }

  function attachPage(page, label = "page") {
    if (!page || trackedPages.has(page)) {
      return;
    }
    trackedPages.add(page);

    page.on("popup", (popup) => {
      pushLimited(events.popups, {
        sourcePageUrl: page.url(),
        popupUrl: popup.url(),
        label,
      });
      attachPage(popup, "popup");
    });

    page.on("console", (msg) => {
      pushLimited(events.console, {
        pageUrl: page.url(),
        type: msg.type(),
        text: String(msg.text() || "").slice(0, 500),
      });
    });

    page.on("pageerror", (error) => {
      pushLimited(events.pageErrors, {
        pageUrl: page.url(),
        message: String(error?.message || error || "").slice(0, 500),
      });
    });

    page.on("request", (request) => {
      const url = request.url();
      if (!looksRelevantUrl(url) && !["document", "xhr", "fetch", "websocket"].includes(request.resourceType())) {
        return;
      }
      pushLimited(events.requests, {
        pageUrl: page.url(),
        resourceType: request.resourceType(),
        method: request.method(),
        url,
      });
    });

    page.on("response", (response) => {
      const url = response.url();
      if (!looksRelevantUrl(url) && !["document", "xhr", "fetch"].includes(response.request().resourceType())) {
        return;
      }
      pushLimited(events.responses, {
        pageUrl: page.url(),
        resourceType: response.request().resourceType(),
        status: response.status(),
        url,
      });
    });

    page.on("requestfailed", (request) => {
      const url = request.url();
      if (!looksRelevantUrl(url) && !["document", "xhr", "fetch", "websocket"].includes(request.resourceType())) {
        return;
      }
      pushLimited(events.requestFailures, {
        pageUrl: page.url(),
        resourceType: request.resourceType(),
        url,
        errorText: request.failure()?.errorText || null,
      });
    });
  }

  browser.on("targetcreated", (target) => {
    pushLimited(events.targets, {
      event: "created",
      type: target.type(),
      url: target.url(),
    });
    target.page().then((page) => attachPage(page, "targetcreated")).catch(() => {});
  });
  browser.on("targetchanged", (target) => {
    pushLimited(events.targets, {
      event: "changed",
      type: target.type(),
      url: target.url(),
    });
  });
  browser.on("targetdestroyed", (target) => {
    pushLimited(events.targets, {
      event: "destroyed",
      type: target.type(),
      url: target.url(),
    });
  });

  return {
    events,
    attachPage,
  };
}

async function collectPageSurfaceState(page) {
  const frames = page.frames();
  const pageSummary = {
    pageUrl: page.url(),
    title: null,
    frameCount: frames.length,
    frames: [],
  };

  try {
    pageSummary.title = await page.title();
  } catch (_error) {
    pageSummary.title = null;
  }

  for (const frame of frames) {
    try {
      const summary = await frame.evaluate(() => {
        function isVisible(node) {
          if (!node || !node.getBoundingClientRect) return false;
          const rect = node.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          const style = window.getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden";
        }

        function textOf(node) {
          return String(node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240);
        }

        function collect(selector, mapper, max = 10) {
          const items = [];
          const nodes = document.querySelectorAll(selector);
          for (const node of nodes) {
            if (!isVisible(node)) continue;
            items.push(mapper(node));
            if (items.length >= max) break;
          }
          return items;
        }

        const bodyText = String(document.body?.innerText || "").replace(/\s+/g, " ").trim();
        return {
          frameUrl: window.location.href,
          bodySample: bodyText.slice(0, 1500),
          iframes: collect("iframe", (node) => ({
            id: node.id || null,
            name: node.name || null,
            src: node.getAttribute("src") || null,
          }), 12),
          dialogs: collect("dialog,[role='dialog'],[aria-modal='true']", (node) => ({
            tag: String(node.tagName || "").toLowerCase(),
            id: node.id || null,
            role: node.getAttribute?.("role") || null,
            text: textOf(node),
          }), 12),
          ariaLives: collect("[aria-live]", (node) => ({
            tag: String(node.tagName || "").toLowerCase(),
            ariaLive: node.getAttribute("aria-live") || null,
            text: textOf(node),
          }), 12),
          composers: collect(
            "textarea,[contenteditable='true'],input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='file'])",
            (node) => ({
              tag: String(node.tagName || "").toLowerCase(),
              id: node.id || null,
              placeholder: node.getAttribute?.("placeholder") || null,
              ariaLabel: node.getAttribute?.("aria-label") || null,
              writable: !(node.disabled || node.readOnly || node.getAttribute?.("aria-disabled") === "true"),
              text: textOf(node),
            }),
            16,
          ),
          buttons: collect(
            "button,a,[role='button'],input[type='button'],input[type='submit'],kat-button",
            (node) => ({
              tag: String(node.tagName || "").toLowerCase(),
              id: node.id || null,
              role: node.getAttribute?.("role") || null,
              text: textOf(node),
            }),
            24,
          ).filter((item) => /(send|chat|message|start|launch|support)/i.test(item.text || item.id || "")),
          customComponents: collect(
            "kat-box,kat-button,kat-tab,kat-modal,kat-alert,kat-banner,kat-card",
            (node) => ({
              tag: String(node.tagName || "").toLowerCase(),
              id: node.id || null,
              text: textOf(node),
            }),
            24,
          ),
        };
      });

      pageSummary.frames.push({
        name: frame.name() || null,
        url: frame.url(),
        ...summary,
      });
    } catch (error) {
      pageSummary.frames.push({
        name: frame.name() || null,
        url: frame.url(),
        error: error.message || String(error),
      });
    }
  }

  return pageSummary;
}

async function inspectChatUiAcrossPages(browser) {
  const pages = await browser.pages();
  const pageStates = [];

  for (const page of pages) {
    let pageUrl = null;
    try {
      pageUrl = page.url();
    } catch (_error) {
      pageUrl = null;
    }

    const chatState = await inspectChatUi(page);
    pageStates.push({
      pageUrl,
      chatOpened: chatState.opened,
      chatState,
    });

    if (chatState.opened) {
      return {
        opened: true,
        pageCount: pages.length,
        openSurface: {
          pageUrl,
          ...chatState,
        },
        pages: pageStates,
      };
    }
  }

  return {
    opened: false,
    pageCount: pages.length,
    openSurface: null,
    pages: pageStates,
  };
}

async function observeChatTransition(browser, page, clickAction, timeoutMs = 20000) {
  const pagesBefore = await browser.pages();
  const beforeState = await Promise.all(pagesBefore.map((candidate) => collectPageSurfaceState(candidate)));

  await clickAction();

  const startedAt = Date.now();
  let chatSurface = await inspectChatUiAcrossPages(browser);
  while (!chatSurface.opened && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    chatSurface = await inspectChatUiAcrossPages(browser);
  }

  const pagesAfter = await browser.pages();
  const afterState = await Promise.all(pagesAfter.map((candidate) => collectPageSurfaceState(candidate)));

  return {
    pageCountBefore: pagesBefore.length,
    pageCountAfter: pagesAfter.length,
    beforeState,
    afterState,
    chatSurface,
  };
}

async function inspectSupportState(page) {
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const state = await frame.evaluate(() => {
        const bodyText = String(document.body?.innerText || "").replace(/\s+/g, " ").trim();
        const lowered = bodyText.toLowerCase();
        const keywords = [
          "contact associates",
          "additional information",
          "provide additional details about your issue",
          "chat now",
          "contact an associate",
          "type your message",
        ].filter((keyword) => lowered.includes(keyword));

        return {
          frameUrl: window.location.href,
          bodySample: bodyText.slice(0, 2500),
          keywords,
          chatNowVisible: lowered.includes("chat now"),
          contactAssociatesVisible: lowered.includes("contact associates"),
          additionalDetailsVisible: lowered.includes("provide additional details about your issue"),
        };
      });

      if (state.keywords.length > 0) {
        return {
          frameUrl: frame.url(),
          frameName: frame.name() || null,
          ...state,
        };
      }
    } catch (_error) {
      // Ignore detached or restricted frame errors.
    }
  }

  return {
    frameUrl: null,
    frameName: null,
    bodySample: null,
    keywords: [],
    chatNowVisible: false,
    contactAssociatesVisible: false,
    additionalDetailsVisible: false,
  };
}

async function findBestContentFrame(page, expectedNeedles = ["create new issue", "get help and resources"]) {
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const match = await frame.evaluate((needles) => {
        const STOP_WORDS = new Set(["a", "an", "the"]);
        const normalizeText = (value) =>
          String(value || "")
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const normalizeComparable = (value) =>
          normalizeText(value)
            .split(" ")
            .filter((token) => token && !STOP_WORDS.has(token))
            .join(" ");

        const text = normalizeText(document.body?.innerText || "");
        const comparableText = normalizeComparable(text);
        return needles.some((needle) => {
          const normalizedNeedle = normalizeText(needle);
          const comparableNeedle = normalizeComparable(needle);
          return (
            (normalizedNeedle && text.includes(normalizedNeedle)) ||
            (comparableNeedle && comparableText.includes(comparableNeedle))
          );
        });
      }, expectedNeedles);
      if (match) {
        return frame;
      }
    } catch (_error) {
      // Ignore cross-frame or detached-frame failures.
    }
  }

  return null;
}

async function waitForBestContentFrame(page, expectedNeedles, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const frame = await findBestContentFrame(page, expectedNeedles);
    if (frame) {
      return frame;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return page.mainFrame();
}

async function locateFirstVisibleTextField(frame) {
  const handle = await frame.evaluateHandle(() => {
    function searchRoot(root) {
      if (!root) return null;
      const selector = [
        "input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='file'])",
        "textarea",
        "[contenteditable='true']",
      ].join(",");

      const candidates = root.querySelectorAll(selector);
      for (const candidate of candidates) {
        const style = window.getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.width === 0 ||
          rect.height === 0
        ) {
          continue;
        }

        return candidate;
      }

      const shadowHosts = root.querySelectorAll("*");
      for (const host of shadowHosts) {
        if (host.shadowRoot) {
          const nested = searchRoot(host.shadowRoot);
          if (nested) {
            return nested;
          }
        }
      }
      return null;
    }

    return searchRoot(document);
  });

  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    return null;
  }

  return element;
}

async function collectVisibleTextFields(frame) {
  try {
    return await frame.evaluate(() => {
      const results = [];

      function getLabelText(node) {
        const bits = [];
        const directLabel = node.getAttribute?.("aria-label") || node.getAttribute?.("placeholder") || "";
        if (directLabel) bits.push(directLabel);

        let current = node.parentElement;
        let depth = 0;
        while (current && depth < 5) {
          const text = String(current.innerText || current.textContent || "").replace(/\s+/g, " ").trim();
          if (text) {
            bits.push(text);
          }
          current = current.parentElement;
          depth += 1;
        }

        return bits.join(" | ").slice(0, 600);
      }

      function pushCandidate(node) {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.width === 0 ||
          rect.height === 0
        ) {
          return;
        }

        results.push({
          tag: String(node.tagName || "").toLowerCase(),
          id: node.id || null,
          name: node.getAttribute?.("name") || null,
          type: node.getAttribute?.("type") || null,
          role: node.getAttribute?.("role") || null,
          ariaLabel: node.getAttribute?.("aria-label") || null,
          placeholder: node.getAttribute?.("placeholder") || null,
          writable: !(node.disabled || node.readOnly || node.getAttribute?.("aria-disabled") === "true"),
          labelText: getLabelText(node),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        });
      }

      function visitRoot(root) {
        if (!root) return;
        const selector = [
          "input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='file'])",
          "textarea",
          "[contenteditable='true']",
        ].join(",");

        const nodes = root.querySelectorAll(selector);
        for (const node of nodes) {
          pushCandidate(node);
          if (node.shadowRoot) {
            visitRoot(node.shadowRoot);
          }
        }

        const shadowHosts = root.querySelectorAll("*");
        for (const host of shadowHosts) {
          if (host.shadowRoot) {
            visitRoot(host.shadowRoot);
          }
        }
      }

      visitRoot(document);
      return results;
    });
  } catch (error) {
    return [{ error: error.message || String(error) }];
  }
}

async function findFieldByLabel(frame, needles, options = {}) {
  const normalizedNeedles = (needles || [])
    .map((needle) => String(needle || "").trim().toLowerCase())
    .filter(Boolean);
  const preferredTags = (options.preferredTags || []).map((tag) => String(tag || "").toLowerCase());

  const handle = await frame.evaluateHandle((criteria) => {
    const { normalizedNeedles, preferredTags } = criteria;
    const preferredTagSet = new Set(preferredTags || []);

    function isVisible(node) {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = window.getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden";
    }

    function getLabelText(node) {
      const bits = [];
      const direct = node.getAttribute?.("aria-label") || node.getAttribute?.("placeholder") || "";
      if (direct) bits.push(direct);
      let current = node.parentElement;
      let depth = 0;
      while (current && depth < 5) {
        const text = String(current.innerText || current.textContent || "").replace(/\s+/g, " ").trim();
        if (text) bits.push(text);
        current = current.parentElement;
        depth += 1;
      }
      return bits.join(" ").toLowerCase();
    }

    function score(node) {
      if (!isVisible(node)) return -1;
      if (node.disabled || node.readOnly || node.getAttribute?.("aria-disabled") === "true") return -1;
      const tag = String(node.tagName || "").toLowerCase();
      const labelText = getLabelText(node);
      let value = 0;
      for (const needle of normalizedNeedles) {
        if (labelText.includes(needle)) {
          value += 20 + needle.length;
        }
      }
      if (preferredTagSet.has(tag)) {
        value += 30;
      }
      const rect = node.getBoundingClientRect();
      value += Math.min(rect.width, 500) / 50;
      return value;
    }

    function searchRoot(root) {
      if (!root) return null;
      const selector = [
        "input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='file'])",
        "textarea",
        "[contenteditable='true']",
      ].join(",");

      let bestNode = null;
      let bestScore = -1;
      const candidates = root.querySelectorAll(selector);
      for (const candidate of candidates) {
        const candidateScore = score(candidate);
        if (candidateScore > bestScore) {
          bestNode = candidate;
          bestScore = candidateScore;
        }
        if (candidate.shadowRoot) {
          const nested = searchRoot(candidate.shadowRoot);
          if (nested) {
            const nestedScore = score(nested);
            if (nestedScore > bestScore) {
              bestNode = nested;
              bestScore = nestedScore;
            }
          }
        }
      }

      const shadowHosts = root.querySelectorAll("*");
      for (const host of shadowHosts) {
        if (host.shadowRoot) {
          const nested = searchRoot(host.shadowRoot);
          if (nested) {
            const nestedScore = score(nested);
            if (nestedScore > bestScore) {
              bestNode = nested;
              bestScore = nestedScore;
            }
          }
        }
      }

      return bestScore >= 0 ? bestNode : null;
    }

    return searchRoot(document);
  }, { normalizedNeedles, preferredTags });

  return handle.asElement();
}

async function fillTextFieldHandle(page, candidate, value) {
  if (!candidate) {
    return null;
  }

  const valueString = String(value || "");
  await candidate.click({ clickCount: 3, delay: 50 });
  await page.keyboard.press("Backspace");
  await candidate.type(valueString, { delay: 25 });
  await page.keyboard.press("Tab");
  await new Promise((resolve) => setTimeout(resolve, 400));

  const details = await candidate.evaluate((node) => {
    if (!node) return null;
    if ("value" in node) {
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      node.dispatchEvent(new Event("blur", { bubbles: true }));
    } else if (node.isContentEditable) {
      node.dispatchEvent(new InputEvent("input", { bubbles: true, data: node.textContent || "" }));
      node.dispatchEvent(new Event("blur", { bubbles: true }));
    }

    return {
      tag: String(node.tagName || "").toLowerCase(),
      id: node.id || null,
      name: node.getAttribute?.("name") || null,
      type: node.getAttribute?.("type") || null,
      ariaLabel: node.getAttribute?.("aria-label") || null,
      placeholder: node.getAttribute?.("placeholder") || null,
      value: "value" in node ? String(node.value || "") : String(node.textContent || ""),
    };
  });

  return details;
}

async function fillFirstVisibleTextField(page, frame, value) {
  const candidate = await locateFirstVisibleTextField(frame);
  if (!candidate) {
    return null;
  }

  const details = await fillTextFieldHandle(page, candidate, value);
  await candidate.dispose();
  return details;
}

async function main() {
  const targetUrl =
    process.argv[2] ||
    process.env.SELLER_CENTRAL_PROBE_URL ||
    "https://sellercentral.amazon.com/help/hub/support";

  const browser = await puppeteer.launch({
    headless: !truthy(process.env.SELLER_CENTRAL_HEADFUL),
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath: (() => {
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

      return candidates.find((candidate) => fs.existsSync(candidate)) || undefined;
    })(),
  });

  try {
    const page = await browser.newPage();
    const runtime = createRuntimeRecorder(browser);
    runtime.attachPage(page, "root");
    const cookieCount = await applyCookies(page);
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: Number(process.env.SELLER_CENTRAL_NAVIGATION_TIMEOUT_MS || 60000),
    });
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const clickSequence = []
      .concat(
        process.env.SELLER_CENTRAL_CLICK_TEXTS
          ? JSON.parse(process.env.SELLER_CENTRAL_CLICK_TEXTS)
          : [],
      )
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    const postFillClickSequence = []
      .concat(
        process.env.SELLER_CENTRAL_POST_FILL_CLICK_TEXTS
          ? JSON.parse(process.env.SELLER_CENTRAL_POST_FILL_CLICK_TEXTS)
          : [],
      )
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    const stepWaitMs = Number(process.env.SELLER_CENTRAL_STEP_WAIT_MS || 3000);
    const finalExpectedTexts = []
      .concat(
        process.env.SELLER_CENTRAL_FINAL_EXPECTED_TEXTS
          ? JSON.parse(process.env.SELLER_CENTRAL_FINAL_EXPECTED_TEXTS)
          : [],
      )
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    const finalExpectedTimeoutMs = Number(
      process.env.SELLER_CENTRAL_FINAL_EXPECTED_TIMEOUT_MS || 15000,
    );
    const intakeDetailsValue = String(process.env.SELLER_CENTRAL_INTAKE_DETAILS_VALUE || "").trim();

    const steps = [];
    async function executeClicks(sequence, phase) {
      for (const clickTarget of sequence) {
        const located = await waitForElementAcrossFrames(page, clickTarget, Math.max(stepWaitMs * 2, 10000));
        const frame = located.frame || await waitForBestContentFrame(page, ["create new issue", "get help and resources"]);
        const element = located.element;
        if (!element) {
          steps.push({
            clickTarget,
            clicked: false,
            phase,
            url: page.url(),
            title: await page.title(),
            frameDiagnostics: located.frameDiagnostics,
          });
          break;
        }

        const clickResult = await clickElementWithStrategies(page, element);
        await new Promise((resolve) => setTimeout(resolve, stepWaitMs));
        steps.push({
          clickTarget,
          clicked: clickResult.clicked,
          clickedElement: clickResult.clickedElement,
          clickStrategies: clickResult.strategies,
          phase,
          url: page.url(),
          title: await page.title(),
          frameUrl: frame?.url?.() || null,
          frameName: frame?.name?.() || null,
          frameDiagnostics: located.frameDiagnostics,
        });
        if (!clickResult.clicked) {
          break;
        }
      }
    }

    if (clickSequence.length > 0) {
      await executeClicks(clickSequence, "pre_fill");
    }

    let firstTextInput = null;
    if (process.env.SELLER_CENTRAL_FIRST_TEXT_INPUT_VALUE) {
      const frame = await waitForBestContentFrame(page, ["enter fnsku", "enter reference id", "order id", "continue"]);
      firstTextInput = await fillFirstVisibleTextField(
        page,
        frame,
        process.env.SELLER_CENTRAL_FIRST_TEXT_INPUT_VALUE,
      );
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    if (postFillClickSequence.length > 0) {
      await executeClicks(postFillClickSequence, "post_fill");
    }

    let intakeForm = null;
    let intakeDetailsField = null;
    let chatTransition = null;
    if (intakeDetailsValue) {
      const intakeFrame = await waitForBestContentFrame(
        page,
        ["contact associates", "additional information", "provide additional details about your issue"],
        15000,
      );
      intakeForm = {
        frameUrl: intakeFrame.url(),
        frameName: intakeFrame.name() || null,
        fields: await collectVisibleTextFields(intakeFrame),
      };

      const detailsField = await findFieldByLabel(
        intakeFrame,
        ["provide additional details about your issue", "additional details"],
        { preferredTags: ["textarea", "div"] },
      );

      if (detailsField) {
        intakeDetailsField = await fillTextFieldHandle(page, detailsField, intakeDetailsValue);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      await executeClicks(["Continue"], "intake_submit");

      const chatNowLocated = await waitForElementAcrossFrames(page, "Chat now", 12000);
      if (chatNowLocated.element) {
        chatTransition = await observeChatTransition(
          browser,
          page,
          async () => {
            const chatNowClick = await clickElementWithStrategies(page, chatNowLocated.element);
            steps.push({
              clickTarget: "Chat now",
              clicked: chatNowClick.clicked,
              clickedElement: chatNowClick.clickedElement,
              clickStrategies: chatNowClick.strategies,
              phase: "chat_launch",
              url: page.url(),
              title: await page.title(),
              frameUrl: chatNowLocated.frame?.url?.() || null,
              frameName: chatNowLocated.frame?.name?.() || null,
              frameDiagnostics: chatNowLocated.frameDiagnostics,
            });
          },
          Number(process.env.SELLER_CENTRAL_CHAT_OBSERVE_TIMEOUT_MS || 20000),
        );
        steps.push({
          clickTarget: "Chat transition observation",
          clicked: Boolean(chatTransition.chatSurface?.opened),
          phase: "chat_observation",
          url: page.url(),
          title: await page.title(),
          transition: chatTransition,
        });
      }
    }

    if (finalExpectedTexts.length > 0) {
      await waitForBestContentFrame(page, finalExpectedTexts, finalExpectedTimeoutMs);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const chatSurface = await inspectChatUiAcrossPages(browser);

    let resultPage = page;
    if (chatSurface.opened && chatSurface.openSurface?.pageUrl) {
      const browserPages = await browser.pages();
      const matchedPage = browserPages.find((candidate) => candidate.url() === chatSurface.openSurface.pageUrl);
      if (matchedPage) {
        resultPage = matchedPage;
      }
    }

    const chatUi = chatSurface.opened ? chatSurface.openSurface : await inspectChatUi(resultPage);
    const supportState = await inspectSupportState(page);

    const frames = resultPage.frames();
    const snapshots = [];
    for (const frame of frames) {
      snapshots.push({
        url: frame.url(),
        name: frame.name() || null,
        snapshot: await collectFrameSnapshot(frame),
      });
    }

    const resultUrl = resultPage.url();
    const resultTitle = await resultPage.title();
    const loginRedirected = /signin|ap\/signin|login/i.test(resultUrl);
    let screenshotPath = null;
    if (process.env.SELLER_CENTRAL_TRACE_DIR) {
      fs.mkdirSync(process.env.SELLER_CENTRAL_TRACE_DIR, { recursive: true });
      screenshotPath = path.join(process.env.SELLER_CENTRAL_TRACE_DIR, `probe-${Date.now()}.png`);
      await resultPage.screenshot({ path: screenshotPath, fullPage: true });
    }

    process.stdout.write(
      JSON.stringify(
        {
          cookiesLoaded: cookieCount > 0,
          cookieCount,
          authenticated: !loginRedirected,
          finalUrl: resultUrl,
          title: resultTitle,
          loginRedirected,
          chatUi,
          chatSurface,
          chatTransition,
          supportState,
          activePageContext: {
            pageUrl: resultUrl,
            pageCount: (await browser.pages()).length,
          },
          runtimeEvents: runtime.events,
          screenshotPath,
          firstTextInput,
          intakeForm,
          intakeDetailsField,
          steps,
          frames: snapshots,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stdout.write(
    JSON.stringify(
      {
        cookiesLoaded: false,
        authenticated: false,
        finalUrl: null,
        title: null,
        loginRedirected: false,
        error: error.message || String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
