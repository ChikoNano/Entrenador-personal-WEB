# Supabase local

Estos archivos son revisables y **no ejecutan cambios remotos automáticamente**.

1. Revise y ejecute `schema.sql` en SQL Editor.
2. Cree el primer administrador siguiendo `../docs/PLAN_MIGRACION_SUPABASE.md`.
3. Ejecute `seed-exercises.sql` una vez creado el esquema.
4. Configure `js/supabase-config.js` con URL y clave publicable/anon (nunca `service_role`).
5. Despliegue `functions/invite-user` y configure sus secretos en Supabase.

La función requiere `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y `SITE_URL`. La `service_role` vive exclusivamente como secreto de la Edge Function. `SITE_URL` debe ser la URL pública de la aplicación permitida también en Authentication > Redirect URLs.

## Cronómetro de intervalos V1

Ejecute `interval-timer-config-v1.sql` para crear `public.interval_timer_configs`. Esta tabla guarda únicamente la configuración asignada a la rutina activa (nombre, rondas, fases y enfriamiento). No guarda ejecuciones, resultados, estadísticas, progreso ni historial. Sus políticas permiten lectura al usuario dueño de la rutina y escritura únicamente al entrenador o administrador autorizado mediante `can_manage_user`.

El bucket privado `avatars` y sus políticas se crean desde `schema.sql`. Cada archivo debe usar la ruta `<auth.uid()>/<nombre-seguro>`.
