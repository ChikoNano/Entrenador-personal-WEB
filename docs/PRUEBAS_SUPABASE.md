# Pruebas Supabase

Ejecutar primero en un proyecto de prueba, con consola abierta y dos navegadores/perfiles independientes.

| Caso | Procedimiento | Resultado esperado |
|---|---|---|
| Admin inicia sesión | Credenciales Auth del admin | sesión persistente y panel admin |
| Invitación | invocar `inviteUser` con cliente real | correo enviado, perfil user y suscripción creados; entrenador no conoce contraseña |
| Creación/recuperación de contraseña | abrir enlace permitido y guardar contraseña >=8 | sesión Auth válida, sin contraseña en tablas/localStorage |
| Cuestionario | completar 7 pasos | upsert único en `initial_assessments`, `completed_at` presente |
| Perfil | cambiar medidas/objetivo | solo perfil propio cambia; rol/trainer/active permanecen |
| Foto | subir JPG/PNG/WebP <5 MB | objeto privado bajo UUID y `avatar_path`; URL firmada visible |
| Entrenador ve cliente | abrir perfil asignado | datos y avatar permitidos por RLS |
| Rutina | crear rutina y ejercicios para semanas 1 y 2 | filas distintas por `week_number`; cliente ve solo las suyas |
| Otro dispositivo | iniciar sesión como cliente | misma rutina, evaluación y progreso |
| Progreso | marcar/desmarcar | upsert sin duplicados y persistencia tras recarga |
| Renovación/plan | crear nueva suscripción/cambiar plan | historial conservado, fechas no alteradas por cambio de plan |
| Aislamiento | cliente A consulta IDs de B | 0 filas o 403 por RLS |
| Escalada | cliente intenta `role='admin'` | trigger conserva rol anterior |
| Sesión | recargar con token vigente | `restoreSession()` recupera Supabase; no depende del rol local |
| Logout | pulsar Salir | `signOut`, login visible y caché de identidad retirada |
| Modo oscuro | alternar y recargar | `darkMode` persiste localmente |
| Semilla idempotente | ejecutar semilla dos veces | 40 `legacy_id` únicos, sin duplicados |
| Migración | respaldo, plan, confirmación | demos/contraseñas omitidos, informe claro, nada se borra |
| Rollback | verificar rama `backup-antes-supabase` | rama intacta y disponible |

## Anchos y regresión local

Comparar visualmente 320, 360, 390, 430, 768, 1366 y 1920 px. No se modificaron nodos visuales ni CSS. Probar login local con placeholders únicamente como compatibilidad; ese resultado no valida producción.

## Comprobaciones de seguridad

- Buscar `service_role` en archivos públicos: solo puede aparecer en documentación/Edge Function como nombre de secreto, nunca como valor.
- Confirmar que `localStorage` no recibe contraseñas en modo Supabase.
- Probar acceso directo REST a cada tabla con token de cliente A contra UUID de B.
- Confirmar que un entrenador solo administra clientes vinculados, salvo admin.

## Requieren un Supabase real

Envío de correo, callback/invitación, RLS efectiva, Storage, Edge Function, persistencia multi-dispositivo, expiración/refresh de tokens y restricciones de Auth no pueden validarse sin URL, clave pública, secretos y proyecto desplegado.
