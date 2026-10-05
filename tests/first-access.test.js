const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const edgeSource = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "functions", "invite-user", "index.ts"),
  "utf8"
);

function between(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.notEqual(start, -1, `${startText} debe existir`);
  assert.notEqual(end, -1, `${endText} debe existir`);
  return source.slice(start, end);
}

const helperSource = between("function showPasswordSetupMessage", "function togglePasswordVisibility");
const initializeSource = between("async function initializePasswordSetupFlow", "function clearTemporarySupabaseAuthState");
const passwordSource = between("async function createInvitedUserPassword", "function syncMobilePrimaryNavigation");
const resendSource = between("async function resendSelectedUserAccess", "async function initializePasswordSetupFlow");
const listenerSource = between("function ensureSupabaseAuthStateListener", "async function restoreSession");

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function callbackContext({ session = null, error = null, callback = {}, delayed = false } = {}) {
  const elements = {
    btnCreatePassword: { disabled: true, textContent: "Crear contraseña" },
    passwordSetupMessage: {
      textContent: "",
      classList: {
        values: new Set(["hidden"]),
        add(value) { this.values.add(value); },
        remove(...values) { values.forEach(value => this.values.delete(value)); }
      }
    },
    newAccountPassword: { focus() {} }
  };
  const pages = [];
  let timerHandler = null;
  const localStorage = storage();
  const context = {
    AUTH_CALLBACK_SESSION_WAIT_MS: 8000,
    TEMPORARY_AUTH_FLOW_KEY: "temporary-auth",
    initialSupabaseAuthCallback: {
      active: true,
      type: callback.type || "invite",
      errorDescription: callback.errorDescription || null,
      errorCode: callback.errorCode || null
    },
    passwordSetupMode: "invite",
    authCallbackFlowActive: true,
    authCallbackSession: null,
    authCallbackSessionWaiter: null,
    passwordSetupInitializationPromise: null,
    localStorage,
    $: id => elements[id] || null,
    configurePasswordSetupView: mode => { context.passwordSetupMode = mode; },
    goToPage: page => pages.push(page),
    window: {
      setTimeout: handler => {
        timerHandler = handler;
        if (!delayed) handler();
        return 1;
      },
      clearTimeout() {},
      TrainerSupabase: {
        isConfigured: () => true,
        getClient: () => ({ auth: { getSession: async () => ({ data: { session }, error }) } })
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(helperSource, context);
  vm.runInContext(initializeSource, context);
  return { context, elements, pages, fireTimeout: () => timerHandler?.() };
}

test("habilita creación cuando la sesión del callback ya está disponible", async () => {
  const state = callbackContext({ session: { user: { id: "user-1" } } });
  assert.equal(await state.context.initializePasswordSetupFlow(), true);
  assert.equal(state.elements.btnCreatePassword.disabled, false);
  assert.equal(state.elements.passwordSetupMessage.textContent, "");
});

test("getSession null seguido de SIGNED_IN habilita y elimina el falso error", async () => {
  const state = callbackContext({ delayed: true });
  const initializing = state.context.initializePasswordSetupFlow();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(state.elements.passwordSetupMessage.textContent, /verificando/i);
  state.context.enablePasswordSetupForSession({ user: { id: "user-late" } }, "invite");
  assert.equal(await initializing, true);
  assert.equal(state.elements.btnCreatePassword.disabled, false);
  assert.equal(state.elements.passwordSetupMessage.textContent, "");
});

test("doble inicialización comparte una única consulta de sesión", async () => {
  const state = callbackContext({ session: { user: { id: "user-1" } } });
  let calls = 0;
  state.context.window.TrainerSupabase.getClient = () => ({
    auth: { getSession: async () => { calls += 1; return { data: { session: { user: { id: "user-1" } } }, error: null }; } }
  });
  await Promise.all([
    state.context.initializePasswordSetupFlow(),
    state.context.initializePasswordSetupFlow()
  ]);
  assert.equal(calls, 1);
});

test("callback code y callback hash se reconocen sin intercambio manual duplicado", () => {
  const descriptor = source.slice(
    source.indexOf("const initialSupabaseAuthCallback"),
    source.indexOf("const TEMPORARY_AUTH_FLOW_KEY")
  );
  assert.match(descriptor, /query\.has\("code"\)/);
  assert.match(descriptor, /hash\.has\("access_token"\)/);
  assert.doesNotMatch(source, /exchangeCodeForSession|verifyOtp\(|setSession\(/);
});

test("error_description y error_code vencidos producen mensaje específico", async () => {
  const state = callbackContext({ callback: { errorDescription: "Email link is invalid or has expired", errorCode: "otp_expired" } });
  await state.context.initializePasswordSetupFlow();
  assert.match(state.elements.passwordSetupMessage.textContent, /no es válido o expiró/i);
  assert.equal(state.elements.btnCreatePassword.disabled, true);
});

test("fallo temporal de red no se presenta como enlace expirado", async () => {
  const state = callbackContext({ error: { message: "Failed to fetch" } });
  await state.context.initializePasswordSetupFlow();
  assert.match(state.elements.passwordSetupMessage.textContent, /conectar/i);
  assert.doesNotMatch(state.elements.passwordSetupMessage.textContent, /expir/i);
});

test("error inesperado de callback tiene mensaje seguro", async () => {
  const state = callbackContext({ error: { message: "internal auth failure" } });
  await state.context.initializePasswordSetupFlow();
  assert.match(state.elements.passwordSetupMessage.textContent, /autenticación/i);
  assert.doesNotMatch(state.elements.passwordSetupMessage.textContent, /internal auth failure/i);
});

test("contraseña rechazada se diferencia de enlace expirado", () => {
  const state = callbackContext();
  const message = state.context.getPasswordSetupErrorMessage({ code: "weak_password", message: "Password should be stronger" }, "password");
  assert.match(message, /requisitos de seguridad/i);
  assert.doesNotMatch(message, /expir/i);
});

test("SIGNED_IN del callback usa el habilitador determinista", () => {
  let authHandler;
  const enabled = [];
  const context = {
    supabaseAuthStateSubscription: null,
    authCallbackFlowActive: true,
    isCompletingPasswordSetup: false,
    enablePasswordSetupForSession: (session, mode) => enabled.push([session.user.id, mode]),
    loadRestoredSupabaseSession() {},
    console,
    window: {
      setTimeout: handler => handler(),
      TrainerSupabase: {
        isConfigured: () => true,
        auth: { onAuthStateChange: handler => { authHandler = handler; return { data: { subscription: {} } }; } }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(listenerSource, context);
  context.ensureSupabaseAuthStateListener();
  authHandler("SIGNED_IN", { user: { id: "user-late" } });
  assert.deepEqual(enabled, [["user-late", undefined]]);
});

test("reemisión usa recuperación del mismo usuario sin crear ni duplicar datos", async () => {
  const calls = [];
  const alerts = [];
  const context = {
    getSelectedUserEmail: () => "client@example.com",
    $: () => ({ disabled: false }),
    confirm: () => true,
    alert: message => alerts.push(message),
    console,
    isTemporaryAuthConnectionError: () => false,
    window: {
      TrainerSupabase: {
        isConfigured: () => true,
        getAppUrl: () => "https://www.fit51islas.com/",
        auth: {
          resetPassword: async (...args) => { calls.push(args); return { data: {}, error: null }; },
          inviteUser: () => { throw new Error("No debe crear otro usuario"); }
        },
        profiles: { create: () => { throw new Error("No debe modificar perfil"); } },
        subscriptions: { create: () => { throw new Error("No debe modificar suscripción"); } }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(resendSource, context);
  await context.resendSelectedUserAccess();
  assert.deepEqual(calls, [["client@example.com", "https://www.fit51islas.com/"]]);
  assert.match(alerts.at(-1), /No se modificaron sus datos ni su suscripción/i);
});

test("la Edge Function no registra correo ni objetos Auth completos", () => {
  assert.doesNotMatch(edgeSource, /Correo a invitar/);
  assert.doesNotMatch(edgeSource, /inviteUserByEmail data/);
  assert.doesNotMatch(edgeSource, /inviteUserByEmail error/);
});

test("creación de contraseña conserva cierre temporal y login posterior", () => {
  assert.match(passwordSource, /updateUser\(\{ password \}\)/);
  assert.match(passwordSource, /client\.auth\.signOut\(\)/);
  assert.match(passwordSource, /goToPage\("loginPage"\)/);
  assert.match(source, /signInWithPassword|TrainerSupabase\.auth\.signIn/);
});

test("creación correcta actualiza contraseña, cierra sesión temporal y vuelve al login", async () => {
  const pages = [];
  const messages = [];
  let updates = 0;
  let signOuts = 0;
  const elements = {
    newAccountPassword: { value: "Password-segura-2026" },
    confirmAccountPassword: { value: "Password-segura-2026" },
    btnCreatePassword: { disabled: false, textContent: "Crear contraseña" },
    emailInput: { value: "" },
    passwordInput: { focus() {} }
  };
  const context = {
    passwordSetupMode: "invite",
    isCompletingPasswordSetup: false,
    authCallbackFlowActive: true,
    $: id => elements[id] || null,
    alert() {},
    showPasswordSetupMessage: (message, type) => messages.push([message, type]),
    getPasswordSetupErrorMessage: () => "error seguro",
    clearTemporarySupabaseAuthState() {},
    clearSupabaseAuthCallbackUrl() {},
    goToPage: page => pages.push(page),
    window: {
      TrainerSupabase: {
        getClient: () => ({
          auth: {
            getSession: async () => ({ data: { session: { user: { id: "user-1" } } }, error: null }),
            updateUser: async ({ password }) => {
              updates += 1;
              assert.equal(password, "Password-segura-2026");
              return { data: { user: { id: "user-1", email: "client@example.com" } }, error: null };
            },
            signOut: async () => { signOuts += 1; return { error: null }; }
          }
        })
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(passwordSource, context);
  await context.createInvitedUserPassword();
  assert.equal(updates, 1);
  assert.equal(signOuts, 1);
  assert.deepEqual(pages, ["loginPage"]);
  assert.match(messages.at(-1)[0], /correctamente/i);
  assert.equal(elements.emailInput.value, "client@example.com");
});

test("recarga durante callback conserva la pantalla y no restaura la aplicación normal", () => {
  const restoreSource = between("async function restoreSession", "/* PERFIL */");
  assert.match(restoreSource, /if \(authCallbackFlowActive \|\| isCompletingPasswordSetup\)/);
  assert.match(restoreSource, /initialSupabaseAuthCallback\.active/);
  assert.match(restoreSource, /goToPage\("passwordSetupPage"\)/);
});
