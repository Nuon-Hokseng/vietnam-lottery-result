import type { Metadata, Viewport } from "next";
import {
  Geist,
  Noto_Sans_Khmer,
  Noto_Serif,
  Noto_Serif_Khmer,
} from "next/font/google";
import "./globals.css";

// Latin text and digits: Geist for UI, a heavy serif for results (as in the
// reference app). Khmer glyphs fall through to the Khmer faces below.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const notoSerif = Noto_Serif({
  variable: "--font-noto-serif",
  subsets: ["latin"],
  weight: ["500", "700", "800"],
});

const notoSansKhmer = Noto_Sans_Khmer({
  variable: "--font-noto-sans-khmer",
  subsets: ["khmer"],
  weight: ["400", "500", "600", "700"],
});

const notoSerifKhmer = Noto_Serif_Khmer({
  variable: "--font-noto-serif-khmer",
  subsets: ["khmer"],
  weight: ["500", "700", "800"],
});

export const metadata: Metadata = {
  title: "លទ្ធផលឆ្នោតវៀតណាម",
  description: "លទ្ធផលឆ្នោតវៀតណាម ពេលថ្ងៃ និងពេលយប់ រយៈពេល 7 ថ្ងៃចុងក្រោយ",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#5e35b1" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0c1a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="km"
      className={`${geistSans.variable} ${notoSerif.variable} ${notoSansKhmer.variable} ${notoSerifKhmer.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
