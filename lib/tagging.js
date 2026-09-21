// Visually distinguish tabs holding different profiles of the same site — like Multilogin's
// per-window profile badge, but done by prefixing the page title (shown right in the Chrome
// tab strip, where two tabs on the same site otherwise look identical).
//
// Mechanism: for each managed domain we register a small dynamic content script
// (chrome.scripting.registerContentScripts) that runs on every page load and asks the
// background for "my tab's tag" (background.js resolves it from the sender's tab id). If the
// tab currently holds a profile, the content script prefixes document.title with
// "[<tag>:<profile name>]" and keeps re-applying it whenever the page changes its own title
// (SPA route changes, etc.) — see content/tagTitle.js.

function scriptIdFor(domain) {
  return `mpl-tag-${domain}`;
}

export async function registerTagScript(domain) {
  const id = scriptIdFor(domain);
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  } catch {
    // wasn't registered yet — fine
  }
  await chrome.scripting.registerContentScripts([
    {
      id,
      matches: [`*://*.${domain}/*`, `*://${domain}/*`],
      js: ["content/tagTitle.js"],
      runAt: "document_idle",
      persistAcrossSessions: true,
    },
  ]);
}

export async function unregisterTagScript(domain) {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [scriptIdFor(domain)] });
  } catch {
    // already gone — fine
  }
}

/** Short id for a freshly-assigned tab profile: last 6 digits of the current ms timestamp. */
export function newTag() {
  return String(Date.now()).slice(-6);
}
