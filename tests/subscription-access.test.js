const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

function message(name) {
  const match = source.match(new RegExp(`const ${name}\\s*=\\s*\\n?\\s*"([^"]+)";`));
  assert.ok(match, `${name} debe existir`);
  return match[1];
}

const messages = {
  expired: message("SUBSCRIPTION_EXPIRED_MESSAGE"),
  inactive: message("SUBSCRIPTION_INACTIVE_MESSAGE"),
  missing: message("SUBSCRIPTION_MISSING_MESSAGE"),
  error: message("SUBSCRIPTION_CHECK_ERROR_MESSAGE")
};

const accessStart = source.indexOf("async function getSupabaseSubscriptionAccess");
const accessEnd = source.indexOf("function blockSupabaseSubscriptionAccess", accessStart);
const accessSource = source.slice(accessStart, accessEnd);

function accessContext(result) {
  const calls = [];
  const context = {
    SUBSCRIPTION_EXPIRED_MESSAGE: messages.expired,
    SUBSCRIPTION_INACTIVE_MESSAGE: messages.inactive,
    SUBSCRIPTION_MISSING_MESSAGE: messages.missing,
    SUBSCRIPTION_CHECK_ERROR_MESSAGE: messages.error,
    console: { error() {} },
    window: {
      TrainerSupabase: {
        subscriptions: {
          getAccessSubscription: async id => {
            calls.push(id);
            return result;
          }
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(accessSource, context);
  return { context, calls };
}

test("usuario con suscripción vigente tiene acceso", async () => {
  const state = accessContext({ data: { effective_status: "active", expiration_date: "2099-01-01" }, error: null });
  const access = await state.context.getSupabaseSubscriptionAccess({ id: "user-1", role: "user" });
  assert.equal(access.allowed, true);
  assert.equal(access.reason, "active");
  assert.deepEqual(state.calls, ["user-1"]);
});

test("usuario próximo a vencer conserva acceso mientras effective_status sea active", async () => {
  const state = accessContext({ data: { effective_status: "active", expiration_date: "2026-08-20" }, error: null });
  const access = await state.context.getSupabaseSubscriptionAccess({ id: "user-2", role: "user" });
  assert.equal(access.allowed, true);
});

test("usuario vencido queda bloqueado", async () => {
  const state = accessContext({ data: { effective_status: "expired", expiration_date: "2026-08-18" }, error: null });
  const access = await state.context.getSupabaseSubscriptionAccess({ id: "user-3", role: "user" });
  assert.equal(access.allowed, false);
  assert.equal(access.reason, "expired");
  assert.equal(access.message, messages.expired);
});

test("suscripción inactiva queda bloqueada con mensaje diferenciado", async () => {
  const state = accessContext({ data: { effective_status: "cancelled" }, error: null });
  const access = await state.context.getSupabaseSubscriptionAccess({ id: "user-inactive", role: "user" });
  assert.equal(access.allowed, false);
  assert.equal(access.reason, "cancelled");
  assert.equal(access.message, messages.inactive);
});

test("administrador y entrenador no quedan bloqueados por suscripciones de clientes", async () => {
  const state = accessContext({ data: null, error: { message: "No debería consultarse" } });
  for (const role of ["admin", "trainer"]) {
    const access = await state.context.getSupabaseSubscriptionAccess({ id: `${role}-1`, role });
    assert.equal(access.allowed, true);
    assert.equal(access.reason, "staff");
  }
  assert.deepEqual(state.calls, []);
});

test("error de Supabase bloquea de forma segura", async () => {
  const state = accessContext({ data: null, error: { message: "Failed to fetch" } });
  const access = await state.context.getSupabaseSubscriptionAccess({ id: "user-4", role: "user" });
  assert.equal(access.allowed, false);
  assert.equal(access.reason, "error");
  assert.equal(access.message, messages.error);
});

test("usuario sin suscripción queda bloqueado sin acceso gratuito silencioso", async () => {
  const state = accessContext({ data: null, error: null });
  const access = await state.context.getSupabaseSubscriptionAccess({ id: "user-5", role: "user" });
  assert.equal(access.allowed, false);
  assert.equal(access.reason, "missing");
  assert.equal(access.message, messages.missing);
});

test("sesión restaurada de usuario vencido vuelve al login sin iniciar la aplicación", async () => {
  const loadStart = source.indexOf("async function loadRestoredSupabaseSession");
  const loadEnd = source.indexOf("function ensureSupabaseAuthStateListener", loadStart);
  const loadSource = source.slice(loadStart, loadEnd);
  const values = new Map([["currentUser", "old@example.com"], ["currentRole", "user"]]);
  const pages = [];
  const alerts = [];
  let started = 0;
  const context = {
    console: { log() {}, error() {} },
    initializedSupabaseUserId: "",
    supabaseSessionLoadPromise: null,
    localStorage: {
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key)
    },
    currentSupabaseProfile: null,
    getSupabaseSubscriptionAccess: async () => ({ allowed: false, message: messages.expired }),
    blockSupabaseSubscriptionAccess: message => {
      values.delete("currentUser");
      values.delete("currentRole");
      alerts.push(message);
      pages.push("loginPage");
    },
    startSession: async () => { started += 1; },
    logout: async () => {},
    window: {
      TrainerSupabase: {
        requireClient: () => ({
          from: () => ({
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: "user-expired", role: "user", active: true, email: "expired@example.com" },
                  error: null
                })
              })
            })
          })
        })
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(loadSource, context);
  const allowed = await context.loadRestoredSupabaseSession({ user: { id: "user-expired", email: "expired@example.com" } });
  assert.equal(allowed, false);
  assert.equal(started, 0);
  assert.equal(values.has("currentUser"), false);
  assert.equal(values.has("currentRole"), false);
  assert.deepEqual(alerts, [messages.expired]);
  assert.deepEqual(pages, ["loginPage"]);
});
