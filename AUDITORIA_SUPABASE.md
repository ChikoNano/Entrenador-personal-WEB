# Auditoría previa a la migración a Supabase

Fecha de auditoría: 21 de julio de 2026  
Repositorio: `C:\Users\idem1\OneDrive\Escritorio\Entrenador personal WEB`  
Rama verificada: `conexion-supabase`

## 1. Alcance y estado del repositorio

Se revisaron los siguientes archivos sin modificarlos:

- `index.html`
- `app.js`
- `styles.css`
- `data/exercises.json`
- `js/supabase-config.js` (archivo adicional encontrado durante la revisión completa del repositorio)

Estado observado antes de crear esta auditoría:

- La rama actual es `conexion-supabase`.
- Git inicialmente rechazó la consulta por `dubious ownership`; la rama se verificó usando una excepción temporal de solo lectura con `git -c safe.directory=...`. No se modificó la configuración global de Git.
- `js/` ya aparecía como directorio no rastreado (`?? js/`) antes de crear este documento.
- `js/supabase-config.js` existe, tiene 0 bytes y no está incluido mediante `<script>` en `index.html`.
- No se realizó commit ni push.

## 2. Resumen de arquitectura actual

La aplicación es un frontend estático. Toda la autenticación, autorización y persistencia de negocio ocurre en el navegador:

- `index.html` contiene las pantallas Login, Evaluación Física Inicial, Dashboard, Mi Perfil, Mi Rutina, Panel del Entrenador y Terapias.
- `app.js` contiene autenticación, navegación, administración de usuarios, perfiles, evaluaciones, biblioteca, rutinas, progreso y suscripciones.
- `styles.css` no accede al almacenamiento; controla únicamente presentación y responsive.
- `data/exercises.json` funciona como semilla/fallback inicial de la biblioteca.
- No existe cliente Supabase inicializado ni llamadas de red a Supabase.
- No existe backend que valide identidad, rol o permisos.

## 3. Inventario de Web Storage

### Resultado global

- Llamadas a `localStorage`: sí, concentradas en `app.js`.
- Llamadas a `sessionStorage`: ninguna.
- Referencias a Web Storage en `index.html`, `styles.css` o `data/exercises.json`: ninguna.

### Matriz de claves

