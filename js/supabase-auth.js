(function (ns) {
  "use strict";
  const run = async (context, operation) => { try { const { data, error } = await operation(ns.requireClient()); return error ? ns.fail(error, context) : ns.ok(data); } catch (e) { return ns.fail(e, context); } };
  ns.auth = {
    getSession: () => run("getSession", c => c.auth.getSession()),
    signIn(email, password) { if (!email || !password) return Promise.resolve(ns.fail("Correo y contraseña son obligatorios", "signIn")); return run("signIn", c => c.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })); },
    signOut: () => run("signOut", c => c.auth.signOut()),
    onAuthStateChange(callback) { return ns.requireClient().auth.onAuthStateChange(callback); },
    updatePassword(password) { if (!password || password.length < 8) return Promise.resolve(ns.fail("La contraseña debe tener al menos 8 caracteres", "updatePassword")); return run("updatePassword", c => c.auth.updateUser({ password })); },
    resetPassword(email, redirectTo) { if (!email) return Promise.resolve(ns.fail("Correo obligatorio", "resetPassword")); return run("resetPassword", c => c.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo })); },
    async getAuthenticatedProfile() { const session = await this.getSession(); const id = session.data?.session?.user?.id; if (!id) return ns.fail("No hay sesión activa", "getAuthenticatedProfile"); return run("getAuthenticatedProfile", c => c.from("profiles").select("*").eq("id", id).single()); },
    async inviteUser(payload) {
      try {
        const c = ns.requireClient();
        const { data: sessionData, error: sessionError } = await c.auth.getSession();
        const session = sessionData?.session;
        if (sessionError || !session?.access_token) {
          return ns.fail(sessionError || "La sesión expiró. Inicia sesión nuevamente.", "inviteUser:session");
        }
        const { data, error } = await c.functions.invoke("invite-user", {
          body: payload,
          headers: { Authorization: `Bearer ${session.access_token}` }
        });
        if (!error) {
          if (data?.success === true && data?.userId) return ns.ok(data);
          return {
            data: null,
            error: {
              message: data?.message || "La función no confirmó la creación del usuario",
              status: 500,
              context: "inviteUser:invalid-success"
            }
          };
        }

        let details = null;
        try { details = await error.context?.json(); } catch { /* respuesta sin JSON */ }
        return {
          data: null,
          error: {
            message: details?.message || details?.error || error.message || "La función de invitación devolvió un error",
            status: error.context?.status || null,
            context: "inviteUser"
          }
        };
      } catch (error) {
        return ns.fail(error, "inviteUser:network");
      }
    },
    async deleteUser(userId) {
      if (!userId) return ns.fail("El UUID del usuario es obligatorio", "deleteUser:validation");
      try {
        const c = ns.requireClient();
        const { data: sessionData, error: sessionError } = await c.auth.getSession();
        const session = sessionData?.session;
        if (sessionError || !session?.access_token) {
          return ns.fail(sessionError || "La sesión expiró. Inicia sesión nuevamente.", "deleteUser:session");
        }

        const { data, error } = await c.functions.invoke("delete-user", {
          body: { userId },
          headers: { Authorization: `Bearer ${session.access_token}` }
        });
        if (!error) {
          if (data?.success === true && data?.userId === userId) return ns.ok(data);
          return ns.fail(
            data?.message || "La función no confirmó la eliminación del usuario",
            "deleteUser:invalid-success"
          );
        }

        let details = null;
        try { details = await error.context?.json(); } catch { /* respuesta sin JSON */ }
        return {
          data: null,
          error: {
            message: details?.message || details?.error || error.message || "No se pudo eliminar el usuario",
            status: error.context?.status || null,
            context: "deleteUser"
          }
        };
      } catch (error) {
        return ns.fail(error, "deleteUser:network");
      }
    }
  };
})(window.TrainerSupabase);
