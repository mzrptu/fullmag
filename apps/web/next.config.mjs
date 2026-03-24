import path from "path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(process.cwd(), "../../"),
  typedRoutes: true,
  experimental: {
    serverComponentsExternalPackages: ["fullmag-api"],
  },
};

export default nextConfig;
