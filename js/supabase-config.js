(function (global) {
  "use strict";
  const SUPABASE_URL = "https://vponqzvewpqpdfgbpmhb.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_CcVD9Egbk-b-SLAVnv_wrQ_UskUZKah";
  const configured = /^https:\/\/.+\.supabase\.co$/i.test(SUPABASE_URL) && !SUPABASE_PUBLISHABLE_KEY.includes("SUPABASE_");
  let client = null;
  if (configured && global.supabase?.createClient) {
    client = global.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  if (configured && !global.supabase?.createClient) console.error("No se pudo cargar @supabase/supabase-js v2; Supabase quedó deshabilitado.");
  const ok = (data) => ({ data, error: null });
  const fail = (error, context) => ({ data: null, error: { message: error?.message || String(error), context } });
  global.TrainerSupabase = Object.freeze ? Object.assign(global.TrainerSupabase || {}, {
    isConfigured: () => configured && !!client,
    getClient: () => client,
    mode: configured && client ? "supabase" : "local-compatibility",
    ok, fail,
    requireClient() { if (!client) throw new Error("Supabase no está configurado. Reemplace SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY."); return client; }
  }) : global.TrainerSupabase;
  document.documentElement.dataset.dataMode = configured && client ? "supabase" : "local-compatibility";
  if (!configured) console.info("Modo local de compatibilidad: configure Supabase antes de producción.");
})(window);
