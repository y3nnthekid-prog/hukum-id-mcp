import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "HukumID — Riset hukum berbasis bukti",
  description: "Telusuri hukum nasional dan hukum ekonomi syariah dengan kutipan yang dapat diperiksa.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="id">
      <body>
        <a className="skip-link" href="#main-content">Lewati ke isi utama</a>
        {children}
      </body>
    </html>
  );
}
