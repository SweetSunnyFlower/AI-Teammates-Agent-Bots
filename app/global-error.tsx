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
    <html lang="en">
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
        <title>Something went wrong · Dotty</title>
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
            Dotty couldn&apos;t load
          </p>
          <p style={{ margin: "8px 0 16px", fontSize: 14, opacity: 0.75 }}>
            Something went wrong on our side. Try again in a moment.
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
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
