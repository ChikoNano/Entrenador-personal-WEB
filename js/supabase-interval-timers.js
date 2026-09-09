(function (ns) {
  "use strict";
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const run = async (context, operation) => {
    try {
      const { data, error } = await operation(ns.requireClient());
      return error ? ns.fail(error, context) : ns.ok(data);
    } catch (error) {
      return ns.fail(error, context);
    }
  };

  ns.intervalTimers = {
    getForRoutine(routineId) {
      if (!uuidPattern.test(routineId || "")) {
        return Promise.resolve(ns.fail("Rutina inválida", "intervalTimers:getForRoutine"));
      }
      return run("intervalTimers:getForRoutine", client => client.from("interval_timer_configs")
        .select("id, routine_id, rounds, work_seconds, phases, cooldown, active, updated_at")
        .eq("routine_id", routineId)
        .eq("active", true)
        .maybeSingle());
    },

    listOwnActive() {
      return run("intervalTimers:listOwnActive", client => client.from("interval_timer_configs")
        .select("id, routine_id, rounds, work_seconds, phases, cooldown, active, updated_at, routines!inner(user_id, active)")
        .eq("active", true)
        .eq("routines.active", true)
        .order("updated_at", { ascending: false })
        .limit(1));
    },

    saveForRoutine(routineId, value) {
      if (!uuidPattern.test(routineId || "")) {
        return Promise.resolve(ns.fail("Rutina inválida", "intervalTimers:saveForRoutine"));
      }
      let config;
      try {
        config = window.FIT51IntervalTimer.validateConfig(value);
      } catch (error) {
        return Promise.resolve(ns.fail(error, "intervalTimers:saveForRoutine"));
      }
      return run("intervalTimers:saveForRoutine", client => client.from("interval_timer_configs").upsert({
        routine_id: routineId,
        rounds: config.rounds,
        work_seconds: config.work_seconds,
        phases: config.phases,
        cooldown: config.cooldown,
        active: true
      }, { onConflict: "routine_id" }).select().single());
    }
  };
})(window.TrainerSupabase);
