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
  const rows = state.inserts[0];
  assert.equal(rows.length, 4);
  assert.deepEqual(Array.from(rows, row => row.week_number), [1, 2, 3, 4]);
  assert.equal(new Set(rows.map(row => row.week_number)).size, 4);
  assert.ok(rows.every(row => row.routine_id === routineId));
  assert.ok(rows.every(row => row.exercise_id === exerciseId));
  assert.ok(rows.every(row => row.day_name === "Lunes"));
});

function renderMasterAssignments(exerciseCount = 1) {
  const start = app.indexOf("async function renderSelectedUserAssignments");
  const end = app.indexOf("async function renderSelectedUserProfile", start);
  const container = { innerHTML: "", querySelectorAll: () => [] };
  const rows = Array.from({ length: exerciseCount }, (_, exerciseIndex) =>
    [1, 2, 3, 4].map(weekNumber => ({
      id: `${assignmentId.slice(0, -1)}${exerciseIndex}-${weekNumber}`,
      routine_id: routineId,
      exercise_id: `${exerciseId.slice(0, -1)}${exerciseIndex}`,
      week_number: weekNumber,
      day_name: "Martes",
      sets: 4,
      repetitions: 12,
      rest_seconds: 60,
      display_order: exerciseIndex,
      exercises: { title: `Ejercicio ${exerciseIndex + 1}`, category: "Pierna", media_url: "", media_type: "video" }
    }))
  ).flat();
  const elements = {
    selectedUserAssignments: container,
    routineDay: { value: "Martes" }
  };
  const context = {
    window: { TrainerSupabase: {
      isConfigured: () => true,
      routines: { listUserRoutines: async () => ({
        data: [{ id: routineId, name: "Rutina mensual", routine_exercises: rows }],
        error: null
      }) }
    } },
    $: id => elements[id] || null,
    getSelectedUserEmail: () => "usuario@fit51.test",
    getSelectedUserId: () => "55555555-5555-4555-8555-555555555555",
    escapeHTML: value => String(value ?? ""),
    sanitizeMediaURL: () => "",
    console
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context);
  return context.renderSelectedUserAssignments().then(() => container.innerHTML);
}

test("la vista maestra muestra únicamente week_number 1", async () => {
  const rendered = await renderMasterAssignments();
  assert.equal((rendered.match(/assigned-exercise-card/g) || []).length, 1);
  assert.match(rendered, /Ejercicio 1/);
  assert.match(rendered, /Semana 1 · Martes/);
  assert.doesNotMatch(rendered, /Semana [234]/);
  assert.doesNotMatch(html, /id="routineWeek"/);
  assert.match(app, /const selectedWeek = 1/);
  assert.match(app, /Number\(item\.week_number\) === selectedWeek && item\.day_name === selectedDay/);
});

test("varios ejercicios distintos aparecen una sola vez cada uno", async () => {
  const rendered = await renderMasterAssignments(3);
  assert.equal((rendered.match(/assigned-exercise-card/g) || []).length, 3);
  for (const title of ["Ejercicio 1", "Ejercicio 2", "Ejercicio 3"]) {
    assert.equal((rendered.match(new RegExp(title, "g")) || []).length, 1);
  }
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
    routineAssignmentEligibility: {
      userId: "55555555-5555-4555-8555-555555555555",
      status: "COMPLETED"
    },
    ROUTINE_ASSESSMENT_PENDING_MESSAGE: "Cuestionario pendiente",
    ROUTINE_ASSESSMENT_CHECK_ERROR_MESSAGE: "Error al consultar cuestionario",
    updateRoutineAssignmentEligibilityUI: () => {
      elements.btnAssignExerciseToUser.disabled = context.isRoutineAssignmentSubmitting;
    },
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

test("elimina el conjunto mensual desde el UUID real de semana 1", async () => {
  const filters = [];
  const removedRows = [1, 2, 3, 4].map(week_number => ({ id: `${assignmentId}-${week_number}`, week_number }));
  const client = {
    from(table) {
      assert.equal(table, "routine_exercises");
      let operation = "lookup";
      return {
        select() {
          return operation === "delete"
            ? Promise.resolve({ data: removedRows, error: null })
            : this;
        },
        eq(column, value) { filters.push({ operation, column, value }); return this; },
        in(column, value) { filters.push({ operation, column, value }); return this; },
        maybeSingle: async () => ({
          data: { id: assignmentId, routine_id: routineId, exercise_id: exerciseId, week_number: 1, day_name: "Lunes" },
          error: null
        }),
        delete() { operation = "delete"; return this; }
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

  const result = await ns.routines.removeMonthlyExerciseAssignment(assignmentId);
  assert.equal(result.error, null);
  assert.equal(result.data.length, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(filters)), [
    { operation: "lookup", column: "id", value: assignmentId },
    { operation: "delete", column: "routine_id", value: routineId },
    { operation: "delete", column: "exercise_id", value: exerciseId },
    { operation: "delete", column: "day_name", value: "Lunes" },
    { operation: "delete", column: "week_number", value: [1, 2, 3, 4] }
  ]);
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
    window: { TrainerSupabase: { routines: { removeMonthlyExerciseAssignment: async () => { calls += 1; return deleteResult; } } } }
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
  state.context.window.TrainerSupabase.routines.removeMonthlyExerciseAssignment = async () => {
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
  assert.match(app, /removeMonthlyExerciseAssignment\(assignmentId\)/);
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
