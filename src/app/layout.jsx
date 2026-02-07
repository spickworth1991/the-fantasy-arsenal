import "./globals.css";
import Providers from "./providers";

// Set NEXT_PUBLIC_SITE_URL in your env for accurate canonical URLs.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://thefantasyarsenal.com";
const SITE_NAME = "The Fantasy Arsenal";
const DEFAULT_DESCRIPTION =
  "Premium fantasy football tools for Sleeper leagues: trade analyzer, player stock, availability, power rankings, SOS, lineup optimizer, and draft pick tracker.";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: "%s | The Fantasy Arsenal",
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: {
    canonical: "/",
  },
  keywords: [
    "fantasy football tools",
    "Sleeper tools",
    "fantasy trade analyzer",
    "dynasty trade calculator",
    "player values",
    "ADP",
    "player stock",
    "draft pick tracker",
    "power rankings",
    "strength of schedule",
    "lineup optimizer",
  ],
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    images: [
      {
        url: "/nfl-loading-bg.webp",
        width: 1200,
        height: 630,
        alt: "The Fantasy Arsenal - fantasy football tools",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    images: ["/nfl-loading-bg.webp"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen text-white page-text">
        {/* Global JSON-LD for rich results */}
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(
              {
                "@context": "https://schema.org",
                "@graph": [
                  {
                    "@type": "Organization",
                    name: SITE_NAME,
                    url: SITE_URL,
                    logo: `${SITE_URL}/icons/icon-512x512.png`,
                  },
                  {
                    "@type": "WebSite",
                    name: SITE_NAME,
                    url: SITE_URL,
                  },
                ],
              },
              null,
              0
            ),
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
