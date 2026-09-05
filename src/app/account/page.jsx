export const metadata = {
  title: "My Arsenal",
  description: "Your personalized Fantasy Arsenal account, career résumé, collections, and privacy controls.",
  robots: { index: false, follow: true },
};

import AccountClient from "./AccountClient";
export default function AccountPage(){ return <AccountClient/>; }
