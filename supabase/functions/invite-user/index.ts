import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
});
const failure = (message: string, status: number, extra: Record<string, unknown> = {}) =>
  json({ success: false, message, ...extra }, status);

const plans: Record<string, "personal" | "group" | "app"> = {
  personal: "personal", "plan personal": "personal",
  group: "group", grupal: "group", "plan grupal": "group",
  app: "app", "plan app": "app",
};
const normalizePlan = (value: unknown) => plans[String(value ?? "").trim().toLowerCase()];
const validIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const inviteErrorStatus = (message: string) =>
  /already|registered|exists|duplicate|ya existe|ya registrado/i.test(message) ? 409 : 400;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  try {
    if (request.method !== "POST") return failure("Método no permitido", 400);

    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const siteUrl = Deno.env.get("SITE_URL")?.trim();
    if (!url || !anon || !serviceRole) {
      console.error("[invite-user] Faltan variables de entorno requeridas");
      return failure("La función no está configurada correctamente", 500);
    }
    if (!siteUrl) {
      console.error("[invite-user] Falta la variable de entorno SITE_URL");
      return failure("Falta configurar SITE_URL para el enlace de invitación", 500);
    }
    try {
      const parsedSiteUrl = new URL(siteUrl);
      if (!['http:', 'https:'].includes(parsedSiteUrl.protocol)) throw new Error("Protocolo no permitido");
    } catch {
      console.error("[invite-user] SITE_URL no es una URL HTTP/HTTPS válida");
      return failure("SITE_URL debe ser una URL HTTP/HTTPS válida", 500);
    }

    const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return failure("Sesión requerida", 401);

    const callerClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await callerClient.auth.getUser(token);
    if (authError || !authData?.user?.id) {
      console.error("[invite-user] Falló la autenticación del actor:", authError?.message || "usuario ausente");
      return failure(authError?.message || "Sesión inválida", 401);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const { data: actor, error: actorError } = await supabaseAdmin
      .from("profiles").select("id,role,active").eq("id", authData.user.id).single();
    if (actorError) {
      console.error("[invite-user] No se pudo cargar el actor:", actorError.message);
      return failure(actorError.message, 500);
    }
    if (!actor?.active || !["admin", "trainer"].includes(actor.role)) {
      console.error("[invite-user] Actor sin permisos:", { actorId: authData.user.id, role: actor?.role, active: actor?.active });
      return failure("Solo un administrador o entrenador activo puede invitar usuarios", 403);
    }
    console.info("[invite-user] Actor autenticado:", { actorId: actor.id, role: actor.role });

    let payload: Record<string, unknown>;
    try { payload = await request.json(); }
    catch { return failure("JSON inválido", 400); }
    if (Object.prototype.hasOwnProperty.call(payload, "role")) {
      return failure("El rol no puede definirse desde el frontend", 400);
    }

    const email = String(payload.email ?? "").trim().toLowerCase();
    const fullName = String(payload.fullName ?? payload.name ?? "").trim();
    const planType = normalizePlan(payload.planType ?? payload.plan);
    const startDate = String(payload.startDate ?? "").trim();
    const expirationDate = String(payload.expirationDate ?? "").trim();
    if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return failure("El correo no es válido o supera 254 caracteres", 400);
    if (fullName.length < 2 || fullName.length > 120)
      return failure("El nombre debe tener entre 2 y 120 caracteres", 400);
    if (!planType) return failure("Tipo de plan no válido", 400);
    if (!validIsoDate(startDate) || !validIsoDate(expirationDate))
      return failure("Las fechas deben ser fechas reales con formato YYYY-MM-DD", 400);
    if (expirationDate < startDate)
      return failure("La fecha de vencimiento no puede ser anterior al inicio", 400);

    console.info("[invite-user] Correo a invitar:", email);
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: siteUrl,
      data: { full_name: fullName, invited_by: actor.id },
    });
    console.info("[invite-user] inviteUserByEmail data:", inviteData);
    console.info("[invite-user] inviteUserByEmail error:", inviteError);
    if (inviteError) {
      console.error("[invite-user] Supabase Auth rechazó la invitación:", inviteError.message);
      return failure(inviteError.message, inviteErrorStatus(inviteError.message));
    }
    const userId = inviteData?.user?.id;
    if (!userId) {
      console.error("[invite-user] Auth no devolvió data.user.id");
      return failure("Supabase Auth no confirmó la creación del usuario", 500);
    }

    const cleanupAuthUser = async () => {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) console.error("[invite-user] Falló la limpieza del usuario Auth:", error.message);
      else console.info("[invite-user] Usuario Auth eliminado durante rollback:", userId);
      return error?.message || null;
    };

    const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").upsert({
      id: userId, email, full_name: fullName,
      role: "user", trainer_id: actor.id, active: true,
    }).select("id").single();
    console.info("[invite-user] Creación de profile:", { profileId: profile?.id || null, error: profileError?.message || null });
    if (profileError || profile?.id !== userId) {
      console.error("[invite-user] No se confirmó el profile:", profileError?.message || "ID ausente");
      const cleanupError = await cleanupAuthUser();
      return failure(profileError?.message || "No se confirmó la creación del perfil", 500, { cleanupError });
    }

    const { data: subscription, error: subscriptionError } = await supabaseAdmin.from("subscriptions").insert({
      user_id: userId, plan_type: planType, start_date: startDate,
      expiration_date: expirationDate, created_by: actor.id,
    }).select("id").single();
    console.info("[invite-user] Creación de subscription:", { subscriptionId: subscription?.id || null, error: subscriptionError?.message || null });
    if (subscriptionError || !subscription?.id) {
      console.error("[invite-user] No se confirmó la subscription:", subscriptionError?.message || "ID ausente");
      const cleanupError = await cleanupAuthUser();
      return failure(subscriptionError?.message || "No se confirmó la creación de la suscripción", 500, { cleanupError });
    }

    const { error: eventError } = await supabaseAdmin.from("subscription_events").insert({
      subscription_id: subscription.id, user_id: userId, event_type: "created",
      new_plan: planType, created_by: actor.id,
    });
    const warnings = eventError
      ? [`No se registró el evento de suscripción: ${eventError.message}`]
      : [];
    if (eventError) console.error("[invite-user] Falló subscription_events:", eventError.message);

    return json({
      success: true,
      message: "Invitación enviada correctamente",
      userId,
      email,
      warnings,
    }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno desconocido";
    console.error("[invite-user] Error no controlado:", message);
    return failure(message, 500);
  }
});
