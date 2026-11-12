import PriceComparator from "@/components/PriceComparator";
import { getDashboardData } from "@/lib/queries";

// Revalidación ISR cada 6 horas (21.600 segundos) según especificación
export const revalidate = 21600;

export default async function HomePage() {
  const initialData = await getDashboardData();
  return <PriceComparator initialData={initialData} />;
}
