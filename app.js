let currentSlide = 0;
let isAssessmentSubmitting = false;
let pendingProfilePhotoFile = null;
let pendingProfilePhotoPreviewUrl = "";
let supabaseAuthStateSubscription = null;
let supabaseSessionLoadPromise = null;
let initializedSupabaseUserId = "";
let currentSupabaseProfile = null;
let passwordSetupMode = "invite";
let activeExerciseFilter = null;
let selectedRoutineWeek = "Semana 1";
let selectedRoutineDay = "Lunes";
const TRAINER_WHATSAPP_NUMBER = "REEMPLAZAR_NUMERO_WHATSAPP";
const initialSupabaseAuthCallback = (() => {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const type = query.get("type") || hash.get("type");
  const errorDescription = query.get("error_description") || hash.get("error_description");
  return {
    type,
    active: ["invite", "recovery"].includes(type) || query.has("code") || hash.has("access_token") || Boolean(errorDescription),
    errorDescription
  };
})();
const TEMPORARY_AUTH_FLOW_KEY = "traineros_temporary_auth_flow";
let authCallbackFlowActive =
  initialSupabaseAuthCallback.active ||
  localStorage.getItem(TEMPORARY_AUTH_FLOW_KEY) === "true";
let isCompletingPasswordSetup = false;


const defaultUsers = {
  "usuario@test.com": { password: "1234", role: "user", name: "Usuario" },
  "admin@test.com": { password: "admin", role: "admin", name: "Entrenador" }
};
const AUTH_SERVICE_UNAVAILABLE_MESSAGE =
  "El servicio de inicio de sesión no está disponible temporalmente. Inténtalo más tarde.";
const SUBSCRIPTION_EXPIRED_MESSAGE =
  "Tu suscripción ha vencido. Contacta a tu entrenador para renovarla.";
const SUBSCRIPTION_INACTIVE_MESSAGE =
  "Tu suscripción no está activa. Contacta a tu entrenador.";
const SUBSCRIPTION_MISSING_MESSAGE =
  "No encontramos una suscripción activa para tu cuenta. Contacta a tu entrenador.";
const SUBSCRIPTION_CHECK_ERROR_MESSAGE =
  "No pudimos verificar tu suscripción temporalmente. Inténtalo más tarde.";
const ASSESSMENT_STATUS = Object.freeze({
  COMPLETED: "COMPLETED",
  NOT_FOUND: "NOT_FOUND",
  ERROR: "ERROR"
});
const ASSESSMENT_CHECK_ERROR_MESSAGE =
  "No pudimos cargar tu evaluación temporalmente. Inténtalo más tarde.";

const allowedPlanTypes = ["Plan personal", "Plan grupal", "Plan APP"];
const subscriptionPlanOptions = [
  { value: "personal", label: "Plan personal" },
  { value: "grupal", label: "Plan grupal" },
  { value: "app", label: "Plan APP" }
];
const getSubscriptionPlanCode = value => ({
  personal: "personal", grupal: "grupal", group: "grupal", app: "app",
  "Plan personal": "personal", "Plan grupal": "grupal", "Plan APP": "app"
})[value] || "";
const getSubscriptionPlanLabel = value =>
  subscriptionPlanOptions.find(option => option.value === getSubscriptionPlanCode(value))?.label || "Sin asignar";
let supabaseUsersCache = {};

function $(id) {
  return document.getElementById(id);
}

/* USUARIOS */

function getUsers() {
  const savedUsers = JSON.parse(localStorage.getItem("users")) || {};
  return { ...defaultUsers, ...savedUsers, ...supabaseUsersCache };
}

function sendProfileSuggestionByWhatsApp() {
  if (!/^\d{8,15}$/.test(TRAINER_WHATSAPP_NUMBER)) {
    alert("El número de WhatsApp del entrenador aún no está configurado.");
    return;
  }

  const fullName = String(currentSupabaseProfile?.full_name || "").trim() || "Usuario";
  const userNumber = currentSupabaseProfile?.user_number;
  const userNumberText =
    userNumber !== null && userNumber !== undefined && String(userNumber).trim()
      ? `, usuario #${userNumber}`
      : "";
  const message = `Hola, soy ${fullName}${userNumberText}.\n\nQuiero enviar la siguiente sugerencia sobre la plataforma:\n`;
  const encodedMessage = encodeURIComponent(message);
  const isMobileDevice = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const url = isMobileDevice
    ? `https://wa.me/${TRAINER_WHATSAPP_NUMBER}?text=${encodedMessage}`
    : `https://web.whatsapp.com/send?phone=${TRAINER_WHATSAPP_NUMBER}&text=${encodedMessage}`;

  window.open(url, "_blank", "noopener,noreferrer");
}

function getPanelUsers() {
  return window.TrainerSupabase?.isConfigured()
    ? supabaseUsersCache
    : getUsers();
}

function formatAdministrativeUserLabel(email, user = {}, includeEmail = false) {
  const numberPrefix = user.userNumber !== null && user.userNumber !== undefined
    ? `#${user.userNumber} - `
    : "";
  const name = String(user.name || "").trim() || "Sin nombre";
  const normalizedEmail = String(email || "").trim();
  return `${numberPrefix}${name}${includeEmail && normalizedEmail ? ` - ${normalizedEmail}` : ""}`;
}

function getSelectedUserEmail() {
  const select = $("userSelect");
  if (!select?.value) return "";
  return select.selectedOptions[0]?.dataset.email || select.value;
}

function getSelectedUserId() {
  const select = $("userSelect");
  if (!select?.value || !window.TrainerSupabase?.isConfigured()) return "";
  return select.value;
}

async function refreshSupabaseUsers() {
  if (!window.TrainerSupabase?.isConfigured()) return { data: null, error: null };
  const [profilesResult, subscriptionsResult] = await Promise.all([
    window.TrainerSupabase.profiles.getClients(),
    window.TrainerSupabase.subscriptions.listSubscriptions()
  ]);
  if (profilesResult.error) return profilesResult;
  if (subscriptionsResult.error) return subscriptionsResult;

  const subscriptionsByUser = new Map(
    (subscriptionsResult.data || []).map(subscription => [subscription.user_id, subscription])
  );
  supabaseUsersCache = Object.fromEntries((profilesResult.data || []).map(profile => {
    const subscription = subscriptionsByUser.get(profile.id);
    return [profile.email, {
      role: profile.role,
      name: profile.full_name || profile.email,
      supabaseId: profile.id,
      userNumber: profile.user_number ?? null,
      subscriptionId: subscription?.id || null,
      planType: window.TrainerSupabase.subscriptions.getPlanLabel(subscription?.plan_type),
      planTypeCode: getSubscriptionPlanCode(subscription?.plan_type),
      createdAt: subscription?.start_date || null,
      expiresAt: subscription?.expiration_date || null,
      subscriptionStatus: subscription?.status || null
    }];
  }));
  return { data: profilesResult.data, error: null };
}

function addDaysToDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

async function repairSupabaseInitialSubscription(userEmail, planType, startDate, expirationDate) {
  if (!window.TrainerSupabase?.isConfigured()) {
    return { data: null, error: { message: "Supabase no está configurado" } };
  }
  const email = String(userEmail || "").trim().toLowerCase();
  let user = getUsers()[email];
  if (!user?.supabaseId) {
    const refreshed = await refreshSupabaseUsers();
    if (refreshed.error) return refreshed;
    user = getUsers()[email];
  }
  if (!user?.supabaseId) {
    return { data: null, error: { message: "No se encontró el perfil de Supabase" } };
  }

  const initialDate = startDate || new Date().toISOString().slice(0, 10);
  const endDate = expirationDate || addDaysToDate(33).slice(0, 10);
  const result = await window.TrainerSupabase.subscriptions.repairInitialSubscription(
    user.supabaseId,
    { planType, start_date: initialDate, expiration_date: endDate }
  );
  if (!result.error) {
    await refreshSupabaseUsers();
    renderAdminData();
  }
  return result;
}

function isUserExpired(user) {
  if (user.role === "admin") return false;
  if (!user.expiresAt) return false;

  return new Date() > new Date(user.expiresAt);
}

async function createUser() {
  const name = $("newUserName")?.value.trim();
  const email = $("newUserEmail")?.value.trim();
  const planType = $("newUserPlanType")?.value;

  const supabaseMode = window.TrainerSupabase?.isConfigured();

  if (supabaseMode) {
    if (!name || !email || !planType) {
      alert(!planType ? "Selecciona el tipo de plan" : "Completa nombre y correo");
      return;
    }

    const sessionResult = await window.TrainerSupabase.auth.getSession();
    const session = sessionResult.data?.session;
    if (sessionResult.error || !session) {
      alert("Tu sesión expiró. Inicia sesión nuevamente.");
      return;
    }

    const profileResult = await window.TrainerSupabase.auth.getAuthenticatedProfile();
    const actor = profileResult.data;
    if (profileResult.error || !actor?.active) {
      alert(profileResult.error?.message || "No se pudo verificar tu perfil de entrenador");
      return;
    }
    if (!["admin", "trainer"].includes(actor.role)) {
      alert("No tienes permisos para crear usuarios");
      return;
    }

    const startDate = new Date().toISOString().slice(0, 10);
    const expirationDate = addDaysToDate(33).slice(0, 10);
    const invitation = await window.TrainerSupabase.auth.inviteUser({
      email: email.toLowerCase(),
      fullName: name,
      planType,
      startDate,
      expirationDate
    });

    if (invitation.error) {
      const message = invitation.error.message || "No se pudo enviar la invitación";
      const status = invitation.error.status;
      if (/already|registered|exists|duplicate|ya existe|ya registrado/i.test(message)) {
        alert("Ese correo ya está registrado");
      } else if (status === 401 || /session|sesión|jwt|token/i.test(message)) {
        alert("Tu sesión expiró. Inicia sesión nuevamente.");
      } else if (status === 403 || /no autorizado|permisos|administrador|entrenador/i.test(message)) {
        alert("No tienes permisos de administrador o entrenador para invitar usuarios");
      } else if (/failed to fetch|network|red|fetch/i.test(message)) {
        alert("No se pudo conectar con Supabase. Revisa tu conexión e inténtalo nuevamente.");
      } else {
        alert(`No se pudo enviar la invitación: ${message}`);
      }
      return;
    }

    if (invitation.data?.success !== true || !invitation.data?.userId) {
      alert(`No se pudo enviar la invitación: ${invitation.data?.message || "Supabase no confirmó la creación del usuario"}`);
      return;
    }

    $("newUserName").value = "";
    $("newUserEmail").value = "";
    $("newUserPlanType").value = "";

    const usersResult = await refreshSupabaseUsers();
    if (usersResult.error) {
      console.error("La invitación se envió, pero no se pudo actualizar la lista:", usersResult.error.message);
    } else {
      renderAdminData();
    }

    const warnings = invitation.data?.warnings || [];
    alert(warnings.length
      ? `Invitación enviada correctamente. Advertencia: ${warnings.join(" ")}`
      : "Invitación enviada correctamente. El usuario recibirá un correo para crear su contraseña.");
    return;
  }

  if (!name || !email) {
    alert("Completa nombre y correo");
    return;
  }

  if (!planType) {
    alert("Selecciona el tipo de plan");
    return;
  }

  const users = getUsers();

  if (users[email]) {
    alert("Ese usuario ya existe");
    return;
  }

  const customUsers = JSON.parse(localStorage.getItem("users")) || {};

  customUsers[email] = {
  role: "user",
  name,
  planType,
  createdAt: new Date().toISOString(),
  expiresAt: addDaysToDate(33)
};

  localStorage.setItem("users", JSON.stringify(customUsers));

  $("newUserName").value = "";
  $("newUserEmail").value = "";
  $("newUserPlanType").value = "";

  renderAdminData();

  alert("Usuario creado correctamente");
}

async function deleteSelectedUser() {
  const userEmail = getSelectedUserEmail();
  const supabaseMode = window.TrainerSupabase?.isConfigured();
  const userId = getSelectedUserId();

  if (!userEmail) {
    alert("Selecciona un usuario");
    return;
  }

  if (userEmail === "usuario@test.com" || userEmail === "admin@test.com") {
    alert("No puedes borrar usuarios demo");
    return;
  }

  if (!confirm("¿Seguro que deseas eliminar este usuario? Esta acción no se puede deshacer.")) return;

  if (supabaseMode) {
    if (!userId) {
      alert("No se encontró el UUID del usuario seleccionado");
      return;
    }

    const result = await window.TrainerSupabase.auth.deleteUser(userId);
    if (result.error || result.data?.success !== true || result.data?.userId !== userId) {
      console.error("Error al eliminar usuario:", result.error || result.data);
      alert(result.error?.message || result.data?.message || "No se pudo eliminar el usuario");
      return;
    }

    const refreshed = await refreshSupabaseUsers();
    if (refreshed.error) {
      console.error("El usuario se eliminó, pero falló la actualización del panel:", refreshed.error);
      alert(`El usuario fue eliminado, pero no se pudo actualizar el panel: ${refreshed.error.message}`);
      return;
    }

    renderAdminData();
    alert("Usuario eliminado correctamente");
    return;
  }

  const customUsers = JSON.parse(localStorage.getItem("users")) || {};
  delete customUsers[userEmail];
  localStorage.setItem("users", JSON.stringify(customUsers));

  localStorage.removeItem(`profile_${userEmail}`);
  localStorage.removeItem(`questionnaire_${userEmail}`);
  localStorage.removeItem(`profilePhoto_${userEmail}`);

  const assignments = getUserAssignments();
  delete assignments[userEmail];
  saveUserAssignments(assignments);

  renderAdminData();

  alert("Usuario eliminado correctamente");
}

/* NAVEGACIÓN */

function goToPage(pageId) {
  const pages = [
    "loginPage",
    "passwordSetupPage",
    "dashboardPage",
    "questionnairePage",
    "profilePage",
    "exercisePage",
    "adminPage",
    "physioPage"
  ];

  pages.forEach(id => {
    if ($(id)) $(id).classList.add("hidden");
  });

  if ($(pageId)) $(pageId).classList.remove("hidden");
  document.body.classList.toggle("admin-panel-active", pageId === "adminPage");
  syncMobilePrimaryNavigation(pageId);
}

function showPasswordSetupMessage(message, type = "error") {
  const element = $("passwordSetupMessage");
  if (!element) return;
  element.textContent = message;
  element.classList.remove("hidden", "success");
  if (type === "success") element.classList.add("success");
}

function togglePasswordVisibility(button) {
  const input = $(button?.dataset.passwordToggle);
  if (!input) return;

  const selectionStart = input.selectionStart;
  const selectionEnd = input.selectionEnd;
  const shouldShowPassword = input.type === "password";

  input.type = shouldShowPassword ? "text" : "password";
  button.setAttribute("aria-label", shouldShowPassword ? "Ocultar contraseña" : "Mostrar contraseña");
  button.setAttribute("aria-pressed", String(shouldShowPassword));
  button.querySelector(".password-eye-open")?.classList.toggle("hidden", shouldShowPassword);
  button.querySelector(".password-eye-off")?.classList.toggle("hidden", !shouldShowPassword);

  input.focus({ preventScroll: true });
  if (selectionStart !== null && selectionEnd !== null) {
    input.setSelectionRange(selectionStart, selectionEnd);
  }
}

function configurePasswordSetupView(mode = "invite") {
  passwordSetupMode = mode === "recovery" ? "recovery" : "invite";
  if ($("passwordSetupTitle")) {
    $("passwordSetupTitle").textContent =
      passwordSetupMode === "recovery" ? "Restablece tu contraseña" : "Crea tu contraseña";
  }
  const copy = document.querySelector(".password-setup-copy");
  if (copy) {
    copy.textContent = passwordSetupMode === "recovery"
      ? "Define una nueva contraseña segura para volver a iniciar sesión."
      : "Define una contraseña segura. Después iniciarás sesión manualmente.";
  }
  if ($("btnCreatePassword")) {
    $("btnCreatePassword").textContent =
      passwordSetupMode === "recovery" ? "Guardar nueva contraseña" : "Crear contraseña";
  }
}

async function requestPasswordRecovery() {
  const initialEmail = $("emailInput")?.value.trim() || "";
  const requestedEmail = window.prompt("Ingresa tu correo electrónico:", initialEmail);
  if (requestedEmail === null) return;

  const email = requestedEmail.trim().toLowerCase();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!validEmail) {
    alert("Ingresa un correo electrónico válido.");
    return;
  }
  if (!window.TrainerSupabase?.isConfigured()) {
    alert("No se pudo iniciar la recuperación. Inténtalo más tarde.");
    return;
  }

  const result = await window.TrainerSupabase.auth.resetPassword(
    email,
    window.TrainerSupabase.getAppUrl()
  );
  if (result.error) {
    console.error("No se pudo solicitar la recuperación de contraseña.");
  }
  alert("Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.");
}

