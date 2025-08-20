// Server file (no "use client")
// Force static, and override any parent edge runtime.
export const dynamic = 'force-static';
export const runtime = 'nodejs';
export const revalidate = false;

import { Suspense } from 'react';
import ClientResults from './ClientResults';

export default function ResultsPage({ searchParams }) {
  return (
    <Suspense fallback={null}>
      <ClientResults initialSearchParams={searchParams} />
    </Suspense>
  );
}
