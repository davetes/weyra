/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Use deployed backend when running on Railway/Vercel/etc.
    const apiBase =
      process.env.NEXT_PUBLIC_API_URL ||
      process.env.BACKEND_ORIGIN ||
      "http://localhost:4000";

    return [
      {
        source: "/api/:path*",
        destination: `${apiBase}/api/:path*`,
      },
      {
        source: "/static/:path*",
        destination: `${apiBase}/static/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
