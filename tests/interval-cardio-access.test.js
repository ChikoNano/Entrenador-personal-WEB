const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const routinesSource = fs.readFileSync(path.join(root, "js", "supabase-routines.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "routine-type-v1.sql"), "utf8");
const routineId = "33333333-3333-4333-8333-333333333333";
const userId = "11111111-1111-4111-8111-111111111111";

const cardioRoutine = () => ({ id: routineId, name: "Rutina de cardio", user_id: userId, routine_type: "cardio", active: true });
const timerConfig = () => ({
  id: "44444444-4444-4444-8444-444444444444", routine_id: routineId, rounds: 2,
  work_seconds: 120, phases: [{ name: "Exhaustivo", intensity: 10, duration_seconds: 60 }],
  cooldown: { name: "Enfriamiento", intensity: 2, duration_seconds: 300 }, active: true
});

function loadAccess({ routine = null, config = null, routineError = null, configError = null } = {}) {
  const queries = [];
  const client = {
    auth: { async getUser() { return { data: { user: { id: userId } }, error: null }; } },
    from(table) {
      const filters = [];
      return {
        select() { return this; },
        eq(column, value) { filters.push([column, value]); return this; },
        limit() { return this; },
        async maybeSingle() {
          queries.push({ table, filters });
          return table === "routines" ? { data: routine, error: routineError } : { data: config, error: configError };
        }
      };
    }
  };
  const ns = {
    ok: data => ({ data, error: null }),
    fail: error => ({ data: null, error: { message: error?.message || String(error) } }),
    requireClient: () => client
  };
  const context = { window: { TrainerSupabase: ns }, console };
  vm.createContext(context);
  vm.runInContext(routinesSource, context);
  return { routines: ns.routines, queries };
}

test("usuario sin cardio queda bloqueado y conserva visible la opción", async () => {
  const state = loadAccess();
  const result = await state.routines.getOwnCardioAccess();
  assert.equal(result.data.allowed, false);
  assert.equal(result.data.reason, "NO_CARDIO_ROUTINE");
  assert.equal(state.queries.length, 1);
  assert.match(html, /id="cardIntervalTimer"[\s\S]*?<h3>Cronómetro<\/h3>/);
  assert.match(appSource, /Tu entrenador aún no ha asignado tu rutina de cardio/);
});

test("rutina general y configuración antigua no habilitan el acceso", async () => {
  const state = loadAccess();
  const result = await state.routines.getOwnCardioAccess();
  assert.equal(result.data.allowed, false);
  assert.equal(state.queries.some(query => query.table === "interval_timer_configs"), false);
  assert.match(routinesSource, /\.eq\("routine_type", "cardio"\)/);
});

test("cardio activo sin configuración queda bloqueado", async () => {
  const result = await loadAccess({ routine: cardioRoutine() }).routines.getOwnCardioAccess();
  assert.equal(result.data.allowed, false);
  assert.equal(result.data.reason, "NO_ACTIVE_CONFIG");
});

test("cardio activo con configuración correcta obtiene acceso completo", async () => {
  const state = loadAccess({ routine: cardioRoutine(), config: timerConfig() });
  const result = await state.routines.getOwnCardioAccess();
  assert.equal(result.data.allowed, true);
  assert.equal(result.data.routine.id, routineId);
  assert.equal(result.data.config.routine_id, routineId);
  assert.deepEqual(state.queries[1].filters, [["routine_id", routineId], ["active", true]]);
});

test("la consulta exige rutina cardio activa y nunca una posición arbitraria", async () => {
  const state = loadAccess({ routine: cardioRoutine(), config: timerConfig() });
  await state.routines.getOwnCardioAccess();
  assert.deepEqual(state.queries[0].filters, [["user_id", userId], ["routine_type", "cardio"], ["active", true]]);
  assert.doesNotMatch(routinesSource, /normalizedCategory|isCardioAssignment|category\.includes\(/);
});

test("categoría y nombre de ejercicios no influyen", () => {
  const start = routinesSource.indexOf("async getOwnCardioAccess");
  const end = routinesSource.indexOf("async getOrCreateActiveCardioRoutine", start);
  const source = routinesSource.slice(start, end);
  assert.doesNotMatch(source, /exercise|category|title|name\.includes/);
  assert.match(source, /routine_type", "cardio"/);
});

test("el bloqueo oculta ejecución y edición incluso con estado residual", () => {
  const start = appSource.indexOf("function blockUserIntervalTimer");
  const end = appSource.indexOf("async function loadUserIntervalTimer", start);
  const source = appSource.slice(start, end);
  assert.match(source, /userIntervalRunner\?\.destroy\(\)/);
  assert.match(source, /userIntervalTimerSection"\)\?\.classList\.add\("hidden"\)/);
  assert.match(source, /btnUserIntervalStart"\)\.disabled = true/);
  assert.match(source, /btnEditUserInterval"\)\.disabled = true/);
});

test("la pantalla directa vuelve a validar y permite regresar", () => {
  assert.match(appSource, /pageId === "intervalTimerPage"\) void loadUserIntervalTimer\(\)/);
  assert.match(html, /id="btnBackFromIntervalTimer"/);
  assert.match(appSource, /btnBackFromIntervalTimer"\)\?\.addEventListener\("click", navigateToRoutine\)/);
});

test("app consume el resultado centralizado sin segunda consulta de acceso", () => {
  const start = appSource.indexOf("async function loadUserIntervalTimer");
  const end = appSource.indexOf("function trainerPreviewElements", start);
  const source = appSource.slice(start, end);
  assert.match(source, /getOwnCardioAccess\(\)/);
  assert.match(source, /if \(!access\.data\?\.allowed\)/);
  assert.match(source, /const stored = access\.data\.config/);
  assert.doesNotMatch(source, /listOwnActive|getForRoutine|interval_timer_configs/);
});

test("errores de Supabase fallan cerrados", async () => {
  const result = await loadAccess({ routineError: { message: "sin conexión" } }).routines.getOwnCardioAccess();
  assert.equal(result.data, null);
  assert.match(result.error.message, /sin conexión/);
  assert.match(appSource, /if \(access\.error\)[\s\S]*?blockUserIntervalTimer/);
});

test("la migración conserva general y evita cardio activo duplicado", () => {
  assert.match(migration, /add column if not exists routine_type text not null default 'general'/);
  assert.match(migration, /check \(routine_type in \('general', 'cardio'\)\)/);
  assert.match(migration, /unique index if not exists routines_one_active_cardio_per_user_idx[\s\S]*?on public\.routines \(user_id\)[\s\S]*?where active = true and routine_type = 'cardio'/);
  assert.doesNotMatch(migration, /update\s+public\.routines/i);
});
