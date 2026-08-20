const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const start = source.indexOf("async function getDashboardSupabaseData");
const end = source.indexOf("/* SUSCRIPCIONES */", start);
const dashboardSource = source.slice(start, end);

const exercise = (overrides = {}) => ({
  id: "assignment-1",
  exercise_id: "exercise-1",
  week_number: 1,
  day_name: "Lunes",
  sets: 4,
  repetitions: 12,
  display_order: 1,
  exercises: {
    title: "PRENSA DE PIERNA",
    media_url: "https://cdn.example/prensa.jpg",
    media_type: "image",
    category: "Pierna",
    active: true
  },
  ...overrides
});

function createContext({ routines = [], completions = [], routineError = null, progressError = null } = {}) {
  const elements = new Map([
    ["dashboardUserName", { textContent: "" }],
    ["dashboardProgressPercent", { textContent: "" }],
    ["dashboardProgressText", { textContent: "" }],
    ["todayRoutineLabel", { textContent: "" }],
    ["todayExercisesPreview", { innerHTML: "" }]
  ]);
  const storage = new Map([
    ["currentUser", "persona@example.com"],
    ["userAssignments", JSON.stringify({ "persona@example.com": { Lunes: [{ exerciseId: "old" }] } })],
    ["completedExercises", JSON.stringify({ old: true })],
    ["exerciseLibrary", JSON.stringify([{ id: "old", title: "RUTINA ANTIGUA" }])]
  ]);
  const context = {
    console,
    selectedRoutineWeek: "Semana 1",
    localStorage: { getItem: key => storage.get(key) ?? null },
    getUsers: () => ({ "persona@example.com": { name: "Persona" } }),
    escapeHTML: value => String(value),
    sanitizeMediaURL: value => String(value || ""),
    $: id => elements.get(id) || null,
    Date: class extends Date { getDay() { return 1; } },
    window: {
      TrainerSupabase: {
        isConfigured: () => true,
        routines: {
          listOwnActiveRoutines: async () => routineError
            ? { error: routineError }
            : { data: { userId: "user-1", routines }, error: null }
        },
        progress: {
          listOwnCompletions: async () => progressError
            ? { error: progressError }
            : { data: completions, error: null }
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(dashboardSource, context);
  return { context, elements, storage };
}

test("muestra la rutina de Supabase con localStorage heredado vacío o irrelevante", async () => {
  const state = createContext({ routines: [{ routine_exercises: [exercise()] }] });
  state.storage.delete("userAssignments");
  state.storage.delete("exerciseLibrary");
  await state.context.renderDashboard();
  assert.match(state.elements.get("todayExercisesPreview").innerHTML, /PRENSA DE PIERNA/);
  assert.equal(state.elements.get("dashboardProgressText").textContent, "0 de 1 ejercicios completados");
});

test("calcula el progreso únicamente con completados de Supabase", async () => {
  const state = createContext({
    routines: [{ routine_exercises: [exercise()] }],
    completions: [{ routine_exercise_id: "assignment-1", week_number: 1 }]
  });
  state.storage.delete("completedExercises");
  await state.context.renderDashboard();
  assert.equal(state.elements.get("dashboardProgressPercent").textContent, "100%");
  assert.equal(state.elements.get("dashboardProgressText").textContent, "1 de 1 ejercicios completados");
});

test("ignora una rutina local antigua distinta de Supabase", async () => {
  const state = createContext({ routines: [{ routine_exercises: [exercise()] }] });
  await state.context.renderDashboard();
  const preview = state.elements.get("todayExercisesPreview").innerHTML;
  assert.match(preview, /PRENSA DE PIERNA/);
  assert.doesNotMatch(preview, /RUTINA ANTIGUA/);
});

test("una sesión limpia obtiene datos correctos sin caché", async () => {
  const state = createContext({ routines: [{ routine_exercises: [exercise()] }] });
  state.storage.delete("userAssignments");
  state.storage.delete("completedExercises");
  state.storage.delete("exerciseLibrary");
  await state.context.renderDashboard();
  assert.equal(state.elements.get("dashboardProgressPercent").textContent, "0%");
  assert.match(state.elements.get("todayExercisesPreview").innerHTML, /PRENSA DE PIERNA/);
});

test("usuario sin rutina muestra el estado vacío", async () => {
  const state = createContext();
  const data = await state.context.getDashboardSupabaseData();
  await state.context.renderDashboard();
  assert.equal(data.status, "NOT_FOUND");
  assert.equal(state.elements.get("dashboardProgressPercent").textContent, "0%");
  assert.equal(state.elements.get("dashboardProgressText").textContent, "No tienes una rutina asignada");
  assert.match(state.elements.get("todayExercisesPreview").innerHTML, /No tienes ejercicios asignados/);
});

test("distingue una rutina existente pero vacía de un usuario sin rutina", async () => {
  const state = createContext({ routines: [{ id: "routine-1", routine_exercises: [] }] });
  const data = await state.context.getDashboardSupabaseData();
  await state.context.renderDashboard();
  assert.equal(data.status, "EMPTY_ROUTINE");
  assert.equal(state.elements.get("dashboardProgressText").textContent, "No tienes una rutina asignada");
});

test("un error de rutinas no muestra la caché local como actual", async () => {
  const state = createContext({ routineError: new Error("fallo remoto") });
  await state.context.renderDashboard();
  assert.equal(state.elements.get("dashboardProgressPercent").textContent, "--");
  assert.equal(state.elements.get("dashboardProgressText").textContent, "No se pudo cargar el progreso");
  assert.doesNotMatch(state.elements.get("todayExercisesPreview").innerHTML, /RUTINA ANTIGUA/);
});

test("un error de progreso invalida el resultado completo del dashboard", async () => {
  const state = createContext({
    routines: [{ routine_exercises: [exercise()] }],
    progressError: new Error("fallo remoto")
  });
  await state.context.renderDashboard();
  assert.equal(state.elements.get("dashboardProgressPercent").textContent, "--");
  assert.doesNotMatch(state.elements.get("todayExercisesPreview").innerHTML, /PRENSA DE PIERNA/);
});

test("no cuenta asociaciones duplicadas, completados ajenos ni ejercicios inactivos", async () => {
  const active = exercise();
  const state = createContext({
    routines: [{ routine_exercises: [
      active,
      active,
      exercise({ id: "inactive", exercises: { title: "INACTIVO", active: false } })
    ] }],
    completions: [
      { routine_exercise_id: "assignment-1", week_number: 1 },
      { routine_exercise_id: "unrelated", week_number: 1 }
    ]
  });
  await state.context.renderDashboard();
  assert.equal(state.elements.get("dashboardProgressText").textContent, "1 de 1 ejercicios completados");
});