| Clave | Funciones que la usan directa o indirectamente | Tipo esperado | Pantallas dependientes | Riesgo de migración |
|---|---|---|---|---|
| `users` | `getUsers`, `createUser`, `deleteSelectedUser`, `login` (vía `getUsers`), `restoreSession`, `renderUserSelect`, `renderSelectedUserProfile`, `renderDashboard`, `ensureSubscriptionDates`, `renderSubscriptions`, `updateUserPlanType`, `renewSubscription` | JSON: objeto indexado por correo. Cada valor contiene `password`, `role`, `name` y opcionalmente `planType`, `createdAt`, `expiresAt` | Login; Usuarios; Rutinas del administrador; perfil visto por entrenador; Suscripciones; Dashboard | **Crítico.** Contraseñas en texto plano, roles manipulables, correo usado como clave primaria, objeto monolítico reescrito completo, usuarios demo hardcodeados y ausencia de control de concurrencia/RLS. |
| `currentUser` | `login`, `logout`, `restoreSession`, `syncMobilePrimaryNavigation`, `nextSlide`, `saveProfile`, `loadProfile`, `renderProfileCard`, `saveProfilePhoto`, `showProfilePhoto`, `toggleExerciseCompleted`, `updateProgressStats`, `renderUserExercises`, `renderDashboard` y listener de regreso al cuestionario | String: correo del usuario autenticado | Todas las pantallas autenticadas y su navegación | **Crítico.** La identidad se acepta desde un valor editable por el cliente. Debe sustituirse por la sesión de Supabase Auth (`auth.uid()`), no por un correo confiado. |
| `currentRole` | `login`, `logout`, `syncMobilePrimaryNavigation` | String: `user` o `admin` | Navegación móvil; decisión visual de sesión | **Crítico.** El rol puede alterarse desde DevTools. En Supabase debe proceder de un perfil/claim protegido y aplicarse con RLS; ocultar elementos no constituye autorización. |
| `darkMode` | `toggleMode`, inicialización en `DOMContentLoaded` | String booleano: `"true"` o ausencia/otro valor | Todas las pantallas | **Bajo.** Preferencia local sin impacto de negocio. Puede permanecer local o sincronizarse opcionalmente en preferencias del perfil. |
| `profile_<email>` | `saveAssessmentResponses`, `saveProfile`, `loadProfile`, `renderProfileCard`, `renderSelectedUserProfile`, `deleteSelectedUser` | JSON: objeto de perfil y parte de la evaluación | Mi Perfil; Editar perfil; perfil del cliente visto por entrenador | **Alto.** Una clave por correo dificulta consultas y borrado relacional; contiene PII; duplica campos de evaluación y fechas de `users`; no tiene versión ni validación de esquema. |
| `questionnaire_<email>` | `saveAssessmentResponses`, `startSession`, `saveProfile`, `renderProfileCard`, `renderSelectedUserProfile`, `ensureSubscriptionDates`, listener de regreso al cuestionario, `deleteSelectedUser` | JSON: respuestas de evaluación, `completed`, `completedAt` y alias legado `objetivo` | Evaluación inicial; control de primer acceso; Mi Perfil; perfil del entrenador; cálculo de fechas heredadas | **Alto.** Clave dinámica por correo, datos duplicados con el perfil, dos escrituras que deberían ser transaccionales y campos legado (`goal`/`objetivo`). |
| `profilePhoto_<email>` | `saveProfilePhoto`, `showProfilePhoto`, `renderProfileCard`, `renderSelectedUserProfile`, `deleteSelectedUser` | String Data URL/Base64 | Mi Perfil; perfil del entrenador | **Crítico/alto.** Base64 consume rápidamente la cuota de `localStorage`, duplica tamaño y no es adecuado para una base relacional. Debe migrarse a Supabase Storage y guardar solo bucket/path o URL controlada. |
| `exerciseLibrary` | `getExerciseLibrary`, `saveExerciseLibrary`, `initializeExerciseLibrary`; consumidores: render de biblioteca, filtros, asignación, rutinas, Dashboard y exportación | JSON: arreglo de `{id, category, title, type, url}` | Biblioteca; Asignar ejercicios; Mi Rutina; Dashboard | **Alto.** Copia completa mutable por dispositivo, posible divergencia respecto a `data/exercises.json`, IDs basados en `Date.now()`, escrituras concurrentes perdidas y ausencia de integridad referencial con asignaciones. |
| `userAssignments` | `getUserAssignments`, `saveUserAssignments`, `deleteSelectedUser`, `assignExerciseToUser`, `removeExerciseFromUser`, `renderSelectedUserAssignments`, `renderUserExercises`, `updateProgressStats`, `renderDashboard`; también se intenta limpiar al eliminar ejercicios | JSON anidado: `{ [email]: { [day]: [{ exerciseId, sets, reps, rest }] } }` | Rutinas del administrador; Mi Rutina; progreso semanal; Dashboard | **Crítico/alto.** Objeto global reescrito completo, sin IDs de asignación, sin fechas ni auditoría, correo como relación, días como texto y el modelo no almacena semana aunque la UI maneja cuatro semanas. La limpieza al borrar ejercicios asume en un punto una forma incompatible (`assignments[email].filter(...)` frente al objeto por días). |
| `completedExercises` | `getCompletedExercises`, `saveCompletedExercises`, `toggleExerciseCompleted`, `toggleExerciseCompletedByKey`, `updateProgressStats`, `renderUserExercises`, `renderDashboard` | JSON: mapa booleano con clave compuesta `${email}_${week}_${day}_${exerciseId}` | Mi Rutina; Progreso semanal; Dashboard | **Alto.** Claves compuestas frágiles, sin timestamp, sin FK, sin aislamiento por usuario y con posibilidad de colisiones si los componentes contienen `_`. Se reescribe todo el progreso global en cada cambio. |

