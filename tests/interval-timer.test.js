const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const coreSource = fs.readFileSync(path.join(root, "js", "interval-timer.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const service = fs.readFileSync(path.join(root, "js", "supabase-interval-timers.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "interval-timer-config-v1.sql"), "utf8");
const workTimeMigration = fs.readFileSync(path.join(root, "supabase", "interval-timer-work-time-v1.sql"), "utf8");

function loadCore() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(coreSource, context);
  return context.window.FIT51IntervalTimer;
}

const sample = overrides => ({
  rounds: 2,
  work_seconds: 120,
  phases: [
    { name: "Exhaustivo", intensity: "Nivel 10", duration_seconds: 30 },
    { name: "Regenerativo", intensity: "Nivel 6", duration_seconds: 30 }
  ],
  cooldown: { name: "Enfriamiento", intensity: "Nivel 5", duration_seconds: 300 },
  ...overrides
});

test("calcula ronda, trabajo y tiempo total automáticamente", () => {
  const summary = loadCore().calculateSummary(sample({ rounds: 20, work_seconds: 1200 }));
  assert.equal(summary.roundSeconds, 60);
  assert.equal(summary.configuredWorkSeconds, 1200);
  assert.equal(summary.workSeconds, 1200);
  assert.equal(summary.cooldownSeconds, 300);
  assert.equal(summary.totalSeconds, 1500);
});

test("inicia el cronómetro en la primera fase", () => {
  const { IntervalEngine } = loadCore();
  const engine = new IntervalEngine(sample(), { now: () => 1000 });
  const state = engine.start(1000);
  assert.equal(state.status, "running");
  assert.equal(state.round, 1);
  assert.equal(state.phase.name, "Exhaustivo");
  assert.equal(state.remainingSeconds, 30);
});

test("pausa y reanuda sin perder ni consumir tiempo pausado", () => {
  const { IntervalEngine } = loadCore();
  const engine = new IntervalEngine(sample());
  engine.start(0);
  assert.equal(engine.pause(10000).remainingSeconds, 20);
  assert.equal(engine.snapshot(80000).remainingSeconds, 20);
  engine.resume(80000);
  assert.equal(engine.tick(85000).remainingSeconds, 15);
});

test("cambia automáticamente de fase usando timestamps", () => {
  const events = [];
  const { IntervalEngine } = loadCore();
  const engine = new IntervalEngine(sample(), { onEvent: type => events.push(type) });
  engine.start(0);
  const state = engine.tick(30000);
  assert.equal(state.phase.name, "Regenerativo");
  assert.ok(events.includes("phase"));
});

test("incrementa la ronda y vuelve a la primera fase", () => {
  const events = [];
  const { IntervalEngine } = loadCore();
  const engine = new IntervalEngine(sample(), { onEvent: type => events.push(type) });
  engine.start(0);
  const state = engine.tick(60000);
  assert.equal(state.round, 2);
  assert.equal(state.phase.name, "Exhaustivo");
  assert.ok(events.includes("round"));
});

test("inicia enfriamiento después de la última ronda", () => {
  const events = [];
  const { IntervalEngine } = loadCore();
  const engine = new IntervalEngine(sample(), { onEvent: type => events.push(type) });
  engine.start(0);
  const state = engine.tick(120000);
  assert.equal(state.mode, "cooldown");
  assert.equal(state.phase.name, "Enfriamiento");
  assert.ok(events.includes("cooldown"));
});

test("finaliza después del enfriamiento", () => {
  const events = [];
  const { IntervalEngine } = loadCore();
  const engine = new IntervalEngine(sample(), { onEvent: type => events.push(type) });
  engine.start(0);
  const state = engine.tick(420000);
  assert.equal(state.mode, "finished");
  assert.equal(state.totalRemainingSeconds, 0);
  assert.ok(events.includes("finish"));
});

test("emite la cuenta regresiva 3, 2, 1", () => {
  const values = [];
  const { IntervalEngine } = loadCore();
  const engine = new IntervalEngine(sample(), {
    onEvent(type, state) { if (type === "countdown") values.push(state.countdown); }
  });
  engine.start(0);
  engine.tick(27000);
  engine.tick(28000);
  engine.tick(29000);
  assert.deepEqual(values, [3, 2, 1]);
});

