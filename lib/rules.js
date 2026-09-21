// declarativeNetRequest (MV3) session-rule helpers.
//
// Two kinds of session rule are used, and rule ids are partitioned so they never collide:
//
//  - "strip" rule (one per managed domain): removes every Set-Cookie response header for that
//    domain, for ALL tabs. This stops Chrome's real cookie jar from ever being written to for
//    that domain — from then on, the extension's own per-profile jar (in storage) is the only
//    place that domain's session lives.
//
//  - "inject" rule (one per tab that currently holds a profile): sets the Cookie request header
//    for that domain to the active profile's serialized jar, scoped to that one tab via the
//    `tabIds` condition (session-rules-only feature, Chrome 92+).
//
// Session rules do NOT persist across a full browser restart — background.js re-creates the
// "strip" rules on chrome.runtime.onStartup. "inject" rules are recreated on demand when a tab
// is switched to a profile, so nothing needs to happen for them at startup.

const STRIP_BASE = 1;
const INJECT_BASE = 1_000_000;

function hashDomain(domain) {
  let h = 0;
  for (let i = 0; i < domain.length; i++) h = (h * 31 + domain.charCodeAt(i)) >>> 0;
  return STRIP_BASE + (h % (INJECT_BASE - STRIP_BASE - 1));
}

function domainFilter(domain) {
  return `||${domain}^`;
}

const ALL_RESOURCE_TYPES = [
  "main_frame", "sub_frame", "xmlhttprequest", "script",
  "image", "stylesheet", "font", "object", "media", "websocket", "other",
];

export async function ensureStripRule(domain) {
  const id = hashDomain(domain);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [
      {
        id,
        priority: 1,
        action: {
          type: "modifyHeaders",
          responseHeaders: [{ header: "set-cookie", operation: "remove" }],
        },
        condition: {
          urlFilter: domainFilter(domain),
          resourceTypes: ALL_RESOURCE_TYPES,
        },
      },
    ],
  });
}

export async function removeStripRule(domain) {
  const id = hashDomain(domain);
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id], addRules: [] });
}

/** Inject `cookieHeaderValue` as the Cookie header for requests to `domain` from tab `tabId`. */
export async function applyTabCookie(tabId, domain, cookieHeaderValue) {
  const id = INJECT_BASE + tabId;
  const requestHeaders = cookieHeaderValue
    ? [{ header: "Cookie", operation: "set", value: cookieHeaderValue }]
    : [{ header: "Cookie", operation: "remove" }];
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [
      {
        id,
        priority: 2,
        action: { type: "modifyHeaders", requestHeaders },
        condition: {
          urlFilter: domainFilter(domain),
          tabIds: [tabId],
          resourceTypes: ALL_RESOURCE_TYPES,
        },
      },
    ],
  });
}

export async function clearTabRule(tabId) {
  const id = INJECT_BASE + tabId;
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id], addRules: [] });
}
