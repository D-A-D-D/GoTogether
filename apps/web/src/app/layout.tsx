import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import { RegisterServiceWorker } from "@/components/register-service-worker";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/lib/auth-context";
import { BOOT_SCRIPT } from "@/lib/preferences";
import "./globals.css";

// Headings in a grotesque with some personality; body in a plain, open sans that stays readable at
// 17px for anyone. Two faces, used consistently - not a font per component.
const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

const body = Instrument_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "GoTogether",
  description: "Find travel companions, host or join trips, and travel together.",
  // iOS reads these separately from the Web App Manifest for its own
  // "Add to Home Screen" behavior (status bar style, standalone title).
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "GoTogether",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFF6EA" },
    { media: "(prefers-color-scheme: dark)", color: "#0A1622" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the script below sets theme/text-size attributes on <html> before React
    // loads, which is the point (no flash of the wrong theme) - React should not treat them as a mismatch.
    <html lang="en" className={`${display.variable} ${body.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} suppressHydrationWarning />
      </head>
      <body className="min-h-full">
        <RegisterServiceWorker />
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
