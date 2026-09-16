import AccountClient from "../AccountClient";

export const metadata = { title: "Library | My Arsenal" };

export default function ArsenalLibraryPage() {
  return <AccountClient initialTab="collection" />;
}
