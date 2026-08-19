const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const start = source.indexOf("function ensureSupabaseAuthStateListener");
const end = source.indexOf("async function restoreSession", start);
const listenerSource = source.slice(start, end);

function createContext() {
  let callback;
  const restored = [];
  const pages = [];
  const context = {
    console,
    supabaseAuthStateSubscription: null,
    authCallbackFlowActive: false,
    isCompletingPasswordSetup: false,
    TEMPORARY_AUTH_FLOW_KEY: "temporary",
    localStorage: { setItem() {} },
    configurePasswordSetupView() {},
    goToPage: page => pages.push(page),
    $: () => null,
    loadRestoredSupabaseSession: async session => restored.push(session.user.id),
    window: {
      setTimeout: handler => handler(),
      TrainerSupabase: {
        isConfigured: () => true,
        auth: {
          onAuthStateChange: handler => {
            callback = handler;
            return { data: { subscription: {} } };
          }
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(listenerSource, context);
  context.ensureSupabaseAuthStateListener();
  return { callback, restored, pages };
}

test("TOKEN_REFRESHED no restaura ni redirige la aplicación", async () => {
  const state = createContext();
  state.callback("TOKEN_REFRESHED", { user: { id: "user-1" } });
  await Promise.resolve();
  assert.deepEqual(state.restored, []);
  assert.deepEqual(state.pages, []);
});

test("SIGNED_IN repetido al recuperar foco no restaura ni redirige", async () => {
  const state = createContext();
  state.callback("SIGNED_IN", { user: { id: "user-1" } });
  await Promise.resolve();
  assert.deepEqual(state.restored, []);
  assert.deepEqual(state.pages, []);
});

test("INITIAL_SESSION restaura la sesión al cargar una sola vez", async () => {
  const state = createContext();
  state.callback("INITIAL_SESSION", { user: { id: "user-1" } });
  await Promise.resolve();
  assert.deepEqual(state.restored, ["user-1"]);
  assert.deepEqual(state.pages, []);
});
