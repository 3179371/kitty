import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kitty: the AI agent that runs your group gift, with PayPal",
  description:
    "Type one sentence. Kitty collects everyone's share with PayPal, chases late payers, lets the group pick a real gift, pays once you approve and refunds what's left.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
