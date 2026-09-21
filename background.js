import { mergeSetCookies, serializeJar } from "./lib/cookieJar.js";
import * as store from "./lib/storage.js";
import * as rules from "./lib/rules.js";
import * as tagging from "./lib/tagging.js";

// ---- Capture Set-Cookie per (tab, domain) and grow that tab's active profile jar -----------
// MV3 removed *blocking* webRequest for normal extensions, so we can no longer rewrite a
// request synchronously in onBeforeSendHeaders. But *observing* response headers is still
// allowed (non-blocking listener + "extraHeaders"), which is enough to capture Set-Cookie.
// The actual rewriting of the outgoing Cookie header is done separately via
// declarativeNetRequest session rules (lib/rules.js).
chrome.webRequest.onHeadersReceived.addListener(
  async (details) => {
    if (details.tabId < 0) return; // not associated with a tab (e.g. service worker fetch)

    const tabProfile = await store.getTabProfile(details.tabId);
    if (!tabProfile) return;

    let host;
    try {
      host = new URL(details.url).hostname;
    } catch {
      return;
    }
    if (host !== tabProfile.domain && !host.endsWith("." + tabProfile.domain)) return;

    const setCookieHeaders = (details.responseHeaders || [])
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value)
      .filter(Boolean);
    if (setCookieHeaders.length === 0) return;

    const currentJar = await store.getProfileJar(tabProfile.domain, tabProfile.profileId);
    const nextJar = mergeSetCookies(currentJar, setCookieHeaders);
    await store.setProfileJar(tabProfile.domain, tabProfile.profileId, nextJar);
    await rules.applyTabCookie(details.tabId, tabProfile.domain, serializeJar(nextJar));
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders", "extraHeaders"]
);

// ---- Clean up when a tab closes -------------------------------------------------------------
// Tab ids get reused by Chrome after a tab closes, so a stale "inject" rule left behind could
// end up applying to a completely unrelated future tab. Always remove it on close.
//
// Profiles here are treated as tied to the tab's lifetime, not as durable named accounts: when
// the tab holding a profile closes, that profile is deleted outright (unless some OTHER open tab
// is also currently using it) so the popup's list doesn't accumulate old one-off sessions.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const tp = await store.getTabProfile(tabId);

  await rules.clearTabRule(tabId);
  await store.clearTabProfile(tabId);
  await store.removePendingAutoTab(tabId);

  if (tp) {
    const stillInUse = await store.isProfileInUseByAnyTab(tp.domain, tp.profileId);
    if (!stillInUse) {
      await store.deleteProfile(tp.domain, tp.profileId);
    }
  }
});

// ---- "New session" auto-adopt: watch tabs opened via the popup's ➕ button ---------------------
// The tab starts on a blank/new-tab page (nothing to auto-adopt yet). The moment the user
// navigates it to any real http(s) site — typed a URL, clicked a bookmark, searched, whatever —
// this fires exactly once for that tab: the domain is auto-added as managed (if it wasn't
// already) and a brand-new, auto-named profile is created and assigned, no manual "Thêm domain"
// step required. Only tabs created through the button are watched; a normal Ctrl+T tab is
// untouched, and must still be added manually via the popup if desired.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  if (!(await store.isPendingAutoTab(tabId))) return;

  let url;
  try {
    url = new URL(changeInfo.url);
  } catch {
    return;
  }
  // Ignore chrome://newtab/, about:blank, etc. — keep waiting for the real navigation.
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  await store.removePendingAutoTab(tabId); // react only to the FIRST real navigation in this tab
  await autoAdoptTab(tabId, url.hostname);
});

async function autoAdoptTab(tabId, domain) {
  const alreadyManaged = (await store.getManagedDomains()).includes(domain);
  if (!alreadyManaged) {
    await store.addManagedDomain(domain);
    await rules.ensureStripRule(domain);
    await tagging.registerTagScript(domain);
  }
  const tag = tagging.newTag();
  const profileId = await store.createProfile(domain, `Phiên ${tag}`);
  await store.setTabProfile(tabId, domain, profileId, tag);
  // Fresh profile ⇒ empty jar ⇒ explicitly strip any Cookie header, so if the very first
  // request already went out with a real cookie before our rules were in place, the reload
  // below re-fetches the page clean.
  await rules.applyTabCookie(tabId, domain, "");
  await chrome.tabs.reload(tabId);
}