async function initializePasswordSetupFlow() {
  if (!initialSupabaseAuthCallback.active) return false;

  authCallbackFlowActive = true;
  localStorage.setItem(TEMPORARY_AUTH_FLOW_KEY, "true");
  configurePasswordSetupView(initialSupabaseAuthCallback.type === "recovery" ? "recovery" : passwordSetupMode);
  goToPage("passwordSetupPage");
  const button = $("btnCreatePassword");
  if (button) button.disabled = true;

  if (!window.TrainerSupabase?.isConfigured()) {
    showPasswordSetupMessage("Supabase no está configurado. Solicita un nuevo enlace al entrenador.");
    return true;
  }
  if (initialSupabaseAuthCallback.errorDescription) {
    showPasswordSetupMessage("El enlace no es válido o ha expirado. Solicita uno nuevo.");
    return true;
  }

  const { data, error } = await window.TrainerSupabase.getClient().auth.getSession();
  if (error || !data?.session) {
    showPasswordSetupMessage("El enlace no es válido o ha expirado. Solicita uno nuevo.");
    return true;
  }

  if (button) button.disabled = false;
  $("newAccountPassword")?.focus();
  return true;
}

function clearTemporarySupabaseAuthState() {
  localStorage.removeItem("currentUser");
  localStorage.removeItem("currentRole");
  localStorage.removeItem(TEMPORARY_AUTH_FLOW_KEY);
  initializedSupabaseUserId = "";
  currentSupabaseProfile = null;

  [localStorage, sessionStorage].forEach(storage => {
    const keysToRemove = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && (/^sb-.+-auth-token$/i.test(key) || /supabase.*(?:auth|pkce)/i.test(key))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => storage.removeItem(key));
  });
}

function clearSupabaseAuthCallbackUrl() {
  window.history.replaceState(
    {},
    document.title,
    window.TrainerSupabase.getAppUrl()
  );
}

async function createInvitedUserPassword() {
  const passwordInput = $("newAccountPassword");
  const confirmationInput = $("confirmAccountPassword");
  const button = $("btnCreatePassword");
  const password = passwordInput?.value || "";
  const confirmation = confirmationInput?.value || "";

  if (!password || !confirmation) {
    showPasswordSetupMessage("Completa ambos campos de contraseña.");
    return;
  }
  if (password.length < 8) {
    showPasswordSetupMessage("La contraseña debe tener al menos 8 caracteres.");
    return;
  }
  if (password !== confirmation) {
    showPasswordSetupMessage("Las contraseñas no coinciden.");
    return;
  }

  button.disabled = true;
  button.textContent = passwordSetupMode === "recovery"
    ? "Guardando nueva contraseña..."
    : "Creando contraseña...";
  isCompletingPasswordSetup = true;
  try {
    const client = window.TrainerSupabase.getClient();
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData?.session) {
      showPasswordSetupMessage("El enlace no es válido o ha expirado. Solicita uno nuevo.");
      return;
    }

    const { data, error } = await client.auth.updateUser({ password });
    if (error || !data?.user) {
      showPasswordSetupMessage("El enlace no es válido o ha expirado. Solicita uno nuevo.");
      return;
    }

    passwordInput.value = "";
    confirmationInput.value = "";
    const successMessage = passwordSetupMode === "recovery"
      ? "Contraseña actualizada correctamente"
      : "Contraseña creada correctamente";
    showPasswordSetupMessage(successMessage, "success");

    const { error: signOutError } = await client.auth.signOut();
    if (signOutError) {
      console.error("No se pudo cerrar la sesión temporal:", signOutError);
    }

    clearTemporarySupabaseAuthState();
    clearSupabaseAuthCallbackUrl();
    authCallbackFlowActive = false;
    alert(`${successMessage}. Inicia sesión con tu nueva contraseña.`);
    goToPage("loginPage");
    if ($("emailInput")) $("emailInput").value = data.user.email || "";
    $("passwordInput")?.focus();
    return;
  } catch {
    showPasswordSetupMessage("El enlace no es válido o ha expirado. Solicita uno nuevo.");
  } finally {
    isCompletingPasswordSetup = false;
    button.disabled = false;
    button.textContent = passwordSetupMode === "recovery"
      ? "Guardar nueva contraseña"
      : "Crear contraseña";
  }
}

function syncMobilePrimaryNavigation(pageId) {
  const navigation = $("mobilePrimaryNav");
  if (!navigation) return;

  const isUserSession = localStorage.getItem("currentUser") && localStorage.getItem("currentRole") === "user";
  const isApplicationPage = ["dashboardPage", "profilePage", "exercisePage", "physioPage"].includes(pageId);
  navigation.classList.toggle("hidden", !(isUserSession && isApplicationPage));

  navigation.querySelectorAll("[data-mobile-page]").forEach(button => {
    const isActive = button.dataset.mobilePage === pageId;
    button.classList.toggle("active", isActive);
    if (isActive) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function navigateToRoutine() {
  renderUserExercises();
  goToPage("exercisePage");
}

function navigateToProfile() {
  goToPage("profilePage");
}

function navigateToTherapies() {
  goToPage("physioPage");
}

/* CUESTIONARIO */

function showSlide(index) {
  const slides = document.querySelectorAll(".slide");

  slides.forEach((slide, i) => {
    slide.style.display = i === index ? "block" : "none";
  });

  if ($("prevBtn")) {
    $("prevBtn").style.display = index > 0 ? "inline-block" : "none";
  }

  if ($("nextBtn")) {
    $("nextBtn").textContent =
      index === slides.length - 1 ? "Enviar" : "Siguiente";
  }

  const questionNumber = index + 1;
  const progress = Math.round((questionNumber / slides.length) * 100);

  if ($("assessmentProgressText")) {
    $("assessmentProgressText").textContent = `Pregunta ${questionNumber} de ${slides.length}`;
  }

  if ($("assessmentProgressPercent")) {
    $("assessmentProgressPercent").textContent = `${progress}%`;
  }

  if ($("assessmentProgressFill")) {
    $("assessmentProgressFill").style.width = `${progress}%`;
  }
}

function getSelectedAssessmentValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || "";
}

function validateCurrentAssessmentSlide() {
  const currentSlideElement = document.querySelectorAll(".slide")[currentSlide];
  const question = currentSlideElement?.dataset.question;

  if (!question || !getSelectedAssessmentValue(question)) {
    alert("Selecciona una opción antes de continuar");
    return false;
  }

  if (question === "hasInjury" && getSelectedAssessmentValue(question) === "true") {
    if (!$("injuryDescription")?.value.trim()) {
      alert("Describe brevemente tu lesión o condición médica");
      return false;
    }
  }

  return true;
}

function getAssessmentData() {
  const hasInjury = getSelectedAssessmentValue("hasInjury") === "true";

  return {
    goal: getSelectedAssessmentValue("goal"),
    previousTraining: getSelectedAssessmentValue("previousTraining"),
    trainingDays: getSelectedAssessmentValue("trainingDays"),
    sessionDuration: getSelectedAssessmentValue("sessionDuration"),
    gymExperience: getSelectedAssessmentValue("gymExperience"),
    physicalActivity: getSelectedAssessmentValue("physicalActivity"),
    hasInjury,
    injuryDescription: hasInjury ? ($("injuryDescription")?.value.trim() || "") : ""
  };
}

function toggleInjuryDescription() {
  const hasInjury = getSelectedAssessmentValue("hasInjury") === "true";
  $("injuryDescriptionWrap")?.classList.toggle("hidden", !hasInjury);

  if (!hasInjury && $("injuryDescription")) {
    $("injuryDescription").value = "";
  }
}

function showAssessmentConfirmation() {
  document.querySelector(".assessment-header")?.classList.add("hidden");
  document.querySelectorAll(".assessment-slide").forEach(slide => {
    slide.classList.add("hidden");
  });
  document.querySelector("#questionnairePage > .btn-row")?.classList.add("hidden");
  $("assessmentConfirmation")?.classList.remove("hidden");
}

function saveAssessmentResponses(currentUser) {
  const users = getUsers();
  const user = users[currentUser] || {};
  const assessment = getAssessmentData();
  const questionnaireKey = `questionnaire_${currentUser}`;
  const profileKey = `profile_${currentUser}`;
  const previousQuestionnaire = localStorage.getItem(questionnaireKey);
  const previousProfile = localStorage.getItem(profileKey);
  const savedQuestionnaire = JSON.parse(previousQuestionnaire) || {};
  const savedProfile = JSON.parse(previousProfile) || {};
  const completedAt = new Date().toISOString();

  const questionnaire = {
    ...savedQuestionnaire,
    ...assessment,
    objetivo: assessment.goal,
    completed: true,
    completedAt
  };

  const profile = {
    ...savedProfile,
    name: savedProfile.name || user.name || "",
    age: savedProfile.age || "",
    height: savedProfile.height || "",
    weight: savedProfile.weight || "",
    email: savedProfile.email || currentUser,
    createdAt: savedProfile.createdAt || user.createdAt || "",
    expiresAt: savedProfile.expiresAt || user.expiresAt || "",
    ...assessment
  };

  const questionnaireJSON = JSON.stringify(questionnaire);
  const profileJSON = JSON.stringify(profile);

  try {
    localStorage.setItem(questionnaireKey, questionnaireJSON);
    localStorage.setItem(profileKey, profileJSON);

    if (
      localStorage.getItem(questionnaireKey) !== questionnaireJSON ||
      localStorage.getItem(profileKey) !== profileJSON
    ) {
      throw new Error("No fue posible verificar los datos guardados");
    }
  } catch (error) {
    if (previousQuestionnaire === null) localStorage.removeItem(questionnaireKey);
    else localStorage.setItem(questionnaireKey, previousQuestionnaire);

    if (previousProfile === null) localStorage.removeItem(profileKey);
    else localStorage.setItem(profileKey, previousProfile);

    throw error;
  }

  return { questionnaire, profile };
}

function startAssessmentProcessing(duration = 2400) {
  const fill = $("assessmentProcessingFill");
  const percentage = $("assessmentProcessingPercent");

  if (fill) fill.style.width = "0%";
  if (percentage) percentage.textContent = "0%";

  return new Promise(resolve => {
    const startedAt = performance.now();

    function updateProgress(now) {
      const progress = Math.min(100, Math.round(((now - startedAt) / duration) * 100));

      if (fill) fill.style.width = `${progress}%`;
      if (percentage) percentage.textContent = `${progress}%`;

      if (progress < 100) requestAnimationFrame(updateProgress);
      else resolve();
    }

    requestAnimationFrame(updateProgress);
  });
}

async function nextSlide() {
  const slides = document.querySelectorAll(".slide");

  if (!validateCurrentAssessmentSlide()) return;

  if (currentSlide < slides.length - 1) {
    currentSlide++;
    showSlide(currentSlide);
    return;
  }

  const currentUser = localStorage.getItem("currentUser");

  if (!currentUser) {
    alert("No hay usuario activo");
    return;
  }

  if (isAssessmentSubmitting) return;

  isAssessmentSubmitting = true;
  if ($("nextBtn")) {
    $("nextBtn").disabled = true;
    $("nextBtn").textContent = "Guardando...";
  }
  $("assessmentSaveError")?.classList.add("hidden");

  try {
    const savedAssessment = saveAssessmentResponses(currentUser);
    if (window.TrainerSupabase?.isConfigured()) {
      const profileResult = await window.TrainerSupabase.auth.getAuthenticatedProfile();
      if (profileResult.error) throw new Error(profileResult.error.message);
      const result = await window.TrainerSupabase.questionnaires.saveAssessment(profileResult.data.id, savedAssessment.questionnaire);
      if (result.error) throw new Error(result.error.message);
    }
  } catch (error) {
    console.error("No se pudo guardar la evaluación:", error);
    if ($("assessmentSaveError")) {
      $("assessmentSaveError").textContent =
        "No se pudo guardar la evaluación. Revisa el espacio disponible e inténtalo nuevamente.";
      $("assessmentSaveError").classList.remove("hidden");
    }
    if ($("nextBtn")) {
      $("nextBtn").disabled = false;
      $("nextBtn").textContent = "Enviar";
    }
    isAssessmentSubmitting = false;
    return;
  }

  loadProfile();
  renderAdminData();
  showAssessmentConfirmation();
  await startAssessmentProcessing();
  goToPage("profilePage");
}

function prevSlide() {
  if (currentSlide > 0) {
    currentSlide--;
    showSlide(currentSlide);
  }
}

/* MODO OSCURO */

function toggleMode() {
  document.body.classList.toggle("dark-mode");

  const isDark = document.body.classList.contains("dark-mode");
  localStorage.setItem("darkMode", isDark ? "true" : "false");

  if ($("modeSwitch")) {
    $("modeSwitch").textContent = isDark ? "☀️" : "🌙";
  }
}

/* LOGIN */

async function login() {
  const email = $("emailInput")?.value.trim();
  const password = $("passwordInput")?.value.trim();

  if (!email || !password) {
    alert("Completa correo y contraseña");
    return;
  }

  if (!window.TrainerSupabase?.isConfigured()) {
    alert(AUTH_SERVICE_UNAVAILABLE_MESSAGE);
    return;
  }

  const signedIn = await window.TrainerSupabase.auth.signIn(email, password);
  if (signedIn.error) {
    const errorMessage = signedIn.error.message || "";
    const connectionFailed = /failed to fetch|network|conexión|timeout|load failed/i.test(errorMessage);
    alert(connectionFailed
      ? AUTH_SERVICE_UNAVAILABLE_MESSAGE
      : errorMessage || AUTH_SERVICE_UNAVAILABLE_MESSAGE);
    return;
  }

  const session = signedIn.data?.session;
  if (!session?.user?.id) {
    alert("No se pudo cargar tu perfil");
    return;
  }
  await loadRestoredSupabaseSession(session);
}

async function getSupabaseAssessmentState(userId) {
  const result = await window.TrainerSupabase.questionnaires.getAssessment(userId);
  if (result.error) {
    console.error("No se pudo consultar la evaluación inicial:", result.error);
    return { status: ASSESSMENT_STATUS.ERROR, error: result.error };
  }
  if (!result.data || result.data.completed !== true) {
    return { status: ASSESSMENT_STATUS.NOT_FOUND, assessment: result.data || null };
  }
  return { status: ASSESSMENT_STATUS.COMPLETED, assessment: result.data };
}

function cacheSupabaseAssessment(email, assessment) {
  localStorage.setItem(`questionnaire_${email}`, JSON.stringify({
    goal: assessment.goal,
    previousTraining: assessment.previous_training,
    trainingDays: assessment.training_days,
    sessionDuration: assessment.session_duration,
    gymExperience: assessment.gym_experience,
    physicalActivity: assessment.physical_activity,
    hasInjury: assessment.has_injury,
    injuryDescription: assessment.injury_description,
    completed: assessment.completed,
    completedAt: assessment.completed_at
  }));
}

function blockSupabaseAssessmentLoadError() {
  localStorage.removeItem("currentUser");
  localStorage.removeItem("currentRole");
  initializedSupabaseUserId = "";
  alert(ASSESSMENT_CHECK_ERROR_MESSAGE);
  goToPage("loginPage");
}

async function startSession(email, user, authenticatedUserId = "") {
  if (!window.TrainerSupabase?.isConfigured() || !authenticatedUserId) {
    console.error("Se rechazó un intento de iniciar sesión sin autenticación de Supabase.");
    goToPage("loginPage");
    return false;
  }

  await initializeExerciseLibrary();

  let assessmentState = null;
  if (user.role === "user") {
    assessmentState = await getSupabaseAssessmentState(authenticatedUserId);
    if (assessmentState.status === ASSESSMENT_STATUS.ERROR) {
      blockSupabaseAssessmentLoadError();
      return false;
    }
    if (assessmentState.status === ASSESSMENT_STATUS.COMPLETED) {
      cacheSupabaseAssessment(email, assessmentState.assessment);
    }
  }

  if ($("whoami")) {
    const dataMode = window.TrainerSupabase?.mode === "supabase" ? "Supabase" : "Local (transición)";
    $("whoami").textContent = `${user.name} (${user.role}) · ${dataMode}`;
    $("whoami").classList.remove("hidden");
  }

  if ($("btnLogout")) {
    $("btnLogout").classList.remove("hidden");
  }

  if (window.TrainerSupabase?.isConfigured() && ["admin", "trainer"].includes(user.role)) {
    const usersResult = await refreshSupabaseUsers();
    if (usersResult.error) {
      console.error("No se pudo cargar la lista de usuarios desde Supabase:", usersResult.error.message);
    }
  }

  await loadProfile(authenticatedUserId || user.supabaseId || "", false);
  await renderUserExercises();
  showProfilePhoto();
  renderProfileCard();
  renderAdminData();
  syncRoutineNavigationUI();

  if (user.role === "admin") {
    goToPage("adminPage");
    return true;
  }

  if (assessmentState?.status === ASSESSMENT_STATUS.COMPLETED) {
    goToPage("profilePage");
  } else {
    currentSlide = 0;
    goToPage("questionnairePage");
    showSlide(currentSlide);
  }
  return true;
}

async function logout() {
  if (window.TrainerSupabase?.isConfigured()) {
    const result = await window.TrainerSupabase.auth.signOut();
    if (result.error) console.error("No se pudo cerrar la sesión de Supabase:", result.error.message);
  }
  localStorage.removeItem("currentUser");
  localStorage.removeItem("currentRole");
  initializedSupabaseUserId = "";

  if ($("emailInput")) $("emailInput").value = "";
  if ($("passwordInput")) $("passwordInput").value = "";

  if ($("whoami")) $("whoami").classList.add("hidden");
  if ($("btnLogout")) $("btnLogout").classList.add("hidden");

  goToPage("loginPage");
}

async function getSupabaseSubscriptionAccess(profile) {
  if (["admin", "trainer"].includes(profile?.role)) {
    return { allowed: true, reason: "staff" };
  }

  if (profile?.role !== "user" || !profile?.id) {
    return { allowed: false, reason: "missing", message: SUBSCRIPTION_MISSING_MESSAGE };
  }

  const result = await window.TrainerSupabase.subscriptions.getAccessSubscription(profile.id);
  if (result.error) {
    console.error("No se pudo verificar la suscripción:", result.error);
    return { allowed: false, reason: "error", message: SUBSCRIPTION_CHECK_ERROR_MESSAGE };
  }

  const subscription = result.data;
  if (!subscription) {
    return { allowed: false, reason: "missing", message: SUBSCRIPTION_MISSING_MESSAGE };
  }

  if (subscription.effective_status !== "active") {
    const reason = subscription.effective_status || "inactive";
    return {
      allowed: false,
      reason,
      message: reason === "expired" ? SUBSCRIPTION_EXPIRED_MESSAGE : SUBSCRIPTION_INACTIVE_MESSAGE
    };
  }

  return { allowed: true, reason: "active", subscription };
}

function blockSupabaseSubscriptionAccess(message) {
  localStorage.removeItem("currentUser");
  localStorage.removeItem("currentRole");
  initializedSupabaseUserId = "";
  currentSupabaseProfile = null;
  alert(message);
  goToPage("loginPage");
}

async function loadRestoredSupabaseSession(session) {
  const userId = session?.user?.id;
  if (!userId) return false;
  if (initializedSupabaseUserId === userId) return true;
  if (supabaseSessionLoadPromise) return supabaseSessionLoadPromise;

  supabaseSessionLoadPromise = (async () => {
    console.log("Sesión restaurada:", Boolean(session));
    console.log("UUID:", userId);

    const client = window.TrainerSupabase.requireClient();
    const profileResult = await client
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (profileResult.error || !profileResult.data?.active) {
      console.error("No se pudo restaurar el perfil:", profileResult.error);
      await logout();
      return false;
    }

    const profile = profileResult.data;
    console.log("Perfil recibido:", profile);
    const subscriptionAccess = await getSupabaseSubscriptionAccess(profile);
    if (!subscriptionAccess.allowed) {
      blockSupabaseSubscriptionAccess(subscriptionAccess.message);
      return false;
    }

    const email = profile.email || session.user.email;
    localStorage.setItem("currentUser", email);
    localStorage.setItem("currentRole", profile.role);

    const sessionStarted = await startSession(
      email,
      { name: profile.full_name || email, role: profile.role, supabaseId: profile.id },
      userId
    );
    if (!sessionStarted) return false;

    initializedSupabaseUserId = userId;
    console.log("Pantalla renderizada:", profile.role === "admin" ? "adminPage" : "perfil/cuestionario");
    return true;
  })().finally(() => {
    supabaseSessionLoadPromise = null;
  });

  return supabaseSessionLoadPromise;
}

function ensureSupabaseAuthStateListener() {
  if (supabaseAuthStateSubscription || !window.TrainerSupabase?.isConfigured()) return;

  const authListener = window.TrainerSupabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      authCallbackFlowActive = true;
      localStorage.setItem(TEMPORARY_AUTH_FLOW_KEY, "true");
      configurePasswordSetupView("recovery");
      goToPage("passwordSetupPage");
      if ($("btnCreatePassword")) $("btnCreatePassword").disabled = false;
      $("newAccountPassword")?.focus();
      return;
    }

    if (
      authCallbackFlowActive ||
      isCompletingPasswordSetup ||
      event === "USER_UPDATED"
    ) {
      if (authCallbackFlowActive && session?.user?.id) {
        goToPage("passwordSetupPage");
      }
      return;
    }

    // SIGNED_IN también puede emitirse para una sesión que ya estaba activa (por
    // ejemplo, al volver a enfocar la pestaña). El login explícito ya carga la
    // sesión; aquí sólo se restaura el estado inicial de una nueva carga.
    if (event !== "INITIAL_SESSION" || !session?.user?.id) return;
    window.setTimeout(() => {
      loadRestoredSupabaseSession(session).catch(error => {
        console.error("Error al reintentar la restauración de sesión:", error);
      });
    }, 0);
  });
  supabaseAuthStateSubscription = authListener?.data?.subscription || authListener;
}

