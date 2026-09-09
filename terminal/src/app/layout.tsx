import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { PreferencesProvider } from "@/lib/preferences/PreferencesProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Terminal",
  description: "Private financial research and trading workstation.",
};

// Sets data-theme on <html> before first paint, straight from localStorage —
// avoids a flash of the wrong theme on load. Mirrors PreferencesProvider's
// own initial state/keys; suppressHydrationWarning on <html> below is the
// documented Next.js escape hatch for an attribute intentionally set outside
// React's render (see https://nextjs.org/docs/messages/react-hydration-error).
const THEME_INIT_SCRIPT = `
try {
  var t = localStorage.getItem("terminal_theme");
  document.documentElement.dataset.theme = t === "light" ? "light" : "dark";
} catch (e) {}
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg-app">
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <PreferencesProvider>{children}</PreferencesProvider>
      </body>
    </html>
  );
}
