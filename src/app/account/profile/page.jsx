import AccountClient from "../AccountClient";

export const metadata = { title: "Profile | My Arsenal" };

export default function ArsenalProfilePage() {
  return <AccountClient initialTab="profile" />;
}
