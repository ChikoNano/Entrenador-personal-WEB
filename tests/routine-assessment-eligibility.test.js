const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const start = app.indexOf("function updateRoutineAssignmentEligibilityUI");
const end = app.indexOf("function removeExerciseFromUser", start);
const source = app.slice(start, end);
const pendingMessage = "El usuario aún no ha completado su cuestionario inicial. Podrás asignarle ejercicios cuando termine su registro.";
const checkErrorMessage = "No se pudo verificar el cuestionario inicial del usuario. Inténtalo nuevamente más tarde.";

function eligibilityContext(responses = {}) {
  let selectedUserId = Object.keys(responses)[0] || "user-pending";
  let assignmentCalls = 0;
  const alerts = [];
  const button = { disabled: false, textContent: "Asignar ejercicio" };
  const message = {
    textContent: "",
    hidden: true,
    classList: { toggle(_name, hidden) { message.hidden = hidden; } }
  };
  const elements = {
    btnAssignExerciseToUser: button,
    routineAssignmentEligibilityMessage: message,
    routineDay: { value: "Lunes" },
    exerciseSelect: { value: "22222222-2222-4222-8222-222222222222" },
    exerciseSets: { value: "4" },
    exerciseReps: { value: "12" },
    exerciseRest: { value: "60" }
  };
  const context = {
    routineAssignmentEligibility: { userId: "", status: "IDLE" },
    isRoutineAssignmentSubmitting: false,
    ROUTINE_ASSESSMENT_PENDING_MESSAGE: pendingMessage,
    ROUTINE_ASSESSMENT_CHECK_ERROR_MESSAGE: checkErrorMessage,
    getSelectedUserId: () => selectedUserId,
    getSelectedUserEmail: () => "usuario@fit51.test",
    $: id => elements[id] || null,
    alert: value => alerts.push(value),
    renderSelectedUserAssignments: async () => {},
    window: { TrainerSupabase: {
      isConfigured: () => true,
      questionnaires: { getAssessment: async userId => responses[userId] },
      routines: { assignExercise: async () => {
        assignmentCalls += 1;
        return { data: [], error: null };
      } }
    } }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    context,
    button,
    message,
    alerts,
    selectUser: userId => { selectedUserId = userId; },
    assignmentCalls: () => assignmentCalls
  };
}

test("usuario sin cuestionario completo deja el botón deshabilitado y muestra mensaje amigable", async () => {
  const state = eligibilityContext({ "user-pending": { data: null, error: null } });
  await state.context.refreshRoutineAssignmentEligibility();
  assert.equal(state.button.disabled, true);
  assert.equal(state.message.hidden, false);
  assert.equal(state.message.textContent, pendingMessage);
});

test("usuario pendiente no ejecuta ninguna asignación ni INSERT indirecto en routines", async () => {
  const state = eligibilityContext({ "user-pending": { data: { completed: false }, error: null } });
  await state.context.refreshRoutineAssignmentEligibility();
  await state.context.assignExerciseToUser();
  assert.equal(state.assignmentCalls(), 0);
  assert.equal(state.alerts.at(-1), pendingMessage);
});

test("usuario con completed true habilita la asignación", async () => {
  const state = eligibilityContext({ "user-complete": { data: { completed: true }, error: null } });
  await state.context.refreshRoutineAssignmentEligibility();
  assert.equal(state.button.disabled, false);
  assert.equal(state.message.hidden, true);
});

test("cambiar de usuario actualiza el estado autoritativo del botón", async () => {
  const state = eligibilityContext({
    "user-pending": { data: { completed: false }, error: null },
    "user-complete": { data: { completed: true }, error: null }
  });
  await state.context.refreshRoutineAssignmentEligibility();
  assert.equal(state.button.disabled, true);
  state.selectUser("user-complete");
  await state.context.refreshRoutineAssignmentEligibility();
  assert.equal(state.button.disabled, false);
  state.selectUser("user-pending");
  await state.context.refreshRoutineAssignmentEligibility();
  assert.equal(state.button.disabled, true);
});

test("un fallo de Supabase bloquea la asignación de forma segura", async () => {
  const state = eligibilityContext({ "user-error": { data: null, error: { message: "fallo remoto" } } });
  await state.context.refreshRoutineAssignmentEligibility();
  assert.equal(state.button.disabled, true);
  assert.equal(state.message.textContent, checkErrorMessage);
  await state.context.assignExerciseToUser();
  assert.equal(state.assignmentCalls(), 0);
  assert.equal(state.alerts.at(-1), checkErrorMessage);
});

test("el botón inicia disabled y conserva una apariencia visual no interactiva", () => {
  assert.match(html, /id="btnAssignExerciseToUser" type="button" disabled/);
  assert.match(styles, /#btnAssignExerciseToUser:disabled\s*\{[^}]*cursor:\s*not-allowed;[^}]*pointer-events:\s*none;/s);
});
