import AccountClient from "../AccountClient";

export const metadata = { title: "Account & Privacy | My Arsenal" };

export default function ArsenalPrivacyPage() {
  return <AccountClient initialTab="privacy" />;
}
