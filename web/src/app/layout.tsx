import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Comparador de Precios Retail Colombia",
  description:
    "Compara precios reales y Precio por Unidad de Medida (PUM) entre Éxito, Carulla, Olímpica, D1, Ara, Alkosto y Rappi.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-CO">
      <body>{children}</body>
    </html>
  );
}
