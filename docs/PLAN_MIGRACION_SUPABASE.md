# Plan de migración a Supabase

## Estado y arquitectura

La app es HTML/CSS/JavaScript clásico y conserva su interfaz. `app.js` continúa al final; antes se cargan Supabase JS v2, una configuración global controlada (`window.TrainerSupabase`) y servicios sin acceso al DOM. Supabase será autoritativo; localStorage queda para `darkMode` y cachés transitorias documentadas.

Auth identifica por UUID. `profiles` modela usuarios/entrenadores, `initial_assessments` la evaluación, `exercises` la biblioteca, `routines/routine_exercises` la programación semanal real, `subscriptions/subscription_events` el historial y `exercise_completions` el progreso. Storage privado guarda avatares. RLS nunca usa `currentUser/currentRole`.

## Orden de despliegue manual

1. Crear un proyecto Supabase y revisar `supabase/schema.sql`.
2. Ejecutar `schema.sql` en SQL Editor.
3. Crear manualmente el primer usuario en Authentication > Users.
4. Promoverlo una sola vez desde SQL Editor: `update public.profiles set role='admin', active=true where email='CORREO_REAL';`.
5. Ejecutar `supabase/seed-exercises.sql`.
6. Configurar Site URL y Redirect URLs (producción y localhost) en Authentication > URL Configuration.
7. Sustituir solo los placeholders públicos en `js/supabase-config.js`. La clave debe ser publishable/anon, nunca service role.
8. Desplegar `invite-user`: `supabase functions deploy invite-user`.
9. Crear secretos: `supabase secrets set SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... SITE_URL=...`.
10. Probar RLS con dos cuentas antes de migrar datos.

## Invitaciones y contraseña

El entrenador autenticado llama `TrainerSupabase.auth.inviteUser(payload)`. La Edge Function valida su perfil, invita por correo, completa `profiles` y crea la suscripción. El cliente abre la URL permitida y define su contraseña mediante `TrainerSupabase.auth.updatePassword()`. El entrenador nunca recibe ni almacena esa contraseña. `service_role` existe únicamente como secreto de la función.

## Migración existente

1. Crear/invitar primero cuentas Auth reales; excluir `admin@test.com` y `usuario@test.com`.
2. Construir un mapa controlado `{ "correo": "uuid-auth" }`.
3. En consola administrativa ejecutar `TrainerSupabase.migration.detectLegacyData()`.
4. Descargar respaldo: `TrainerSupabase.migration.createBackup()`.
5. Preparar: `const plan = TrainerSupabase.migration.buildMigrationPlan(mapa)` y revisar omitidos/alertas.
6. Ejecutar explícitamente: `const result = await TrainerSupabase.migration.executeMigration(plan, {confirm:true})`.
7. Exportar informe: `TrainerSupabase.migration.exportReport(result.data)`.
8. Resolver manualmente semana de rutinas, correspondencias de progreso y Base64 de avatares. El migrador no inventa esos datos.
9. Validar conteos y usuarios desde otro dispositivo. No borrar localStorage hasta completar la validación.

No se migran contraseñas. La operación es reejecutable para biblioteca/evaluaciones; perfiles se actualizan por UUID. Rutinas/progreso quedan deliberadamente en preparación mientras falte el mapeo no ambiguo.

## Rollback

No se modificó `backup-antes-supabase`. Para volver, cambie a esa rama de manera no destructiva después de conservar cualquier trabajo local. Los cambios SQL remotos deben revertirse con scripts revisados o restauración del proyecto; no se ejecutaron desde esta tarea. El respaldo JSON permite recuperar el estado local, pero puede contener datos sensibles y debe almacenarse de forma privada.

## Variables y configuración

- Frontend: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`.
- Edge Function: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SITE_URL`.
- Redirect URLs: URL publicada y URL exacta de desarrollo. No usar comodines amplios en producción.

## Archivos de la fase

SQL/Edge: `supabase/schema.sql`, `supabase/seed-exercises.sql`, `supabase/functions/invite-user/index.ts`. Servicios: los archivos `js/supabase-*.js` y `js/migration-localstorage.js`. Integración: `index.html` y puentes mínimos en `app.js`. Documentación: los tres archivos de `docs/`.

## Dependencias heredadas pendientes

Creación/eliminación local de usuarios, edición administrativa, perfiles completos, asignador de rutinas, renovaciones y la mayor parte del progreso aún escriben localStorage. Deben migrarse pantalla por pantalla a los servicios antes de producción. Las cachés de biblioteca/evaluación y `currentUser/currentRole` se conservan solo para renderizadores antiguos. `darkMode` permanece local legítimamente.

## Riesgos y decisiones

- No se inventó la semana de asignaciones antiguas ni una interpretación de las claves compuestas de progreso.
- La Edge Function hace compensación eliminando la invitación si falla perfil/suscripción; revisar logs ante fallos parciales.
- `updatePlan` hace dos llamadas; para auditoría transaccional estricta conviene reemplazarlo por RPC en una fase posterior.
- El CDN requiere red. Para despliegues con política CSP estricta, fijar versión e integridad o servir el SDK localmente.
- La política de avatares supone que la primera carpeta sea un UUID válido.
