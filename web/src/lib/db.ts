import { Pool, type PoolConfig } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __comparadorPgPool: Pool | undefined;
}

const SUPAVISOR_POOL_PORT = "6543";

function buildPoolConfig(connectionString: string): PoolConfig {
  let cleanConnectionString = connectionString;
  let useSsl = false;

  try {
    const parsed = new URL(connectionString);
    const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    useSsl = !isLocal;

    if (!isLocal && parsed.port && parsed.port !== SUPAVISOR_POOL_PORT) {
      console.warn(
        `[db] DATABASE_URL usa el puerto ${parsed.port}. Se recomienda el pool de Supavisor en el puerto ${SUPAVISOR_POOL_PORT} para Vercel ISR.`
      );
    }

    // Evita que `sslmode=require` en pg-connection-string sobrescriba `ssl.rejectUnauthorized`
    // y dispare SELF_SIGNED_CERT_IN_CHAIN contra el certificado de Supavisor.
    if (useSsl && !parsed.searchParams.has("sslrootcert")) {
      parsed.searchParams.delete("sslmode");
      cleanConnectionString = parsed.toString();
    }
  } catch {
    useSsl = connectionString.includes("supabase.co") || connectionString.includes("supabase.com");
  }

  return {
    connectionString: cleanConnectionString,
    max: 5,
    idleTimeoutMillis: 15_000,
    connectionTimeoutMillis: 5_000,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  };
}

/**
 * Retorna el pool singleton hacia Supabase vía Supavisor (puerto 6543, Transaction Mode).
 * Si `DATABASE_URL` no está definida, retorna `null` para habilitar el modo demo/build offline.
 */
export function getPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    return null;
  }

  if (!globalThis.__comparadorPgPool) {
    globalThis.__comparadorPgPool = new Pool(buildPoolConfig(connectionString));
  }
  return globalThis.__comparadorPgPool;
}
