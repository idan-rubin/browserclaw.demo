import type { Metadata } from "next";
import { Inter, Source_Serif_4, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-heading",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    template: "%s | browserclaw.org",
    default: "browserclaw.org — AI that browses for you",
  },
  description: "Type what you want done. Watch AI do it in a real browser. Get a reusable skill.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${sourceSerif.variable} ${jetbrainsMono.variable} font-[family-name:var(--font-inter)] antialiased`}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
          {children}
          <Toaster
            position="top-right"
            richColors
            closeButton
            toastOptions={{ style: { borderRadius: "var(--radius-xl)" } }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