async function restoreSession() {
  if (!window.TrainerSupabase?.isConfigured()) {
    localStorage.removeItem("currentUser");
    localStorage.removeItem("currentRole");
    console.error(AUTH_SERVICE_UNAVAILABLE_MESSAGE);
    goToPage("loginPage");
    return;
  }

  if (authCallbackFlowActive || isCompletingPasswordSetup) {
    if (initialSupabaseAuthCallback.active || isCompletingPasswordSetup) {
      goToPage("passwordSetupPage");
      return;
    }

    const result = await window.TrainerSupabase.auth.signOut();
    if (result.error) {
      console.error("No se pudo cerrar una sesión temporal pendiente:", result.error);
    }
    clearTemporarySupabaseAuthState();
    authCallbackFlowActive = false;
    goToPage("loginPage");
    return;
  }

  console.log("Inicio restauración");
  ensureSupabaseAuthStateListener();

  const sessionResult = await window.TrainerSupabase.auth.getSession();
  if (sessionResult.error) {
    console.error("Error al restaurar sesión:", sessionResult.error);
  }

  const session = sessionResult.data?.session;
  if (session?.user?.id) {
    await loadRestoredSupabaseSession(session);
    return;
  }

  // INITIAL_SESSION reintentará la carga si la sesión llega después.
  localStorage.removeItem("currentUser");
  localStorage.removeItem("currentRole");
  goToPage("loginPage");
}

/* PERFIL */

const aerobicTestInformation = {
  cooper: {
    title: "Prueba de Cooper",
    text: `Esta sencilla prueba permite obtener información sobre tu capacidad aeróbica. Consiste en correr durante 12 minutos intentando mantener un ritmo constante y recorrer la mayor distancia posible.

Al repetirla periódicamente podrás comprobar tu evolución con la rutina de entrenamiento y estimar de manera indirecta tu consumo máximo de oxígeno (VO₂ máx.), lo que ayuda a adaptar las cargas de entrenamiento.

Registra la distancia total recorrida en kilómetros.`
  },
  vam: {
    title: "Prueba de VAM — Velocidad Aeróbica Máxima",
    text: `La VAM es la Velocidad Aeróbica Máxima. No es una prueba de esfuerzo por sí sola, sino una métrica que se obtiene mediante un test progresivo.

Permite conocer la velocidad máxima que un corredor puede sostener utilizando su máxima capacidad de absorción y aprovechamiento de oxígeno (VO₂ máx.).

El test suele realizarse en una pista de atletismo, aumentando progresivamente la velocidad hasta el agotamiento. El resultado permite establecer ritmos de entrenamiento personalizados y evaluar el progreso.

Registra el resultado en kilómetros por hora.`
  }
};

let aerobicModalTrigger = null;

function getAerobicResult(value, unit) {
  if (value === undefined || value === null || value === "") return "Sin registrar";
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return "Sin registrar";
  return `${value} ${unit}`;
}

function openAerobicTestModal(testType, trigger = null) {
  const modal = $("aerobicInfoModal");
  const information = aerobicTestInformation[testType];
  if (!modal || !information) return;

  aerobicModalTrigger = trigger;
  $("aerobicModalTitle").textContent = information.title;
  $("aerobicModalText").textContent = information.text;
  modal.classList.remove("hidden");
  document.body.classList.add("aerobic-modal-open");
  $("closeAerobicModal")?.focus();
}

function closeAerobicTestModal() {
  const modal = $("aerobicInfoModal");
  if (!modal || modal.classList.contains("hidden")) return;

  modal.classList.add("hidden");
  document.body.classList.remove("aerobic-modal-open");
  aerobicModalTrigger?.focus();
  aerobicModalTrigger = null;
}

async function saveProfile() {
  const currentUser = localStorage.getItem("currentUser");

  if (!currentUser) {
    alert("No hay usuario activo");
    return;
  }

  if (window.TrainerSupabase?.isConfigured()) {
    const client = window.TrainerSupabase.requireClient();
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    const session = sessionData?.session;
    if (sessionError || !session?.user?.id) {
      console.error("Error completo de sesión al guardar perfil:", sessionError);
      alert("La sesión expiró. Inicia sesión nuevamente.");
      return;
    }

    const userId = session.user.id;
    console.log("UUID usado:", userId);
    console.log("Perfil actual antes de guardar:", currentSupabaseProfile);
    const existingProfile = currentSupabaseProfile || {};

    const nullableNumber = (value, integer = false) => {
      const normalized = String(value ?? "").trim();
      if (!normalized) return null;
      const numericValue = Number(normalized);
      if (!Number.isFinite(numericValue)) return Number.NaN;
      return integer ? Math.trunc(numericValue) : numericValue;
    };

    const fullName = $("pName")?.value.trim() || "";
    const ageValue = nullableNumber($("pAge")?.value, true);
    const weightValue = nullableNumber($("pWeight")?.value);
    const heightValue = nullableNumber($("pHeight")?.value);
    const cooperValue = nullableNumber($("cooperDistance")?.value);
    const vamValue = nullableNumber($("vamSpeed")?.value);
    const goalValue =
      existingProfile.goal ||
      existingProfile.objetivo ||
      "";

    const numericValues = [ageValue, weightValue, heightValue, cooperValue, vamValue];
    if (numericValues.some(value => Number.isNaN(value)) ||
        [weightValue, heightValue, cooperValue, vamValue].some(value => value !== null && value < 0) ||
        (ageValue !== null && ageValue < 0)) {
      alert("Ingresa valores numéricos válidos y sin números negativos");
      return;
    }

    let avatarPathValue =
      existingProfile.avatar_path ||
      existingProfile.avatar_url ||
      "";
    let uploadedAvatarPath = "";

    if (pendingProfilePhotoFile) {
      const extension =
        pendingProfilePhotoFile.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
        "jpg";
      const avatarPath = `${userId}/avatar-${Date.now()}.${extension}`;
      const uploadResult = await client.storage
        .from("avatars")
        .upload(avatarPath, pendingProfilePhotoFile, {
          upsert: false,
          contentType: pendingProfilePhotoFile.type || "image/jpeg"
        });

      if (uploadResult.error || !uploadResult.data?.path) {
        console.error("Error completo al subir avatar:", uploadResult.error);
        alert(uploadResult.error?.message || "No se pudo guardar la foto de perfil.");
        return;
      }

      uploadedAvatarPath = uploadResult.data.path;
      avatarPathValue = uploadedAvatarPath;
    }

    const payload = {
      full_name: fullName,
      age: ageValue,
      weight: weightValue,
      height: heightValue,
      goal: goalValue || null,
      cooper_distance_km: cooperValue,
      vam_kmh: vamValue,
      avatar_path: avatarPathValue || null,
      updated_at: new Date().toISOString()
    };

    console.log("Payload enviado:", {
      full_name: fullName ? "[definido]" : "",
      age: ageValue === null ? null : "[definido]",
      weight: weightValue === null ? null : "[definido]",
      height: heightValue === null ? null : "[definido]",
      goal: goalValue ? "[definido]" : null,
      cooper_distance_km: cooperValue === null ? null : "[definido]",
      vam_kmh: vamValue === null ? null : "[definido]",
      avatar_path: avatarPathValue ? "[definido]" : null,
      updated_at: payload.updated_at
    });
    console.log("avatar_path final:", avatarPathValue || null);

    const { data, error } = await client
      .from("profiles")
      .update(payload)
      .eq("id", userId)
      .select()
      .single();

    console.log("Data del update:", data);
    console.error("Error completo del update:", error);

    if (error || !data) {
      if (uploadedAvatarPath) {
        const cleanupResult = await client.storage.from("avatars").remove([uploadedAvatarPath]);
        if (cleanupResult.error) {
          console.error("No se pudo limpiar el avatar después del error:", cleanupResult.error);
        }
      }
      alert(error?.message || "Supabase no devolvió el perfil actualizado.");
      return;
    }

    currentSupabaseProfile = data;
    currentSupabaseAvatarUrl = "";
    if (data.avatar_path) {
      if (/^(https?:|data:|blob:)/i.test(data.avatar_path)) {
        currentSupabaseAvatarUrl = data.avatar_path;
      } else {
        const avatarResult = await window.TrainerSupabase.storage.getAvatarUrl(data.avatar_path);
        if (avatarResult.error) {
          console.error("No se pudo obtener la URL del avatar actualizado:", avatarResult.error);
        } else {
          currentSupabaseAvatarUrl = avatarResult.data?.signedUrl || "";
        }
      }
    }

    pendingProfilePhotoFile = null;
    clearPendingProfilePhotoPreview();
    window.pendingProfilePhotoFile = null;
    window.pendingProfilePhotoPreview = "";
    if ($("profilePhoto")) $("profilePhoto").value = "";
    if ($("profileSaved")) $("profileSaved").classList.remove("hidden");
    showProfilePhoto();
    renderProfileCard();
    alert("Perfil guardado correctamente");
    return;
  }

  const questionnaire = JSON.parse(localStorage.getItem(`questionnaire_${currentUser}`));
  const savedProfile = JSON.parse(localStorage.getItem(`profile_${currentUser}`)) || {};
  const user = getUsers()[currentUser] || {};
  const cooperDistance = $("cooperDistance")?.value.trim() || "";
  const vamSpeed = $("vamSpeed")?.value.trim() || "";

  const hasInvalidCooperResult = cooperDistance && (!Number.isFinite(Number(cooperDistance)) || Number(cooperDistance) < 0);
  const hasInvalidVamResult = vamSpeed && (!Number.isFinite(Number(vamSpeed)) || Number(vamSpeed) < 0);

  if (hasInvalidCooperResult || hasInvalidVamResult) {
    alert("Ingresa resultados válidos y sin números negativos");
    return;
  }

  const photoResult = await saveProfilePhoto();
  if (!photoResult) return;

  const profile = {
    ...savedProfile,
    name: $("pName")?.value || "",
    age: $("pAge")?.value || "",
    weight: $("pWeight")?.value || "",
    height: $("pHeight")?.value || "",
    email: savedProfile.email || currentUser,
    createdAt: savedProfile.createdAt || user.createdAt || "",
    expiresAt: savedProfile.expiresAt || user.expiresAt || "",
    goal: savedProfile.goal || questionnaire?.goal || questionnaire?.objetivo || "",
    cooperDistance,
    vamSpeed
  };

  localStorage.setItem(`profile_${currentUser}`, JSON.stringify(profile));

  if ($("profileSaved")) {
    $("profileSaved").classList.remove("hidden");
  }

  renderProfileCard();
  renderAdminData();

  alert("Perfil guardado correctamente");
}

