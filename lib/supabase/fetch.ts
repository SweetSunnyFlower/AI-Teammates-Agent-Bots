/**
 * fetch for Supabase server clients that retries only failures where the request never left this
 * machine (DNS lookup / connect), so a retry can't apply a write twice. Without it a brief network
 * blip surfaces as "TypeError: fetch failed".
 */
const RETRYABLE = new Set(["EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT", "ENETUNREACH", "EHOSTUNREACH"]);

function causeCode(err: unknown): string | undefined {
  const cause = (err as { cause?: { code?: string; errors?: Array<{ code?: string }> } })?.cause;
  return cause?.code ?? cause?.errors?.[0]?.code;
}

export const fetchWithRetry: typeof fetch = async (input, init) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      const code = causeCode(err);
      if (attempt >= 2 || !code || !RETRYABLE.has(code)) throw err;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
};

