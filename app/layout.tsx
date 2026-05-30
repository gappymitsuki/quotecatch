import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuoteCatch",
  description: "AI lead-intake and estimate-prep chat for home-services teams.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
