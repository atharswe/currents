import type { Metadata } from "next";
import { IBM_Plex_Sans, Newsreader } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const ui = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ui",
  display: "swap",
});

const article = Newsreader({
  subsets: ["latin"],
  variable: "--font-article",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Currents",
  description: "A self-hostable RSS reader with full-text search.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${article.variable} h-full`}>
      <body className="h-full overflow-hidden bg-abyss font-sans text-mist antialiased">
        {children}
      </body>
    </html>
  );
}