async function loadProfile(authenticatedUserId = "", shouldRender = true) {
  const currentUser = localStorage.getItem("currentUser");
  if (!currentUser) return;

  let profile = JSON.parse(localStorage.getItem(`profile_${currentUser}`));

  if (window.TrainerSupabase?.isConfigured()) {
    try {
      const client = window.TrainerSupabase.requireClient();
      let profileUserId = authenticatedUserId;
      let authenticatedUser = null;
      if (!profileUserId) {
        const authResult = await client.auth.getUser();
        console.log("auth.getUser():", authResult);
        authenticatedUser = authResult.data?.user || null;
        profileUserId = authenticatedUser?.id || "";
        console.log("user.id obtenido:", profileUserId || null);
        if (authResult.error) {
          console.error("error completo auth.getUser():", authResult.error);
          return;
        }
      }

      if (!profileUserId) {
        console.error("No se obtuvo user.id para cargar el perfil");
        return;
      }

      console.log("Consulta a public.profiles:", {
        table: "profiles",
        filter: { id: profileUserId }
      });
      const profileResult = await client
        .from("profiles")
        .select("*")
        .eq("id", profileUserId)
        .single();

      console.log("Resultado completo public.profiles:", profileResult);
      console.error("Error completo public.profiles:", profileResult.error);

      if (profileResult.error) return;

      const supabaseProfile = profileResult.data;
      console.log("Profile encontrado:", supabaseProfile);
      if (!supabaseProfile) return;
      currentSupabaseProfile = supabaseProfile;

      profile = {
        ...profile,
        user_number: supabaseProfile.user_number ?? null,
        name: supabaseProfile.full_name || "",
        age: supabaseProfile.age ?? "",
        weight: supabaseProfile.weight ?? "",
        height: supabaseProfile.height ?? "",
        email: supabaseProfile.email || authenticatedUser?.email || currentUser,
        goal: supabaseProfile.goal || "",
        cooperDistance: supabaseProfile.cooper_distance_km ?? "",
        vamSpeed: supabaseProfile.vam_kmh ?? ""
      };
      localStorage.setItem(`profile_${currentUser}`, JSON.stringify(profile));

      if (supabaseProfile.avatar_path && window.TrainerSupabase.storage) {
        const avatarResult = await window.TrainerSupabase.storage.getAvatarUrl(
          supabaseProfile.avatar_path
        );
        if (!avatarResult.error && avatarResult.data?.signedUrl) {
          localStorage.setItem(
            `profilePhoto_${currentUser}`,
            avatarResult.data.signedUrl
          );
        }
      }
    } catch (error) {
      console.error("Error completo al cargar el perfil:", error);
      return;
    }
  }

  if (profile) {
    if ($("pName")) $("pName").value = profile.name || "";
    if ($("pAge")) $("pAge").value = profile.age || "";
    if ($("pWeight")) $("pWeight").value = profile.weight || "";
    if ($("pHeight")) $("pHeight").value = profile.height || "";
    if ($("cooperDistance")) $("cooperDistance").value = profile.cooperDistance ?? "";
    if ($("vamSpeed")) $("vamSpeed").value = profile.vamSpeed ?? "";
  } else {
    if ($("cooperDistance")) $("cooperDistance").value = "";
    if ($("vamSpeed")) $("vamSpeed").value = "";
  }

  if (shouldRender) {
    showProfilePhoto();
    renderProfileCard();
  }
}

