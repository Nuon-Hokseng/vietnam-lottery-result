import { Suspense } from "react";

import Dashboard from "./components/Dashboard";

/**
 * The page shell is static. `searchParams` is request-time data, so it is read
 * inside a Suspense boundary: /?date=2026-10-12 opens that day directly.
 */
export default function Home(props: PageProps<"/">) {
  return (
    <Suspense fallback={null}>
      <WithDate searchParams={props.searchParams} />
    </Suspense>
  );
}

async function WithDate({
  searchParams,
}: {
  searchParams: PageProps<"/">["searchParams"];
}) {
  const { date } = await searchParams;
  const initialDate =
    typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  return <Dashboard initialDate={initialDate} />;
}
