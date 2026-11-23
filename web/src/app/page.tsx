import ParallelComparator from "@/components/parallel/ParallelComparator";
import { getDashboardData } from "@/lib/queries";

import "./v2.css";

// Revalidación ISR cada 6 horas (21.600 segundos)
export const revalidate = 21600;

export default async function HomePage() {
  const initialData = await getDashboardData();
  return <ParallelComparator initialData={initialData} />;
}
