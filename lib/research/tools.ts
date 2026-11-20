import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { DbClient } from "@/lib/db/client";
import { extractPage, findPrices } from "./extract";
import { searchWeb } from "./search";

export function researchTools(db: DbClient, workspaceId: string, botId: string, keys: string[]): ToolSet {
  const has = (key: string) => keys.includes(key);
  const tools: ToolSet = {};

  if (has("web.search")) {
    tools.web_search = tool({
      description: "通过自建 SearXNG 搜索公开网页。使用精确查询，并引用返回的 URL。",
      inputSchema: z.object({
        query: z.string().min(2).max(500),
        limit: z.number().int().min(1).max(10).default(6),
      }),
      execute: async ({ query, limit }) => {
        try {
          return await searchWeb(query, limit);
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    });
  }

  if (has("browser.extract")) {
    tools.browser_extract = tool({
      description: "读取公开网页并返回正文。私有地址和本地地址会被阻止。",
      inputSchema: z.object({
        url: z.string().url().max(2048),
        maxChars: z.number().int().min(500).max(30_000).default(12_000),
      }),
      execute: async ({ url, maxChars }) => {
        try {
          return await extractPage(url, maxChars);
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    });
  }

  if (has("watch.add")) {
    tools.watch_add = tool({
      description: "添加价格监控。每次检查都会读取公开页面并记录第一个可见价格。",
      inputSchema: z.object({
        url: z.string().url().max(2048),
        target: z.string().max(500).default("第一个可见价格"),
        threshold: z.number().optional(),
      }),
      execute: async ({ url, target, threshold }) => {
        const { data, error } = await db
          .from("watches")
          .insert({ workspace_id: workspaceId, bot_id: botId, url, target, threshold })
          .select("id")
          .single();
        return error ? { ok: false, error: "添加价格监控失败。" } : { ok: true, watchId: data.id, url, threshold: threshold ?? null };
      },
    });
  }

  if (has("watch.check")) {
    tools.watch_check = tool({
      description: "检查一个或全部启用的价格监控，返回价格以及是否跌破阈值。",
      inputSchema: z.object({ watchId: z.string().uuid().optional() }),
      execute: async ({ watchId }) => {
        let query = db.from("watches").select("id, url, target, last_value, threshold").eq("workspace_id", workspaceId).eq("bot_id", botId);
        if (watchId) query = query.eq("id", watchId);
        const { data: watches, error } = await query;
        if (error) return { ok: false, error: "读取价格监控失败。" };
        const checked = [];
        for (const watch of watches ?? []) {
          try {
            const page = await extractPage(String(watch.url), 30_000);
            const prices = findPrices(page.text);
            const numeric = Number(String(prices[0] ?? "").replace(/[^\d.,]/g, "").replace(/,/g, ""));
            const value = Number.isFinite(numeric) ? numeric : null;
            const threshold = watch.threshold === null ? null : Number(watch.threshold);
            const dropped = value !== null && threshold !== null && value <= threshold;
            await db
              .from("watches")
              .update({ last_value: value, last_checked_at: new Date().toISOString() })
              .eq("id", watch.id)
              .eq("workspace_id", workspaceId);
            checked.push({ watchId: watch.id, url: watch.url, prices, value, threshold, crossed: dropped });
          } catch (error) {
            checked.push({ watchId: watch.id, url: watch.url, error: error instanceof Error ? error.message : String(error) });
          }
        }
        return { ok: true, checked };
      },
    });
  }

  return tools;
}
