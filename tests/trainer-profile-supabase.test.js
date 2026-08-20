const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const start = source.indexOf("async function renderSelectedUserProfile");
const end = source.indexOf("function getCompletedExercises", start);
const renderSource = source.slice(start, end);

const remoteProfile = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "cliente@example.com",
  full_name: "Nombre Supabase",
  age: 32,
  weight: 70,
  height: 168,
  goal: "Fuerza",
  cooper_distance_km: 2.5,
  vam_kmh: 14,
  avatar_path: null
};

const remoteAssessment = {
  user_id: remoteProfile.id,
  goal: "Mejorar fuerza",
  previous_training: "Sí",
  training_days: 4,
  session_duration: 60,
  gym_experience: "Intermedio",
  physical_activity: "Alta",
  has_injury: false,
  injury_description: null,
  completed: true,
  completed_at: "2026-08-01T12:00:00Z"
};

function createContext({
  profile = remoteProfile,
  assessment = remoteAssessment,
  profileError = null,
  assessmentError = null,
  avatarUrl = "",
  avatarError = null
} = {}) {
  const storage = new Map([
    ["profile_cliente@example.com", JSON.stringify({ name: "Nombre antiguo", age: 99 })],
    ["questionnaire_cliente@example.com", JSON.stringify({ goal: "Objetivo antiguo", completed: true })],
    ["profilePhoto_cliente@example.com", "data:image/png;base64,antigua"]
  ]);
  const container = { innerHTML: "" };
  const select = {
    value: remoteProfile.id,
    selectedOptions: [{ dataset: { email: "cliente@example.com" } }]
  };
  const calls = { profileIds: [], assessmentIds: [], avatarPaths: [] };
  const context = {
    console,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    $: id => id === "selectedUserProfile" ? container : id === "userSelect" ? select : null,
    getSelectedUserEmail: () => select.selectedOptions[0].dataset.email,
    getSelectedUserId: () => select.value,
    getPanelUsers: () => ({
      "cliente@example.com": {
        name: "Nombre en lista",
        planType: "Plan personal",
        userNumber: 27,
        supabaseId: remoteProfile.id
      }
    }),
    getAerobicResult: (value, unit) => value ? `${value} ${unit}` : "No registrado",
    escapeHTML: value => String(value),
    sanitizeMediaURL: value => String(value || ""),
    window: {
      TrainerSupabase: {
        isConfigured: () => true,
        profiles: {
          getProfile: async id => {
            calls.profileIds.push(id);
            return profileError ? { data: null, error: profileError } : { data: profile, error: null };
          }
        },
        questionnaires: {
          getAssessment: async id => {
            calls.assessmentIds.push(id);
            return assessmentError ? { data: null, error: assessmentError } : { data: assessment, error: null };
          }
        },
        storage: {
          getAvatarUrl: async avatarPath => {
            calls.avatarPaths.push(avatarPath);
            return avatarError
              ? { data: null, error: avatarError }
              : { data: avatarUrl ? { signedUrl: avatarUrl } : null, error: null };
          }
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(renderSource, context);
  return { context, container, storage, calls };
}

test("consulta y muestra el perfil completo de Supabase mediante UUID", async () => {
  const state = createContext();
  await state.context.renderSelectedUserProfile();
  assert.deepEqual(state.calls.profileIds, [remoteProfile.id]);
  assert.deepEqual(state.calls.assessmentIds, [remoteProfile.id]);
  assert.match(state.container.innerHTML, /Nombre Supabase/);
  assert.match(state.container.innerHTML, /32/);
  assert.match(state.container.innerHTML, /70 kg/);
});

test("funciona con localStorage vacío", async () => {
  const state = createContext();
  state.storage.clear();
  await state.context.renderSelectedUserProfile();
  assert.match(state.container.innerHTML, /Nombre Supabase/);
  assert.match(state.container.innerHTML, /Mejorar fuerza/);
});

test("ignora perfil, cuestionario y foto locales obsoletos", async () => {
  const state = createContext();
  await state.context.renderSelectedUserProfile();
  assert.doesNotMatch(state.container.innerHTML, /Nombre antiguo|Objetivo antiguo|base64,antigua/);
  assert.match(state.container.innerHTML, /Nombre Supabase|Mejorar fuerza/);
});

test("muestra la evaluación inicial obtenida de initial_assessments", async () => {
  const state = createContext();
  await state.context.renderSelectedUserProfile();
  assert.match(state.container.innerHTML, /Mejorar fuerza/);
  assert.match(state.container.innerHTML, /Intermedio/);
  assert.match(state.container.innerHTML, /Completada/);
});

test("distingue ausencia válida de evaluación de un error", async () => {
  const state = createContext({ assessment: null });
  await state.context.renderSelectedUserProfile();
  assert.match(state.container.innerHTML, /Pendiente/);
  assert.match(state.container.innerHTML, /No contestado/);
  assert.doesNotMatch(state.container.innerHTML, /Error al cargar|Objetivo antiguo/);
  assert.equal(state.storage.has("questionnaire_cliente@example.com"), false);
});

test("muestra el avatar mediante una URL firmada y no la persiste", async () => {
  const state = createContext({
    profile: { ...remoteProfile, avatar_path: `${remoteProfile.id}/avatar.webp` },
    avatarUrl: "https://storage.example/signed-avatar"
  });
  await state.context.renderSelectedUserProfile();
  assert.deepEqual(state.calls.avatarPaths, [`${remoteProfile.id}/avatar.webp`]);
  assert.match(state.container.innerHTML, /https:\/\/storage.example\/signed-avatar/);
  assert.equal(state.storage.get("profilePhoto_cliente@example.com"), "data:image/png;base64,antigua");
});

test("usuario sin avatar conserva el placeholder actual", async () => {
  const state = createContext();
  await state.context.renderSelectedUserProfile();
  assert.match(state.container.innerHTML, /admin-profile-photo-placeholder/);
  assert.deepEqual(state.calls.avatarPaths, []);
});

test("error de perfil no presenta datos locales obsoletos", async () => {
  const state = createContext({ profileError: new Error("fallo de perfil") });
  await state.context.renderSelectedUserProfile();
  assert.match(state.container.innerHTML, /No se pudo cargar el perfil/);
  assert.doesNotMatch(state.container.innerHTML, /Nombre antiguo|Objetivo antiguo/);
});

test("error de evaluación no se representa como evaluación vacía", async () => {
  const state = createContext({ assessmentError: new Error("fallo de evaluación") });
  await state.context.renderSelectedUserProfile();
  assert.match(state.container.innerHTML, /Nombre Supabase/);
  assert.match(state.container.innerHTML, /Error al cargar/);
  assert.match(state.container.innerHTML, /No disponible temporalmente/);
  assert.doesNotMatch(state.container.innerHTML, /Objetivo antiguo/);
});

test("error de signed URL conserva placeholder y reporta la foto no disponible", async () => {
  const state = createContext({
    profile: { ...remoteProfile, avatar_path: `${remoteProfile.id}/avatar.webp` },
    avatarError: new Error("fallo de storage")
  });
  await state.context.renderSelectedUserProfile();
  assert.match(state.container.innerHTML, /admin-profile-photo-placeholder/);
  assert.match(state.container.innerHTML, /No se pudo cargar la foto/);
  assert.doesNotMatch(state.container.innerHTML, /base64,antigua/);
});
