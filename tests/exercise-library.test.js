const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(require("node:path").join(__dirname, "..", "app.js"), "utf8");

function functionSource(name, nextName) {
  const functionStart = source.indexOf(`function ${name}`);
  const asyncStart = source.lastIndexOf("async ", functionStart);
  const start = asyncStart === functionStart - 6 ? asyncStart : functionStart;
  const nextFunctionStart = source.indexOf(`function ${nextName}`, start);
  const nextAsyncStart = source.lastIndexOf("async ", nextFunctionStart);
  const end = nextAsyncStart === nextFunctionStart - 6 ? nextAsyncStart : nextFunctionStart;
  assert.notEqual(start, -1, `${name} debe existir`);
  assert.notEqual(end, -1, `${nextName} debe existir después de ${name}`);
  return source.slice(start, end);
}

function createContext(initialLibrary, prompts, trainerSupabase = { isConfigured: () => false }) {
  const values = new Map([["exerciseLibrary", JSON.stringify(initialLibrary)]]);
  const alerts = [];
  const context = {
    console,
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    },
    prompt: () => prompts.shift(),
    confirm: () => true,
    alert: message => alerts.push(message),
    renderAdminData() {},
    renderUserExercises() {},
    window: { TrainerSupabase: trainerSupabase },
    alerts
  };

  vm.createContext(context);
  vm.runInContext(
    functionSource("normalizeExercise", "getExerciseLibrary") +
    functionSource("getExerciseLibrary", "saveExerciseLibrary") +
    functionSource("saveExerciseLibrary", "initializeExerciseLibrary") +
    functionSource("editExerciseTitle", "getSelectedExerciseCategory") +
    functionSource("deleteExerciseFromLibrary", "compressImage"),
    context
  );
  return context;
}

test("edita dos veces, persiste al recargar y conserva el objeto original", async () => {
  const original = {
    id: 2,
    title: "LEG PRESS",
    category: "Pierna",
    type: "video",
    url: "https://example.test/leg-press.mp4",
    description: "Dato que no se edita",
    sets: 4,
    reps: 12
  };
  const context = createContext([original], ["PRENSA DE PIERNA", "PRENSA 45 GRADOS"]);

  await context.editExerciseTitle(2);
  let reloaded = context.getExerciseLibrary();
  assert.equal(reloaded[0].title, "PRENSA DE PIERNA");
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].id, original.id);
  assert.equal(reloaded[0].url, original.url);
  assert.equal(reloaded[0].category, original.category);
  assert.equal(reloaded[0].description, original.description);
  assert.equal(reloaded[0].sets, original.sets);
  assert.equal(reloaded[0].reps, original.reps);

  await context.editExerciseTitle(2);
  reloaded = context.getExerciseLibrary();
  assert.equal(reloaded[0].title, "PRENSA 45 GRADOS");
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].id, original.id);
  assert.equal(reloaded[0].url, original.url);
  assert.equal(reloaded[0].category, original.category);
});

test("normaliza nombres heredados y no usa un title numérico como nombre", () => {
  const context = createContext([
    { id: 7, title: 2, nombre: "PRENSA DE PIERNA", grupoMuscular: "Pierna", videoUrl: "video.mp4" }
  ], []);
  const [exercise] = context.getExerciseLibrary();

  assert.equal(exercise.id, 7);
  assert.equal(exercise.title, "PRENSA DE PIERNA");
  assert.equal(exercise.category, "Pierna");
  assert.equal(exercise.url, "video.mp4");
  assert.equal(exercise.type, "video");
});

test("desactiva exactamente el UUID de la tarjeta antes de actualizar localStorage", async () => {
  const deletedId = "11111111-1111-4111-8111-111111111111";
  const similarId = "22222222-2222-4222-8222-222222222222";
  const calls = [];
  const context = createContext([
    { id: deletedId, title: "PRENSA", category: "Pierna", type: "video", url: "prensa.mp4" },
    { id: similarId, title: "PRENSA", category: "Pierna", type: "video", url: "otra.mp4" }
  ], [], {
    isConfigured: () => true,
    exercises: {
      deactivateExercise: async id => {
        calls.push(id);
        return { data: { id, active: false }, error: null };
      }
    }
  });

  await context.deleteExerciseFromLibrary(deletedId);
  const reloaded = context.getExerciseLibrary();
  assert.deepEqual(calls, [deletedId]);
  assert.equal(reloaded.some(item => item.id === deletedId), false);
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].id, similarId);
  assert.equal(reloaded[0].url, "otra.mp4");
});

test("si Supabase falla mantiene intacta la biblioteca local", async () => {
  const exercise = { id: "33333333-3333-4333-8333-333333333333", title: "LEG PRESS", category: "Pierna", url: "video.mp4" };
  const context = createContext([exercise], [], {
    isConfigured: () => true,
    exercises: {
      deactivateExercise: async () => ({ data: null, error: { message: "Fallo remoto" } })
    }
  });

  await context.deleteExerciseFromLibrary(exercise.id);
  assert.equal(context.getExerciseLibrary().length, 1);
  assert.equal(context.getExerciseLibrary()[0].id, exercise.id);
  assert.match(context.alerts[0], /Fallo remoto/);
});
