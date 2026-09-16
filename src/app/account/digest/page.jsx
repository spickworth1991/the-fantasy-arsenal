import AccountClient from "../AccountClient";

export const metadata = { title: "Digest | My Arsenal" };

export default function ArsenalDigestPage() {
  return <AccountClient initialTab="digest" />;
}
