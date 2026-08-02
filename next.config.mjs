const arsenalDevApiOrigin = String(
  process.env.ARSENAL_DEV_API_ORIGIN || "",
).replace(/\/$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true }, // you use <img>; keeps behavior identical & no extra image pipeline
  async rewrites() {
    const useRemoteAccountApi =
      process.env.NODE_ENV === "development" &&
      /^https:\/\//i.test(arsenalDevApiOrigin);
    if (!useRemoteAccountApi) return [];
    return {
      beforeFiles: [
        {
          source: "/api/arsenal/:path*",
          destination: `${arsenalDevApiOrigin}/api/arsenal/:path*`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};
export default nextConfig;
