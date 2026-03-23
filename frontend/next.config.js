/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true,
  },
  async rewrites() {
    // In production the backend is not reachable at localhost.
    // Set BACKEND_ORIGIN (or NEXT_PUBLIC_BACKEND_ORIGIN) to your server URL, e.g.
    // https://weyra-server.up.railway.app
    const backend =
      process.env.NEXT_PUBLIC_BACKEND_ORIGIN ||
      process.env.BACKEND_ORIGIN ||
      "http://localhost:4000";

    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
      {
        source: "/static/:path*",
        destination: `${backend}/static/:path*`,
      },
      {
        source: "/ws/:path*",
        destination: `${backend}/ws/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
