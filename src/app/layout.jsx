export const metadata = {
  title: "The Fantasy Arsenal",
  description: "Premium fantasy football tools",
};

import "./globals.css";
import Providers from "./providers";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen text-white page-text">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
