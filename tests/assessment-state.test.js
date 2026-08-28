const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const statusValues = { COMPLETED: "COMPLETED", LEGAL_REQUIRED: "LEGAL_REQUIRED", NOT_FOUND: "NOT_FOUND", ERROR: "ERROR" };
const currentVersions = { privacyNotice: "1.0", terms: "1.0" };

const stateStart = source.indexOf("async function getSupabaseAssessmentState");
const stateEnd = source.indexOf("function cacheSupabaseAssessment", stateStart);
const stateSource = source.slice(stateStart, stateEnd);

function stateContext(result, consentResult = { data: { legal_accepted_at: "2026-08-28T12:00:00Z" }, error: null }) {
  const calls = [];
  const context = {
    ASSESSMENT_STATUS: statusValues,
    console: { error() {} },
    window: {
      TrainerSupabase: {
        questionnaires: {
          getAssessment: async userId => {
            calls.push(userId);
            return result;
          }
        },
        legal: { getCurrentConsent: async () => consentResult }
      }
    },
    LEGAL_DOCUMENT_VERSIONS: currentVersions
  };
  vm.createContext(context);
  vm.runInContext(stateSource, context);
  return { context, calls };
}

test("representa evaluación completada como COMPLETED", async () => {
  const assessment = { completed: true, goal: "Fuerza" };
  const state = stateContext({ data: assessment, error: null });
  const result = await state.context.getSupabaseAssessmentState("user-1");
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.assessment.goal, "Fuerza");
  assert.deepEqual(state.calls, ["user-1"]);
});

test("representa ausencia real como NOT_FOUND", async () => {
  const state = stateContext({ data: null, error: null });
  const result = await state.context.getSupabaseAssessmentState("user-2");
  assert.equal(result.status, "NOT_FOUND");
  assert.equal(result.assessment, null);
});

test("representa fallo de consulta como ERROR", async () => {
  const state = stateContext({ data: null, error: { message: "Failed to fetch" } });
  const result = await state.context.getSupabaseAssessmentState("user-3");
  assert.equal(result.status, "ERROR");
  assert.equal(result.error.message, "Failed to fetch");
});

test("evaluación previa sin versión legal vigente requiere consentimiento", async () => {
  const assessment = { completed: true, goal: "Fuerza" };
  const state = stateContext({ data: assessment, error: null }, { data: null, error: null });
  const result = await state.context.getSupabaseAssessmentState("user-4");
  assert.equal(result.status, "LEGAL_REQUIRED");
});

function startSessionContext(assessmentState) {
  const pages = [];
  const alerts = [];
  const values = new Map();
  let cached = 0;
  const start = source.indexOf("async function startSession");
  const end = source.indexOf("async function logout", start);
  const functionSource = source.slice(start, end);
  const context = {
    ASSESSMENT_STATUS: statusValues,
    ASSESSMENT_CHECK_ERROR_MESSAGE: "Error temporal de evaluación",
    initializedSupabaseUserId: "",
    currentSlide: 0,
    console: { error() {} },
    localStorage: {
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key)
    },
    $: () => null,
    alert: message => alerts.push(message),
    goToPage: page => pages.push(page),
    initializeExerciseLibrary: async () => {},
    getSupabaseAssessmentState: async () => assessmentState,
    cacheSupabaseAssessment: () => { cached += 1; },
    blockSupabaseAssessmentLoadError: () => {
      alerts.push("Error temporal de evaluación");
      pages.push("loginPage");
    },
    refreshSupabaseUsers: async () => ({ error: null }),
    loadProfile: async () => {},
    renderUserExercises: async () => {},
    showProfilePhoto() {},
    renderProfileCard() {},
    renderAdminData() {},
    syncRoutineNavigationUI() {},
    showSlide() {},
    showLegalConsentScreen: completed => pages.push(completed ? "legalCompleted" : "legalNew"),
    document: { querySelector: () => null },
    window: { TrainerSupabase: { isConfigured: () => true, mode: "supabase" } }
  };
  vm.createContext(context);
  vm.runInContext(functionSource, context);
  return { context, pages, alerts, getCached: () => cached };
}

const user = { role: "user", supabaseId: "user-1", name: "Usuario" };

test("usuario completado no vuelve al cuestionario", async () => {
  const state = startSessionContext({ status: "COMPLETED", assessment: { completed: true } });
  assert.equal(await state.context.startSession("user@example.com", user, "user-1"), true);
  assert.equal(state.pages.includes("questionnairePage"), false);
  assert.equal(state.pages.at(-1), "profilePage");
  assert.equal(state.getCached(), 1);
});

test("usuario realmente sin evaluación ve el cuestionario", async () => {
  const state = startSessionContext({ status: "NOT_FOUND", assessment: null });
  assert.equal(await state.context.startSession("user@example.com", user, "user-1"), true);
  assert.equal(state.pages.at(-1), "questionnairePage");
  assert.equal(state.getCached(), 0);
});

test("usuario con evaluación histórica ve únicamente el consentimiento pendiente", async () => {
  const state = startSessionContext({ status: "LEGAL_REQUIRED", assessment: { completed: true } });
  assert.equal(await state.context.startSession("user@example.com", user, "user-1"), true);
  assert.deepEqual(state.pages.slice(-2), ["questionnairePage", "legalCompleted"]);
});

test("error temporal bloquea sin mostrar cuestionario", async () => {
  const state = startSessionContext({ status: "ERROR", error: { message: "Timeout" } });
  assert.equal(await state.context.startSession("user@example.com", user, "user-1"), false);
  assert.equal(state.pages.includes("questionnairePage"), false);
  assert.deepEqual(state.pages, ["loginPage"]);
  assert.deepEqual(state.alerts, ["Error temporal de evaluación"]);
});

test("la decisión se vuelve a consultar en cada sesión restaurada", async () => {
  const completed = startSessionContext({ status: "COMPLETED", assessment: { completed: true } });
  await completed.context.startSession("user@example.com", user, "user-1");
  assert.equal(completed.pages.includes("questionnairePage"), false);

  const error = startSessionContext({ status: "ERROR", error: { message: "Network" } });
  await error.context.startSession("user@example.com", user, "user-1");
  assert.equal(error.pages.includes("questionnairePage"), false);
  assert.equal(error.pages.at(-1), "loginPage");
});
