export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/**
 * Obtiene la configuración HTTPS de Supabase desde variables de entorno
 * (compatibles con `.env.local`, `.dev.vars` y Cloudflare Workers Secrets).
 * Si faltan credenciales, retorna `null` para habilitar el modo demo/build offline.
 */
export function getSupabaseConfig(): SupabaseConfig | null {
  const rawUrl =
    process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey =
    process.env.SUPABASE_ANON_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!rawUrl || !anonKey) {
    return null;
  }

  return {
    url: rawUrl.replace(/\/+$/, ""),
    anonKey,
  };
}

function buildSupabaseHeaders(config: SupabaseConfig): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: config.anonKey,
    "Content-Type": "application/json",
  };

  if (config.anonKey.startsWith("eyJ")) {
    headers.Authorization = `Bearer ${config.anonKey}`;
  }

  return headers;
}

async function parseSupabaseResponse<T>(res: Response, endpoint: string): Promise<T> {
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Supabase REST error ${res.status} en ${endpoint}: ${detail}`);
  }
  return (await res.json()) as T;
}

export async function supabaseRestGet<T>(config: SupabaseConfig, path: string): Promise<T> {
  const cleanPath = path.replace(/^\/+/, "");
  const res = await fetch(`${config.url}/rest/v1/${cleanPath}`, {
    method: "GET",
    headers: buildSupabaseHeaders(config),
  });
  return parseSupabaseResponse<T>(res, cleanPath);
}

export async function supabaseRpc<T>(
  config: SupabaseConfig,
  fnName: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(`${config.url}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: buildSupabaseHeaders(config),
    body: JSON.stringify(params),
  });
  return parseSupabaseResponse<T>(res, `rpc/${fnName}`);
}
