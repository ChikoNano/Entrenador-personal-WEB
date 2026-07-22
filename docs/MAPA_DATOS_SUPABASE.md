# Mapa de datos: localStorage → Supabase

Documento derivado de `AUDITORIA_SUPABASE.md` y de la revisión directa de `app.js`. No existe uso de `sessionStorage`.

| Clave legado | Forma real | Consumidores principales | Pantallas | Destino | Riesgo |
|---|---|---|---|---|---|
| `users` | objeto por correo; incluye `password`, rol, nombre, plan y fechas | `getUsers`, `createUser`, login, suscripciones, perfiles | Login, Usuarios, Suscripciones | Auth + `profiles` + `subscriptions` | Crítico: contraseñas en texto plano, correo como identidad y usuarios demo mezclados |
| `currentUser` | correo string | sesión, perfil, rutina, cuestionario, progreso | toda sesión | sesión de Supabase (`auth.uid()`) | Alto: no sirve para autorización; solo queda como caché temporal de UI |
| `currentRole` | string | sesión/UI | paneles | `profiles.role` + RLS | Crítico si se confía en navegador; nunca participa en RLS |
| `darkMode` | boolean serializado | `toggleMode`, inicio | global | localStorage | Bajo; se conserva como preferencia no sensible |
| `profile_<email>` | perfil/medidas/fechas | `loadProfile`, guardado, perfil entrenador | Mi Perfil, Usuarios | `profiles` | Alto: campos duplicados, numéricos como strings y correo en clave |
| `questionnaire_<email>` | evaluación; `goal` y alias `objetivo` | cuestionario, perfil, suscripciones | Evaluación, Perfil | `initial_assessments` | Alto: duplicación, tipos inconsistentes; se normaliza a `goal` |
| `profilePhoto_<email>` | Data URL Base64 | foto/preview/perfil | Perfil | Storage `avatars` + `profiles.avatar_path` | Alto: cuota y datos grandes; requiere conversión manual segura |
| `exerciseLibrary` | arreglo `{id,category,title,type,url}` | inicialización, CRUD, selectores | Biblioteca, Rutinas | `exercises` | Medio: IDs timestamp; pasan a `uuid` y conservan `legacy_id` |
| `userAssignments` | `{email:{day:[{exerciseId,sets,reps,rest}]}}` | asignación/render/eliminación | Rutinas | `routines` + `routine_exercises` | Crítico: no contiene semana y una función lo trataba como arreglo |
| `completedExercises` | objeto de booleanos con clave `${email}_${week}_${day}_${exerciseId}` | progreso | Mi Rutina | `exercise_completions` | Crítico: clave ambigua y sin FK; requiere mapa a `routine_exercise_id` |

## Formas y normalización

- Usuario: la contraseña no se migra. Primero se crea/invita una cuenta Auth y se proporciona un mapa explícito `correo → UUID`.
- Perfil: `name→full_name`, `cooperDistance→cooper_distance_km`, `vamSpeed→vam_kmh`; edad, peso y estatura se convierten con validación.
- Evaluación: `goal ?? objetivo→goal`; nombres camelCase pasan a snake_case. `trainingDays` y `sessionDuration` se convierten a enteros seguros.
- Plan: `Plan personal→personal`, `Plan grupal→group`, `Plan APP→app`.
- Fechas: timestamps se normalizan a ISO; inicio/vencimiento se almacenan como `date`, eventos/completado como `timestamptz`.
- Asignaciones: cada cliente requiere una rutina y cada elemento una semana real. Como el legado no posee semana, el migrador lo reporta y no inventa `week_number`.
- Progreso: se abandona la clave de texto; la unicidad es `(user_id, routine_exercise_id, week_number)`.

## Incompatibilidad corregida

`deleteExerciseFromLibrary()` ejecutaba `.filter()` directamente sobre `assignments[email]`, aunque la forma vigente es un objeto por días. Ahora admite ambos formatos heredados y filtra los arreglos dentro de cada día. En Supabase, `deactivateExercise()` usa `active=false`; la FK `ON DELETE RESTRICT` evita borrar ejercicios usados.

## Código duplicado o pendiente

- Los objetos demo se fusionan en `getUsers()` y deben quedar fuera de producción.
- Perfil y evaluación duplican algunos datos; el modelo nuevo deja la evaluación en una sola tabla y solo conserva `profiles.goal` como objetivo resumido actual.
- `currentUser/currentRole` y las escrituras sensibles siguen presentes en adaptadores heredados. Su retiro está planificado por pantalla; no autorizan ninguna operación Supabase.
- La biblioteca JSON es semilla, no fuente autoritativa después del despliegue.

## Fuentes de autoridad durante la transición

Con `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` válidos, Auth y la biblioteca se leen de Supabase. Las copias de `currentUser`, `currentRole`, cuestionario y biblioteca en localStorage son caché de compatibilidad para renderizadores existentes; RLS usa exclusivamente `auth.uid()`. Sin configuración se muestra `data-mode="local-compatibility"`; ese modo no es apto para producción.
