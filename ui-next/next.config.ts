import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  distDir: "../dist/control-ui-next",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
