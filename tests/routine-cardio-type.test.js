const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "js", "supabase-routines.js"), "utf8");
const userId = "11111111-1111-4111-8111-111111111111";
const trainerId = "22222222-2222-4222-8222-222222222222";
const cardioId = "33333333-3333-4333-8333-333333333333";

function setup({ lookups = [], createResult = null } = {}) {
  const inserted = [];
  let lookupIndex = 0;
  const query = {
    eq() { return this; },
    limit() { return this; },
    async maybeSingle() {
      return lookups[lookupIndex++] || { data: null, error: null };
    }
  };
  const client = {
    auth: { async getUser() { return { data: { user: { id: trainerId } }, error: null }; } },
    from(table) {
      assert.equal(table, "routines");
      return {
        select() { return query; },
        insert(value) {
          inserted.push(value);
          return { select() { return { async single() { return createResult; } }; } };
        }
      };
    }
  };
  const ns = {
    requireClient: () => client,
    ok: data => ({ data, error: null }),
    fail: (error, context) => ({ data: null, error: { message: error?.message || String(error), context } })
  };
  const context = { window: { TrainerSupabase: ns }, console, Date };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { routines: ns.routines, inserted, get lookupCount() { return lookupIndex; } };
}

test("guardar sin cardio existente crea una rutina explícitamente cardio", async () => {
  const created = { id: cardioId, user_id: userId, routine_type: "cardio", active: true };
  const state = setup({
    lookups: [{ data: null, error: null }],
    createResult: { data: created, error: null }
  });
  const result = await state.routines.getOrCreateActiveCardioRoutine(userId);
  assert.equal(result.data.id, cardioId);
  assert.equal(state.inserted.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(state.inserted[0])), {
    user_id: userId,
    trainer_id: trainerId,
    name: "Rutina de cardio",
    routine_type: "cardio",
    start_date: new Date().toISOString().slice(0, 10),
    active: true
  });
});

test("guardar nuevamente reutiliza la rutina cardio activa", async () => {
  const existing = { id: cardioId, user_id: userId, routine_type: "cardio", active: true };
  const state = setup({ lookups: [{ data: existing, error: null }] });
  const result = await state.routines.getOrCreateActiveCardioRoutine(userId);
  assert.equal(result.data.id, cardioId);
  assert.equal(state.inserted.length, 0);
});

test("una carrera de doble guardado recupera la rutina protegida por el índice único", async () => {
  const existing = { id: cardioId, user_id: userId, routine_type: "cardio", active: true };
  const state = setup({
    lookups: [{ data: null, error: null }, { data: existing, error: null }],
    createResult: { data: null, error: { code: "23505", message: "duplicate key" } }
  });
  const result = await state.routines.getOrCreateActiveCardioRoutine(userId);
  assert.equal(result.data.id, cardioId);
  assert.equal(state.inserted.length, 1);
  assert.equal(state.lookupCount, 2);
});

test("el flujo de ejercicios generales no convierte su rutina a cardio", () => {
  const start = source.indexOf("async getOrCreateActiveRoutine");
  const end = source.indexOf("async assignExercise", start);
  const generalSource = source.slice(start, end);
  assert.match(generalSource, /name: "Rutina activa"/);
  assert.doesNotMatch(generalSource, /routine_type:\s*"cardio"/);
});

test("guardar explícitamente migra la configuración legacy sin modificar su rutina general", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const loadStart = app.indexOf("async function loadTrainerIntervalConfig");
  const saveStart = app.indexOf("async function saveTrainerIntervalTimer", loadStart);
  const saveEnd = app.indexOf("/* INICIO */", saveStart);
  const loadSource = app.slice(loadStart, saveStart);
  const saveSource = app.slice(saveStart, saveEnd);
  assert.match(loadSource, /findForRoutines\([\s\S]*?routine_type === "general"/);
  assert.match(loadSource, /selectedTrainerIntervalRoutineId = routine\?\.id \|\| ""/);
  assert.match(saveSource, /getOrCreateActiveCardioRoutine\(userId\)/);
  assert.match(saveSource, /saveForRoutine\(routineId, config\)/);
  assert.doesNotMatch(saveSource, /updateRoutine|routine_type:\s*"cardio"/);
});
