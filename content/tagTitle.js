// Injected (via chrome.scripting.registerContentScripts, see lib/tagging.js) into every page on
// a managed domain. If this tab currently has a profile assigned, prefix document.title with a
// short "[tag]" badge so tabs on the same site are distinguishable in the tab strip.
(async () => {
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: "GET_TAB_TAG" });
  } catch {
    return; // background not reachable (e.g. extension reloading) — skip silently
  }
  if (!res || !res.tag) return; // this tab has no profile assigned yet

  const prefixRe = /^\[[^\]]*\]\s*/;

  const applyTag = (raw) => `[${res.tag}] ${String(raw).replace(prefixRe, "")}`;

  document.title = applyTag(document.title);

  // Keep the badge sticky: many sites (SPAs) set document.title again after our own script runs
  // (on route changes, async data loads, etc). Intercept future writes on the *instance* itself
  // so it shadows the prototype accessor for every script on the page, in every JS world.
  const proto = Object.getPrototypeOf(document);
  const desc = Object.getOwnPropertyDescriptor(proto, "title");
  if (desc && desc.configurable !== false && desc.set && desc.get) {
    Object.defineProperty(document, "title", {
      configurable: true,
      get() {
        return desc.get.call(document);
      },
      set(v) {
        desc.set.call(document, applyTag(v));
      },
    });
  }
})();
