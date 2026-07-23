(function (ns) {
  "use strict";

  const run = async (context, operation) => {
    try {
      const { data, error } = await operation(ns.requireClient());
      return error ? ns.fail(error, context) : ns.ok(data);
    } catch (error) {
      return ns.fail(error, context);
    }
  };
  const getAuthenticatedUserId = async client => {
    const { data, error } = await client.auth.getUser();
    return { userId: data?.user?.id || null, error };
  };

  ns.progress = {
    listCompletions(userId) {
      if (!userId) return Promise.resolve(ns.fail("ID obligatorio", "listCompletions"));
      return run("listCompletions", client => client.from("exercise_completions")
        .select("*").eq("user_id", userId));
    },
    async listOwnCompletions() {
      const client = ns.requireClient();
      const auth = await getAuthenticatedUserId(client);
      if (auth.error || !auth.userId) return ns.fail(auth.error || "Sesión requerida", "listOwnCompletions:auth");
      return run("listOwnCompletions", db => db.from("exercise_completions")
        .select("id, routine_exercise_id, week_number, completed_at")
        .eq("user_id", auth.userId));
    },
    markCompleted(userId, routineExerciseId, weekNumber) {
      const week = Number(weekNumber);
      if (!userId || !routineExerciseId || !Number.isInteger(week) || week < 1) {
        return Promise.resolve(ns.fail("Progreso inválido", "markCompleted"));
      }
      return run("markCompleted", client => client.from("exercise_completions").upsert({
        user_id: userId,
        routine_exercise_id: routineExerciseId,
        week_number: week,
        completed_at: new Date().toISOString()
      }, { onConflict: "user_id,routine_exercise_id,week_number" }).select().single());
    },
    async setOwnCompletion(routineExerciseId, weekNumber, completed) {
      const client = ns.requireClient();
      const auth = await getAuthenticatedUserId(client);
      const week = Number(weekNumber);
      if (auth.error || !auth.userId) return ns.fail(auth.error || "Sesión requerida", "setOwnCompletion:auth");
      if (!routineExerciseId || !Number.isInteger(week) || week < 1) {
        return ns.fail("Progreso inválido", "setOwnCompletion:validation");
      }
      if (!completed) {
        return run("setOwnCompletion:delete", db => db.from("exercise_completions").delete()
          .eq("user_id", auth.userId).eq("routine_exercise_id", routineExerciseId).eq("week_number", week));
      }
      return run("setOwnCompletion:insert", db => db.from("exercise_completions").insert({
        user_id: auth.userId,
        routine_exercise_id: routineExerciseId,
        week_number: week,
        completed_at: new Date().toISOString()
      }).select().single());
    },
    unmarkCompleted(userId, routineExerciseId, weekNumber) {
      return run("unmarkCompleted", client => client.from("exercise_completions").delete()
        .eq("user_id", userId).eq("routine_exercise_id", routineExerciseId)
        .eq("week_number", Number(weekNumber)));
    },
    calculate(completions, total) {
      return total > 0 ? Math.round((completions.length / total) * 100) : 0;
    }
  };
})(window.TrainerSupabase);
