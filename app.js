let currentSlide = 0;
let activeExerciseFilter = "Todos";
let selectedRoutineWeek = "Semana 1";
let selectedRoutineDay = "Lunes";


const defaultUsers = {
  "usuario@test.com": { password: "1234", role: "user", name: "Usuario" },
  "admin@test.com": { password: "admin", role: "admin", name: "Entrenador" }
};

function $(id) {
  return document.getElementById(id);
}

/* USUARIOS */

function getUsers() {
  const savedUsers = JSON.parse(localStorage.getItem("users")) || {};
  return { ...defaultUsers, ...savedUsers };
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

function createUser() {
  const name = $("newUserName")?.value.trim();
  const email = $("newUserEmail")?.value.trim();
  const password = $("newUserPassword")?.value.trim();

  if (!name || !email || !password) {
    alert("Completa todos los campos");
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
  createdAt: new Date().toISOString(),
  expiresAt: addDaysToDate(33)
};

  localStorage.setItem("users", JSON.stringify(customUsers));

  $("newUserName").value = "";
  $("newUserEmail").value = "";
  $("newUserPassword").value = "";

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
}

function nextSlide() {
  const slides = document.querySelectorAll(".slide");

  if (currentSlide < slides.length - 1) {
    currentSlide++;
    showSlide(currentSlide);
    return;
  }

  const currentUser = localStorage.getItem("currentUser");
  const objetivo = document.querySelector('input[name="objetivo"]:checked');

  if (!currentUser) {
    alert("No hay usuario activo");
    return;
  }

  if (!objetivo) {
    alert("Selecciona un objetivo principal antes de continuar");
    return;
  }

  const questionnaire = {
    objetivo: objetivo.value,
    completed: true,
    completedAt: new Date().toLocaleString()
  };

  localStorage.setItem(
    `questionnaire_${currentUser}`,
    JSON.stringify(questionnaire)
  );

  alert("Cuestionario enviado. Ya no podrá modificarse.");
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

function login() {
  const email = $("emailInput")?.value.trim();
  const password = $("passwordInput")?.value.trim();

  if (!email || !password) {
    alert("Completa correo y contraseña");
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

function startSession(email, user) {
  if ($("whoami")) {
    $("whoami").textContent = `${user.name} (${user.role})`;
    $("whoami").classList.remove("hidden");
  }

  if ($("btnLogout")) {
    $("btnLogout").classList.remove("hidden");
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

function logout() {
  localStorage.removeItem("currentUser");
  localStorage.removeItem("currentRole");

  if ($("emailInput")) $("emailInput").value = "";
  if ($("passwordInput")) $("passwordInput").value = "";

  if ($("whoami")) $("whoami").classList.add("hidden");
  if ($("btnLogout")) $("btnLogout").classList.add("hidden");

  goToPage("loginPage");
}

function restoreSession() {
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

  startSession(currentUser, user);
}

/* PERFIL */

function saveProfile() {
  const currentUser = localStorage.getItem("currentUser");

  if (!currentUser) {
    alert("No hay usuario activo");
    return;
  }

  const questionnaire = JSON.parse(localStorage.getItem(`questionnaire_${currentUser}`));

  const profile = {
    name: $("pName")?.value || "",
    age: $("pAge")?.value || "",
    weight: $("pWeight")?.value || "",
    height: $("pHeight")?.value || "",
    objetivo: questionnaire?.objetivo || ""
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
        ${questionnaire?.objetivo || "Objetivo pendiente"}
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

function renderExerciseSelect() {
  const select = $("exerciseSelect");
  if (!select) return;

  const library = getExerciseLibrary();

  if (library.length === 0) {
    select.innerHTML = `<option value="">No hay ejercicios</option>`;
    return;
  }

  select.innerHTML = library.map(exercise => `
    <option value="${exercise.id}">
      ${exercise.category || "Sin categoría"} - ${exercise.title} (${exercise.type})
    </option>
  `).join("");
}

function deleteExerciseFromLibrary(exerciseId) {
  if (!confirm("¿Eliminar ejercicio de la biblioteca?")) return;

  let library = getExerciseLibrary();
  library = library.filter(exercise => exercise.id !== exerciseId);
  saveExerciseLibrary(library);

  const assignments = getUserAssignments();

  Object.keys(assignments).forEach(userEmail => {
    assignments[userEmail] = assignments[userEmail].filter(id => id !== exerciseId);
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

    if (!Array.isArray(assignedExercises) || assignedExercises.length === 0) {
      return;
    }

    html += `
      <details class="admin-routine-day" open>
        <summary>${day}</summary>

        ${assignedExercises.map(item => {
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

  container.innerHTML = `
    <div class="media-card">
      ${
        profilePhoto
          ? `<img src="${profilePhoto}" class="profile-photo" alt="Foto de perfil">`
          : "<p>Sin foto de perfil</p>"
      }

      <p><strong>Usuario:</strong> ${userEmail}</p>
      <p><strong>Nombre:</strong> ${profile?.name || "No cargado"}</p>
      <p><strong>Edad:</strong> ${profile?.age || "No cargada"}</p>
      <p><strong>Peso:</strong> ${profile?.weight || "No cargado"} kg</p>
      <p><strong>Altura:</strong> ${profile?.height || "No cargada"}</p>

      <hr>

      <p><strong>Objetivo:</strong> ${questionnaire?.objetivo || "No contestado"}</p>
      <p><strong>Cuestionario:</strong> ${
        questionnaire?.completed ? "Completado y bloqueado" : "Pendiente"
      }</p>
      <p><strong>Fecha:</strong> ${questionnaire?.completedAt || "Sin fecha"}</p>
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

function renderAdminData() {
  renderUserSelect();
  renderExerciseLibrary();
  renderExerciseSelect();
  renderSelectedUserAssignments();
  renderSelectedUserProfile();
  updateSelectedUserLabel();
}

function renderDashboard() {
  const currentUser = localStorage.getItem("currentUser");

  if (!currentUser) return;

  const users =
  JSON.parse(localStorage.getItem("users")) || [];

let user = null;

if (Array.isArray(users)) {
  user = users.find(u => u.email === currentUser);
} else {
  user = users[currentUser];
}

  if ($("dashboardUserName")) {
    $("dashboardUserName").textContent =
      user?.name || "Usuario";
  }

  const assignments = getUserAssignments();
  const completed = getCompletedExercises();

  const week = selectedRoutineWeek || "Semana 1";
  const day = selectedRoutineDay || "Lunes";

  const userRoutine =
    assignments[currentUser] || {};

  const exercises =
    userRoutine[day] || [];

  let completedCount = 0;

  exercises.forEach(item => {
    const key =
      `${currentUser}_${week}_${day}_${item.exerciseId}`;

    if (completed[key]) {
      completedCount++;
    }
  });

  const percent =
    exercises.length > 0
      ? Math.round((completedCount / exercises.length) * 100)
      : 0;

  if ($("dashboardProgressPercent")) {
    $("dashboardProgressPercent").textContent =
      `${percent}%`;
  }

  if ($("dashboardProgressText")) {
    $("dashboardProgressText").textContent =
      `${completedCount} de ${exercises.length} ejercicios completados`;
  }

  if ($("todayRoutineLabel")) {
    $("todayRoutineLabel").textContent =
      `${week} · ${day}`;
  }

  const library = getExerciseLibrary();

  if ($("todayExercisesPreview")) {
    $("todayExercisesPreview").innerHTML =
      exercises.slice(0, 3).map(item => {

        const exercise =
          library.find(ex => ex.id === item.exerciseId);

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

/* INICIO */

document.addEventListener("DOMContentLoaded", () => {
 if ($("cardWorkout")) {
  $("cardWorkout").addEventListener("click", () => {
    renderUserExercises();
    goToPage("exercisePage");
  });
}

if ($("cardProfile")) {
  $("cardProfile").addEventListener("click", () => {
    goToPage("profilePage");
  });
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

  if ($("btnLogout")) {
    $("btnLogout").addEventListener("click", logout);
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

          if ($(target)) {
            $(target).classList.add("active");
          }

          renderAdminData();
        });
      });
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
    selectedRoutineDay = button.dataset.day;

    document.querySelectorAll(".day-btn").forEach(btn => {
      btn.classList.remove("active");
    });

    button.classList.add("active");

    renderUserExercises();
  });
});

document.querySelectorAll(".week-btn").forEach(button => {
  button.addEventListener("click", () => {
    selectedRoutineWeek = button.dataset.week;

    document.querySelectorAll(".week-btn").forEach(btn => {
      btn.classList.remove("active");
    });

    button.classList.add("active");

    renderUserExercises();
  });
});
if ($("btnRoutineMenu")) {
  $("btnRoutineMenu").addEventListener("click", () => {
    $("routineNav").classList.toggle("open");
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
  });
});

  showSlide(currentSlide);
  renderAdminData();
  renderUserExercises();
  restoreSession();
});