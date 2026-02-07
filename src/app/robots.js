// Next.js Robots route
// https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://thefantasyarsenal.com";

export default function robots() {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
