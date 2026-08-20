const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const utilities = source.slice(
  source.indexOf("function escapeHTML"),
  source.indexOf("function filterSubscriptions")
);
const addExerciseSource = source.slice(
  source.indexOf("async function addExerciseToLibrary()"),
  source.indexOf("function clearNewExerciseForm")
);

function utilityContext(origin) {
  const location = new URL(origin);
  const context = {
    URL,
    window: {
      location: { origin: location.origin, hostname: location.hostname }
    }
  };
  vm.createContext(context);
  vm.runInContext(utilities, context);
  return context;
}

function createExerciseContext({ origin, mediaUrl }) {
  const util = utilityContext(origin);
  const values = {
    exerciseCategory: { value: "Pierna" },
    exerciseTitle: { value: "PRENSA" },
    exerciseImageUrl: { value: "" },
    exerciseVideoUrl: { value: mediaUrl }
  };
  const alerts = [];
  const inserts = [];
  const client = {
    from: table => ({
      insert: payload => {
        inserts.push({ table, payload });
        return {
          select: () => ({
            single: async () => ({ data: { id: "exercise-1" }, error: null })
          })
        };
      }
    })
  };
  const context = {
    ...util,
    console,
    exerciseLibraryInitialization: null,
    $: id => values[id] || null,
    alert: message => alerts.push(message),
    initializeExerciseLibrary: async () => [],
    clearNewExerciseForm() {},
    renderAdminData() {},
    getExerciseLibrary: () => [],
    saveExerciseLibrary() {},
    window: {
      ...util.window,
      TrainerSupabase: {
        isConfigured: () => true,
        getClient: () => client
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(addExerciseSource, context);
  return { context, inserts, alerts };
}

test("producción HTTPS rechaza HTTP antes de enviar a Supabase", async () => {
  const state = createExerciseContext({
    origin: "https://entrenador.example",
    mediaUrl: "http://ejemplo.com/video.mp4"
  });
  await state.context.addExerciseToLibrary();
  assert.equal(state.inserts.length, 0);
  assert.match(state.alerts[0], /URL multimedia no es segura/);
});

test("producción acepta y guarda Cloudinary HTTPS", async () => {
  const cloudinary = "https://res.cloudinary.com/demo/video/upload/prensa.mp4";
  const state = createExerciseContext({ origin: "https://entrenador.example", mediaUrl: cloudinary });
  await state.context.addExerciseToLibrary();
  assert.equal(state.inserts.length, 1);
  assert.equal(state.inserts[0].payload.media_url, cloudinary);
});

test("producción acepta signed URLs HTTPS de Supabase Storage", () => {
  const context = utilityContext("https://entrenador.example");
  const signed = "https://project.supabase.co/storage/v1/object/sign/avatars/user/avatar.webp?token=abc";
  assert.equal(context.sanitizeMediaURL(signed), signed);
});

test("localhost permite HTTP únicamente por el origen local", async () => {
  const media = "http://servidor-desarrollo.test/video.mp4";
  const state = createExerciseContext({ origin: "http://localhost:5500", mediaUrl: media });
  await state.context.addExerciseToLibrary();
  assert.equal(state.inserts.length, 1);
  assert.equal(state.inserts[0].payload.media_url, media);

  const production = utilityContext("https://entrenador.example");
  assert.equal(production.sanitizeMediaURL(media), "");
});

test("javascript y protocolos desconocidos se rechazan", () => {
  const context = utilityContext("https://entrenador.example");
  assert.equal(context.sanitizeMediaURL("javascript:alert(1)"), "");
  assert.equal(context.sanitizeMediaURL("ftp://ejemplo.com/video.mp4"), "");
});

test("un medio HTTP heredado se conserva pero no obtiene src renderizable", () => {
  const context = utilityContext("https://entrenador.example");
  const legacyExercise = { id: 7, title: "Ejercicio antiguo", url: "http://ejemplo.com/old.mp4" };
  assert.equal(context.sanitizeMediaURL(legacyExercise.url), "");
  assert.equal(legacyExercise.url, "http://ejemplo.com/old.mp4");
  assert.equal(legacyExercise.id, 7);
});

test("blob continúa permitido sólo para previews explícitos", () => {
  const context = utilityContext("https://entrenador.example");
  const preview = "blob:https://entrenador.example/11111111-1111-4111-8111-111111111111";
  assert.equal(context.sanitizeMediaURL(preview), "");
  assert.equal(context.sanitizeMediaURL(preview, { allowBlob: true }), preview);
});
