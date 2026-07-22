let currentSlide = 0;
let isAssessmentSubmitting = false;
let activeExerciseFilter = "Todos";
let selectedRoutineWeek = "Semana 1";
let selectedRoutineDay = "Lunes";
const initialSupabaseAuthCallback = (() => {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const type = query.get("type") || hash.get("type");
  const errorDescription = query.get("error_description") || hash.get("error_description");
  return {
    active: ["invite", "recovery"].includes(type) || query.has("code") || hash.has("access_token") || Boolean(errorDescription),
    errorDescription
  };
})();


const defaultUsers = {
  "usuario@test.com": { password: "1234", role: "user", name: "Usuario" },
  "admin@test.com": { password: "admin", role: "admin", name: "Entrenador" }
};

const allowedPlanTypes = ["Plan personal", "Plan grupal", "Plan APP"];
let supabaseUsersCache = {};

function $(id) {
  return document.getElementById(id);
}

/* USUARIOS */

function getUsers() {
  const savedUsers = JSON.parse(localStorage.getItem("users")) || {};
  return { ...defaultUsers, ...savedUsers, ...supabaseUsersCache };
}

async function refreshSupabaseUsers() {
  if (!window.TrainerSupabase?.isConfigured()) return { data: null, error: null };
  const result = await window.TrainerSupabase.profiles.getClients();
  if (result.error) return result;
  supabaseUsersCache = Object.fromEntries((result.data || []).map(profile => [
    profile.email,
    {
      role: profile.role,
      name: profile.full_name || profile.email,
      supabaseId: profile.id
    }
  ]));
  return result;
}

function addDaysToDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function isUserExpired(user) {
  if (user.role === "admin") return false;
  if (!user.expiresAt) return false;

  return new Date() > new Date(user.expiresAt);
}

async function createUser() {
  const name = $("newUserName")?.value.trim();
  const email = $("newUserEmail")?.value.trim();
  const password = $("newUserPassword")?.value.trim();
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
    // La contraseña visible pertenece al modo local heredado. En Supabase se ignora:
    // el cliente define su propia contraseña desde el correo de invitación.
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
    $("newUserPassword").value = "";
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

  if (!name || !email || !password) {
    alert("Completa todos los campos");
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
  password,
  role: "user",
  name,
  planType,
  createdAt: new Date().toISOString(),
  expiresAt: addDaysToDate(33)
};

  localStorage.setItem("users", JSON.stringify(customUsers));

  $("newUserName").value = "";
  $("newUserEmail").value = "";
  $("newUserPassword").value = "";
  $("newUserPlanType").value = "";

  renderAdminData();

  alert("Usuario creado correctamente");
}