function renderProfileCard() {
  const currentUser = localStorage.getItem("currentUser");
  const container = $("profileCard");

  if (!currentUser || !container) return;

  const profile = JSON.parse(localStorage.getItem(`profile_${currentUser}`));
  const questionnaire = JSON.parse(localStorage.getItem(`questionnaire_${currentUser}`));
  const photo = sanitizeMediaURL(
    pendingProfilePhotoPreviewUrl || localStorage.getItem(`profilePhoto_${currentUser}`),
    { allowBlob: true, allowDataImage: true }
  );
  const userNumber =
    currentSupabaseProfile?.user_number ??
    profile?.user_number ??
    null;

  container.innerHTML = `
    <div class="profile-card-inner">
      ${
        photo
          ? `<img src="${escapeHTML(photo)}" class="profile-photo" alt="Foto de perfil">`
          : `<div class="profile-placeholder">👤</div>`
      }

      <h2 class="${userNumber !== null ? "profile-name-with-number" : ""}">${escapeHTML(profile?.name || "Tu nombre")}</h2>
      ${userNumber !== null
        ? `<span class="profile-user-number">#${escapeHTML(userNumber)}</span>`
        : ""
      }

      <p class="profile-objective">
        ${escapeHTML(profile?.goal || questionnaire?.goal || questionnaire?.objetivo || "Objetivo pendiente")}
      </p>

      <div class="profile-stats">
        <div>
          <strong>${escapeHTML(profile?.age || "--")}</strong>
          <span>Edad</span>
        </div>

        <div>
          <strong>${escapeHTML(profile?.weight || "--")} kg</strong>
          <span>Peso</span>
        </div>

        <div>
          <strong>${escapeHTML(profile?.height || "--")}</strong>
          <span>Altura</span>
        </div>
      </div>

      <section class="profile-aerobic-section" aria-labelledby="profileAerobicTitle">
        <div class="profile-aerobic-heading">
          <span>Rendimiento</span>
          <h3 id="profileAerobicTitle">Evaluaciones aeróbicas</h3>
        </div>
        <div class="profile-aerobic-grid">
          <article class="profile-aerobic-result">
            <div class="profile-aerobic-result-title">
              <span>Prueba de Cooper</span>
              <button class="aerobic-info-btn" type="button" data-aerobic-info="cooper" aria-label="Información sobre la Prueba de Cooper">i</button>
            </div>
            <strong>${escapeHTML(getAerobicResult(profile?.cooperDistance, "km"))}</strong>
          </article>
          <article class="profile-aerobic-result">
            <div class="profile-aerobic-result-title">
              <span>Prueba de VAM</span>
              <button class="aerobic-info-btn" type="button" data-aerobic-info="vam" aria-label="Información sobre la Prueba de VAM">i</button>
            </div>
            <strong>${escapeHTML(getAerobicResult(profile?.vamSpeed, "km/h"))}</strong>
          </article>
        </div>
      </section>
    </div>
  `;
}

function readProfilePhotoAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => resolve(event.target?.result || "");
    reader.onerror = () => reject(new Error("No se pudo cargar la vista previa de la imagen."));
    reader.readAsDataURL(file);
  });
}

function clearPendingProfilePhotoPreview() {
  if (pendingProfilePhotoPreviewUrl) {
    URL.revokeObjectURL(pendingProfilePhotoPreviewUrl);
    pendingProfilePhotoPreviewUrl = "";
  }
}

function previewSelectedProfilePhoto(event) {
  console.log("Change disparado");
  const statusElement = document.getElementById("profilePhotoLabel");
  const file = event.target.files?.[0];
  if (!file) {
    console.warn("No se seleccionó archivo");
    return;
  }

  console.log("File encontrado:", file.name);
  console.log("Tipo:", file.type);
  console.log("Tamaño:", file.size);
  if (statusElement) statusElement.textContent = "Foto de perfil · archivo seleccionado";

  if (!file.type?.startsWith("image/")) {
    event.target.value = "";
    alert("Selecciona una imagen válida");
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {
    console.log("FileReader onload");
    const previewUrl = reader.result;
    if (statusElement) statusElement.textContent = "Foto de perfil · imagen leída";

    if (!previewUrl) {
      alert("No se pudo leer la imagen");
      return;
    }

    const preview = document.getElementById("profilePreview");
    console.log("Elemento de vista previa encontrado:", Boolean(preview));
    if (!preview) {
      alert("No se pudo cargar la vista previa de la imagen");
      return;
    }

    preview.src = sanitizeMediaURL(previewUrl, { allowDataImage: true });
    preview.classList.remove("hidden");
    preview.style.display = "block";
    console.log("Src actualizado:", Boolean(preview.src));
    if (statusElement) statusElement.textContent = "Foto de perfil · vista previa aplicada";

    pendingProfilePhotoFile = file;
    pendingProfilePhotoPreviewUrl = previewUrl;
    window.pendingProfilePhotoFile = file;
    window.pendingProfilePhotoPreview = previewUrl;

    renderProfileCard();
    console.log("Vista previa actualizada correctamente");
  };

  reader.onerror = () => {
    console.error("Error FileReader", reader.error);
    alert("No se pudo cargar la vista previa de la imagen");
  };

  reader.readAsDataURL(file);
}

async function saveProfilePhoto() {
  const currentUser = localStorage.getItem("currentUser");
  const file = pendingProfilePhotoFile;
  if (!file) return true;
  if (!currentUser) return false;

  try {
    if (window.TrainerSupabase?.isConfigured()) {
      const profileResult = await window.TrainerSupabase.profiles.getOwnProfile();
      if (profileResult.error) throw new Error(profileResult.error.message);

      const uploadResult = await window.TrainerSupabase.storage.uploadAvatar(
        file,
        profileResult.data?.avatar_path || null
      );
      if (uploadResult.error) throw new Error(uploadResult.error.message);

      const urlResult = await window.TrainerSupabase.storage.getAvatarUrl(uploadResult.data.path);
      if (urlResult.error) throw new Error(urlResult.error.message);
      if (urlResult.data?.signedUrl) {
        localStorage.setItem(`profilePhoto_${currentUser}`, urlResult.data.signedUrl);
      }
    } else {
      const dataUrl = await readProfilePhotoAsDataUrl(file);
      if (!dataUrl) throw new Error("No se pudo cargar la vista previa de la imagen.");
      localStorage.setItem(`profilePhoto_${currentUser}`, dataUrl);
    }

    pendingProfilePhotoFile = null;
    clearPendingProfilePhotoPreview();
    if ($("profilePhoto")) $("profilePhoto").value = "";
    showProfilePhoto();
    renderProfileCard();
    renderAdminData();
    return true;
  } catch (error) {
    console.error("Error al guardar la foto de perfil:", error);
    alert(error?.message || "No se pudo guardar la foto de perfil.");
    return false;
  }
}

function showProfilePhoto() {
  const currentUser = localStorage.getItem("currentUser");
  const preview = $("profilePreview");

  if (!currentUser || !preview) return;

  const savedPhoto = sanitizeMediaURL(
    pendingProfilePhotoPreviewUrl || localStorage.getItem(`profilePhoto_${currentUser}`),
    { allowBlob: true, allowDataImage: true }
  );

  if (!savedPhoto) {
    preview.classList.add("hidden");
    return;
  }

  preview.src = savedPhoto;
  preview.classList.remove("hidden");
}

/* BIBLIOTECA */

function normalizeExercise(exercise) {
  if (!exercise || typeof exercise !== "object") return exercise;

  const textValue = (...values) => {
    const value = values.find(candidate =>
      typeof candidate === "string" && candidate.trim()
    );
    return value?.trim();
  };

  const title = textValue(
    exercise.title,
    exercise.name,
    exercise.nombre,
    exercise.exerciseName
  );
  const category = textValue(
    exercise.category,
    exercise.muscle_group,
    exercise.muscleGroup,
    exercise.grupoMuscular
  );
  const url = textValue(exercise.url, exercise.media_url, exercise.videoUrl, exercise.imageUrl);
  const type = textValue(exercise.type, exercise.media_type) ||
    (textValue(exercise.videoUrl) ? "video" : undefined);

  return {
    ...exercise,
    ...(title ? { title } : {}),
    ...(category ? { category } : {}),
    ...(url ? { url } : {}),
    ...(type ? { type } : {})
  };
}

function getExerciseLibrary() {
  try {
    const library = JSON.parse(localStorage.getItem("exerciseLibrary"));
    return Array.isArray(library) ? library.map(normalizeExercise) : [];
  } catch (error) {
    console.error("No se pudo leer la biblioteca de ejercicios:", error);
    return [];
  }
}

function saveExerciseLibrary(library) {
  localStorage.setItem("exerciseLibrary", JSON.stringify(library));
}

let exerciseLibraryInitialization;

async function initializeExerciseLibrary() {
  if (exerciseLibraryInitialization) return exerciseLibraryInitialization;

  exerciseLibraryInitialization = (async () => {
    if (window.TrainerSupabase?.isConfigured()) {
      const result = await window.TrainerSupabase.exercises.listExercises();
      if (!result.error) {
        const library = result.data.map(exercise => ({ id: exercise.id, legacyId: exercise.legacy_id, category: exercise.category, title: exercise.title, type: exercise.media_type, url: exercise.media_url }));
        saveExerciseLibrary(library); // caché de lectura temporal para renderizadores heredados
        console.log(`${library.length} ejercicios cargados desde Supabase`);
        return library;
      }
      console.error("Error al cargar la biblioteca desde Supabase:", result.error.message);
      return [];
    }

    const savedLibrary = getExerciseLibrary();

    if (savedLibrary.length > 0) return savedLibrary;

    console.log("Cargando biblioteca desde JSON");

    try {
      const response = await fetch("./data/exercises.json");

      if (!response.ok) {
        throw new Error(`Error HTTP ${response.status}: ${response.statusText}`);
      }

      const library = await response.json();

      if (!Array.isArray(library)) {
        throw new Error("data/exercises.json no contiene un arreglo");
      }

      saveExerciseLibrary(library);
      console.log(`${library.length} ejercicios cargados`);
      return library;
    } catch (error) {
      console.error("Error al cargar la biblioteca desde JSON:", error);
      exerciseLibraryInitialization = null;
      return [];
    }
  })();

  return exerciseLibraryInitialization;
}

function exportExerciseLibrary() {
  const library = getExerciseLibrary();
  const json = JSON.stringify(library, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = downloadUrl;
  link.download = "exercise-library.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
}

function getUserAssignments() {
  return JSON.parse(localStorage.getItem("userAssignments")) || {};
}

function saveUserAssignments(assignments) {
  localStorage.setItem("userAssignments", JSON.stringify(assignments));
}

async function addExerciseToLibraryLegacy() {
  const category = $("exerciseCategory")?.value;
  const title = $("exerciseTitle")?.value.trim();
  const imageUrl = $("exerciseImageUrl")?.value.trim();
  const videoUrl = $("exerciseVideoUrl")?.value.trim();

  if (!category || !title) {
    alert("Completa categoría y nombre del ejercicio");
    return;
  }

  if (!imageUrl && !videoUrl) {
    alert("Agrega una imagen o pega la URL del video");
    return;
  }

  const mediaUrl = videoUrl || imageUrl;
  const safeMediaUrl = sanitizeMediaURL(mediaUrl);
  if (!safeMediaUrl) {
    alert("La URL multimedia no es segura. Usa HTTPS; HTTP sólo está permitido en desarrollo local.");
    return;
  }

  try {
    const library = getExerciseLibrary();

    let type = "image";
    let url = "";

    if (videoUrl) {
      type = "video";
      url = safeMediaUrl;
    } else if (imageUrl) {
      type = "image";
      url = safeMediaUrl;
    }

    library.push({
      id: Date.now(),
      category,
      title,
      type,
      url
    });

    saveExerciseLibrary(library);

    $("exerciseCategory").value = "";
    $("exerciseTitle").value = "";
    $("exerciseImageUrl").value = "";
    $("exerciseVideoUrl").value = "";

    renderAdminData();

    alert("Ejercicio agregado a la biblioteca");
  } catch (error) {
    console.error(error);
    alert("No se pudo agregar el ejercicio");
  }
}

async function addExerciseToLibrary() {
  console.log("Crear ejercicio presionado");

  const muscleGroup = $("exerciseCategory")?.value;
  const title = $("exerciseTitle")?.value.trim();
  const imageUrl = $("exerciseImageUrl")?.value.trim();
  const videoUrl = $("exerciseVideoUrl")?.value.trim();
  const mediaType = videoUrl ? "video" : "image";
  const mediaUrl = videoUrl || imageUrl;
  const safeMediaUrl = sanitizeMediaURL(mediaUrl);
  const payload = {
    category: muscleGroup,
    muscle_group: muscleGroup,
    title,
    media_type: mediaType,
    media_url: safeMediaUrl,
    active: true
  };

  console.log("Grupo muscular:", muscleGroup);
  console.log("Título:", title);
  console.log("Tipo de medio:", mediaType);
  console.log("URL:", mediaUrl);
  console.log("Payload ejercicio:", payload);

  if (!muscleGroup || !title) {
    alert("Completa categoría y nombre del ejercicio");
    return;
  }

  if (!mediaUrl) {
    alert("Agrega una imagen o pega la URL del video");
    return;
  }

  if (!safeMediaUrl) {
    alert("La URL multimedia no es segura. Usa HTTPS; HTTP sólo está permitido en desarrollo local.");
    return;
  }

  if (!["video", "image"].includes(mediaType)) {
    alert("Tipo de medio inválido");
    return;
  }

  try {
    if (window.TrainerSupabase?.isConfigured()) {
      const supabase = window.TrainerSupabase.getClient();
      const { data, error } = await supabase
        .from("exercises")
        .insert(payload)
        .select()
        .single();

      console.log("Respuesta insert ejercicio:", data);
      console.error("Error insert ejercicio:", error);

      if (error) {
        throw new Error(error.message || "No se pudo crear el ejercicio");
      }

      if (!data?.id) {
        throw new Error("Supabase no devolvió un ejercicio válido");
      }

      exerciseLibraryInitialization = null;
      await initializeExerciseLibrary();
      clearNewExerciseForm();
      renderAdminData();
      alert("Ejercicio agregado a la biblioteca");
      return;
    }

    const library = getExerciseLibrary();
    library.push({
      id: Date.now(),
      category: muscleGroup,
      title,
      type: mediaType,
      url: safeMediaUrl
    });
    saveExerciseLibrary(library);
    clearNewExerciseForm();
    renderAdminData();
    alert("Ejercicio agregado a la biblioteca");
  } catch (error) {
    console.error("No se pudo crear el ejercicio:", error);
    alert(`No se pudo crear el ejercicio: ${error.message || "Error desconocido"}`);
  }
}

function clearNewExerciseForm() {
  if ($("exerciseCategory")) $("exerciseCategory").value = "";
  if ($("exerciseTitle")) $("exerciseTitle").value = "";
  if ($("exerciseImageUrl")) $("exerciseImageUrl").value = "";
  if ($("exerciseVideoUrl")) $("exerciseVideoUrl").value = "";
}

function renderExerciseLibrary() {
  const container = $("exerciseLibraryList");
  if (!container) return;

  const library = getExerciseLibrary();
  const categoryFilter = $("exerciseLibraryCategoryFilter");
  const countElement = $("exerciseLibraryCount");
  const normalizedSearch = ($("exerciseLibrarySearch")?.value || "")
    .trim()
    .toLocaleLowerCase("es");

  if (!library.length) {
    container.innerHTML = "<p>No hay ejercicios cargados todavía.</p>";
    if (categoryFilter) {
      categoryFilter.replaceChildren(new Option("Todos los grupos", "Todos"));
    }
    if (countElement) countElement.textContent = "0 ejercicios encontrados";
    return;
  }

  const categories = [...new Set(
    library.map(exercise => exercise.category?.trim() || "Sin categoría")
  )].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));

  if (activeExerciseFilter !== "Todos" && !categories.includes(activeExerciseFilter)) {
    activeExerciseFilter = null;
  }

  if (categoryFilter) {
    categoryFilter.replaceChildren(
      new Option("Todos los grupos", "Todos"),
      ...categories.map(category => new Option(category, category))
    );
    categoryFilter.value = activeExerciseFilter || "Todos";
  }

  const hasActiveCriteria = Boolean(activeExerciseFilter || normalizedSearch);
  const filteredExercises = hasActiveCriteria
    ? library.filter(exercise => {
        const category = exercise.category?.trim() || "Sin categoría";
        const matchesCategory =
          !activeExerciseFilter ||
          activeExerciseFilter === "Todos" ||
          category === activeExerciseFilter;
        const searchableText = `${exercise.title || ""} ${category}`
          .toLocaleLowerCase("es");

        return matchesCategory &&
          (!normalizedSearch || searchableText.includes(normalizedSearch));
      })
    : [];

  if (countElement) {
    countElement.textContent = `${filteredExercises.length} ${
      filteredExercises.length === 1 ? "ejercicio encontrado" : "ejercicios encontrados"
    }`;
  }

  if (!hasActiveCriteria) {
    container.innerHTML =
      '<p class="exercise-library-empty">Selecciona un grupo muscular o busca un ejercicio.</p>';
    return;
  }

  if (!filteredExercises.length) {
    container.innerHTML =
      '<p class="exercise-library-empty">No se encontraron ejercicios.</p>';
    return;
  }

  container.innerHTML = filteredExercises.map(exercise => {
    const exerciseId = escapeHTML(String(exercise.id));
    const title = escapeHTML(exercise.title || "Ejercicio sin nombre");
    const category = escapeHTML(exercise.category || "Sin categoría");
    const mediaUrl = escapeHTML(sanitizeMediaURL(exercise.url));
    const isVideo = exercise.type === "video";
    const mediaPreview = mediaUrl
      ? isVideo
        ? `<video controls preload="metadata" src="${mediaUrl}"></video>`
        : `<img src="${mediaUrl}" alt="${title}" loading="lazy">`
      : '<p class="exercise-library-media-fallback">Vista previa no disponible</p>';

    return `
      <article class="media-card exercise-library-card">
        <div class="exercise-library-card-header">
          <div>
            <strong>${title}</strong>
            <div class="exercise-library-meta">
              <span>${category}</span>
              <span>${isVideo ? "Video" : "Imagen"}</span>
            </div>
          </div>

          <button type="button"
                  class="btn-delete"
                  data-library-action="delete"
                  data-exercise-id="${exerciseId}"
                  aria-label="Eliminar ${title}">
            ❌
          </button>
        </div>

        <div class="exercise-library-media">${mediaPreview}</div>

        <button type="button"
                class="btn-edit"
                data-library-action="edit"
                data-exercise-id="${exerciseId}">
          ✏️ Editar nombre
        </button>
      </article>
    `;
  }).join("");
}

async function editExerciseTitle(exerciseId) {
  const library = getExerciseLibrary();
  const exerciseIndex = library.findIndex(item => String(item.id) === String(exerciseId));
  const exercise = library[exerciseIndex];

  if (!exercise) return;

  const newTitle = prompt("Nuevo nombre del ejercicio:", exercise.title || "")?.trim();

  if (!newTitle || newTitle === exercise.title) return;

  try {
    if (window.TrainerSupabase?.isConfigured()) {
      const supabase = window.TrainerSupabase.getClient();
      const { data, error } = await supabase
        .from("exercises")
        .update({ title: newTitle })
        .eq("id", exercise.id)
        .select()
        .single();

      if (error) throw new Error(error.message || "No se pudo actualizar el ejercicio");
      if (!data || String(data.id) !== String(exercise.id)) {
        throw new Error("Supabase no devolvió el ejercicio actualizado");
      }
    }

    library[exerciseIndex] = { ...exercise, title: newTitle };
    saveExerciseLibrary(library);
    renderAdminData();
    renderUserExercises();
  } catch (error) {
    console.error("No se pudo editar el nombre del ejercicio:", error);
    alert(`No se pudo editar el ejercicio: ${error.message || "Error desconocido"}`);
  }
}

function getSelectedExerciseCategory() {
  return $("exerciseCategoryFilter")?.value || "Todos";
}

function renderExerciseCategoryFilter() {
  const filter = $("exerciseCategoryFilter");
  if (!filter) return;

  const selectedCategory = filter.value || "Todos";
  const categories = [...new Set(
    getExerciseLibrary().map(exercise =>
      exercise.category?.trim() || "Sin categoría"
    )
  )].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));

  filter.replaceChildren(
    new Option("Todos los grupos", "Todos"),
    ...categories.map(category => new Option(category, category))
  );

  filter.value = categories.includes(selectedCategory)
    ? selectedCategory
    : "Todos";
}

function renderExerciseSelect(category = getSelectedExerciseCategory()) {
  const select = $("exerciseSelect");
  if (!select) return;

  const library = getExerciseLibrary();
  const selectedExerciseId = select.value;
  const filteredExercises = category === "Todos"
    ? library
    : library.filter(exercise =>
        (exercise.category?.trim() || "Sin categoría") === category
      );

  if (filteredExercises.length === 0) {
    select.replaceChildren(new Option("No hay ejercicios en este grupo", ""));
    select.disabled = true;
    return;
  }

  select.disabled = false;
  select.replaceChildren(...filteredExercises.map(exercise => new Option(
    `${exercise.category || "Sin categoría"} - ${exercise.title || "Ejercicio"} (${exercise.type || ""})`,
    String(exercise.id ?? "")
  )));

  if (filteredExercises.some(exercise => String(exercise.id) === selectedExerciseId)) {
    select.value = selectedExerciseId;
  }
}

async function deleteExerciseFromLibrary(exerciseId) {
  if (!confirm("¿Eliminar ejercicio de la biblioteca?")) return;

  const library = getExerciseLibrary();
  const exercise = library.find(item => String(item.id) === String(exerciseId));
  if (!exercise) return;

  try {
    if (window.TrainerSupabase?.isConfigured()) {
      const result = await window.TrainerSupabase.exercises.deactivateExercise(exercise.id);

      if (result.error) {
        throw new Error(result.error.message || "No se pudo eliminar el ejercicio");
      }

      if (!result.data ||
          String(result.data.id) !== String(exercise.id) ||
          result.data.active !== false) {
        throw new Error("Supabase no confirmó la eliminación del ejercicio");
      }
    }

    const updatedLibrary = library.filter(item => String(item.id) !== String(exercise.id));
    saveExerciseLibrary(updatedLibrary);
    renderAdminData();
    renderUserExercises();
  } catch (error) {
    console.error("No se pudo eliminar el ejercicio:", error);
    alert(`No se pudo eliminar el ejercicio: ${error.message || "Error desconocido"}`);
  }
}

async function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement("canvas");

        const maxSize = 800;

        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxSize) {
            height *= maxSize / width;
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width *= maxSize / height;
            height = maxSize;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");

        ctx.drawImage(img, 0, 0, width, height);

        resolve(
          canvas.toDataURL("image/jpeg", 0.7)
        );
      };

      img.src = event.target.result;
    };

    reader.readAsDataURL(file);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = function (e) {
      resolve(e.target.result);
    };

    reader.onerror = function () {
      reject("Error al leer el archivo");
    };

    reader.readAsDataURL(file);
  });
}
/* ASIGNACIONES */

function renderUserSelect(refreshRemoteRelatedViews = true) {
  const select = $("userSelect");
  if (!select) return;

  const supabaseMode = window.TrainerSupabase?.isConfigured();
  const users = getPanelUsers();
  const normalizedQuery = String($("userSearch")?.value || "")
    .trim()
    .toLowerCase()
    .replace(/^#/, "");
  console.log("Texto buscado:", normalizedQuery);
  const userEmails = Object.keys(users).filter(email =>
    users[email].role === "user" &&
    (!supabaseMode || users[email].supabaseId) &&
    (!normalizedQuery || [
      email,
      users[email].name,
      users[email].userNumber
    ].some(value => String(value ?? "").toLowerCase().includes(normalizedQuery)))
  );
  console.log("Usuarios encontrados:", userEmails.length);

  if (userEmails.length === 0) {
    select.innerHTML = `<option value="">No se encontraron usuarios</option>`;
    if (refreshRemoteRelatedViews) renderSelectedUserAssignments();
    if ($("selectedUserProfile")) {
      $("selectedUserProfile").innerHTML = "<p>No se encontraron usuarios</p>";
    }
    updateSelectedUserLabel();
    return;
  }

  select.replaceChildren(...userEmails.map(email => {
    const option = new Option(
      formatAdministrativeUserLabel(email, users[email], true),
      String(supabaseMode ? users[email].supabaseId : email)
    );
    option.dataset.email = email;
    return option;
  }));

  if (refreshRemoteRelatedViews) renderSelectedUserAssignments();
  renderSelectedUserProfile();
  updateSelectedUserLabel();
}

async function assignExerciseToUser() {
  const supabaseMode = window.TrainerSupabase?.isConfigured();
  const userEmail = getSelectedUserEmail();
  const userId = getSelectedUserId();
  const day = $("routineDay")?.value;
  const exerciseValue = $("exerciseSelect")?.value;
  const setsValue = $("exerciseSets")?.value ?? "";
  const repsValue = $("exerciseReps")?.value ?? "";
  const restValue = $("exerciseRest")?.value ?? "";
  const sets = Number(setsValue);
  const reps = Number(repsValue);
  const rest = Number(restValue);
  const allowedDays = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

  if (!(supabaseMode ? userId : userEmail)) return alert("Selecciona un usuario");
  if (!day || !allowedDays.includes(day)) return alert("Selecciona un día");
  if (!exerciseValue) return alert("Selecciona un ejercicio");
  if (setsValue === "" || !Number.isInteger(sets) || sets < 1) return alert("Ingresa una cantidad válida de series");
  if (repsValue === "" || !Number.isInteger(reps) || reps < 1) return alert("Ingresa una cantidad válida de repeticiones");
  if (restValue === "" || !Number.isInteger(rest) || rest < 0) return alert("Ingresa un descanso válido en segundos");

  if (supabaseMode) {
    const result = await window.TrainerSupabase.routines.assignExercise({
      user_id: userId,
      exercise_id: exerciseValue,
      day_name: day,
      sets,
      repetitions: reps,
      rest_seconds: rest
    });
    if (result.error) {
      alert(`No se pudo asignar el ejercicio: ${result.error.message}`);
      return;
    }
    $("exerciseSets").value = "";
    $("exerciseReps").value = "";
    $("exerciseRest").value = "";
    await renderSelectedUserAssignments();
    alert("Ejercicio asignado correctamente");
    return;
  }

  const exerciseId = Number(exerciseValue);

  const assignments = getUserAssignments();

  if (!assignments[userEmail]) assignments[userEmail] = {};
  if (!assignments[userEmail][day]) assignments[userEmail][day] = [];

  assignments[userEmail][day].push({
    exerciseId,
    sets,
    reps,
    rest
  });

  saveUserAssignments(assignments);

  $("exerciseSets").value = "";
  $("exerciseReps").value = "";
  $("exerciseRest").value = "";

  renderSelectedUserAssignments();
  renderUserExercises();

  alert("Ejercicio asignado correctamente");
}

function removeExerciseFromUser(dayKey, exerciseId) {
  const userEmail = getSelectedUserEmail();

  if (!userEmail || !dayKey || !exerciseId) return;

  const assignments = getUserAssignments();

  if (!assignments[userEmail] || !assignments[userEmail][dayKey]) return;

  assignments[userEmail][dayKey] =
    assignments[userEmail][dayKey].filter(item => {
      const id =
        typeof item === "object"
          ? item.exerciseId
          : item;

      return Number(id) !== Number(exerciseId);
    });

  saveUserAssignments(assignments);

  renderSelectedUserAssignments();
  renderUserExercises();
}

async function renderSelectedUserAssignments() {
  const container = $("selectedUserAssignments");
  const userEmail = getSelectedUserEmail();

  if (!container || !userEmail) return;

  if (window.TrainerSupabase?.isConfigured()) {
    const userId = getSelectedUserId();
    if (!userId) {
      container.innerHTML = "<p>Selecciona un usuario.</p>";
      return;
    }
    const result = await window.TrainerSupabase.routines.listUserRoutines(userId);
    if (result.error) {
      container.innerHTML = `<p>No se pudieron cargar las asignaciones: ${escapeHTML(result.error.message)}</p>`;
      return;
    }
    const exercises = (result.data || []).flatMap(routine =>
      (routine.routine_exercises || []).map(item => ({ ...item, routineName: routine.name }))
    );
    container.innerHTML = exercises.length ? exercises.map(item => {
      const exercise = Array.isArray(item.exercises) ? item.exercises[0] : item.exercises;
      const mediaUrl = sanitizeMediaURL(exercise?.media_url);
      const mediaType = exercise?.media_type;
      const media = mediaUrl && mediaType === "video"
        ? `<video controls preload="metadata" src="${escapeHTML(mediaUrl)}" data-assigned-media></video>`
        : mediaUrl && mediaType === "image"
          ? `<img src="${escapeHTML(mediaUrl)}" alt="${escapeHTML(exercise?.title || "Ejercicio asignado")}" loading="lazy" data-assigned-media>`
          : "";
      return `
        <div class="media-card assigned-exercise-card">
          <p><strong>${escapeHTML(exercise?.title || "Ejercicio")}</strong><br>
          <small>${escapeHTML(exercise?.category || "Sin categoría")} · ${escapeHTML(item.routineName)} · Semana ${item.week_number} · ${escapeHTML(item.day_name)}</small></p>
          <p>${item.sets} series | ${item.repetitions} reps | ${item.rest_seconds}s descanso</p>
          <div class="assigned-exercise-media">
            ${media}
            <p class="assigned-media-fallback${media ? " hidden" : ""}">Vista previa no disponible</p>
          </div>
        </div>
      `;
    }).join("") : "<p>Este usuario no tiene ejercicios asignados.</p>";

    container.querySelectorAll("[data-assigned-media]").forEach(media => {
      media.addEventListener("error", () => {
        media.classList.add("hidden");
        media.closest(".assigned-exercise-media")
          ?.querySelector(".assigned-media-fallback")?.classList.remove("hidden");
      });
    });
    return;
  }

  const library = getExerciseLibrary();
  const assignments = getUserAssignments();
  const userRoutine = assignments[userEmail] || {};

  const days = [
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
    "Domingo"
  ];

  let html = "";

  days.forEach(day => {
   const assignedExercises = userRoutine[day] || [];

const validExercises = assignedExercises.filter(item => {
  const exerciseId =
    typeof item === "object"
      ? item.exerciseId
      : item;

  return library.some(ex => Number(ex.id) === Number(exerciseId));
});

if (!Array.isArray(validExercises) || validExercises.length === 0) {
  return;
}

    html += `
      <details class="admin-routine-day" open>
        <summary>${escapeHTML(day)}</summary>

        ${validExercises.map(item => {
          const exerciseId =
            typeof item === "object"
              ? item.exerciseId
              : item;

          const exercise = library.find(
            ex => Number(ex.id) === Number(exerciseId)
          );

          if (!exercise) return "";

          return `
            <div class="media-card">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                <div>
                  <p>
                    <strong>${escapeHTML(exercise.title || "Ejercicio")}</strong><br>
                    <small>${escapeHTML(exercise.category || "Sin categoría")}</small>
                  </p>

                  <p>
                    💪 ${escapeHTML(item.sets || "--")} series |
                    🔁 ${escapeHTML(item.reps || "--")} reps |
                    ⏱ ${escapeHTML(item.rest || "--")}s descanso
                  </p>
                </div>

                <button
                  class="btn-delete"
                  onclick="removeExerciseFromUser('${day}', ${exercise.id})"
                >
                  ❌
                </button>
              </div>

              ${sanitizeMediaURL(exercise.url)
                ? exercise.type === "video"
                  ? `<video controls><source src="${escapeHTML(sanitizeMediaURL(exercise.url))}"></video>`
                  : `<img src="${escapeHTML(sanitizeMediaURL(exercise.url))}" alt="${escapeHTML(exercise.title || "Ejercicio")}">`
                : '<p class="assigned-media-fallback">Vista previa no disponible</p>'}
            </div>
          `;
        }).join("")}
      </details>
    `;
  });

  container.innerHTML =
    html || "<p>Este usuario no tiene ejercicios asignados.</p>";
}

async function renderSelectedUserProfile() {
  const container = $("selectedUserProfile");
  const userEmail = getSelectedUserEmail();
  const userId = getSelectedUserId();

  if (!container || !userEmail) return;

  if (!window.TrainerSupabase?.isConfigured() || !userId) {
    container.innerHTML = "<p>No se pudo cargar el perfil del usuario.</p>";
    return;
  }

  container.innerHTML = "<p>Cargando perfil...</p>";
  const [profileResult, assessmentResult] = await Promise.all([
    window.TrainerSupabase.profiles.getProfile(userId),
    window.TrainerSupabase.questionnaires.getAssessment(userId)
  ]);

  if (getSelectedUserId() !== userId) return;
  if (profileResult.error || !profileResult.data) {
    console.error("[Perfil del cliente] No se pudo cargar el perfil desde Supabase:", profileResult.error);
    container.innerHTML = "<p>No se pudo cargar el perfil del usuario. Inténtalo más tarde.</p>";
    return;
  }

  const supabaseProfile = profileResult.data;
  const assessmentError = assessmentResult.error || null;
  const supabaseAssessment = assessmentError ? null : assessmentResult.data;
  if (assessmentError) {
    console.error("[Perfil del cliente] No se pudo cargar la evaluación desde Supabase:", assessmentError);
  }

  let profilePhoto = "";
  let avatarError = null;
  if (supabaseProfile.avatar_path) {
    const avatarResult = await window.TrainerSupabase.storage.getAvatarUrl(supabaseProfile.avatar_path);
    if (getSelectedUserId() !== userId) return;
    avatarError = avatarResult.error || null;
    profilePhoto = sanitizeMediaURL(avatarResult.data?.signedUrl);
    if (avatarError) {
      console.error("[Perfil del cliente] No se pudo obtener la URL firmada del avatar:", avatarError);
    }
  }

  const profile = {
    name: supabaseProfile.full_name,
    age: supabaseProfile.age,
    weight: supabaseProfile.weight,
    height: supabaseProfile.height,
    goal: supabaseProfile.goal,
    cooperDistance: supabaseProfile.cooper_distance_km,
    vamSpeed: supabaseProfile.vam_kmh
  };
  const questionnaire = supabaseAssessment ? {
    goal: supabaseAssessment.goal,
    previousTraining: supabaseAssessment.previous_training,
    trainingDays: supabaseAssessment.training_days,
    sessionDuration: supabaseAssessment.session_duration,
    gymExperience: supabaseAssessment.gym_experience,
    physicalActivity: supabaseAssessment.physical_activity,
    hasInjury: supabaseAssessment.has_injury,
    injuryDescription: supabaseAssessment.injury_description,
    completed: supabaseAssessment.completed,
    completedAt: supabaseAssessment.completed_at
  } : null;

  localStorage.setItem(`profile_${userEmail}`, JSON.stringify(profile));
  if (!assessmentError) {
    if (questionnaire) localStorage.setItem(`questionnaire_${userEmail}`, JSON.stringify(questionnaire));
    else localStorage.removeItem(`questionnaire_${userEmail}`);
  }

  const selectedUser = getPanelUsers()[userEmail] || {};
  const assessmentValue = (property, fallback = "No contestado") =>
    assessmentError ? "No se pudo cargar" : questionnaire?.[property] || profile?.[property] || fallback;
  const hasInjury = profile?.hasInjury ?? questionnaire?.hasInjury;
  const injuryLabel = hasInjury === true ? "Sí" : hasInjury === false ? "No" : "No contestado";
  const personalDetails = [
    {
      icon: "👤",
      label: "Nombre",
      value: profile?.name || selectedUser.name || "No cargado",
      userNumber: selectedUser.userNumber ?? null
    },
    { icon: "✉️", label: "Correo electrónico", value: userEmail },
    { icon: "◇", label: "Tipo de plan", value: selectedUser.planType || "Sin asignar" },
    { icon: "🎂", label: "Edad", value: profile?.age || "No cargada" },
    { icon: "⚖️", label: "Peso", value: profile?.weight ? `${profile.weight} kg` : "No cargado" },
    { icon: "↕️", label: "Estatura", value: profile?.height || "No cargada" }
  ];
  const assessmentDetails = [
    { icon: "🎯", label: "Objetivo", value: assessmentValue("goal", questionnaire?.objetivo || "No contestado") },
    { icon: "🏋️", label: "Entrenamiento previo", value: assessmentValue("previousTraining") },
    { icon: "📅", label: "Días disponibles", value: assessmentValue("trainingDays") },
    { icon: "⏱️", label: "Tiempo por sesión", value: assessmentValue("sessionDuration") },
    { icon: "💪", label: "Nivel de experiencia", value: assessmentValue("gymExperience") },
    { icon: "❤️", label: "Actividad física", value: assessmentValue("physicalActivity") },
    { icon: "🩺", label: "Lesión", value: injuryLabel },
    { icon: "🏃", label: "Prueba de Cooper", value: getAerobicResult(profile?.cooperDistance, "km") },
    { icon: "⚡", label: "Prueba de VAM", value: getAerobicResult(profile?.vamSpeed, "km/h") }
  ];

  container.innerHTML = `
    <div class="admin-user-profile">
      <section class="admin-profile-card admin-profile-personal-card" aria-labelledby="adminPersonalTitle">
        <header class="admin-profile-card-heading">
          <span class="admin-profile-eyebrow">Perfil del cliente</span>
          <h4 id="adminPersonalTitle">Información personal</h4>
        </header>

        <div class="admin-profile-avatar-wrap">
          ${profilePhoto
            ? `<img src="${escapeHTML(profilePhoto)}" class="admin-profile-photo" alt="Foto de ${escapeHTML(profile?.name || selectedUser.name || userEmail)}">`
            : `<div class="admin-profile-photo admin-profile-photo-placeholder" role="img" aria-label="Sin foto de perfil">👤</div>`
          }
          ${avatarError ? "<p>No se pudo cargar la foto.</p>" : ""}
        </div>

        <div class="admin-personal-details">
          ${personalDetails.map(detail => `
            <div class="admin-personal-detail">
              <span class="admin-detail-icon" aria-hidden="true">${detail.icon}</span>
              <div>
                <span class="admin-detail-label">${detail.label}</span>
                <strong class="admin-detail-value">${escapeHTML(String(detail.value))}</strong>
                ${detail.userNumber !== null && detail.userNumber !== undefined
                  ? `<span class="profile-user-number admin-profile-user-number">#${escapeHTML(detail.userNumber)}</span>`
                  : ""
                }
              </div>
            </div>
          `).join("")}
        </div>
      </section>

      <section class="admin-profile-card admin-profile-assessment-card" aria-labelledby="adminAssessmentTitle">
        <header class="admin-profile-card-heading admin-assessment-heading">
          <div>
            <span class="admin-profile-eyebrow">Datos para el entrenamiento</span>
            <h4 id="adminAssessmentTitle">Evaluación Física Inicial</h4>
          </div>
          <span class="admin-assessment-status ${questionnaire?.completed ? "is-complete" : "is-pending"}">
            ${assessmentError ? "Error al cargar" : questionnaire?.completed ? "Completada" : "Pendiente"}
          </span>
        </header>

        <div class="admin-assessment-grid">
          ${assessmentDetails.map(detail => `
            <article class="admin-assessment-item">
              <span class="admin-assessment-icon" aria-hidden="true">${detail.icon}</span>
              <div>
                <span class="admin-detail-label">${detail.label}</span>
                <strong class="admin-detail-value">${escapeHTML(String(detail.value))}</strong>
              </div>
            </article>
          `).join("")}

          ${hasInjury === true ? `
            <article class="admin-assessment-item admin-injury-description">
              <span class="admin-assessment-icon" aria-hidden="true">📝</span>
              <div>
                <span class="admin-detail-label">Descripción de la lesión</span>
                <strong class="admin-detail-value">${escapeHTML(assessmentValue("injuryDescription", "Sin descripción"))}</strong>
              </div>
            </article>
          ` : ""}
        </div>

        <footer class="admin-assessment-footer">
          <span>Estado: <strong>${assessmentError ? "No disponible temporalmente" : questionnaire?.completed ? "Completado y bloqueado" : "Pendiente"}</strong></span>
          <span>Fecha: <strong>${escapeHTML(assessmentError ? "No disponible" : questionnaire?.completedAt || "Sin fecha")}</strong></span>
        </footer>
      </section>
    </div>
  `;
}

