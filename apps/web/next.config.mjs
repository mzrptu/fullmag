import path from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(process.cwd(), "../../"),
  output: "export",
  trailingSlash: true,
  typedRoutes: true,
  serverExternalPackages: ["fullmag-api"],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
