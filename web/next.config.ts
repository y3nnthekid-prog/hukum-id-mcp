import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
};

export default config;