## 4. Modelos almacenados actualmente

### 4.1 Usuarios y contraseñas

Hay dos fuentes lógicas que `getUsers()` mezcla:

1. `defaultUsers` hardcodeado en `app.js`:

```js
{
  "usuario@test.com": { password: "1234", role: "user", name: "Usuario" },
  "admin@test.com": { password: "admin", role: "admin", name: "Entrenador" }
}
```

2. La clave `users` de `localStorage`, con forma aproximada:

```js
{
  "correo@ejemplo.com": {
    password: "texto-plano",
    role: "user",
    name: "Nombre",
    planType: "Plan personal | Plan grupal | Plan APP",
    createdAt: "ISO-8601",
    expiresAt: "ISO-8601"
  }
}
```

`login()` compara directamente `user.password !== password`. No hay hash, MFA, recuperación, rotación ni protección de credenciales. La migración correcta es Supabase Auth; las contraseñas no deben copiarse a una tabla ni migrarse en texto plano.

### 4.2 Perfiles

Cada usuario tiene una clave dinámica `profile_<email>`. La forma acumulada observada incluye:

```js
{
  name,
  age,
  weight,
  height,
  email,
  createdAt,
  expiresAt,
  goal,
  previousTraining,
  trainingDays,
  sessionDuration,
  gymExperience,
  physicalActivity,
  hasInjury,
  injuryDescription,
  cooperDistance,
  vamSpeed
}
```

Los valores de formulario se guardan principalmente como strings. `hasInjury` es booleano. Fechas y datos de evaluación se duplican respecto a otras claves.

### 4.3 Cuestionarios

Cada usuario tiene `questionnaire_<email>`:

```js
{
  goal,
  objetivo, // alias legado del mismo objetivo
  previousTraining,
  trainingDays,
  sessionDuration,
  gymExperience,
  physicalActivity,
  hasInjury,
  injuryDescription,
  completed: true,
  completedAt: "ISO-8601"
}
```

`saveAssessmentResponses()` escribe cuestionario y perfil por separado e intenta simular rollback si falla la verificación. En Supabase esto debe ejecutarse mediante una transacción/RPC o una estrategia idempotente, no mediante rollback del navegador.

### 4.4 Fotografías de perfil

`profilePhoto_<email>` almacena un Data URL generado por `FileReader.readAsDataURL`. Debe migrarse a Supabase Storage. La tabla de perfil debería conservar únicamente un `avatar_path` o referencia equivalente.

### 4.5 Biblioteca de ejercicios

`exerciseLibrary` contiene un arreglo de:

```js
{
  id: Number,
  category: String,
  title: String,
  type: "video" | "image",
  url: String
}
```

Si la clave no existe o está vacía, `initializeExerciseLibrary()` carga `./data/exercises.json` y persiste el arreglo completo. El JSON contiene 40 ejercicios, distribuidos en Abdomen, Brazo, Espalda y Hombro. Las URLs apuntan a Cloudinary.

Riesgo adicional: existen tres autoridades potenciales futuras si no se define precedencia: JSON de semilla, caché local y tabla Supabase. Se recomienda que el JSON sea solo un seed versionado y que Supabase sea la fuente autoritativa.

### 4.6 Rutinas / asignaciones

`userAssignments` usa esta forma:

```js
{
  "correo@ejemplo.com": {
    "Lunes": [
      { exerciseId: 123, sets: "4", reps: "12", rest: "60" }
    ],
    "Martes": []
  }
}
```

La UI dispone de `selectedRoutineWeek`, pero la semana no forma parte de la asignación almacenada. Por ello, una migración literal conservaría la limitación actual: las mismas asignaciones se muestran para todas las semanas. Antes de diseñar tablas se debe decidir si esto es intencional.

