import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ServiceWorkerRegister } from "@/components/fetchit/shared/sw-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fetch-It Rider — Drive & Earn",
  description:
    "Fetch-It Rider: the driver app for the Fetch-It logistics network. Go online, get matched with nearby delivery jobs, capture proof of delivery, and track your earnings.",
  keywords: [
    "Fetch-It Rider",
    "driver app",
    "courier",
    "delivery jobs",
    "logistics",
    "PWA",
    "Next.js",
  ],
  authors: [{ name: "Fetch-It" }],
  applicationName: "Fetch-It Rider",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Fetch-It Rider",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  openGraph: {
    title: "Fetch-It Rider — Drive & Earn",
    description:
      "Get matched with nearby delivery jobs and earn on every completed delivery.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#f97316",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* The browser can fire "beforeinstallprompt" before our React app
            finishes loading. Capture it here, as early as possible, so
            the profile menu's Install option never misses it. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__deferredInstallPrompt__=e;window.dispatchEvent(new Event('fetchit:install-ready'));});",
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
