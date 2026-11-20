import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({ src: "./fonts/GeistVF.woff", variable: "--font-geist-sans", weight: "100 900" });

export const metadata: Metadata = {
  title: { default: "Agency CRM", template: "%s · Agency CRM" },
  description: "Works, scheduling, workers and approvals",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2563eb" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: browser extensions (e.g. LanguageTool adds data-lt-installed)
    // modify <html>/<body> before React loads. Only affects these two elements' attributes.
    <html lang="en" suppressHydrationWarning>
      <body className={geistSans.variable} suppressHydrationWarning>{children}</body>
    </html>
  );
}
