const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const routinesModule = fs.readFileSync(path.join(root, "js", "supabase-routines.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const schema = fs.readFileSync(path.join(root, "supabase", "schema.sql"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "routine-exercises-dedup-guard.sql"), "utf8");

const routineId = "11111111-1111-4111-8111-111111111111";
const exerciseId = "22222222-2222-4222-8222-222222222222";
const assignmentId = "33333333-3333-4333-8333-333333333333";

function moduleContext(existingRows = []) {
  const inserts = [];
  const deletes = [];
  const tables = [];
  const lookup = {
    select() { return this; },
    eq() { return this; },
    in: async () => ({ data: existingRows, error: null })
  };
  const client = {
    from(table) {
      tables.push(table);
      return {
        select: lookup.select.bind(lookup),
        insert(rows) {
          inserts.push(rows);
          return { select: async () => ({ data: rows.map((row, index) => ({ ...row, id: `${assignmentId}-${index}` })), error: null }) };
        },
        delete() {
          return { eq: async (column, value) => { deletes.push({ column, value }); return { data: null, error: null }; } };
        }
      };
    }
  };
  const ns = {
    requireClient: () => client,
    ok: data => ({ data, error: null }),
    fail: (error, context) => ({ data: null, error: { message: error?.message || String(error), context } })
  };
  const context = { window: { TrainerSupabase: ns }, console: { log() {} } };
  vm.createContext(context);
  vm.runInContext(routinesModule, context);
  return { routines: ns.routines, inserts, deletes, tables };
}

const assignment = overrides => ({
  routine_id: routineId,
  exercise_id: exerciseId,
  day_name: "Lunes",
  sets: 4,
  repetitions: 12,
  rest_seconds: 60,
  ...overrides
});

test("agrega un ejercicio una sola vez como cuatro asignaciones semanales", async () => {
  const state = moduleContext();
  const result = await state.routines.syncExerciseAcrossFourWeeks(assignment());
  assert.equal(result.error, null);
  assert.equal(state.inserts.length, 1);
  assert.deepEqual(Array.from(state.inserts[0], row => row.week_number), [1, 2, 3, 4]);
});

test("impide una asignación duplicada antes del insert", async () => {
  const state = moduleContext([{ id: assignmentId, week_number: 1 }]);
  const result = await state.routines.syncExerciseAcrossFourWeeks(assignment());
  assert.match(result.error.message, /ya está asignado/);
  assert.equal(state.inserts.length, 0);
});

test("la clave lógica permite ejercicios distintos en la misma rutina y día", async () => {
  const first = moduleContext();
  const second = moduleContext();
  const anotherExercise = "44444444-4444-4444-8444-444444444444";
  assert.equal((await first.routines.syncExerciseAcrossFourWeeks(assignment())).error, null);
  assert.equal((await second.routines.syncExerciseAcrossFourWeeks(assignment({ exercise_id: anotherExercise }))).error, null);
  assert.equal(first.inserts.length + second.inserts.length, 2);
});

test("doble clic en Asignar no crea dos solicitudes", async () => {
  const start = app.indexOf("async function assignExerciseToUser");
  const end = app.indexOf("function removeExerciseFromUser", start);
  let release;
  let calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const elements = {
    routineDay: { value: "Lunes" },
    exerciseSelect: { value: exerciseId },
    exerciseSets: { value: "4" },
    exerciseReps: { value: "12" },
    exerciseRest: { value: "60" },
    btnAssignExerciseToUser: { disabled: false, textContent: "Asignar ejercicio" }
  };
  const context = {
    isRoutineAssignmentSubmitting: false,
    window: { TrainerSupabase: {
      isConfigured: () => true,
      routines: { assignExercise: async () => { calls += 1; await pending; return { data: [], error: null }; } }
    } },
    getSelectedUserEmail: () => "usuario@fit51.test",
    getSelectedUserId: () => "55555555-5555-4555-8555-555555555555",
    $: id => elements[id] || null,
    alert() {},
    renderSelectedUserAssignments: async () => {}
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context);

  const first = context.assignExerciseToUser();
  await Promise.resolve();
  const second = context.assignExerciseToUser();
  assert.equal(calls, 1);
  assert.equal(await second, undefined);
  release();
  await first;
  assert.equal(calls, 1);
  assert.equal(elements.btnAssignExerciseToUser.disabled, false);
});

test("elimina por UUID real sólo en routine_exercises", async () => {
  const state = moduleContext();
  const result = await state.routines.removeRoutineExercise(assignmentId);
  assert.equal(result.error, null);
  assert.deepEqual(state.deletes, [{ column: "id", value: assignmentId }]);
  assert.equal(state.tables.includes("exercises"), false);
  assert.equal(state.tables.at(-1), "routine_exercises");
});

function deletionContext(deleteResult) {
  const start = app.indexOf("async function deleteRoutineExerciseAssignment");
  const end = app.indexOf("async function renderSelectedUserAssignments", start);
  let renders = 0;
  let calls = 0;
  const alerts = [];
  const context = {
    deletingRoutineExerciseIds: new Set(),
    confirm: () => true,
    alert: message => alerts.push(message),
    renderSelectedUserAssignments: async () => { renders += 1; },
    window: { TrainerSupabase: { routines: { removeRoutineExercise: async () => { calls += 1; return deleteResult; } } } }
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context);
  return { context, alerts, getRenders: () => renders, getCalls: () => calls };
}

test("error de Supabase mantiene la tarjeta y permite reintentar", async () => {
  const state = deletionContext({ data: null, error: { message: "Fallo remoto" } });
  const button = { disabled: false, isConnected: true };
  assert.equal(await state.context.deleteRoutineExerciseAssignment(assignmentId, button), false);
  assert.equal(state.getRenders(), 0);
  assert.equal(button.disabled, false);
  assert.match(state.alerts[0], /Fallo remoto/);
});

test("eliminación exitosa refresca la interfaz inmediatamente", async () => {
  const state = deletionContext({ data: null, error: null });
  assert.equal(await state.context.deleteRoutineExerciseAssignment(assignmentId, { disabled: false, isConnected: false }), true);
  assert.equal(state.getRenders(), 1);
});

test("doble eliminación del mismo UUID sólo ejecuta una solicitud", async () => {
  let release;
  let calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const state = deletionContext(null);
  state.context.window.TrainerSupabase.routines.removeRoutineExercise = async () => {
    calls += 1;
    await pending;
    return { data: null, error: null };
  };
  const first = state.context.deleteRoutineExerciseAssignment(assignmentId, null);
  const second = await state.context.deleteRoutineExerciseAssignment(assignmentId, null);
  assert.equal(second, false);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, true);
});

test("la interfaz renderiza Eliminar con el UUID real de la asignación", () => {
  assert.match(app, /data-delete-routine-exercise="\$\{escapeHTML\(item\.id\)\}"/);
  assert.match(app, /deleteRoutineExerciseAssignment\(button\.dataset\.deleteRoutineExercise, button\)/);
  assert.match(html, /id="btnAssignExerciseToUser" type="button"/);
});

test("el esquema protege la clave lógica sin borrar duplicados existentes", () => {
  for (const sql of [schema, migration]) {
    assert.match(sql, /unique \(routine_id, exercise_id, week_number, day_name\)/);
  }
  assert.match(migration, /having count\(\*\) > 1/);
  assert.match(migration, /raise exception 'Existen asignaciones duplicadas/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.routine_exercises/i);
});
