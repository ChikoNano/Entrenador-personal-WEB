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
const libraryRenderer = source.slice(
  source.indexOf("function renderExerciseLibrary"),
  source.indexOf("async function editExerciseTitle")
);
const profileRenderer = source.slice(
  source.indexOf("function renderProfileCard"),
  source.indexOf("function readProfilePhotoAsDataUrl")
);

function loadUtilities() {
  const context = {
    URL,
    window: { location: { origin: "https://app.example", hostname: "app.example" } }
  };
  vm.createContext(context);
  vm.runInContext(utilities, context);
  return context;
}

function renderLibrary(exercise) {
  const util = loadUtilities();
  const container = { innerHTML: "" };
  const search = { value: exercise.title };
  const categoryFilter = { replaceChildren() {}, value: "" };
  const count = { textContent: "" };
  const context = {
    ...util,
    activeExerciseFilter: null,
    Option: class Option { constructor(text, value) { this.text = text; this.value = value; } },
    getExerciseLibrary: () => [exercise],
    $: id => ({
      exerciseLibraryList: container,
      exerciseLibrarySearch: search,
      exerciseLibraryCategoryFilter: categoryFilter,
      exerciseLibraryCount: count
    })[id] || null
  };
  vm.createContext(context);
  vm.runInContext(libraryRenderer, context);
  context.renderExerciseLibrary();
  return container.innerHTML;
}

function renderProfile({ name, goal = "Fuerza", photo = "" }) {
  const util = loadUtilities();
  const container = { innerHTML: "" };
  const values = new Map([
    ["currentUser", "persona@example.com"],
    ["profile_persona@example.com", JSON.stringify({ name, goal, age: 30, weight: 70, height: 170 })],
    ["questionnaire_persona@example.com", JSON.stringify({ completed: true })],
    ["profilePhoto_persona@example.com", photo]
  ]);
  const context = {
    ...util,
    pendingProfilePhotoPreviewUrl: "",
    currentSupabaseProfile: null,
    localStorage: { getItem: key => values.get(key) ?? null },
    $: id => id === "profileCard" ? container : null,
    getAerobicResult: () => "No registrado"
  };
  vm.createContext(context);
  vm.runInContext(profileRenderer, context);
  context.renderProfileCard();
  return container.innerHTML;
}

test("un título con HTML se muestra escapado y no crea una imagen atacante", () => {
  const html = renderLibrary({
    id: "exercise-1",
    category: "Pierna",
    title: "<img src=x onerror=alert(1)>",
    type: "image",
    url: "https://res.cloudinary.com/demo/image/upload/exercise.jpg"
  });
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<strong><img src=x/);
});

test("un nombre con script se neutraliza en la tarjeta de perfil", () => {
  const html = renderProfile({ name: "<script>alert(1)</script>" });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test("javascript: no se acepta como URL de medio", () => {
  const util = loadUtilities();
  assert.equal(util.sanitizeMediaURL("javascript:alert(1)"), "");
  const html = renderLibrary({
    id: "exercise-2",
    category: "Pierna",
    title: "Prensa",
    type: "image",
    url: "javascript:alert(1)"
  });
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /Vista previa no disponible/);
});

test("una URL HTTPS válida de Cloudinary permanece habilitada", () => {
  const util = loadUtilities();
  const cloudinary = "https://res.cloudinary.com/demo/video/upload/exercise.mp4";
  assert.equal(util.sanitizeMediaURL(cloudinary), cloudinary);
});

test("data: sólo se permite explícitamente para imágenes de avatar", () => {
  const util = loadUtilities();
  const image = "data:image/png;base64,aGVsbG8=";
  assert.equal(util.sanitizeMediaURL(image), "");
  assert.equal(util.sanitizeMediaURL(image, { allowDataImage: true }), image);
  assert.equal(util.sanitizeMediaURL("data:text/html;base64,PHNjcmlwdD4=", { allowDataImage: true }), "");
});

test("valores normales conservan el render visual esperado", () => {
  const html = renderLibrary({
    id: "exercise-3",
    category: "Pierna",
    title: "PRENSA 45 GRADOS",
    type: "video",
    url: "https://res.cloudinary.com/demo/video/upload/prensa.mp4"
  });
  assert.match(html, /PRENSA 45 GRADOS/);
  assert.match(html, /Pierna/);
  assert.match(html, /<video controls/);
});

test("una URL peligrosa de foto no llega al atributo src", () => {
  const html = renderProfile({ name: "Persona", photo: "javascript:alert(1)" });
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /profile-placeholder/);
});
