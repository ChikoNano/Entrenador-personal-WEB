const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const configSource = fs.readFileSync(path.join(root, "js", "supabase-config.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");

function loadConfig(origin, pathname) {
  const window = {
    location: { origin, pathname },
    supabase: {
      createClient: () => ({})
    }
  };
  const context = {
    URL,
    console,
    window,
    document: { documentElement: { dataset: {} } }
  };
  vm.createContext(context);
  vm.runInContext(configSource, context);
  return window.TrainerSupabase;
}

test("calcula una URL local válida y conserva puerto y subruta", () => {
  const config = loadConfig("http://localhost:5500", "/Entrenador-personal-WEB/index.html");
  assert.equal(config.getAppUrl(), "http://localhost:5500/Entrenador-personal-WEB/index.html");
});

test("usa automáticamente el origin HTTPS de un dominio futuro", () => {
  const config = loadConfig("https://app.ejemplo.com", "/");
  assert.equal(config.getAppUrl(), "https://app.ejemplo.com/");
});

test("recuperación de contraseña usa la URL central del entorno", async () => {
  const start = appSource.indexOf("async function requestPasswordRecovery");
  const end = appSource.indexOf("async function initializePasswordSetupFlow", start);
  const functionSource = appSource.slice(start, end);
  const resetCalls = [];
  const alerts = [];
  const context = {
    alert: message => alerts.push(message),
    console,
    $: () => ({ value: "user@example.com" }),
    window: {
      prompt: () => "user@example.com",
      TrainerSupabase: {
        isConfigured: () => true,
        getAppUrl: () => "https://app.ejemplo.com/",
        auth: {
          resetPassword: async (...args) => {
            resetCalls.push(args);
            return { data: {}, error: null };
          }
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(functionSource, context);
  await context.requestPasswordRecovery();
  assert.deepEqual(resetCalls, [["user@example.com", "https://app.ejemplo.com/"]]);
  assert.equal(alerts.length, 1);
});

test("la limpieza del callback reutiliza la URL central", () => {
  const start = appSource.indexOf("function clearSupabaseAuthCallbackUrl");
  const end = appSource.indexOf("async function createInvitedUserPassword", start);
  const functionSource = appSource.slice(start, end);
  const replacements = [];
  const context = {
    document: { title: "Entrenador" },
    window: {
      TrainerSupabase: { getAppUrl: () => "https://app.ejemplo.com/subruta/" },
      history: { replaceState: (...args) => replacements.push(args) }
    }
  };
  vm.createContext(context);
  vm.runInContext(functionSource, context);
  context.clearSupabaseAuthCallbackUrl();
  assert.equal(replacements.length, 1);
  assert.equal(Object.keys(replacements[0][0]).length, 0);
  assert.equal(replacements[0][1], "Entrenador");
  assert.equal(replacements[0][2], "https://app.ejemplo.com/subruta/");
});