function deleteSelectedUser() {
  const userEmail = $("userSelect")?.value;

  if (!userEmail) {
    alert("Selecciona un usuario");
    return;
  }

  if (userEmail === "usuario@test.com" || userEmail === "admin@test.com") {
    alert("No puedes borrar usuarios demo");
    return;
  }

  if (!confirm(`¿Eliminar usuario ${userEmail}?`)) return;

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

async function initializePasswordSetupFlow() {
  if (!initialSupabaseAuthCallback.active) return false;

  goToPage("passwordSetupPage");
  const button = $("btnCreatePassword");
  if (button) button.disabled = true;

  if (!window.TrainerSupabase?.isConfigured()) {
    showPasswordSetupMessage("Supabase no está configurado. Solicita un nuevo enlace al entrenador.");
    return true;
  }
  if (initialSupabaseAuthCallback.errorDescription) {
    showPasswordSetupMessage(`El enlace es inválido o expiró: ${initialSupabaseAuthCallback.errorDescription}`);
    return true;
  }

  const { data, error } = await window.TrainerSupabase.getClient().auth.getSession();
  if (error || !data?.session) {
    showPasswordSetupMessage("El enlace de invitación es inválido o expiró. Solicita uno nuevo a tu entrenador.");
    return true;
  }

  if (button) button.disabled = false;
  $("newAccountPassword")?.focus();
  return true;
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
  button.textContent = "Creando contraseña...";
  try {
    const client = window.TrainerSupabase.getClient();
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData?.session) {
      showPasswordSetupMessage("La invitación expiró. Solicita un nuevo enlace a tu entrenador.");
      return;
    }

    const { data, error } = await client.auth.updateUser({ password });
    if (error || !data?.user) {
      showPasswordSetupMessage(error?.message || "No se pudo crear la contraseña. Solicita un nuevo enlace.");
      return;
    }

    passwordInput.value = "";
    confirmationInput.value = "";
    window.history.replaceState({}, document.title, window.location.pathname);
    showPasswordSetupMessage("Contraseña creada correctamente. Preparando tu cuenta...", "success");

    const profileResult = await window.TrainerSupabase.auth.getAuthenticatedProfile();
    if (profileResult.error || !profileResult.data?.active) {
      showPasswordSetupMessage(profileResult.error?.message || "La contraseña fue creada, pero el perfil todavía no está disponible.");
      return;
    }
    const profile = profileResult.data;
    const email = profile.email || data.user.email;
    localStorage.setItem("currentUser", email);
    localStorage.setItem("currentRole", profile.role);
    await startSession(email, {
      name: profile.full_name || email,
      role: profile.role,
      supabaseId: profile.id
    });

    const questionnaire = JSON.parse(localStorage.getItem(`questionnaire_${email}`));
    if (questionnaire?.completed) {
      goToPage("dashboardPage");
      renderDashboard();
    }
  } catch {
    showPasswordSetupMessage("No se pudo crear la contraseña. Revisa tu conexión o solicita un nuevo enlace.");
  } finally {
    button.disabled = false;
    button.textContent = "Crear contraseña";
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

  // Supabase es autoritativo cuando está configurado. El modo local solo permite
  // probar la transición y no debe usarse como autenticación de producción.
  if (window.TrainerSupabase?.isConfigured()) {
    const signedIn = await window.TrainerSupabase.auth.signIn(email, password);
    if (signedIn.error) {
      alert(signedIn.error.message || "Correo o contraseña incorrectos");
      return;
    }
    const profileResult = await window.TrainerSupabase.auth.getAuthenticatedProfile();
    if (profileResult.error || !profileResult.data?.active) {
      await window.TrainerSupabase.auth.signOut();
      alert(profileResult.error?.message || "Tu acceso no está activo");
      return;
    }
    const profile = profileResult.data;
    const compatibilityUser = { name: profile.full_name || email, role: profile.role, supabaseId: profile.id };
    localStorage.setItem("currentUser", email); // caché temporal; RLS nunca confía en este valor
    localStorage.setItem("currentRole", profile.role); // solo presentación heredada
    await startSession(email, compatibilityUser);
    return;
  }

  const users = getUsers();
  const user = users[email];

  if (!user || user.password !== password) {
    alert("Correo o contraseña incorrectos");
    return;
  }

  if (isUserExpired(user)) {
  alert("Tu acceso ha vencido. Contacta a tu entrenador para renovar.");
  return;
}

  localStorage.setItem("currentUser", email);
  localStorage.setItem("currentRole", user.role);

  startSession(email, user);
}

async function startSession(email, user) {
  await initializeExerciseLibrary();

  if (window.TrainerSupabase?.isConfigured() && user.supabaseId) {
    const assessmentResult = await window.TrainerSupabase.questionnaires.getAssessment(user.supabaseId);
    if (!assessmentResult.error && assessmentResult.data) {
      const a = assessmentResult.data;
      localStorage.setItem(`questionnaire_${email}`, JSON.stringify({
        goal: a.goal, previousTraining: a.previous_training, trainingDays: a.training_days,
        sessionDuration: a.session_duration, gymExperience: a.gym_experience,
        physicalActivity: a.physical_activity, hasInjury: a.has_injury,
        injuryDescription: a.injury_description, completed: a.completed, completedAt: a.completed_at
      })); // caché temporal para renderizadores heredados
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

  loadProfile();
  renderUserExercises();
  renderAdminData();

  if (user.role === "admin") {
    goToPage("adminPage");
    return;
  }

  const questionnaire = JSON.parse(localStorage.getItem(`questionnaire_${email}`));

  if (questionnaire?.completed) {
    goToPage("profilePage");
  } else {
    currentSlide = 0;
    goToPage("questionnairePage");
    showSlide(currentSlide);
  }
}

async function logout() {
  if (window.TrainerSupabase?.isConfigured()) {
    const result = await window.TrainerSupabase.auth.signOut();
    if (result.error) console.error("No se pudo cerrar la sesión de Supabase:", result.error.message);
  }
  localStorage.removeItem("currentUser");
  localStorage.removeItem("currentRole");

  if ($("emailInput")) $("emailInput").value = "";
  if ($("passwordInput")) $("passwordInput").value = "";

  if ($("whoami")) $("whoami").classList.add("hidden");
  if ($("btnLogout")) $("btnLogout").classList.add("hidden");

  goToPage("loginPage");
}

async function restoreSession() {
  if (window.TrainerSupabase?.isConfigured()) {
    const sessionResult = await window.TrainerSupabase.auth.getSession();
    const session = sessionResult.data?.session;
    if (!session) {
      localStorage.removeItem("currentUser");
      localStorage.removeItem("currentRole");
      goToPage("loginPage");
      return;
    }
    const profileResult = await window.TrainerSupabase.auth.getAuthenticatedProfile();
    if (profileResult.error || !profileResult.data?.active) {
      await logout();
      return;
    }
    const profile = profileResult.data;
    const email = profile.email || session.user.email;
    localStorage.setItem("currentUser", email);
    localStorage.setItem("currentRole", profile.role);
    await startSession(email, { name: profile.full_name || email, role: profile.role, supabaseId: profile.id });
    return;
  }
  const currentUser = localStorage.getItem("currentUser");

  if (!currentUser) {
    goToPage("loginPage");
    return;
  }

  const users = getUsers();
  const user = users[currentUser];

  if (!user) {
    logout();
    return;
  }

  await startSession(currentUser, user);
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

function saveProfile() {
  const currentUser = localStorage.getItem("currentUser");

  if (!currentUser) {
    alert("No hay usuario activo");
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

function loadProfile() {
  const currentUser = localStorage.getItem("currentUser");
  if (!currentUser) return;

  const profile = JSON.parse(localStorage.getItem(`profile_${currentUser}`));

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

  showProfilePhoto();
  renderProfileCard();
}

function renderProfileCard() {
  const currentUser = localStorage.getItem("currentUser");
  const container = $("profileCard");

  if (!currentUser || !container) return;

  const profile = JSON.parse(localStorage.getItem(`profile_${currentUser}`));
  const questionnaire = JSON.parse(localStorage.getItem(`questionnaire_${currentUser}`));
  const photo = localStorage.getItem(`profilePhoto_${currentUser}`);

  container.innerHTML = `
    <div class="profile-card-inner">
      ${
        photo
          ? `<img src="${photo}" class="profile-photo" alt="Foto de perfil">`
          : `<div class="profile-placeholder">👤</div>`
      }

      <h2>${profile?.name || "Tu nombre"}</h2>

      <p class="profile-objective">
        ${profile?.goal || questionnaire?.goal || questionnaire?.objetivo || "Objetivo pendiente"}
      </p>

      <div class="profile-stats">
        <div>
          <strong>${profile?.age || "--"}</strong>
          <span>Edad</span>
        </div>

        <div>
          <strong>${profile?.weight || "--"} kg</strong>
          <span>Peso</span>
        </div>

        <div>
          <strong>${profile?.height || "--"}</strong>
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

function saveProfilePhoto(file) {
  const currentUser = localStorage.getItem("currentUser");
  if (!currentUser || !file) return;

  const reader = new FileReader();

  reader.onload = function (e) {
    localStorage.setItem(`profilePhoto_${currentUser}`, e.target.result);
    showProfilePhoto();
    renderProfileCard();
    renderAdminData();
  };

  reader.readAsDataURL(file);
}

function showProfilePhoto() {
  const currentUser = localStorage.getItem("currentUser");
  const preview = $("profilePreview");

  if (!currentUser || !preview) return;

  const savedPhoto = localStorage.getItem(`profilePhoto_${currentUser}`);

  if (!savedPhoto) {
    preview.classList.add("hidden");
    return;
  }

  preview.src = savedPhoto;
  preview.classList.remove("hidden");
}

/* BIBLIOTECA */

function getExerciseLibrary() {
  return JSON.parse(localStorage.getItem("exerciseLibrary")) || [];
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

async function addExerciseToLibrary() {
  const category = $("exerciseCategory")?.value;
  const title = $("exerciseTitle")?.value.trim();
  const file = $("exerciseImageFile")?.files[0];
  const imageUrl = $("exerciseImageUrl")?.value.trim();
  const videoUrl = $("exerciseVideoUrl")?.value.trim();

  if (!category || !title) {
    alert("Completa categoría y nombre del ejercicio");
    return;
  }

  if (!file && !videoUrl) {
    alert("Agrega una imagen o pega la URL del video");
    return;
  }

  try {
    const library = getExerciseLibrary();

    let type = "image";
    let url = "";

        if (videoUrl) {
      type = "video";
      url = videoUrl;
    }
    else if (imageUrl) {
      type = "image";
      url = imageUrl;
    }
    else if (file) {
      type = "image";
      url = await compressImage(file);
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
    $("exerciseImageFile").value = "";
    $("exerciseVideoUrl").value = "";

    renderAdminData();

    alert("Ejercicio agregado a la biblioteca");
  } catch (error) {
    console.error(error);
    alert("No se pudo agregar el ejercicio");
  }
}

function renderExerciseLibrary() {
  const container = $("exerciseLibraryList");
  if (!container) return;

  const library = getExerciseLibrary();

  if (!library || library.length === 0) {
    container.innerHTML = "<p>No hay ejercicios cargados todavía.</p>";
    return;
  }

  const grouped = {};

  library.forEach(exercise => {
    const category = exercise.category || "Sin categoría";

    if (!grouped[category]) {
      grouped[category] = [];
    }

    grouped[category].push(exercise);
  });

  container.innerHTML = Object.keys(grouped).map(category => `
    <details class="category-block" open>
      <summary>
        <strong>${category}</strong>
      </summary>

      ${grouped[category].map(exercise => `
        <div class="media-card">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
            <div>
              <p>
                <strong>${exercise.title}</strong><br>
                <small>${exercise.type === "video" ? "Video" : "Imagen"}</small>
              </p>

              <button class="btn-edit" onclick="editExerciseTitle(${exercise.id})">
                ✏️ Editar nombre
              </button>
            </div>

            <button class="btn-delete" onclick="deleteExerciseFromLibrary(${exercise.id})">
              ❌
            </button>
          </div>

          ${
            exercise.type === "video"
              ? `<video controls><source src="${exercise.url}"></video>`
              : `<img src="${exercise.url}" alt="${exercise.title}">`
          }
        </div>
      `).join("")}
    </details>
  `).join("");
}

function editExerciseTitle(exerciseId) {
  const library = getExerciseLibrary();
  const exercise = library.find(item => item.id === exerciseId);

  if (!exercise) return;

  const newTitle = prompt("Nuevo nombre del ejercicio:", exercise.title);

  if (!newTitle || !newTitle.trim()) return;

  exercise.title = newTitle.trim();

  saveExerciseLibrary(library);
  renderAdminData();
  renderUserExercises();
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
    select.innerHTML = `<option value="">No hay ejercicios en este grupo</option>`;
    select.disabled = true;
    return;
  }

  select.disabled = false;
  select.innerHTML = filteredExercises.map(exercise => `
    <option value="${exercise.id}">
      ${exercise.category || "Sin categoría"} - ${exercise.title} (${exercise.type})
    </option>
  `).join("");

  if (filteredExercises.some(exercise => String(exercise.id) === selectedExerciseId)) {
    select.value = selectedExerciseId;
  }
}

function deleteExerciseFromLibrary(exerciseId) {
  if (!confirm("¿Eliminar ejercicio de la biblioteca?")) return;

  let library = getExerciseLibrary();
  library = library.filter(exercise => exercise.id !== exerciseId);
  saveExerciseLibrary(library);

  const assignments = getUserAssignments();

  Object.keys(assignments).forEach(userEmail => {
    const days = assignments[userEmail];
    if (Array.isArray(days)) {
      assignments[userEmail] = days.filter(item => (item?.exerciseId ?? item) !== exerciseId);
      return;
    }
    if (days && typeof days === "object") {
      Object.keys(days).forEach(day => {
        if (Array.isArray(days[day])) {
          days[day] = days[day].filter(item => (item?.exerciseId ?? item) !== exerciseId);
        }
      });
    }
  });

  saveUserAssignments(assignments);

  renderAdminData();
  renderUserExercises();
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

function renderUserSelect() {
  const select = $("userSelect");
  if (!select) return;

  const users = getUsers();
  const userEmails = Object.keys(users).filter(email => users[email].role === "user");

  if (userEmails.length === 0) {
    select.innerHTML = `<option value="">No hay usuarios</option>`;
    return;
  }

  select.innerHTML = userEmails.map(email => `
    <option value="${email}">
      ${users[email].name} - ${email}
    </option>
  `).join("");

  renderSelectedUserAssignments();
  renderSelectedUserProfile();
}

function assignExerciseToUser() {
  const userEmail = $("userSelect")?.value;
  const day = $("routineDay")?.value;
  const exerciseId = Number($("exerciseSelect")?.value);
  const sets = $("exerciseSets")?.value;
  const reps = $("exerciseReps")?.value;
  const rest = $("exerciseRest")?.value;

  if (!userEmail || !day || !exerciseId || !sets || !reps || !rest) {
    alert("Completa usuario, día, ejercicio, series, repeticiones y descanso");
    return;
  }

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
  const userEmail = $("userSelect")?.value;

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

function renderSelectedUserAssignments() {
  const container = $("selectedUserAssignments");
  const userEmail = $("userSelect")?.value;

  if (!container || !userEmail) return;

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
        <summary>${day}</summary>

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
                    <strong>${exercise.title}</strong><br>
                    <small>${exercise.category || "Sin categoría"}</small>
                  </p>

                  <p>
                    💪 ${item.sets || "--"} series |
                    🔁 ${item.reps || "--"} reps |
                    ⏱ ${item.rest || "--"}s descanso
                  </p>
                </div>

                <button
                  class="btn-delete"
                  onclick="removeExerciseFromUser('${day}', ${exercise.id})"
                >
                  ❌
                </button>
              </div>

              ${
                exercise.type === "video"
                  ? `<video controls><source src="${exercise.url}"></video>`
                  : `<img src="${exercise.url}" alt="${exercise.title}">`
              }
            </div>
          `;
        }).join("")}
      </details>
    `;
  });

  container.innerHTML =
    html || "<p>Este usuario no tiene ejercicios asignados.</p>";
}

function renderSelectedUserProfile() {
  const container = $("selectedUserProfile");
  const userEmail = $("userSelect")?.value;

  if (!container || !userEmail) return;

  const profile = JSON.parse(localStorage.getItem(`profile_${userEmail}`));
  const questionnaire = JSON.parse(localStorage.getItem(`questionnaire_${userEmail}`));
  const profilePhoto = localStorage.getItem(`profilePhoto_${userEmail}`);
  const selectedUser = getUsers()[userEmail] || {};
  const assessmentValue = (property, fallback = "No contestado") =>
    profile?.[property] || questionnaire?.[property] || fallback;
  const hasInjury = profile?.hasInjury ?? questionnaire?.hasInjury;
  const injuryLabel = hasInjury === true ? "Sí" : hasInjury === false ? "No" : "No contestado";
  const personalDetails = [
    { icon: "👤", label: "Nombre", value: profile?.name || selectedUser.name || "No cargado" },
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
            ? `<img src="${profilePhoto}" class="admin-profile-photo" alt="Foto de ${escapeHTML(profile?.name || selectedUser.name || userEmail)}">`
            : `<div class="admin-profile-photo admin-profile-photo-placeholder" role="img" aria-label="Sin foto de perfil">👤</div>`
          }
        </div>

        <div class="admin-personal-details">
          ${personalDetails.map(detail => `
            <div class="admin-personal-detail">
              <span class="admin-detail-icon" aria-hidden="true">${detail.icon}</span>
              <div>
                <span class="admin-detail-label">${detail.label}</span>
                <strong class="admin-detail-value">${escapeHTML(String(detail.value))}</strong>
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
            ${questionnaire?.completed ? "Completada" : "Pendiente"}
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
          <span>Estado: <strong>${questionnaire?.completed ? "Completado y bloqueado" : "Pendiente"}</strong></span>
          <span>Fecha: <strong>${escapeHTML(questionnaire?.completedAt || "Sin fecha")}</strong></span>
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

function renderUserExercises() {
  const currentUser = localStorage.getItem("currentUser");
  const assignedVideos = $("assignedVideos");
  const assignedImages = $("assignedImages");

  if (!currentUser || !assignedVideos || !assignedImages) return;

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
    assignedVideos.innerHTML = `<p>No tienes ejercicios asignados para ${day}.</p>`;
    assignedImages.innerHTML = "";
    updateProgressStats();
    return;
  }

  assignedVideos.innerHTML = `
    <div class="routine-day">
      <h3>${week} - ${day}</h3>

      ${assignedExercises.map(item => {
        const exerciseId = item.exerciseId;
        const exercise = library.find(ex => Number(ex.id) === Number(exerciseId));

        if (!exercise) return "";

        const key = `${currentUser}_${week}_${day}_${exercise.id}`;
        const isCompleted = completed[key];

        return `
        <article class="exercise-card ${isCompleted ? "completed-card" : ""}">
          <div class="exercise-media">
            ${
              exercise.type === "video"
                ? `<video controls><source src="${exercise.url}"></video>`
                : `<img src="${exercise.url}" alt="${exercise.title}">`
            }
          </div>

          <div class="exercise-info">
            <div class="exercise-top">
              <span class="exercise-category">
                ${exercise.category || "Sin categoría"}
              </span>

              <span class="exercise-status">
                ${isCompleted ? "Completado" : "Pendiente"}
              </span>
            </div>

            <h3>${exercise.title}</h3>

            <div class="exercise-metrics">
              <span>💪 ${item.sets || "--"} series</span>
              <span>🔁 ${item.reps || "--"} reps</span>
              <span>⏱ ${item.rest || "--"}s</span>
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
  const userEmail = $("userSelect")?.value;

  if ($("routineSelectedUserLabel")) {
    $("routineSelectedUserLabel").textContent = userEmail || "Ninguno";
  }
}

function renderDashboard() {
  const currentUser = localStorage.getItem("currentUser");

  if (!currentUser) return;

  const users = getUsers();
  const user = users[currentUser];

  if ($("dashboardUserName")) {
    $("dashboardUserName").textContent =
      user?.name || "Usuario";
  }

  const assignments = getUserAssignments();
  const completed = getCompletedExercises();

  const weeks = ["Semana 1", "Semana 2", "Semana 3", "Semana 4"];
const days = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const userRoutine = assignments[currentUser] || {};

let totalExercises = 0;
let completedCount = 0;

weeks.forEach(week => {
  days.forEach(day => {
    const exercises = userRoutine[day] || [];

    totalExercises += exercises.length;

    exercises.forEach(item => {
      const key = `${currentUser}_${week}_${day}_${item.exerciseId}`;

      if (completed[key]) {
        completedCount++;
      }
    });
  });
});

const percent =
  totalExercises > 0
    ? Math.round((completedCount / totalExercises) * 100)
    : 0;

  if ($("dashboardProgressPercent")) {
    $("dashboardProgressPercent").textContent =
      `${percent}%`;
  }

  if ($("dashboardProgressText")) {
    $("dashboardProgressText").textContent =
      `${completedCount} de ${totalExercises} ejercicios completados`;
  }

  const week = selectedRoutineWeek || "Semana 1";
  const todayIndex = new Date().getDay();
  const day = days[todayIndex === 0 ? 6 : todayIndex - 1];
  const exercises = Array.isArray(userRoutine[day]) ? userRoutine[day] : [];

  if ($("todayRoutineLabel")) {
    $("todayRoutineLabel").textContent =
      `${week} · ${day}`;
  }

  const library = getExerciseLibrary();

  if ($("todayExercisesPreview")) {
    $("todayExercisesPreview").innerHTML =
      exercises.slice(0, 3).map(item => {

        const exercise =
          library.find(ex => Number(ex.id) === Number(item.exerciseId));

        if (!exercise) return "";

        return `
          <div class="today-item">
            <img src="${exercise.url}" alt="${exercise.title}">

            <div>
              <strong>${exercise.title}</strong>
              <p>
                ${item.sets} series ·
                ${item.reps} reps
              </p>
            </div>
          </div>
        `;
      }).join("");
  }
}

/* SUSCRIPCIONES */

function getDaysRemaining(expiresAt) {
  if (!expiresAt) return 0;
  const today = new Date();
  const expiration = new Date(expiresAt);
  if (Number.isNaN(expiration.getTime())) return 0;
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

function formatSubscriptionDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function parseStoredDate(value) {
  if (!value) return null;

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
    if (user.role === "admin" || (user.createdAt && user.expiresAt)) return;

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

function filterSubscriptions(filter = "all") {
  if ($("subscriptionFilter")) $("subscriptionFilter").value = filter;
  renderSubscriptions();
}

function renderSubscriptions() {
  const list = $("subscriptionsList");
  if (!list) return;

  ensureSubscriptionDates();

  const filter = $("subscriptionFilter")?.value || "all";
  const users = Object.entries(getUsers())
    .filter(([, user]) => user.role !== "admin")
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
      <td data-label="Usuario">${escapeHTML(user.name || "Sin nombre")}</td>
      <td data-label="Correo">${escapeHTML(email)}</td>
      <td class="subscription-plan" data-label="Tipo de plan">
        <select
          class="plan-type-select"
          data-plan-email="${escapeHTML(email)}"
          data-previous-plan="${escapeHTML(user.planType || "")}"
          aria-label="Cambiar plan de ${escapeHTML(user.name || email)}"
        >
          <option value="" ${user.planType ? "" : "selected"} disabled>Sin asignar</option>
          ${allowedPlanTypes.map(plan => `<option value="${plan}" ${user.planType === plan ? "selected" : ""}>${plan}</option>`).join("")}
        </select>
      </td>
      <td data-label="Fecha de inicio">${formatSubscriptionDate(user.createdAt)}</td>
      <td data-label="Fecha de vencimiento">${formatSubscriptionDate(user.expiresAt)}</td>
      <td data-label="Días restantes">${daysRemaining}</td>
      <td data-label="Estado"><span class="subscription-status ${status}">${labels[status]}</span></td>
      <td data-label="Acción">${status === "active" ? "—" : `<button class="btn renew-btn" type="button" data-renew-email="${escapeHTML(email)}">Renovar</button>`}</td>
    </tr>
  `).join("");
}

function updateUserPlanType(userEmail, newPlanType) {
  const user = getUsers()[userEmail];

  if (!user || user.role === "admin") {
    alert("No se encontró el usuario");
    return false;
  }

  if (!allowedPlanTypes.includes(newPlanType)) {
    alert("Selecciona un tipo de plan válido");
    return false;
  }

  const previousPlan = user.planType || "Sin asignar";
  if (previousPlan === newPlanType) return true;

  const userName = user.name || userEmail;
  const confirmed = confirm(`¿Confirmas cambiar el plan de ${userName} de ${previousPlan} a ${newPlanType}?`);
  if (!confirmed) return false;

  const customUsers = JSON.parse(localStorage.getItem("users")) || {};
  customUsers[userEmail] = { ...user, planType: newPlanType };
  localStorage.setItem("users", JSON.stringify(customUsers));

  renderSubscriptions();
  if ($("userSelect")?.value === userEmail) renderSelectedUserProfile();
  return true;
}

function renewSubscription(email) {
  const user = getUsers()[email];
  if (!user || user.role === "admin") return;

  const now = new Date();
  const currentExpiration = new Date(user.expiresAt);
  const baseDate = !Number.isNaN(currentExpiration.getTime()) && currentExpiration > now
    ? currentExpiration : now;
  const renewedDate = addOneMonth(baseDate);

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
    "https://wa.me/525559970953?text=" + message,
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
 const passwordSetupFlowActive = await initializePasswordSetupFlow();
 document.body.classList.remove("auth-routing");
 if (!passwordSetupFlowActive) await initializeExerciseLibrary();

 document.addEventListener("click", event => {
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

  $("subscriptionsList").addEventListener("change", event => {
    const planSelect = event.target.closest("[data-plan-email]");
    if (!planSelect) return;

    const previousPlan = planSelect.dataset.previousPlan || "";
    const updated = updateUserPlanType(planSelect.dataset.planEmail, planSelect.value);
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

  if ($("profilePhoto")) {
    $("profilePhoto").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) saveProfilePhoto(file);
    });
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

  document.querySelectorAll(".filter-btn").forEach(button => {
    button.addEventListener("click", () => {
      activeExerciseFilter = button.dataset.category;

      document.querySelectorAll(".filter-btn").forEach(btn => {
        btn.classList.remove("active");
      });

      button.classList.add("active");

      renderExerciseLibrary();
    });
  });

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

  showSlide(currentSlide);
  renderAdminData();
  syncRoutineNavigationUI();
  renderUserExercises();
  await restoreSession();
});
