import AdminCurationBoard from "@/components/AdminCurationBoard";
import { getAdminCurationData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Curación Visual y Calidad | MercaSabio",
  description:
    "Panel visual de clasificación por gamas de calidad, revisión de dudas del algoritmo y reportes de comparación injusta.",
};

export default async function AdminCurationPage() {
  const initialData = await getAdminCurationData();
  return <AdminCurationBoard initialData={initialData} />;
}
