import AdminCurationBoard from "@/components/AdminCurationBoard";
import { isLocalAdminEnvironment } from "@/lib/localAdminDb";
import { getAdminCurationData } from "@/lib/queries";

import "./admin-v2.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Curación Visual y Calidad | MercaSabio",
  description:
    "Panel visual exclusivo del modo local sobre SQLite para curación de catálogo.",
};

export default async function AdminCurationPage() {
  if (!isLocalAdminEnvironment()) {
    return (
      <div className="ms2-admin-root" style={{ padding: "3rem 1.5rem", maxWidth: 680, margin: "0 auto" }}>
        <h1>Panel Admin exclusivo de entorno local</h1>
        <p style={{ marginTop: "0.75rem", lineHeight: 1.6 }}>
          Por optimización de almacenamiento e IO, la infraestructura de administración fue retirada de Supabase.
          Para usar <code>/admin</code>, inicia el servidor localmente junto a{" "}
          <code>etl/data/local_staging.db</code>.
        </p>
      </div>
    );
  }

  const initialData = await getAdminCurationData();
  return (
    <div className="ms2-admin-root">
      <AdminCurationBoard initialData={initialData} />
    </div>
  );
}
