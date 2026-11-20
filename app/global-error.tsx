"use client";

/**
 * Last-resort boundary (the root layout itself failed). It renders its own document without the
 * app's CSS, so it's styled inline.
 */
export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "#8cc15d",
          fontFamily: "system-ui, sans-serif",
          color: "#2b2620",
        }}
      >
        <title>出了点问题 · Dotty</title>
        <div
          style={{
            maxWidth: 420,
            margin: 16,
            padding: 24,
            background: "#f4eee3",
            border: "2px solid #2b2620",
            borderRadius: 14,
            boxShadow: "0 4px 0 0 #2b2620",
          }}
        >
          <p style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
            Dotty 暂时无法加载
          </p>
          <p style={{ margin: "8px 0 16px", fontSize: 14, opacity: 0.75 }}>
            服务端出现了问题，请稍后重试。
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              font: "inherit",
              fontWeight: 700,
              padding: "8px 14px",
              borderRadius: 999,
              border: "2px solid #2b2620",
              background: "#2b2620",
              color: "#f4eee3",
              cursor: "pointer",
            }}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
