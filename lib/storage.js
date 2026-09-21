// Storage layout.
//
// chrome.storage.local  — durable: managed domains + named cookie-jar "profiles" per domain.
//                          Survives browser restarts, which is the point (profiles are meant
//                          to be reused across sessions, like separate logins).
// chrome.storage.session — ephemeral: which profile each currently-open tab is using.
//                          Cleared on browser restart, which is fine: tab ids themselves become
//                          invalid across restarts, so this mapping couldn't survive anyway.

const LOCAL_KEY = "mpl_profiles_v1";   // { [domain]: { [profileId]: { name, jar, createdAt } } }
const DOMAINS_KEY = "mpl_domains_v1";  // string[]
const SESSION_KEY = "mpl_tab_profile_v1"; // { [tabId]: { domain, profileId, tag } }
const PENDING_KEY = "mpl_pending_auto_tabs_v1"; // number[] — tabs opened via "new session", awaiting their first real navigation

export async function getManagedDomains() {
  const { [DOMAINS_KEY]: domains } = await chrome.storage.local.get(DOMAINS_KEY);
  return domains || [];
}

export async function addManagedDomain(domain) {
  const domains = await getManagedDomains();
  if (!domains.includes(domain)) {
    domains.push(domain);
    await chrome.storage.local.set({ [DOMAINS_KEY]: domains });
  }
}

export async function removeManagedDomain(domain) {
  const domains = (await getManagedDomains()).filter((d) => d !== domain);
  await chrome.storage.local.set({ [DOMAINS_KEY]: domains });
}

export async function getAllProfiles() {
  const { [LOCAL_KEY]: all } = await chrome.storage.local.get(LOCAL_KEY);
  return all || {};
}

/**
 * Self-healing cleanup: delete every profile that no currently-open tab actually holds.
 *
 * tabs.onRemoved (background.js) deletes a profile the moment its tab closes — but that's an
 * event-driven fast path, and MV3 service workers can miss events (suspended right as the event
 * fires, extension reloading at that instant, etc.), and it never fires at all across a full
 * browser restart (Chrome tears the service worker down together with every tab, before it gets
 * a chance to react tab-by-tab). This function doesn't depend on any of that: it asks Chrome
 * directly which tabs actually exist right now, prunes the tab→profile map to match, and deletes
 * any stored profile no longer referenced by it. Call it opportunistically (background.js runs it
 * whenever the popup asks for the domain/profile list) so the list self-corrects even if an
 * individual close event was missed, with no dependency on catching that event at all.
 */
export async function reconcileProfiles() {
  const openTabs = await chrome.tabs.query({});
  const openIds = new Set(openTabs.map((t) => t.id));

  const map = await getTabProfileMap();
  const liveMap = {};
  for (const [tabIdStr, tp] of Object.entries(map)) {
    if (openIds.has(Number(tabIdStr))) liveMap[tabIdStr] = tp;
  }
  if (Object.keys(liveMap).length !== Object.keys(map).length) {
    await chrome.storage.session.set({ [SESSION_KEY]: liveMap });
  }

  const inUse = new Set(Object.values(liveMap).map((tp) => `${tp.domain}\u0000${tp.profileId}`));

  const all = await getAllProfiles();
  let changed = false;
  for (const domain of Object.keys(all)) {
    for (const profileId of Object.keys(all[domain])) {
      if (!inUse.has(`${domain}\u0000${profileId}`)) {
        delete all[domain][profileId];
        changed = true;
      }
    }
  }
  if (changed) await chrome.storage.local.set({ [LOCAL_KEY]: all });
}

export async function getProfilesForDomain(domain) {
  const all = await getAllProfiles();
  return all[domain] || {};
}

export async function createProfile(domain, name) {
  const all = await getAllProfiles();
  if (!all[domain]) all[domain] = {};
  const id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  all[domain][id] = { name, jar: {}, createdAt: Date.now() };
  await chrome.storage.local.set({ [LOCAL_KEY]: all });
  return id;
}

export async function deleteProfile(domain, profileId) {
  const all = await getAllProfiles();
  if (all[domain]) {
    delete all[domain][profileId];
    await chrome.storage.local.set({ [LOCAL_KEY]: all });
  }
}

export async function getProfileJar(domain, profileId) {
  const all = await getAllProfiles();
  return all[domain]?.[profileId]?.jar || {};
}

export async function setProfileJar(domain, profileId, jar) {
  const all = await getAllProfiles();
  if (!all[domain]) all[domain] = {};
  if (!all[domain][profileId]) all[domain][profileId] = { name: profileId, jar: {}, createdAt: Date.now() };
  all[domain][profileId].jar = jar;
  await chrome.storage.local.set({ [LOCAL_KEY]: all });
}

export async function getTabProfileMap() {
  const { [SESSION_KEY]: map } = await chrome.storage.session.get(SESSION_KEY);
  return map || {};
}

// `tag` is a short, human-visible id (see lib/tagging.js) stamped onto the tab at the moment a
// profile is assigned to it — like the little profile badge Multilogin shows per window, but
// here it goes into the page title so it's visible right in the Chrome tab strip.
export async function setTabProfile(tabId, domain, profileId, tag) {
  const map = await getTabProfileMap();
  map[tabId] = { domain, profileId, tag };
  await chrome.storage.session.set({ [SESSION_KEY]: map });
}

export async function clearTabProfile(tabId) {
  const map = await getTabProfileMap();
  delete map[tabId];
  await chrome.storage.session.set({ [SESSION_KEY]: map });
}

export async function getTabProfile(tabId) {
  const map = await getTabProfileMap();
  return map[tabId] || null;
}

/** True if some OTHER open tab is still holding this exact (domain, profileId). */
export async function isProfileInUseByAnyTab(domain, profileId) {
  const map = await getTabProfileMap();
  return Object.values(map).some((tp) => tp.domain === domain && tp.profileId === profileId);
}

// ---- "Pending auto-adopt" tabs: created via the popup's "new session" button. The first real
// (http/https) navigation in one of these tabs gets auto-added as a managed domain with a fresh
// profile — see background.js's tabs.onUpdated listener. ----------------------------------------

export async function addPendingAutoTab(tabId) {
  const { [PENDING_KEY]: list } = await chrome.storage.session.get(PENDING_KEY);
  const next = new Set(list || []);
  next.add(tabId);
  await chrome.storage.session.set({ [PENDING_KEY]: [...next] });
}

export async function isPendingAutoTab(tabId) {
  const { [PENDING_KEY]: list } = await chrome.storage.session.get(PENDING_KEY);
  return (list || []).includes(tabId);
}

export async function removePendingAutoTab(tabId) {
  const { [PENDING_KEY]: list } = await chrome.storage.session.get(PENDING_KEY);
  const next = (list || []).filter((id) => id !== tabId);
  await chrome.storage.session.set({ [PENDING_KEY]: next });
}
