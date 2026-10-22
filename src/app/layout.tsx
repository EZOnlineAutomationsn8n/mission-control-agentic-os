import type { Metadata } from "next";
// Geist + Geist Mono are bundled locally via the official `geist` package
// (next/font/local, SIL OFL 1.1 — see node_modules/geist/LICENSE.txt and
// docs/operations/FONTS_GEIST_LOCAL.md). The production build must never
// fetch fonts from the network; do not switch back to next/font/google.
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { PanelFocusProvider } from "@/components/shell/PanelFocus";
import { MissionBackground } from "@/components/shell/MissionBackground";
import { PreviewIdentity } from "@/components/shell/PreviewIdentity";

export const metadata: Metadata = {
  title: "Mission Control — Agentic OS",
  description: "Command center for supervising, controlling, and connecting AI agent systems.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full text-foreground">
        <PanelFocusProvider>
          <div className="mc-app-shell flex min-h-screen">
            <PreviewIdentity />
            <MissionBackground />
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
              <TopBar />
              <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
            </div>
          </div>
        </PanelFocusProvider>
      </body>
    </html>
  );
}
