import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "@/components/query-provider";
export const metadata: Metadata = {
  title: "Evidence Workbench",
  description:
    "Investigate questions, inspect sources, and build reports with verifiable citations.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