function getCompletedExercises() {
  return JSON.parse(localStorage.getItem("completedExercises")) || {};
}

function saveCompletedExercises(completed) {
  localStorage.setItem("completedExercises", JSON.stringify(completed));
}

function toggleExerciseCompleted(week, day, exerciseId) {
  const currentUser = localStorage.getItem("currentUser");
  if (!currentUser) return;

  const completed = getCompletedExercises();
  const key = `${currentUser}_${week}_${day}_${exerciseId}`;

  completed[key] = !completed[key];

  saveCompletedExercises(completed);
  renderUserExercises();
  updateProgressStats();
}

function toggleExerciseCompletedByKey(key) {
  const completed = getCompletedExercises();

  completed[key] = !completed[key];

  saveCompletedExercises(completed);
  renderUserExercises();
  updateProgressStats();
}

function updateProgressStats() {
  const currentUser = localStorage.getItem("currentUser");
  if (!currentUser) return;

  const assignments = getUserAssignments();
  const completed = getCompletedExercises();
  const userRoutine = assignments[currentUser] || {};
  const week = selectedRoutineWeek || "Semana 1";

  let totalExercises = 0;
  let completedExercises = 0;

  Object.keys(userRoutine).forEach(day => {
    const exercises = userRoutine[day];

    if (!Array.isArray(exercises)) return;

    totalExercises += exercises.length;

    exercises.forEach(item => {
      const exerciseId = item.exerciseId;
      const key = `${currentUser}_${week}_${day}_${exerciseId}`;

      if (completed[key]) {
        completedExercises++;
      }
    });
  });

  const percent =
    totalExercises > 0
      ? Math.round((completedExercises / totalExercises) * 100)
      : 0;

  if ($("progressText")) {
    $("progressText").textContent =
      `${completedExercises} de ${totalExercises} ejercicios completados`;
  }

  if ($("progressPercent")) {
    $("progressPercent").textContent = `${percent}%`;
  }

  if ($("progressFill")) {
    $("progressFill").style.width = `${percent}%`;
  }
}

function updateSupabaseProgressStats(exercises, completedIds, hasProgressError = false, weekNumber = null) {
  const uniqueExercises = Array.from(
    new Map(exercises.filter(item => item?.id).map(item => [item.id, item])).values()
  );
  const completedCount = uniqueExercises.filter(item => completedIds.has(item.id)).length;
  const total = uniqueExercises.length;
  const percent = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  console.log("[Progreso semanal] Semana seleccionada:", weekNumber);
  console.log("[Progreso semanal] Total de ejercicios de la semana:", total);
  console.log("[Progreso semanal] Completados de la semana:", completedCount);
  console.log("[Progreso semanal] Porcentaje calculado:", percent);
  if ($("progressText")) {
    $("progressText").textContent = hasProgressError
      ? "No se pudo cargar el progreso"
      : `${completedCount} de ${total} ejercicios completados`;
  }
  if ($("progressPercent")) $("progressPercent").textContent = hasProgressError ? "--" : `${percent}%`;
  if ($("progressFill")) $("progressFill").style.width = hasProgressError ? "0%" : `${percent}%`;
}

async function toggleSupabaseExerciseCompleted(routineExerciseId, weekNumber, currentlyCompleted) {
  const result = await window.TrainerSupabase.progress.setOwnCompletion(
    routineExerciseId,
    weekNumber,
    !currentlyCompleted
  );
  if (result.error) {
    console.error("[Mi Rutina] Error al actualizar progreso:", result.error.message);
    alert(`No se pudo actualizar el progreso: ${result.error.message}`);
    return;
  }
  await renderUserExercises();
}

