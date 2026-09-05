import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Scholar Draftbox — ECCV 2026 paper planner",
  description:
    "Search ECCV 2026 papers, save your shortlist, and find posters by session. An unofficial, lovingly off-brand community planner.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
