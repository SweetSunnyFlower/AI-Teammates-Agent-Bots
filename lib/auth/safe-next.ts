/** Only allow same-site relative redirects. */
export function safeNext(raw: string | null | undefined, fallback = "/workspace") {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}
