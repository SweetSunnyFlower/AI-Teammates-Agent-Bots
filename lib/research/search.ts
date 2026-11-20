type SearxResult = {
  title?: string;
  url?: string;
  content?: string;
  engine?: string;
};

export async function searchWeb(query: string, limit = 6) {
  const base = process.env.SEARXNG_URL?.replace(/\/$/, "");
  if (!base) return { ok: false as const, error: "网页搜索尚未配置，请设置 SEARXNG_URL。" };

  const url = new URL(`${base}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("safesearch", "1");
  const engines = process.env.SEARXNG_ENGINES?.trim();
  if (engines) url.searchParams.set("engines", engines);

  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Dotty/1.0" },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new Error("SearXNG 请求失败，请检查搜索服务是否运行。");
  });
  if (!response.ok) throw new Error(`SearXNG 返回状态码 ${response.status}。`);
  const body = (await response.json()) as { results?: SearxResult[] };
  const results = (body.results ?? [])
    .filter((item) => item.title && item.url)
    .slice(0, Math.max(1, Math.min(limit, 10)))
    .map((item) => ({
      title: item.title!,
      url: item.url!,
      snippet: (item.content ?? "").slice(0, 500),
      engine: item.engine ?? null,
    }));
  return { ok: true as const, query, results };
}
