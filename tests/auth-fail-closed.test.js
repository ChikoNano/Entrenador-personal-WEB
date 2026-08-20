const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const unavailableMessageMatch = source.match(
  /const AUTH_SERVICE_UNAVAILABLE_MESSAGE\s*=\s*\n?\s*"([^"]+)";/
);
assert.ok(unavailableMessageMatch, "Debe existir el mensaje de autenticación no disponible");
const unavailableMessage = unavailableMessageMatch[1];

function sourceBetween(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.notEqual(start, -1, `${startText} debe existir`);
  assert.notEqual(end, -1, `${endText} debe existir después de ${startText}`);
  return source.slice(start, end);
}

const loginSource = sourceBetween("async function login", "async function startSession");
const logoutSource = sourceBetween("async function logout", "async function loadRestoredSupabaseSession");
const restoreSource = sourceBetween("async function restoreSession", "/* PERFIL */");

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values
  };
}

function loginContext(trainerSupabase, email = "valid@example.com", password = "correct") {
  const alerts = [];
  const restored = [];
  const localStorage = storage();
  const elements = {
    emailInput: { value: email },
    passwordInput: { value: password }
  };
  const context = {
    AUTH_SERVICE_UNAVAILABLE_MESSAGE: unavailableMessage,
    alert: message => alerts.push(message),
    localStorage,
    $: id => elements[id] || null,
    getUsers: () => { throw new Error("El login no debe consultar usuarios locales"); },
    loadRestoredSupabaseSession: async session => {
      restored.push(session.user.id);
      return true;
    },
    window: { TrainerSupabase: trainerSupabase }
  };
  vm.createContext(context);
  vm.runInContext(loginSource, context);
  return { context, alerts, restored, localStorage };
}

test("Supabase disponible y usuario válido inicia sesión", async () => {
  const state = loginContext({
    isConfigured: () => true,
    auth: { signIn: async () => ({ data: { session: { user: { id: "user-1" } } }, error: null }) }
  });
  await state.context.login();
  assert.deepEqual(state.restored, ["user-1"]);
  assert.deepEqual(state.alerts, []);
});

test("Supabase disponible rechaza contraseña incorrecta", async () => {
  const state = loginContext({
    isConfigured: () => true,
    auth: { signIn: async () => ({ data: null, error: { message: "Credenciales inválidas" } }) }
  });
  await state.context.login();
  assert.deepEqual(state.restored, []);
  assert.match(state.alerts[0], /Credenciales inválidas/);
  assert.equal(state.localStorage.getItem("currentUser"), null);
});

test("Supabase no disponible rechaza las cuentas demo sin fallback", async () => {
  for (const [email, password] of [
    ["usuario@test.com", "1234"],
    ["admin@test.com", "admin"]
  ]) {
    const state = loginContext({ isConfigured: () => false }, email, password);
    await state.context.login();
    assert.equal(state.alerts[0], unavailableMessage);
    assert.equal(state.localStorage.getItem("currentUser"), null);
    assert.deepEqual(state.restored, []);
  }
});

test("Supabase no configurado rechaza acceso", async () => {
  const state = loginContext(undefined, "usuario@test.com", "1234");
  await state.context.login();
  assert.equal(state.alerts[0], unavailableMessage);
  assert.equal(state.localStorage.getItem("currentUser"), null);
});

test("un error de conexión no crea una sesión local falsa", async () => {
  const state = loginContext({
    isConfigured: () => true,
    auth: { signIn: async () => ({ data: null, error: { message: "Failed to fetch" } }) }
  }, "admin@test.com", "admin");
  await state.context.login();
  assert.equal(state.alerts[0], unavailableMessage);
  assert.equal(state.localStorage.getItem("currentUser"), null);
  assert.equal(state.localStorage.getItem("currentRole"), null);
});

test("restoreSession elimina sólo la caché de autenticación si Supabase no está disponible", async () => {
  const localStorage = storage({
    currentUser: "admin@test.com",
    currentRole: "admin",
    exerciseLibrary: "datos-conservados"
  });
  const pages = [];
  const context = {
    AUTH_SERVICE_UNAVAILABLE_MESSAGE: unavailableMessage,
    authCallbackFlowActive: false,
    isCompletingPasswordSetup: false,
    initialSupabaseAuthCallback: { active: false },
    console: { log() {}, error() {} },
    localStorage,
    goToPage: page => pages.push(page),
    window: { TrainerSupabase: { isConfigured: () => false } }
  };
  vm.createContext(context);
  vm.runInContext(restoreSource, context);
  await context.restoreSession();
  assert.equal(localStorage.getItem("currentUser"), null);
  assert.equal(localStorage.getItem("currentRole"), null);
  assert.equal(localStorage.getItem("exerciseLibrary"), "datos-conservados");
  assert.deepEqual(pages, ["loginPage"]);
});

test("logout normal sigue cerrando Supabase y limpiando la caché de sesión", async () => {
  const localStorage = storage({ currentUser: "user@example.com", currentRole: "user" });
  let signedOut = 0;
  const pages = [];
  const elements = {
    emailInput: { value: "user@example.com" },
    passwordInput: { value: "secret" },
    whoami: { classList: { add() {} } },
    btnLogout: { classList: { add() {} } }
  };
  const context = {
    console,
    initializedSupabaseUserId: "user-1",
    localStorage,
    $: id => elements[id] || null,
    goToPage: page => pages.push(page),
    window: {
      TrainerSupabase: {
        isConfigured: () => true,
        auth: { signOut: async () => { signedOut += 1; return { error: null }; } }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(logoutSource, context);
  await context.logout();
  assert.equal(signedOut, 1);
  assert.equal(localStorage.getItem("currentUser"), null);
  assert.equal(localStorage.getItem("currentRole"), null);
  assert.deepEqual(pages, ["loginPage"]);
});
