import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

const MAX_BYTES = 2_000_000;

function privateIp(ip: string) {
  if (ip === "::1" || ip === "::" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  if (ip.startsWith("127.") || ip === "0.0.0.0") return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  const match = /^172\.(\d+)\./.exec(ip);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  if (ip.startsWith("169.254.") || ip.startsWith("100.64.")) return true;
  return false;
}

async function assertPublicUrl(raw: string) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http and https URLs are allowed.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error("Private network addresses are not allowed.");
  }
  if (isIP(host)) {
    if (privateIp(host)) throw new Error("Private network addresses are not allowed.");
    return url;
  }
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some((entry) => privateIp(entry.address))) {
    throw new Error("Private network addresses are not allowed.");
  }
  return url;
}

async function safeFetch(raw: string) {
  let url = await assertPublicUrl(raw);
  for (let redirect = 0; redirect < 5; redirect++) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { Accept: "text/html,application/xhtml+xml,text/plain", "User-Agent": "Dotty/1.0 (+research bot)" },
      signal: AbortSignal.timeout(20_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect ${response.status} without a location.`);
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Page returned ${response.status}.`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) throw new Error("Page is too large to extract.");
    return { response, finalUrl: url.toString() };
  }
  throw new Error("Too many redirects.");
}

export async function extractPage(rawUrl: string, maxChars = 12_000) {
  const { response, finalUrl } = await safeFetch(rawUrl);
  const type = response.headers.get("content-type") ?? "";
  const raw = (await response.text()).slice(0, MAX_BYTES);
  let title = "";
  let text = raw;

  if (type.includes("html") || raw.trimStart().startsWith("<")) {
    const dom = new JSDOM(raw, { url: finalUrl });
    try {
      const article = new Readability(dom.window.document).parse();
      title = article?.title ?? dom.window.document.title ?? "";
      text = article?.textContent ?? dom.window.document.body?.textContent ?? raw;
    } finally {
      dom.window.close();
    }
  }

  const clean = text.replace(/\s+/g, " ").trim();
  return {
    ok: true as const,
    url: finalUrl,
    title: title.slice(0, 300),
    text: clean.slice(0, Math.max(500, Math.min(maxChars, 30_000))),
    truncated: clean.length > maxChars,
  };
}

export function findPrices(text: string) {
  const matches = text.match(/(?:US\$|\$|€|£|¥|CNY|USD|EUR|GBP)\s?\d[\d,.]*|\d[\d,.]*\s?(?:USD|EUR|GBP|CNY|元)/gi) ?? [];
  return [...new Set(matches.map((value) => value.trim()))].slice(0, 20);
}
