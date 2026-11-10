import type { Metadata } from "next";
import { Courier_Prime, Nunito_Sans } from "next/font/google";
import "@bible-strong/avatar-react/styles.css";
import "streamdown/styles.css";
import "./globals.css";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const nunitoSans = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const courierPrime = Courier_Prime({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-courier",
});

export const metadata: Metadata = {
  title: "Dotty",
  description: "Run a team of AI bots from a tiny 3D office.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("h-full antialiased font-sans", nunitoSans.variable, courierPrime.variable)}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster position="bottom-center" closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