// ---- Messages from popup.js / options.js / content/tagTitle.js --------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: String(err && err.message ? err.message : err) }));
  return true; // keep the message channel open for the async response
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case "START_AUTO_SESSION": {
      const tab = await chrome.tabs.create({ url: "chrome://newtab/" });
      await store.addPendingAutoTab(tab.id);
      return { ok: true, tabId: tab.id };
    }

    case "ADD_DOMAIN":
      await store.addManagedDomain(msg.domain);
      await rules.ensureStripRule(msg.domain);
      await tagging.registerTagScript(msg.domain);
      return { ok: true };

    case "REMOVE_DOMAIN":
      await store.removeManagedDomain(msg.domain);
      await rules.removeStripRule(msg.domain);
      await tagging.unregisterTagScript(msg.domain);
      return { ok: true };

    // Self-heal before reporting anything to the popup: prune any profile whose tab is no
    // longer actually open (covers a missed tabs.onRemoved event, not just the normal case —
    // see lib/storage.js's reconcileProfiles for why that can happen).
    case "LIST_DOMAINS":
      await store.reconcileProfiles();
      return { domains: await store.getManagedDomains() };

    case "LIST_PROFILES":
      await store.reconcileProfiles();
      return { profiles: await store.getProfilesForDomain(msg.domain) };

    case "CREATE_PROFILE": {
      const id = await store.createProfile(msg.domain, msg.name);
      return { id };
    }

    case "DELETE_PROFILE":
      await store.deleteProfile(msg.domain, msg.profileId);
      return { ok: true };

    case "SWITCH_TAB_PROFILE": {
      const { tabId, domain, profileId } = msg;
      const tag = tagging.newTag();
      await store.setTabProfile(tabId, domain, profileId, tag);
      const jar = await store.getProfileJar(domain, profileId);
      await rules.applyTabCookie(tabId, domain, serializeJar(jar));
      await chrome.tabs.reload(tabId);
      return { ok: true, tag };
    }

    case "GET_TAB_PROFILE":
      return { profile: await store.getTabProfile(msg.tabId) };

    // Asked by content/tagTitle.js on every page load on a managed domain. Resolves the asking
    // tab's own id from the message sender (content scripts don't get their own tab id directly).
    case "GET_TAB_TAG": {
      const tabId = sender?.tab?.id;
      if (tabId == null) return {};
      const tp = await store.getTabProfile(tabId);
      if (!tp) return {};
      const profiles = await store.getProfilesForDomain(tp.domain);
      return { tag: tp.tag, name: profiles[tp.profileId]?.name };
    }

    default:
      return { error: `Unknown message type: ${msg.type}` };
  }
}

// ---- Session rules do not survive a full browser restart: recreate the "strip" rules ---------
// (the tag content script registration does persist on its own, but re-registering is harmless
// and keeps things in sync if a domain was added/removed while the service worker was asleep)
chrome.runtime.onStartup.addListener(reapplyForManagedDomains);
chrome.runtime.onInstalled.addListener(reapplyForManagedDomains);

async function reapplyForManagedDomains() {
  const domains = await store.getManagedDomains();
  for (const domain of domains) {
    await rules.ensureStripRule(domain);
    await tagging.registerTagScript(domain);
  }
}

// ---- A full browser restart doesn't reliably fire tabs.onRemoved for tabs that were open when
// Chrome quit (the service worker gets torn down along with everything else, with no chance to
// run per-tab cleanup) — that's why closed-tab sessions could still show up after reopening
// Chrome. reconcileProfiles() (also used above on every LIST_DOMAINS/LIST_PROFILES) fixes this
// the same way it fixes a missed single-tab close: by checking which tabs actually exist right
// now rather than trusting any specific event to have fired.
chrome.runtime.onStartup.addListener(() => store.reconcileProfiles());
