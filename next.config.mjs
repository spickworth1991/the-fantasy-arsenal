/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true } // you use <img>; keeps behavior identical & no extra image pipeline
};
export default nextConfig;
