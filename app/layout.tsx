import type { ReactNode } from "react";
import "./globals.css";
import SwRegister from "./sw-register";

export const metadata = {
  title: "MY TEEN PATTI CLUB",
  description: "Multiplayer Classic Teen Patti with friends — virtual chips only.",
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#046A38",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
