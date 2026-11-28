import type { NextConfig } from "next";

// The browser only talks to Next.js; /api/v1/* is proxied to the Express
// backend, so the backend needs no CORS setup and the token never leaves
// this origin.
const backendUrl = process.env.BACKEND_URL ?? "http://localhost:5050";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${backendUrl}/api/v1/:path*` }];
  },
};

export default nextConfig;
