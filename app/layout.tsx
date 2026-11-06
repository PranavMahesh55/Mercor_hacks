import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Takecheck — AI UGC Review",
  description: "Review AI-generated ads against your approved brief. Timestamped evidence, human decisions, and a better next take.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
