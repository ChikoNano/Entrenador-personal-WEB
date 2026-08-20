(function (ns) {
  "use strict";

  const labels = {
    personal: "Plan personal",
    grupal: "Plan grupal",
    group: "Plan grupal",
    app: "Plan APP"
  };
  const plans = {
    "Plan personal": "personal",
    "Plan grupal": "grupal",
    "Plan APP": "app",
    personal: "personal",
    grupal: "grupal",
    group: "grupal",
    app: "app"
  };
  const normalize = value => plans[value];
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "");
  const run = async (context, operation) => {
    try {
      const { data, error } = await operation(ns.requireClient());
      return error ? ns.fail(error, context) : ns.ok(data);
    } catch (error) {
      return ns.fail(error, context);
    }
  };
  const validate = value => {
    const plan = normalize(value.plan_type ?? value.planType);
    if (!value.user_id || !plan || !validDate(value.start_date) ||
        !validDate(value.expiration_date) || value.expiration_date < value.start_date) {
      throw new Error("Suscripción inválida: usuario, plan y fechas son obligatorios");
    }
    return { ...value, plan_type: plan, status: "active" };
  };

  ns.subscriptions = {
    labels,
    normalize,
    getPlanLabel(plan) {
      return labels[plan] || "";
    },
    getSubscription(userId) {
      return run("getSubscription", client => client.from("subscriptions").select("*")
        .eq("user_id", userId).eq("status", "active")
        .order("created_at", { ascending: false }).limit(1).maybeSingle());
    },
    getAccessSubscription(userId) {
      if (!userId) return Promise.resolve(ns.fail("ID obligatorio", "getAccessSubscription"));
      return run("getAccessSubscription", client => client.from("subscription_overview")
        .select("id,user_id,plan_type,start_date,expiration_date,status,effective_status,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle());
    },
    async listSubscriptions() {
      const result = await run("listSubscriptions", client => client.from("subscriptions").select("*")
        .eq("status", "active").order("created_at", { ascending: false }));
      if (result.error) return result;
      const latestByUser = new Map();
      (result.data || []).forEach(subscription => {
        if (!latestByUser.has(subscription.user_id)) latestByUser.set(subscription.user_id, subscription);
      });
      return ns.ok([...latestByUser.values()]);
    },
    createSubscription(value) {
      try {
        return run("createSubscription", client => client.from("subscriptions")
          .insert(validate(value)).select().single());
      } catch (error) {
        return Promise.resolve(ns.fail(error, "createSubscription"));
      }
    },
    renewSubscription(value) {
      const subscriptionId = value?.subscriptionId;
      const userId = value?.userId;
      const expirationDate = value?.expirationDate;
      if (!subscriptionId || !userId || !validDate(expirationDate)) {
        return Promise.resolve(ns.fail("Suscripción o fecha de renovación inválida", "renewSubscription"));
      }
      return run("renewSubscription", client => client.from("subscriptions")
        .update({ expiration_date: expirationDate, status: "active" })
        .eq("id", subscriptionId)
        .eq("user_id", userId)
        .select()
        .single());
    },
    async repairInitialSubscription(userId, value) {
      if (!userId) return ns.fail("El usuario es obligatorio", "repairInitialSubscription");
      let payload;
      try {
        payload = validate({ ...value, user_id: userId });
      } catch (error) {
        return ns.fail(error, "repairInitialSubscription");
      }

      const client = ns.requireClient();
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError || !authData?.user?.id) {
        return ns.fail(authError || "Sesión requerida", "repairInitialSubscription:auth");
      }
      payload.created_by = authData.user.id;
      const existing = await client.from("subscriptions").select("*")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (existing.error) return ns.fail(existing.error, "repairInitialSubscription:lookup");
      if (existing.data?.plan_type && existing.data?.start_date && existing.data?.expiration_date) {
        return ns.ok(existing.data);
      }
      if (existing.data?.id) {
        return run("repairInitialSubscription:update", db => db.from("subscriptions")
          .update(payload).eq("id", existing.data.id).eq("user_id", userId).select().single());
      }
      return run("repairInitialSubscription:insert", db => db.from("subscriptions")
        .insert(payload).select().single());
    },
    async updatePlan(userId, newPlan) {
      const plan = normalize(newPlan);
      if (!userId || !plan) return ns.fail("Plan inválido", "updatePlan");
      const client = ns.requireClient();
      const old = await client.from("subscriptions").select("id, user_id, plan_type")
        .eq("user_id", userId).eq("status", "active")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (old.error) return ns.fail(old.error, "updatePlan:lookup");
      if (!old.data?.id) return ns.fail("No se encontró una suscripción activa", "updatePlan:lookup");
      const subscriptionId = old.data.id;
      console.log("Subscription id:", subscriptionId);
      const updated = await client.from("subscriptions").update({ plan_type: plan })
        .eq("id", subscriptionId).eq("user_id", userId).select().single();
      console.log("Resultado del update:", updated.data);
      console.log("Error:", updated.error);
      if (updated.error) return ns.fail(updated.error, "updatePlan:update");
      if (!updated.data?.id) return ns.fail("Supabase no devolvió la fila actualizada", "updatePlan:update");
      const { data: auth } = await client.auth.getUser();
      const event = await client.from("subscription_events").insert({
        subscription_id: subscriptionId, user_id: userId, event_type: "plan_changed",
        previous_plan: old.data.plan_type, new_plan: plan, created_by: auth.user.id
      });
      if (event.error) console.warn("No se pudo registrar el historial del cambio de plan:", event.error.message);
      return ns.ok(updated.data);
    }
  };
})(window.TrainerSupabase);