### 4.7 Suscripciones

No existe una clave `subscriptions`. La suscripción está embebida en cada registro de `users`:

- `planType`
- `createdAt`
- `expiresAt`

El estado y los días restantes se calculan en tiempo real. `ensureSubscriptionDates()` puede completar fechas faltantes usando `questionnaire.completedAt` o la fecha actual, y luego reescribe `users`. `renewSubscription()` reemplaza únicamente `expiresAt`; `updateUserPlanType()` reemplaza únicamente `planType` mediante spread del usuario.

Se recomienda separar perfil/identidad de la suscripción, con una tabla que permita historial, estado, periodo y renovaciones sin sobrescribir el registro principal.

### 4.8 Ejercicios completados

`completedExercises` usa un mapa global:

```js
{
  "correo_Semana 1_Lunes_123": true
}
```

No hay fecha de finalización ni ID de asignación. El progreso se recalcula recorriendo asignaciones y buscando la clave compuesta.

## 5. Dependencias por pantalla

| Pantalla/sección | Claves de las que depende |
|---|---|
| Login | `users`; escribe `currentUser` y `currentRole` |
| Evaluación Física Inicial | `currentUser`, `questionnaire_<email>`, `profile_<email>`, datos del usuario en `users` |
| Mi Perfil / Editar perfil | `currentUser`, `profile_<email>`, `questionnaire_<email>`, `profilePhoto_<email>` |
| Dashboard | `currentUser`, `users`, `userAssignments`, `completedExercises`, `exerciseLibrary` |
| Mi Rutina | `currentUser`, `userAssignments`, `completedExercises`, `exerciseLibrary` |
| Panel > Usuarios | `users`, `profile_<email>`, `questionnaire_<email>`, `profilePhoto_<email>` |
| Panel > Rutinas | `users`, `userAssignments`, `exerciseLibrary` |
| Panel > Biblioteca | `exerciseLibrary`, y `userAssignments` al eliminar ejercicios |
| Panel > Suscripciones | `users`; puede consultar `questionnaire_<email>` para completar fechas faltantes |
| Navegación autenticada | `currentUser`, `currentRole` |
| Tema visual | `darkMode` |
| Terapias | No depende de Web Storage para sus datos; solo requiere navegación de sesión |

## 6. Riesgos transversales

### Críticos

1. **Autenticación insegura:** contraseñas en texto plano y validación completamente cliente.
2. **Autorización insegura:** `currentRole` es editable y no existe RLS.
3. **Exposición de PII y datos médicos:** perfiles, lesiones y cuestionarios son accesibles desde el navegador sin aislamiento real.
4. **Escrituras monolíticas:** `users`, `userAssignments` y `completedExercises` se reescriben completos; dos dispositivos pueden perder cambios mutuamente.
5. **Fotografías Base64:** alto riesgo de exceder cuota y de bloquear escrituras relacionadas.

### Altos

1. El correo funciona como identidad, clave de objeto y parte de claves compuestas.
2. No hay foreign keys, cascadas ni transacciones reales.
3. Datos duplicados entre `users`, perfiles y cuestionarios.
4. Fechas potencialmente mezcladas entre ISO y formatos locales; `parseStoredDate()` intenta aceptar ambos.
5. No hay timestamps de actualización ni control de versiones.
6. Asignaciones sin semana pese a una UI semanal.
7. Progreso sin ID de asignación, timestamps o unicidad relacional.
8. La eliminación de un ejercicio intenta filtrar `assignments[userEmail]` como arreglo, aunque la forma vigente es un objeto por día; esto debe corregirse o contemplarse antes de imponer integridad referencial.

### Medios/bajos

1. `darkMode` no necesita migración obligatoria.
2. El JSON de ejercicios es útil como seed, pero debe definirse una sola fuente de verdad.
3. Los usuarios demo hardcodeados no deben llegar a producción ni coexistir con Supabase Auth.