test("admite múltiples fases con nombres personalizados", () => {
  const timer = loadCore();
  const config = timer.normalizeConfig(sample({ phases: [
    { name: "Subida", intensity: "RPE 8", duration_seconds: 10 },
    { name: "Llano", intensity: "RPE 5", duration_seconds: 20 },
    { name: "Sprint", intensity: "RPE 10", duration_seconds: 5 }
  ] }));
  assert.deepEqual(Array.from(config.phases, phase => phase.name), ["Subida", "Llano", "Sprint"]);
  assert.equal(timer.calculateSummary(config).roundSeconds, 35);
});

test("calcula correctamente diferentes cantidades de rondas", () => {
  const timer = loadCore();
  assert.equal(timer.calculateSummary(sample({ rounds: 1, work_seconds: 60 })).configuredWorkSeconds, 60);
  assert.equal(timer.calculateSummary(sample({ rounds: 7, work_seconds: 420 })).configuredWorkSeconds, 420);
});

test("la ausencia de vibración no interrumpe los avisos", () => {
  const start = appSource.indexOf("function notifyIntervalEvent");
  const end = appSource.indexOf("function createIntervalRunner", start);
  const context = { window: { navigator: {} } };
  vm.createContext(context);
  vm.runInContext(appSource.slice(start, end), context);
  assert.doesNotThrow(() => context.notifyIntervalEvent("phase"));
});

test("el campo nombre fue eliminado y el entrenador edita tiempo de trabajo", () => {
  assert.doesNotMatch(html, /intervalTrainingName|Nombre del entrenamiento/);
  assert.doesNotMatch(service, /name:\s*config\.name/);
  assert.match(html, /id="intervalWorkDuration"[^>]*max="30"/);
  assert.match(html, /id="intervalWorkUnit"/);
  assert.match(html, /id="intervalRounds"/);
  assert.match(html, /id="btnAddIntervalPhase"/);
  assert.match(appSource, /interval-phase-intensity/);
  assert.match(html, /id="intervalCooldownDuration"/);
  assert.match(appSource, /readIntervalConfigEditor/);
});