async function renderSupabaseUserExercises(assignedVideos, assignedImages) {
  const weekLabel = selectedRoutineWeek || "Semana 1";
  const day = selectedRoutineDay || "Lunes";
  const weekNumber = Number.parseInt(String(weekLabel).match(/\d+/)?.[0] || "1", 10);
  console.log("[Mi Rutina] Semana seleccionada:", weekNumber);
  console.log("[Mi Rutina] Día seleccionado:", day);

  const routinesResult = await window.TrainerSupabase.routines.listOwnActiveRoutines();
  if (routinesResult.error) {
    console.error("[Mi Rutina] Error de Supabase/RLS:", routinesResult.error.message);
    assignedVideos.innerHTML = `<p>No se pudo cargar tu rutina: ${escapeHTML(routinesResult.error.message)}</p>`;
    assignedImages.innerHTML = "";
    updateSupabaseProgressStats([], new Set(), true, weekNumber);
    return;
  }

  const { userId, routines } = routinesResult.data;
  console.log("[Mi Rutina] auth.uid obtenido:", userId);
  console.log("[Mi Rutina] Rutina activa encontrada:", routines.length > 0);
  const allExercises = routines.flatMap(routine => routine.routine_exercises || []);
  console.log("[Mi Rutina] Cantidad de routine_exercises:", allExercises.length);
  const weeklyExercises = Array.from(
    new Map(
      allExercises
        .filter(item => Number(item.week_number) === weekNumber)
        .map(item => [item.id, item])
    ).values()
  );
  const selectedExercises = weeklyExercises
    .filter(item => item.day_name === day)
    .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));

  const completionsResult = await window.TrainerSupabase.progress.listOwnCompletions();
  const progressError = Boolean(completionsResult.error);
  if (progressError) console.error("[Mi Rutina] Error al cargar progreso:", completionsResult.error.message);
  const completedIds = new Set(
    (completionsResult.data || [])
      .filter(item => Number(item.week_number) === weekNumber)
      .map(item => item.routine_exercise_id)
  );

  if (!selectedExercises.length) {
    assignedVideos.innerHTML = `<p>No tienes ejercicios asignados para ${escapeHTML(day)}.</p>`;
    assignedImages.innerHTML = "";
    updateSupabaseProgressStats(weeklyExercises, completedIds, progressError, weekNumber);
    return;
  }

  assignedVideos.innerHTML = `
    <div class="routine-day">
      <h3>${escapeHTML(weekLabel)} - ${escapeHTML(day)}</h3>
      ${selectedExercises.map(item => {
        const exercise = Array.isArray(item.exercises) ? item.exercises[0] : item.exercises;
        const title = exercise?.title || "Ejercicio";
        const mediaUrl = sanitizeMediaURL(exercise?.media_url);
        const isCompleted = completedIds.has(item.id);
        const media = mediaUrl && exercise?.media_type === "video"
          ? `<video controls preload="metadata" src="${escapeHTML(mediaUrl)}" data-user-routine-media></video>`
          : mediaUrl && exercise?.media_type === "image"
            ? `<img src="${escapeHTML(mediaUrl)}" alt="${escapeHTML(title)}" loading="lazy" data-user-routine-media>`
            : `<p class="assigned-media-fallback">Vista previa no disponible</p>`;
        return `
          <article class="exercise-card ${isCompleted ? "completed-card" : ""}">
            <div class="exercise-media">
              ${media}
              ${mediaUrl ? '<p class="assigned-media-fallback hidden">Vista previa no disponible</p>' : ""}
            </div>
            <div class="exercise-info">
              <div class="exercise-top">
                <span class="exercise-category">${escapeHTML(exercise?.category || "Sin categoría")}</span>
                <span class="exercise-status">${isCompleted ? "Completado" : "Pendiente"}</span>
              </div>
              <h3>${escapeHTML(title)}</h3>
              <div class="exercise-metrics">
                <span>${item.sets} series</span>
                <span>${item.repetitions} reps</span>
                <span>${item.rest_seconds}s descanso</span>
              </div>
              ${item.notes ? `<p>${escapeHTML(item.notes)}</p>` : ""}
              <button class="complete-btn ${isCompleted ? "done" : ""}"
                onclick="toggleSupabaseExerciseCompleted('${escapeHTML(item.id)}', ${weekNumber}, ${isCompleted})">
                ${isCompleted ? "Completado" : "Marcar completado"}
              </button>
            </div>
          </article>`;
      }).join("")}
    </div>`;
  assignedImages.innerHTML = "";
  assignedVideos.querySelectorAll("[data-user-routine-media]").forEach(media => {
    media.addEventListener("error", () => {
      media.classList.add("hidden");
      media.closest(".exercise-media")?.querySelector(".assigned-media-fallback")?.classList.remove("hidden");
    });
  });
  updateSupabaseProgressStats(weeklyExercises, completedIds, progressError, weekNumber);
}

async function renderUserExercises() {
  const assignedVideos = $("assignedVideos");
  const assignedImages = $("assignedImages");

  if (!assignedVideos || !assignedImages) return;
  if (window.TrainerSupabase?.isConfigured()) {
    await renderSupabaseUserExercises(assignedVideos, assignedImages);
    return;
  }

  const currentUser = localStorage.getItem("currentUser");

  if (!currentUser) return;

  const library = getExerciseLibrary();
  const assignments = getUserAssignments();
  const userRoutine = assignments[currentUser] || {};
  const completed = getCompletedExercises();

  const week = selectedRoutineWeek || "Semana 1";
  const day = selectedRoutineDay || "Lunes";

  if ($("routineSubtitle")) {
  $("routineSubtitle").textContent = `${week} · ${day}`;
  }

  const assignedExercises = userRoutine[day] || [];

  if (!assignedExercises.length) {
    assignedVideos.innerHTML = `<p>No tienes ejercicios asignados para ${escapeHTML(day)}.</p>`;
    assignedImages.innerHTML = "";
    updateProgressStats();
    return;
  }

  assignedVideos.innerHTML = `
    <div class="routine-day">
      <h3>${escapeHTML(week)} - ${escapeHTML(day)}</h3>

      ${assignedExercises.map(item => {
        const exerciseId = item.exerciseId;
        const exercise = library.find(ex => Number(ex.id) === Number(exerciseId));

        if (!exercise) return "";

        const key = `${currentUser}_${week}_${day}_${exercise.id}`;
        const isCompleted = completed[key];

        return `
        <article class="exercise-card ${isCompleted ? "completed-card" : ""}">
          <div class="exercise-media">
            ${sanitizeMediaURL(exercise.url)
              ? exercise.type === "video"
                ? `<video controls><source src="${escapeHTML(sanitizeMediaURL(exercise.url))}"></video>`
                : `<img src="${escapeHTML(sanitizeMediaURL(exercise.url))}" alt="${escapeHTML(exercise.title || "Ejercicio")}">`
              : '<p class="assigned-media-fallback">Vista previa no disponible</p>'}
          </div>

          <div class="exercise-info">
            <div class="exercise-top">
              <span class="exercise-category">
                ${escapeHTML(exercise.category || "Sin categoría")}
              </span>

              <span class="exercise-status">
                ${isCompleted ? "Completado" : "Pendiente"}
              </span>
            </div>

            <h3>${escapeHTML(exercise.title || "Ejercicio")}</h3>

            <div class="exercise-metrics">
              <span>💪 ${escapeHTML(item.sets || "--")} series</span>
              <span>🔁 ${escapeHTML(item.reps || "--")} reps</span>
              <span>⏱ ${escapeHTML(item.rest || "--")}s</span>
            </div>

            <button
              class="complete-btn ${isCompleted ? "done" : ""}"
              onclick="toggleExerciseCompleted('${week}', '${day}', ${exercise.id})"
            >
              ${isCompleted ? "✅ Completado" : "Marcar completado"}
            </button>
          </div>
        </article>
      `;
      }).join("")}
    </div>
  `;

  assignedImages.innerHTML = "";
  updateProgressStats();
}

/* ADMIN */

function updateSelectedUserLabel() {
  const userEmail = getSelectedUserEmail();
  const selectedUser = getPanelUsers()[userEmail] || {};

  if ($("routineSelectedUserLabel")) {
    $("routineSelectedUserLabel").textContent =
      userEmail ? formatAdministrativeUserLabel(userEmail, selectedUser) : "Ninguno";
  }
}

async function getDashboardSupabaseData() {
  const [routinesResult, completionsResult] = await Promise.all([
    window.TrainerSupabase.routines.listOwnActiveRoutines(),
    window.TrainerSupabase.progress.listOwnCompletions()
  ]);

  if (routinesResult.error || completionsResult.error) {
    const error = routinesResult.error || completionsResult.error;
    console.error("[Dashboard] No se pudieron cargar rutina y progreso desde Supabase:", error);
    return { status: "ERROR", error };
  }

  const routines = routinesResult.data?.routines || [];
  const exercises = Array.from(new Map(
    routines
      .flatMap(routine => routine.routine_exercises || [])
      .filter(item => {
        const exercise = Array.isArray(item.exercises) ? item.exercises[0] : item.exercises;
        return item?.id && exercise && exercise.active !== false;
      })
      .map(item => [item.id, item])
  ).values());

  return {
    status: exercises.length
      ? "READY"
      : routines.length
        ? "EMPTY_ROUTINE"
        : "NOT_FOUND",
    exercises,
    completions: completionsResult.data || []
  };
}

function renderDashboardLoadError() {
  if ($("dashboardProgressPercent")) $("dashboardProgressPercent").textContent = "--";
  if ($("dashboardProgressText")) {
    $("dashboardProgressText").textContent = "No se pudo cargar el progreso";
  }
  if ($("todayExercisesPreview")) {
    $("todayExercisesPreview").innerHTML = "<p>No se pudo cargar tu rutina. Inténtalo más tarde.</p>";
  }
}

async function renderDashboard() {
  const currentUser = localStorage.getItem("currentUser");

  if (!currentUser) return;

  const users = getUsers();
  const user = users[currentUser];

  if ($("dashboardUserName")) {
    $("dashboardUserName").textContent =
      user?.name || "Usuario";
  }

  if (!window.TrainerSupabase?.isConfigured()) {
    renderDashboardLoadError();
    return;
  }

  const dashboardData = await getDashboardSupabaseData();
  if (dashboardData.status === "ERROR") {
    renderDashboardLoadError();
    return;
  }

  const { exercises, completions } = dashboardData;
  const exerciseKeys = new Set(
    exercises.map(item => `${item.id}:${Number(item.week_number)}`)
  );
  const completedKeys = new Set(
    completions.map(item => `${item.routine_exercise_id}:${Number(item.week_number)}`)
  );
  const totalExercises = exerciseKeys.size;
  const completedCount = Array.from(exerciseKeys)
    .filter(key => completedKeys.has(key)).length;
  const percent = totalExercises > 0
    ? Math.round((completedCount / totalExercises) * 100)
    : 0;

  if ($("dashboardProgressPercent")) {
    $("dashboardProgressPercent").textContent =
      `${percent}%`;
  }

  if ($("dashboardProgressText")) {
    $("dashboardProgressText").textContent =
      totalExercises > 0
        ? `${completedCount} de ${totalExercises} ejercicios completados`
        : "No tienes una rutina asignada";
  }

  const week = selectedRoutineWeek || "Semana 1";
  const weekNumber = Number.parseInt(String(week).match(/\d+/)?.[0] || "1", 10);
  const days = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  const todayIndex = new Date().getDay();
  const day = days[todayIndex === 0 ? 6 : todayIndex - 1];
  const todayExercises = exercises
    .filter(item => Number(item.week_number) === weekNumber && item.day_name === day)
    .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));

  if ($("todayRoutineLabel")) {
    $("todayRoutineLabel").textContent =
      `${week} · ${day}`;
  }

  if ($("todayExercisesPreview")) {
    $("todayExercisesPreview").innerHTML = todayExercises.length
      ? todayExercises.slice(0, 3).map(item => {
        const exercise = Array.isArray(item.exercises) ? item.exercises[0] : item.exercises;
        return `
          <div class="today-item">
            ${sanitizeMediaURL(exercise.media_url)
              ? `<img src="${escapeHTML(sanitizeMediaURL(exercise.media_url))}" alt="${escapeHTML(exercise.title || "Ejercicio")}">`
              : ""}

            <div>
              <strong>${escapeHTML(exercise.title || "Ejercicio")}</strong>
              <p>
                ${item.sets} series ·
                ${item.repetitions} reps
              </p>
            </div>
          </div>
        `;
      }).join("")
      : `<p>No tienes ejercicios asignados para ${escapeHTML(day)}.</p>`;
  }
}

/* SUSCRIPCIONES */

function getDaysRemaining(expiresAt) {
  if (!expiresAt) return 0;
  const today = new Date();
  const expiration = parseStoredDate(expiresAt);
  if (!expiration) return 0;
  today.setHours(0, 0, 0, 0);
  expiration.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((expiration - today) / 86400000));
}

function getSubscriptionStatus(expiresAt) {
  const days = getDaysRemaining(expiresAt);
  if (days === 0) return "expired";
  if (days <= 7) return "warning";
  return "active";
}

function formatSqlDate(dateString) {
  if (!dateString) return "Sin fecha";
  const sqlDateMatch = String(dateString).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (sqlDateMatch) {
    const [, year, month, day] = sqlDateMatch;
    return `${day}/${month}/${year}`;
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function parseStoredDate(value) {
  if (!value) return null;

  const sqlDateMatch = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (sqlDateMatch) {
    const parsedSqlDate = new Date(
      Number(sqlDateMatch[1]),
      Number(sqlDateMatch[2]) - 1,
      Number(sqlDateMatch[3])
    );
    return Number.isNaN(parsedSqlDate.getTime()) ? null : parsedSqlDate;
  }

  const directDate = new Date(value);
  if (!Number.isNaN(directDate.getTime())) return directDate;

  const match = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;

  const parsedDate = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function addOneMonth(date) {
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

function ensureSubscriptionDates() {
  const allUsers = getUsers();
  const customUsers = JSON.parse(localStorage.getItem("users")) || {};
  let changed = false;

  Object.entries(allUsers).forEach(([email, user]) => {
    if (user.role === "admin" || user.supabaseId || (user.createdAt && user.expiresAt)) return;

    const questionnaire = JSON.parse(localStorage.getItem(`questionnaire_${email}`)) || {};
    const startDate = parseStoredDate(user.createdAt) ||
      parseStoredDate(questionnaire.completedAt) || new Date();
    const expirationDate = parseStoredDate(user.expiresAt) || addOneMonth(startDate);

    customUsers[email] = {
      ...user,
      createdAt: startDate.toISOString(),
      expiresAt: expirationDate.toISOString()
    };
    changed = true;
  });

  if (changed) localStorage.setItem("users", JSON.stringify(customUsers));
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    "'": "&#39;", '"': "&quot;"
  })[character]);
}

function sanitizeMediaURL(value, options = {}) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return "";

  if (options.allowDataImage && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(rawValue)) {
    return rawValue;
  }
  if (options.allowBlob && rawValue.startsWith("blob:")) {
    try {
      const blobUrl = new URL(rawValue);
      return blobUrl.protocol === "blob:" ? blobUrl.href : "";
    } catch {
      return "";
    }
  }

  try {
    const url = new URL(rawValue, window.location.origin);
    if (url.protocol === "https:") return url.href;
    const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    const applicationHost = String(window.location.hostname || "").toLowerCase();
    if (url.protocol === "http:" && localHosts.has(applicationHost)) return url.href;
    return "";
  } catch {
    return "";
  }
}

function filterSubscriptions(filter = "all") {
  if ($("subscriptionFilter")) $("subscriptionFilter").value = filter;
  renderSubscriptions();
}

