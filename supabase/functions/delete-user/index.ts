import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });

const failure = (message: string, status: number) =>
  jsonResponse({ success: false, message }, status);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") return failure("Método no permitido", 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      console.error("[delete-user] Faltan variables de entorno requeridas");
      return failure("La función no está configurada correctamente", 500);
    }

    const accessToken = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!accessToken) return failure("Sesión requerida", 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await callerClient.auth.getUser(accessToken);
    if (authError || !authData.user?.id) {
      console.error("[delete-user] Sesión inválida:", authError?.message || "actor ausente");
      return failure(authError?.message || "Sesión inválida o expirada", 401);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: actor, error: actorError } = await supabaseAdmin
      .from("profiles")
      .select("id, role, active")
      .eq("id", authData.user.id)
      .single();
    if (actorError) {
      console.error("[delete-user] No se pudo validar al actor:", actorError.message);
      return failure("No se pudo validar al administrador", 500);
    }
    if (!actor.active || actor.role !== "admin") {
      return failure("Solo un administrador activo puede eliminar usuarios", 403);
    }

    let payload: { userId?: unknown };
    try {
      payload = await request.json();
    } catch {
      return failure("JSON inválido", 400);
    }

    const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return failure("userId debe ser un UUID válido", 400);
    }
    if (userId === actor.id) {
      return failure("No puedes eliminar tu propia cuenta administrativa", 400);
    }

    const { data: target, error: targetError } = await supabaseAdmin
      .from("profiles")
      .select("id, role")
      .eq("id", userId)
      .single();
    if (targetError || !target) {
      console.error("[delete-user] Usuario objetivo no encontrado:", targetError?.message || userId);
      return failure("El usuario no existe", 404);
    }
    if (target.role !== "user") {
      return failure("Esta operación solo permite eliminar cuentas de clientes", 403);
    }

    console.info("[delete-user] Eliminando cliente:", { actorId: actor.id, userId });

    // auth.users -> profiles y las tablas del cliente usan ON DELETE CASCADE.
    const { data, error } =
      await supabaseAdmin.auth.admin.deleteUser(userId);
    console.info("[delete-user] Resultado completo de deleteUser:", { data, error });
    console.info("[delete-user] Data completa:", data);
    console.error("[delete-user] Error completo:", error);

    if (error) {
      console.error("[delete-user] Falló auth.admin.deleteUser:", error);
      return failure(error.message, 500);
    }

    console.info("[delete-user] Usuario eliminado correctamente:", userId);
    return jsonResponse({ success: true, userId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    console.error("[delete-user] Error inesperado:", message);
    return failure(message, 500);
  }
});