test("el usuario sólo recibe controles de ejecución y no edita la configuración", () => {
  const section = html.match(/<section id="userIntervalTimerSection"[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(section, /btnUserIntervalStart/);
  assert.match(section, /btnUserIntervalPause/);
  assert.match(section, /btnUserIntervalFinish/);
  assert.doesNotMatch(section, /<input|<select|btnAddIntervalPhase/);
});

test("la rutina diaria del entrenador permanece primero sin eliminar opciones secundarias", () => {
  const primary = html.indexOf('data-routine-priority="primary"');
  const secondary = html.indexOf('data-routine-priority="secondary"');
  assert.ok(primary >= 0);
  assert.ok(secondary > primary);
  assert.match(html, /id="assignedVideos"/);
  assert.match(html, /id="assignedImages"/);
  assert.match(html, /id="userIntervalTimerSection"/);
  assert.match(appSource, /item\.day_name === day/);
});

test("persiste sólo configuración y no resultados de sesión", () => {
  assert.match(service, /from\("interval_timer_configs"\)/);
  assert.match(service, /rounds: config\.rounds[\s\S]*work_seconds: config\.work_seconds[\s\S]*phases: config\.phases[\s\S]*cooldown: config\.cooldown/);
  assert.doesNotMatch(service, /result|history|session|performance|completion/i);
  assert.doesNotMatch(migration, /timer_results|timer_sessions|performance|statistics/i);
  assert.match(migration, /No almacena resultados, sesiones, estadísticas ni desempeño/);
});

test("la configuración usa RLS asociada a la rutina", () => {
  assert.match(migration, /routine_id uuid not null unique references public\.routines\(id\)/);
  assert.match(migration, /alter table public\.interval_timer_configs enable row level security/);
  assert.match(migration, /r\.user_id = auth\.uid\(\) or public\.can_manage_user\(r\.user_id\)/);
  assert.match(migration, /public\.can_manage_user\(r\.user_id\)/);
});

test("rechaza tiempo de trabajo superior a 30 minutos", () => {
  const timer = loadCore();
  assert.throws(
    () => timer.normalizeConfig(sample({ work_seconds: 1801 })),
    /El tiempo de trabajo máximo permitido es de 30 minutos\./
  );
});

test("exige igualdad exacta entre fases por rondas y tiempo de trabajo", () => {
  const timer = loadCore();
  assert.doesNotThrow(() => timer.validateConfig(sample({ work_seconds: 120 })));
  assert.throws(
    () => timer.validateConfig(sample({ work_seconds: 121 })),
    /La configuración suma 02:00 min y el tiempo de trabajo indicado es 02:01 min/
  );
});

test("el enfriamiento queda fuera del trabajo y sólo se suma al total", () => {
  const summary = loadCore().calculateSummary(sample({ work_seconds: 120 }));
  assert.equal(summary.workSeconds, 120);
  assert.equal(summary.configuredWorkSeconds, 120);
  assert.equal(summary.cooldownSeconds, 300);
  assert.equal(summary.totalSeconds, 420);
});

test("la interfaz bloquea Guardar y Previsualizar mientras no coincide", () => {
  assert.match(appSource, /btnSaveIntervalTimer"\)\) \$\("btnSaveIntervalTimer"\)\.disabled = !valid/);
  assert.match(appSource, /btnPreviewIntervalTimer"\)\) \$\("btnPreviewIntervalTimer"\)\.disabled = !valid/);
  assert.match(appSource, /validateConfig\(readIntervalConfigEditor\(\)\)/);
});

test("la migración incremental elimina nombre y protege el tiempo de trabajo", () => {
  assert.match(workTimeMigration, /drop column if exists name/);
  assert.match(workTimeMigration, /work_seconds between 1 and 1800/);
  assert.match(workTimeMigration, /work_seconds = public\.interval_timer_configured_work_seconds\(phases, rounds\)/);
});

test("guardar asigna únicamente la configuración normalizada a la rutina", async () => {
  const timer = loadCore();
  let upserted = null;
  const builder = {
    upsert(value) { upserted = value; return this; },
    select() { return this; },
    single: async () => ({ data: { id: "config-1", ...upserted }, error: null })
  };
  const ns = {
    requireClient: () => ({ from: table => {
      assert.equal(table, "interval_timer_configs");
      return builder;
    } }),
    ok: data => ({ data, error: null }),
    fail: error => ({ data: null, error: { message: error?.message || String(error) } })
  };
  const context = { window: { FIT51IntervalTimer: timer, TrainerSupabase: ns } };
  vm.createContext(context);
  vm.runInContext(service, context);
  const routineId = "11111111-1111-4111-8111-111111111111";
  const result = await ns.intervalTimers.saveForRoutine(routineId, sample());
  assert.equal(result.error, null);
  assert.equal(upserted.routine_id, routineId);
  assert.equal(upserted.rounds, 2);
  assert.equal(upserted.work_seconds, 120);
  assert.equal(upserted.phases.length, 2);
  assert.equal(upserted.cooldown.duration_seconds, 300);
  assert.deepEqual(Object.keys(upserted).sort(), ["active", "cooldown", "phases", "rounds", "routine_id", "work_seconds"]);
});

test("una configuración incoherente no ejecuta upsert en Supabase", async () => {
  const timer = loadCore();
  let writes = 0;
  const ns = {
    requireClient: () => ({ from: () => ({ upsert() { writes += 1; return this; } }) }),
    ok: data => ({ data, error: null }),
    fail: error => ({ data: null, error: { message: error?.message || String(error) } })
  };
  const context = { window: { FIT51IntervalTimer: timer, TrainerSupabase: ns } };
  vm.createContext(context);
  vm.runInContext(service, context);
  const result = await ns.intervalTimers.saveForRoutine(
    "11111111-1111-4111-8111-111111111111",
    sample({ work_seconds: 121 })
  );
  assert.match(result.error.message, /Ajusta rondas o tiempos/);
  assert.equal(writes, 0);
});
