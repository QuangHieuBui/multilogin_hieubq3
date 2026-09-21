// Cookie jar utilities: parse Set-Cookie response headers, merge them into a jar object,
// and serialize a jar back into a single "Cookie" request header value.
//
// We deliberately only look at the "name=value" part of each Set-Cookie header and ignore
// attributes (Path, Domain, Expires, Max-Age, HttpOnly, Secure, SameSite). That is enough to
// replay a session, and keeps the merge logic simple. If a site relies on cookie attributes
// for behavior (e.g. two different Path scopes for the same cookie name), this simplification
// can lose information — see README for the general limitations of this technique.

/** Parse one raw Set-Cookie header value into { name, value }, or null if unparsable. */
export function parseSetCookie(setCookieValue) {
  const firstPart = setCookieValue.split(";")[0].trim();
  const eq = firstPart.indexOf("=");
  if (eq === -1) return null;
  const name = firstPart.slice(0, eq).trim();
  const value = firstPart.slice(eq + 1).trim();
  if (!name) return null;
  return { name, value };
}

/**
 * Merge an array of raw Set-Cookie header values into an existing jar ({name: value}).
 * Returns a NEW jar object; does not mutate the input.
 */
export function mergeSetCookies(jar, setCookieValues) {
  const next = { ...jar };
  for (const raw of setCookieValues) {
    const parsed = parseSetCookie(raw);
    if (!parsed) continue;
    next[parsed.name] = parsed.value;
  }
  return next;
}

/** Serialize a jar object into a single "Cookie" request header value ("a=1; b=2"). */
export function serializeJar(jar) {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}
