const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const coreSource = fs.readFileSync(path.join(root, "js", "interval-timer.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
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
    { name: "Subida", intensity: "Nivel 8", duration_seconds: 10 },
    { name: "Llano", intensity: "Nivel 5", duration_seconds: 20 },
    { name: "Sprint", intensity: "Nivel 10", duration_seconds: 5 }
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

test("cada fase usa selector Regenerativo, Exhaustivo u Otro", () => {
  assert.match(appSource, /\[\.\.\.standardNames, "Otro"\]/);
  assert.match(appSource, /className = "interval-phase-name-choice"/);
  assert.match(appSource, /className = "interval-phase-custom-name"/);
  assert.match(appSource, /customName\.classList\.toggle\("hidden", choice !== "Otro"\)/);
  assert.match(appSource, /customName\.disabled = choice !== "Otro"/);
});

test("el nivel de fase es un selector cerrado de Nivel 0 a Nivel 20", () => {
  assert.match(appSource, /intensity\.className = "interval-phase-intensity"/);
  assert.match(appSource, /Array\.from\(\{ length: 21 \}/);
  assert.match(appSource, /option\.value = `Nivel \$\{level\}`/);
  assert.doesNotMatch(appSource, /\["text", "interval-phase-intensity"/);
});

test("la duración de fase limita segundos a 60 y minutos a 30", () => {
  assert.match(appSource, /duration\.max = unit === "minutes" \? "30" : "60"/);
  assert.match(appSource, /duration\.min = "1"/);
  assert.match(appSource, /event\.target\.matches\("\.interval-phase-unit"\)/);
  const start = appSource.indexOf("function intervalPhaseDurationToSeconds");
  const end = appSource.indexOf("function updateIntervalPhaseDurationLimits", start);
  const context = { intervalDurationToSeconds(value, unit) { return Number(value) * (unit === "minutes" ? 60 : 1); } };
  vm.createContext(context);
  vm.runInContext(appSource.slice(start, end), context);
  assert.equal(context.intervalPhaseDurationToSeconds(60, "seconds"), 60);
  assert.ok(Number.isNaN(context.intervalPhaseDurationToSeconds(61, "seconds")));
  assert.equal(context.intervalPhaseDurationToSeconds(30, "minutes"), 1800);
  assert.ok(Number.isNaN(context.intervalPhaseDurationToSeconds(31, "minutes")));
  assert.ok(Number.isNaN(context.intervalPhaseDurationToSeconds(0, "seconds")));
});

test("la validación rechaza niveles fuera del rango 0 a 20", () => {
  const timer = loadCore();
  assert.doesNotThrow(() => timer.normalizeConfig(sample({ phases: [
    { name: "Regenerativo", intensity: "Nivel 0", duration_seconds: 60 }
  ], rounds: 2 })));
  assert.throws(() => timer.normalizeConfig(sample({ phases: [
    { name: "Exhaustivo", intensity: "Nivel 21", duration_seconds: 60 }
  ] })), /debe estar entre Nivel 0 y Nivel 20/);
});

test("convierte minutos a segundos para cálculos y persistencia", () => {
  const start = appSource.indexOf("function intervalDurationToSeconds");
  const end = appSource.indexOf("function updateIntervalPhaseDurationLimits", start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(appSource.slice(start, end), context);
  assert.equal(context.intervalDurationToSeconds(30, "seconds"), 30);
  assert.equal(context.intervalDurationToSeconds(1, "minutes"), 60);
  assert.equal(context.intervalDurationToSeconds(5, "minutes"), 300);
});

test("el usuario conserva controles de ejecución y obtiene edición temporal", () => {
  const start = html.indexOf('<section id="userIntervalTimerSection"');
  const section = html.slice(start, html.indexOf("</main>", start));
  assert.match(section, /btnUserIntervalStart/);
  assert.match(section, /btnUserIntervalPause/);
  assert.match(section, /btnUserIntervalFinish/);
  assert.match(section, /btnEditUserInterval/);
  assert.match(section, /userIntervalEditor/);
  assert.match(section, /btnApplyUserInterval/);
});

test("la configuración temporal no escribe interval_timer_configs ni altera la maestra", () => {
  const start = appSource.indexOf("function applyUserIntervalEditor");
  const end = appSource.indexOf("function restoreUserIntervalMasterConfig", start);
  const applySource = appSource.slice(start, end);
  assert.match(applySource, /installUserIntervalSession\(config\)/);
  assert.doesNotMatch(applySource, /TrainerSupabase|saveForRoutine|interval_timer_configs|localStorage/);
  assert.match(appSource, /userIntervalMasterConfig = cloneIntervalConfig\(stored\)/);
  assert.match(appSource, /userIntervalSessionConfig = cloneIntervalConfig\(config\)/);
  assert.match(appSource, /btnApplyUserInterval"\)\) \$\("btnApplyUserInterval"\)\.disabled = !valid/);
  assert.match(appSource, /validateConfig\(readUserIntervalConfigEditor\(\)\)/);
});

test("restaurar descarta cambios temporales y recupera la receta del entrenador", () => {
  const start = appSource.indexOf("function restoreUserIntervalMasterConfig");
  const end = appSource.indexOf("function notifyIntervalEvent", start);
  const restoreSource = appSource.slice(start, end);
  assert.match(restoreSource, /window\.confirm\("¿Descartar los cambios temporales/);
  assert.match(restoreSource, /installUserIntervalSession\(userIntervalMasterConfig\)/);
  assert.match(restoreSource, /resetUserIntervalEditor\(userIntervalMasterConfig\)/);
});

test("recargar vuelve a obtener Supabase y no restaura cambios temporales", () => {
  const start = appSource.indexOf("async function loadUserIntervalTimer");
  const end = appSource.indexOf("function trainerPreviewElements", start);
  const loadSource = appSource.slice(start, end);
  assert.match(loadSource, /intervalTimers\.listOwnActive\(\)/);
  assert.match(loadSource, /userIntervalMasterConfig = cloneIntervalConfig\(stored\)/);
  assert.doesNotMatch(loadSource, /localStorage|saveForRoutine/);
});

test("timeline conserva orden, estado actual, siguiente y enfriamiento final", () => {
  const timer = loadCore();
  const engine = new timer.IntervalEngine(sample());
  const initial = engine.snapshot(0);
  const initialStages = timer.getRemainingStages(sample(), initial);
  assert.deepEqual(Array.from(initialStages, stage => stage.name), ["Exhaustivo", "Regenerativo", "Exhaustivo", "Regenerativo", "Enfriamiento"]);
  assert.deepEqual(Array.from(initialStages.slice(0, 3), stage => stage.state), ["current", "next", "pending"]);
  assert.equal(initialStages.at(-1).kind, "cooldown");
  const afterFirst = timer.getRemainingStages(sample(), engine.start(0) && engine.tick(30000));
  assert.equal(afterFirst[0].name, "Regenerativo");
  assert.equal(afterFirst[0].state, "current");
  assert.equal(afterFirst[1].name, "Exhaustivo");
  assert.equal(afterFirst[1].state, "next");
  assert.doesNotMatch(afterFirst.map(stage => stage.name).join(","), /^Exhaustivo,/);
});

test("timeline funciona en múltiples rondas sin alterar el motor timestamp-based", () => {
  const timer = loadCore();
  const config = sample({ rounds: 20, work_seconds: 1200 });
  const engine = new timer.IntervalEngine(config);
  engine.start(0);
  const snapshot = engine.tick(180000);
  const stages = timer.getRemainingStages(config, snapshot, 12);
  assert.equal(snapshot.round, 4);
  assert.equal(stages[0].state, "current");
  assert.equal(stages.at(-1).kind, "cooldown");
  assert.ok(stages.omittedCount > 0);
  assert.equal(engine.tick(180000).remainingSeconds, snapshot.remainingSeconds);
});

test("edición queda bloqueada durante ejecución y pausa; terminar permanece operativo", () => {
  assert.match(appSource, /elements\.edit\.disabled = snapshot\.status !== "idle"/);
  assert.match(appSource, /elements\.finish\.onclick/);
  const timer = loadCore();
  const engine = new timer.IntervalEngine(sample());
  engine.start(0);
  assert.equal(engine.pause(10000).status, "paused");
  assert.equal(engine.resume(20000).status, "running");
  assert.equal(engine.finish(25000).status, "finished");
});

test("botones informativos son accesibles y contienen todos los textos aprobados", () => {
  assert.match(html, /data-interval-info="work"[^>]*aria-label/);
  assert.match(html, /data-interval-info="timeline"[^>]*aria-label/);
  assert.match(html, /id="btnCloseIntervalInfo"[^>]*aria-label/);
  [
    "Es la duración total de la parte activa del entrenamiento. No incluye el enfriamiento.",
    "Es el número de veces que se repetirá el conjunto completo de fases.",
    "Define el tipo de esfuerzo: Exhaustivo, Regenerativo u Otro.",
    "Indica la intensidad de la fase en una escala de 0 a 20.",
    "Permite ajustar únicamente tu sesión actual. No modifica la rutina original de tu entrenador.",
    "Vuelve a los tiempos, niveles y fases indicados originalmente por tu entrenador."
  ].forEach(text => assert.match(appSource, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))));
  assert.match(appSource, /event\.key === "Escape"/);
});

test("enfriamiento se captura sólo en minutos, entre 1 y 30", () => {
  assert.doesNotMatch(html, /intervalCooldownUnit|userIntervalCooldownUnit/);
  assert.match(html, /id="intervalCooldownDuration"[^>]*min="1"[^>]*max="30"/);
  assert.match(html, /id="userIntervalCooldownDuration"[^>]*min="1"[^>]*max="30"/);
  const start = appSource.indexOf("function intervalCooldownMinutesToSeconds");
  const end = appSource.indexOf("function updateIntervalPhaseDurationLimits", start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(appSource.slice(start, end), context);
  assert.equal(context.intervalCooldownMinutesToSeconds(1), 60);
  assert.equal(context.intervalCooldownMinutesToSeconds(30), 1800);
  assert.ok(Number.isNaN(context.intervalCooldownMinutesToSeconds(0)));
  assert.ok(Number.isNaN(context.intervalCooldownMinutesToSeconds(31)));
});

test("la pantalla mobile evita overflow y mantiene timeline compacto", () => {
  assert.match(styles, /\.interval-timeline\s*\{[\s\S]*?max-height:[\s\S]*?overflow-y: auto/);
  assert.match(styles, /\.interval-timeline-item\s*\{[\s\S]*?min-width: 0/);
  assert.match(styles, /@media \(max-width: 390px\)/);
  assert.match(styles, /width: min\(360px, calc\(100vw - 2rem\)\)/);
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