## 7. Modelo Supabase sugerido para la siguiente fase

Esta sección es una recomendación de diseño; no se implementó nada.

| Dominio actual | Destino sugerido |
|---|---|
| `users.password` | Supabase Auth; nunca tabla propia ni texto plano |
| Datos básicos y rol | `profiles` con PK/FK a `auth.users.id`; rol protegido por RLS |
| Plan y fechas | `subscriptions` y, si se requiere, `subscription_events` |
| Perfil físico | `physical_profiles` o columnas bien tipadas en `profiles` |
| Cuestionario | `initial_assessments`, una fila vigente por usuario o historial versionado |
| Foto Base64 | Bucket de Supabase Storage + `avatar_path` |
| Biblioteca | `exercises`; `id` UUID o bigint, categoría normalizada si es necesario |
| Rutinas | `routines`, `routine_days`, `routine_exercises` con orden, semana, series, repeticiones y descanso |
| Progreso | `exercise_completions` con `user_id`, `routine_exercise_id`, semana/fecha y `completed_at` |
| `darkMode` | Mantener local o `user_preferences` opcional |

RLS mínimo recomendado:

- Un cliente solo puede leer/escribir su propio perfil, evaluación y progreso.
- Un cliente solo puede leer las rutinas que le fueron asignadas.
- El entrenador puede gestionar clientes, ejercicios, rutinas y suscripciones según una política de rol validada en servidor.
- La biblioteca puede ser de lectura para clientes y escritura solo para entrenadores.
- Las fotos deben estar en un bucket con políticas por propietario o rutas firmadas.

## 8. Orden recomendado de migración

1. Configurar cliente Supabase mediante variables de entorno/configuración pública segura y cargar el SDK; actualmente `supabase-config.js` está vacío y no se incluye en HTML.
2. Crear Supabase Auth y dejar de crear/comparar contraseñas en `app.js`.
3. Crear `profiles` y política de roles/RLS.
4. Migrar suscripciones separándolas de usuarios.
5. Migrar evaluaciones y perfiles con una estrategia para los campos duplicados y el alias `objetivo`.
6. Subir fotografías a Storage.
7. Importar `data/exercises.json` como seed de `exercises` y definir Supabase como autoridad.
8. Normalizar rutinas/asignaciones, resolviendo primero la ausencia de semana en el modelo actual.
9. Migrar ejercicios completados usando IDs relacionales y timestamps.
10. Mantener temporalmente una capa de compatibilidad de lectura solo durante la transición; retirar después las escrituras a `localStorage` de datos de negocio.

## 9. Decisiones pendientes antes de implementar

1. ¿Un solo entrenador administra a todos los clientes o habrá múltiples entrenadores/organizaciones?
2. ¿Las rutinas deben variar realmente por semana o las cuatro semanas comparten ejercicios?
3. ¿Se necesita historial de cuestionarios, perfiles físicos, planes y renovaciones?
4. ¿Los correos de usuarios actuales son válidos y pueden recibir invitación/restablecimiento para crear credenciales seguras?
5. ¿Se migrarán los dos usuarios demo o se excluirán?
6. ¿Las URLs de Cloudinary seguirán siendo la fuente de medios de ejercicios?
7. ¿Qué datos médicos requieren consentimiento, retención o eliminación específica?
8. ¿Se requiere funcionamiento offline y, en ese caso, qué datos pueden cachearse localmente sin convertirse en fuente de verdad?

## 10. Conclusión

La aplicación depende de `localStorage` como base de datos, sistema de autenticación y almacenamiento de archivos. La migración no debe consistir en reemplazar mecánicamente `getItem/setItem`: primero hay que separar identidad, autorización, perfiles, evaluaciones, suscripciones, catálogo, rutinas y progreso. Supabase Auth, tablas normalizadas, Storage y RLS deben convertirse en las fuentes de verdad; `localStorage` debería quedar limitado a caché no sensible y preferencias locales como el tema visual.