function renderSubscriptions() {
  const list = $("subscriptionsList");
  if (!list) return;

  ensureSubscriptionDates();

  const filter = $("subscriptionFilter")?.value || "all";
  const searchTerm = String($("userSearch")?.value || "")
    .trim()
    .toLowerCase()
    .replace(/^#/, "");
  const users = Object.entries(getPanelUsers())
    .filter(([, user]) => user.role !== "admin")
    .filter(([email, user]) =>
      !searchTerm || [user.userNumber, user.name, email]
        .some(value => String(value ?? "").toLowerCase().includes(searchTerm))
    )
    .map(([email, user]) => ({
      email,
      user,
      daysRemaining: getDaysRemaining(user.expiresAt),
      status: getSubscriptionStatus(user.expiresAt)
    }));

  const counts = users.reduce((result, item) => {
    result[item.status]++;
    return result;
  }, { active: 0, warning: 0, expired: 0 });

  if ($("totalCount")) $("totalCount").textContent = users.length;
  if ($("activeCount")) $("activeCount").textContent = counts.active;
  if ($("warningCount")) $("warningCount").textContent = counts.warning;
  if ($("expiredCount")) $("expiredCount").textContent = counts.expired;

  const order = { expired: 0, warning: 1, active: 2 };
  const visibleUsers = users
    .filter(item => filter === "all" || item.status === filter)
    .sort((a, b) => order[a.status] - order[b.status] ||
      a.daysRemaining - b.daysRemaining || a.email.localeCompare(b.email));

  if (!visibleUsers.length) {
    list.innerHTML = '<tr><td class="subscription-empty" colspan="8">No hay usuarios en este estado.</td></tr>';
    return;
  }

  const labels = { active: "Activo", warning: "Por vencer", expired: "Vencido" };
  list.innerHTML = visibleUsers.map(({ email, user, daysRemaining, status }) => `
    <tr>
      <td data-label="Usuario">
        <strong>${escapeHTML(formatAdministrativeUserLabel(email, user))}</strong>
      </td>
      <td data-label="Correo">${escapeHTML(email)}</td>
      <td class="subscription-plan" data-label="Tipo de plan">
        <select
          class="plan-type-select"
          data-plan-email="${escapeHTML(email)}"
          data-previous-plan="${escapeHTML(user.planTypeCode || getSubscriptionPlanCode(user.planType))}"
          aria-label="Cambiar plan de ${escapeHTML(user.name || email)}"
        >
          <option value="" ${(user.planTypeCode || getSubscriptionPlanCode(user.planType)) ? "" : "selected"} disabled>Sin asignar</option>
          ${subscriptionPlanOptions.map(option => `<option value="${option.value}" ${(user.planTypeCode || getSubscriptionPlanCode(user.planType)) === option.value ? "selected" : ""}>${option.label}</option>`).join("")}
        </select>
      </td>
      <td data-label="Fecha de inicio">${formatSqlDate(user.createdAt)}</td>
      <td data-label="Fecha de vencimiento">${formatSqlDate(user.expiresAt)}</td>
      <td data-label="Días restantes">${daysRemaining}</td>
      <td data-label="Estado"><span class="subscription-status ${status}">${labels[status]}</span></td>
      <td data-label="Acción">${status === "active" ? "—" : `<button class="btn renew-btn" type="button" data-renew-email="${escapeHTML(email)}">Renovar</button>`}</td>
    </tr>
  `).join("");
}

async function updateUserPlanType(userEmail, newPlanType) {
  console.log("Usuario recibido:", userEmail);
  const user = getUsers()[userEmail];
  if (!user || user.role === "admin") {
    alert("No se encontró el usuario");
    return false;
  }

  const normalizedPlan = getSubscriptionPlanCode(newPlanType);
  if (!normalizedPlan) {
    alert("Selecciona un tipo de plan válido");
    return false;
  }

  const previousPlan = user.planTypeCode || getSubscriptionPlanCode(user.planType);
  console.log("Plan anterior:", previousPlan || "Sin asignar");
  console.log("Plan nuevo:", normalizedPlan);
  if (previousPlan === normalizedPlan) return true;

  const userName = user.name || userEmail;
  const confirmed = confirm(`¿Confirmas cambiar el plan de ${userName} de ${getSubscriptionPlanLabel(previousPlan)} a ${getSubscriptionPlanLabel(normalizedPlan)}?`);
  if (!confirmed) return false;

  if (window.TrainerSupabase?.isConfigured()) {
    if (!user.supabaseId) {
      alert("No se encontró el UUID del usuario");
      return false;
    }
    console.log("Subscription id:", user.subscriptionId || "Buscando suscripción activa más reciente");
    const result = await window.TrainerSupabase.subscriptions.updatePlan(user.supabaseId, normalizedPlan);
    console.log("Resultado del update:", result.data);
    console.log("Error:", result.error);
    if (result.error || !result.data?.id) {
      alert(`No se pudo actualizar el tipo de plan: ${result.error?.message || "Supabase no devolvió la fila actualizada"}`);
      return false;
    }

    const refreshed = await refreshSupabaseUsers();
    if (refreshed.error) {
      alert(`El plan se actualizó, pero no se pudo recargar la tabla: ${refreshed.error.message}`);
      return false;
    }
    renderSubscriptions();
    if (getSelectedUserEmail() === userEmail) renderSelectedUserProfile();
    alert("Tipo de plan actualizado correctamente");
    return true;
  }

  const customUsers = JSON.parse(localStorage.getItem("users")) || {};
  customUsers[userEmail] = { ...user, planType: getSubscriptionPlanLabel(normalizedPlan) };
  localStorage.setItem("users", JSON.stringify(customUsers));
  renderSubscriptions();
  if (getSelectedUserEmail() === userEmail) renderSelectedUserProfile();
  return true;
}

async function renewSubscription(email) {
  console.log("Renovar presionado");
  console.log("Usuario recibido:", email);
  const user = getUsers()[email];
  if (!user || user.role === "admin") {
    console.error("Error de Supabase:", "Usuario no válido para renovación");
    return;
  }

  console.log("Subscription encontrada:", {
    subscriptionId: user.subscriptionId || null,
    userId: user.supabaseId || null,
    expirationDate: user.expiresAt || null
  });

  const now = new Date();
  console.log("Fecha actual:", now.toISOString());
  const currentExpiration = parseStoredDate(user.expiresAt) || new Date(NaN);
  const baseDate = !Number.isNaN(currentExpiration.getTime()) && currentExpiration > now
    ? currentExpiration : now;
  const renewedDate = addOneMonth(baseDate);
  console.log("Nueva fecha calculada:", renewedDate.toISOString());

  if (window.TrainerSupabase?.isConfigured()) {
    if (!user.subscriptionId || !user.supabaseId) {
      console.error("Error de Supabase:", "No se encontró la suscripción activa del usuario");
      alert("No se encontró la suscripción activa del usuario");
      return;
    }

    const updatePayload = {
      subscriptionId: user.subscriptionId,
      userId: user.supabaseId,
      expirationDate: renewedDate.toISOString().slice(0, 10)
    };
    console.log("Update enviado:", updatePayload);
    const result = await window.TrainerSupabase.subscriptions.renewSubscription(updatePayload);
    console.log("Resultado del update:", result.data);
    console.log("Error de Supabase:", result.error);
    if (result.error) {
      alert(`No se pudo renovar la suscripción: ${result.error.message}`);
      return;
    }

    const refreshed = await refreshSupabaseUsers();
    if (refreshed.error) {
      console.error("Error de Supabase:", refreshed.error);
      alert(`La suscripción se renovó, pero no se pudo actualizar la tabla: ${refreshed.error.message}`);
      return;
    }
    renderSubscriptions();
    return;
  }

  const customUsers = JSON.parse(localStorage.getItem("users")) || {};
  customUsers[email] = { ...user, expiresAt: renewedDate.toISOString() };
  localStorage.setItem("users", JSON.stringify(customUsers));
  renderSubscriptions();
}

function contactTherapy() {

  const message = encodeURIComponent(
    "Hola, me interesa agendar una terapia o saber información sobre los servicios disponibles."
  );

  window.open(
    "https://wa.me/525624774731?text=" + message,
    "_blank"
  );
}

/* INICIO */

function renderAdminData() {
  renderUserSelect();
  renderExerciseLibrary();
  renderExerciseCategoryFilter();
  renderExerciseSelect();
  renderSelectedUserAssignments();
  renderSelectedUserProfile();
  updateSelectedUserLabel();
  if (typeof renderSubscriptions === "function") {
  renderSubscriptions();
}
}

function syncRoutineNavigationUI() {
  if ($("mobileWeekLabel")) {
    $("mobileWeekLabel").textContent = selectedRoutineWeek;
  }

  if ($("routineSubtitle")) {
    $("routineSubtitle").textContent = `${selectedRoutineWeek} · ${selectedRoutineDay}`;
  }

  document.querySelectorAll(".week-btn, .mobile-week-option").forEach(button => {
    button.classList.toggle("active", button.dataset.week === selectedRoutineWeek);
  });

  document.querySelectorAll(".day-btn, .mobile-day-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.day === selectedRoutineDay);
  });
}

function selectRoutineWeek(week) {
  selectedRoutineWeek = week;
  syncRoutineNavigationUI();
  renderUserExercises();
}

function selectRoutineDay(day) {
  selectedRoutineDay = day;
  syncRoutineNavigationUI();
  renderUserExercises();
}

document.addEventListener("DOMContentLoaded", async () => {
 if (window.TrainerSupabase?.isConfigured()) ensureSupabaseAuthStateListener();
 const passwordSetupFlowActive = await initializePasswordSetupFlow();
 document.body.classList.remove("auth-routing");

 document.addEventListener("click", event => {
  const passwordToggle = event.target.closest("[data-password-toggle]");
  if (passwordToggle) {
    togglePasswordVisibility(passwordToggle);
    return;
  }

  const informationButton = event.target.closest("[data-aerobic-info]");
  if (informationButton) {
    openAerobicTestModal(informationButton.dataset.aerobicInfo, informationButton);
    return;
  }

  if (event.target.closest("[data-close-aerobic-modal]")) closeAerobicTestModal();
 });

 document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeAerobicTestModal();
 });

 if ($("cardWorkout")) {
  $("cardWorkout").addEventListener("click", navigateToRoutine);
}

if ($("subscriptionFilter")) {
  $("subscriptionFilter").addEventListener("change", event => {
    filterSubscriptions(event.target.value);
  });
}

if ($("subscriptionsList")) {
  $("subscriptionsList").addEventListener("click", event => {
    const button = event.target.closest("[data-renew-email]");
    if (button) renewSubscription(button.dataset.renewEmail);
  });

  $("subscriptionsList").addEventListener("change", async event => {
    const planSelect = event.target.closest("[data-plan-email]");
    if (!planSelect) return;

    const previousPlan = planSelect.dataset.previousPlan || "";
    const updated = await updateUserPlanType(planSelect.dataset.planEmail, planSelect.value);
    if (!updated) planSelect.value = previousPlan;
  });
}

if ($("cardProfile")) {
  $("cardProfile").addEventListener("click", navigateToProfile);
}

if ($("cardTherapies")) {
  $("cardTherapies").addEventListener("click", navigateToTherapies);
}

if ($("mobilePrimaryNav")) {
  $("mobilePrimaryNav").addEventListener("click", event => {
    const navigationButton = event.target.closest("[data-mobile-page]");
    if (!navigationButton) return;

    const actions = {
      exercisePage: navigateToRoutine,
      profilePage: navigateToProfile,
      physioPage: navigateToTherapies
    };
    actions[navigationButton.dataset.mobilePage]?.();
  });
}

if ($("mobileNavLogout")) {
  $("mobileNavLogout").addEventListener("click", logout);
}

if ($("btnGoProfile")) {
  $("btnGoProfile").addEventListener("click", () => {
    goToPage("profilePage");
  });
}
  if ($("btnCreateUser")) {
    $("btnCreateUser").addEventListener("click", createUser);
  }

  if ($("btnDeleteUser")) {
    $("btnDeleteUser").addEventListener("click", deleteSelectedUser);
  }

  if ($("btnLogin")) {
    $("btnLogin").addEventListener("click", login);
  }

  if ($("btnForgotPassword")) {
    $("btnForgotPassword").addEventListener("click", requestPasswordRecovery);
  }

  if ($("btnCreatePassword")) {
    $("btnCreatePassword").addEventListener("click", createInvitedUserPassword);
  }

  if ($("btnLogout")) {
    $("btnLogout").addEventListener("click", logout);
  }

  if ($("adminNavLogout")) {
    $("adminNavLogout").addEventListener("click", logout);
  }

  if ($("modeSwitch")) {
    $("modeSwitch").addEventListener("click", toggleMode);
  }

  if ($("nextBtn")) {
    $("nextBtn").addEventListener("click", nextSlide);
  }

  if ($("prevBtn")) {
    $("prevBtn").addEventListener("click", prevSlide);
  }

  document.querySelectorAll('input[name="hasInjury"]').forEach(input => {
    input.addEventListener("change", toggleInjuryDescription);
  });

  if ($("btnSaveProfile")) {
    $("btnSaveProfile").addEventListener("click", saveProfile);
  }

  if ($("btnSendSuggestion")) {
    $("btnSendSuggestion").addEventListener("click", sendProfileSuggestionByWhatsApp);
  }

  if ($("btnBackToQuestionnaire")) {
    $("btnBackToQuestionnaire").addEventListener("click", () => {
      const currentUser = localStorage.getItem("currentUser");
      const questionnaire = JSON.parse(
        localStorage.getItem(`questionnaire_${currentUser}`)
      );

      if (questionnaire?.completed) {
        alert("El cuestionario ya fue enviado y no puede modificarse.");
        return;
      }

      goToPage("questionnairePage");

      showSlide(currentSlide);
    });
  }

  const profilePhotoInput = $("profilePhoto");
  if ($("btnChangeProfilePhoto") && profilePhotoInput) {
    $("btnChangeProfilePhoto").addEventListener("click", () => {
      profilePhotoInput.click();
    });
  }

  if (profilePhotoInput) {
    profilePhotoInput.addEventListener("change", previewSelectedProfilePhoto);
  }

  if ($("btnToExercises")) {
    $("btnToExercises").addEventListener("click", () => {
      renderUserExercises();
      goToPage("dashboardPage");
      renderDashboard();
    });
  }

  if ($("btnBackToProfile")) {
    $("btnBackToProfile").addEventListener("click", () => {
      goToPage("profilePage");
    });
  }

  if ($("btnToPhysio")) {
    $("btnToPhysio").addEventListener("click", () => {
      goToPage("physioPage");
    });
  }

  if ($("btnBackToExercises")) {
    $("btnBackToExercises").addEventListener("click", () => {
      renderUserExercises();
      goToPage("dashboardPage");
      renderDashboard();
    });
  }

  if ($("btnGoToExercisesFromAdmin")) {
    $("btnGoToExercisesFromAdmin").addEventListener("click", () => {
      renderUserExercises();
      goToPage("dashboardPage");
      renderDashboard();
    });
  }

  if ($("btnAddExercise")) {
    $("btnAddExercise").addEventListener("click", addExerciseToLibrary);
  }

  if ($("btnAssignExerciseToUser")) {
    $("btnAssignExerciseToUser").addEventListener("click", assignExerciseToUser);
  }

  if ($("exerciseCategoryFilter")) {
    $("exerciseCategoryFilter").addEventListener("change", () => {
      renderExerciseSelect();
    });
  }

  if ($("userSelect")) {
    $("userSelect").addEventListener("change", () => {
      renderSelectedUserAssignments();
      renderSelectedUserProfile();
    });
  }

  if ($("userSearch")) {
    $("userSearch").addEventListener("input", () => {
      renderUserSelect(false);
    });
  }

  if ($("exerciseLibrarySearch")) {
    $("exerciseLibrarySearch").addEventListener("input", renderExerciseLibrary);
  }

  if ($("exerciseLibraryCategoryFilter")) {
    $("exerciseLibraryCategoryFilter").addEventListener("change", event => {
      activeExerciseFilter = event.target.value === "Todos"
        ? null
        : event.target.value;
      renderExerciseLibrary();
    });
  }

  if ($("clearExerciseLibraryFilters")) {
    $("clearExerciseLibraryFilters").addEventListener("click", () => {
      activeExerciseFilter = null;
      if ($("exerciseLibrarySearch")) $("exerciseLibrarySearch").value = "";
      renderExerciseLibrary();
    });
  }

  if ($("exerciseLibraryList")) {
    $("exerciseLibraryList").addEventListener("click", event => {
      const actionButton = event.target.closest("[data-library-action]");
      if (!actionButton) return;

      const exerciseId = actionButton.dataset.exerciseId;
      if (actionButton.dataset.libraryAction === "edit") {
        editExerciseTitle(exerciseId);
      } else if (actionButton.dataset.libraryAction === "delete") {
        deleteExerciseFromLibrary(exerciseId);
      }
    });

    $("exerciseLibraryList").addEventListener("error", event => {
      if (!event.target.matches("img, video")) return;

      const mediaContainer = event.target.closest(".exercise-library-media");
      if (mediaContainer) {
        mediaContainer.innerHTML =
          '<p class="exercise-library-media-fallback">Vista previa no disponible</p>';
      }
    }, true);
  }

  if (localStorage.getItem("darkMode") === "true") {
    document.body.classList.add("dark-mode");
    if ($("modeSwitch")) $("modeSwitch").textContent = "☀️";
  }

  document.querySelectorAll(".day-btn").forEach(button => {
  button.addEventListener("click", () => {
    selectRoutineDay(button.dataset.day);
  });
});

document.querySelectorAll(".week-btn").forEach(button => {
  button.addEventListener("click", () => {
    selectRoutineWeek(button.dataset.week);
  });
});

document.querySelectorAll(".mobile-day-btn").forEach(button => {
  button.addEventListener("click", () => {
    selectRoutineDay(button.dataset.day);
  });
});

document.querySelectorAll(".mobile-week-option").forEach(button => {
  button.addEventListener("click", () => {
    selectRoutineWeek(button.dataset.week);
    $("mobileWeekOptions")?.classList.remove("open");
    $("mobileWeekToggle")?.setAttribute("aria-expanded", "false");
  });
});

if ($("mobileWeekToggle")) {
  $("mobileWeekToggle").addEventListener("click", () => {
    const isOpen = $("mobileWeekOptions")?.classList.toggle("open");
    $("mobileWeekToggle").setAttribute("aria-expanded", String(Boolean(isOpen)));
  });
}

if ($("btnRoutineMenu")) {
  $("btnRoutineMenu").addEventListener("click", () => {
    const mobileLayout = window.matchMedia("(max-width: 600px)").matches;
    const target = mobileLayout ? $("mobileRoutineNav") : $("routineNav");
    const isOpen = target?.classList.toggle("open");
    $("btnRoutineMenu").setAttribute("aria-expanded", String(Boolean(isOpen)));
  });
}

document.querySelectorAll(".admin-tab-btn").forEach(button => {
  button.addEventListener("click", () => {
    const target = button.dataset.adminTab;

    document.querySelectorAll(".admin-tab-btn").forEach(btn => {
      btn.classList.remove("active");
    });

    document.querySelectorAll(".admin-section").forEach(section => {
      section.classList.remove("active");
    });

    button.classList.add("active");

    const section = document.getElementById(target);

    if (section) {
      section.classList.add("active");
    }

    if (target === "subscriptionsSection") renderSubscriptions();
  });
});

  if (passwordSetupFlowActive) return;

  await restoreSession();
});
