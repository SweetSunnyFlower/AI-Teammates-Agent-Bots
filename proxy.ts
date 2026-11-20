import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasDatabaseEnv } from "@/lib/db/env";

// Next.js 16: `proxy.ts` replaces `middleware.ts`.
export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });
  if (!hasDatabaseEnv) return response;

  const session = await auth.api.getSession({ headers: request.headers });
  const signedIn = Boolean(session?.user?.id);
  const { pathname, search } = request.nextUrl;
  const isProtected = pathname === "/workspace" || pathname.startsWith("/workspace/");

  if (!signedIn && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (signedIn && pathname === "/auth/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/workspace";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const opened = signedIn ? /^\/workspace\/([0-9a-f-]{36})(?:\/|$)/i.exec(pathname) : null;
  if (opened && request.cookies.get("dotty_last_ws")?.value !== opened[1]) {
    response.cookies.set("dotty_last_ws", opened[1], {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return response;
}

export const config = {
  matcher: [
    // Every path except static files and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
