(function (ns) {
  "use strict";

  const days = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const run = async (context, operation) => {
    try {
      const { data, error } = await operation(ns.requireClient());
      return error ? ns.fail(error, context) : ns.ok(data);
    } catch (error) {
      return ns.fail(error, context);
    }
  };
  const positive = (value, name) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) throw new Error(`${name} debe ser entero positivo`);
    return number;
  };
  const validateAssignment = value => {
    if (!uuidPattern.test(value.user_id || "")) throw new Error("Usuario inválido");
    if (!uuidPattern.test(value.exercise_id || "")) throw new Error("Ejercicio inválido");
    if (!days.includes(value.day_name)) throw new Error("Día inválido");
    const rest = Number(value.rest_seconds);
    if (!Number.isInteger(rest) || rest < 0) throw new Error("Descanso inválido");
    return {
      user_id: value.user_id,
      exercise_id: value.exercise_id,
      day_name: value.day_name,
      sets: positive(value.sets, "sets"),
      repetitions: positive(value.repetitions, "repetitions"),
      rest_seconds: rest
    };
  };

  ns.routines = {
    createRoutine(value) {
      if (!value?.user_id || !value?.trainer_id || !value?.name) {
        return Promise.resolve(ns.fail("Usuario, entrenador y nombre son obligatorios", "createRoutine"));
      }
      return run("createRoutine", client => client.from("routines").insert(value).select().single());
    },
    listUserRoutines(userId) {
      if (!userId) return Promise.resolve(ns.fail("ID obligatorio", "listUserRoutines"));
      return run("listUserRoutines", client => client.from("routines")
        .select("id, name, user_id, trainer_id, routine_type, active, created_at, routine_exercises(id, exercise_id, week_number, day_name, sets, repetitions, rest_seconds, notes, display_order, exercises(title, media_type, media_url, category, active))")
        .eq("user_id", userId).eq("active", true).order("created_at"));
    },
    async listOwnActiveRoutines() {
      const client = ns.requireClient();
      const { data: authData, error: authError } = await client.auth.getUser();
      const userId = authData?.user?.id;
      if (authError || !userId) return ns.fail(authError || "Sesión requerida", "listOwnActiveRoutines:auth");
      const result = await run("listOwnActiveRoutines", db => db.from("routines")
        .select("id, name, user_id, routine_type, active, routine_exercises(id, exercise_id, week_number, day_name, sets, repetitions, rest_seconds, notes, display_order, exercises(title, media_type, media_url, category, active))")
        .eq("user_id", userId).eq("active", true).order("created_at"));
      return result.error ? result : ns.ok({ userId, routines: result.data || [] });
    },
    async getOwnCardioAccess() {
      try {
        const client = ns.requireClient();
        const { data: authData, error: authError } = await client.auth.getUser();
        const userId = authData?.user?.id;
        if (authError || !userId) return ns.fail(authError || "Sesión requerida", "getOwnCardioAccess:auth");

        const routineResult = await client.from("routines")
          .select("id, name, user_id, routine_type, active")
          .eq("user_id", userId)
          .eq("routine_type", "cardio")
          .eq("active", true)
          .limit(1)
          .maybeSingle();
        if (routineResult.error) return ns.fail(routineResult.error, "getOwnCardioAccess:routine");
        if (!routineResult.data) return ns.ok({ allowed: false, reason: "NO_CARDIO_ROUTINE", routine: null, config: null });

        const configResult = await client.from("interval_timer_configs")
          .select("id, routine_id, rounds, work_seconds, phases, cooldown, active, updated_at")
          .eq("routine_id", routineResult.data.id)
          .eq("active", true)
          .maybeSingle();
        if (configResult.error) return ns.fail(configResult.error, "getOwnCardioAccess:config");
        if (!configResult.data) {
          return ns.ok({ allowed: false, reason: "NO_ACTIVE_CONFIG", routine: routineResult.data, config: null });
        }
        return ns.ok({ allowed: true, reason: "ALLOWED", routine: routineResult.data, config: configResult.data });
      } catch (error) {
        return ns.fail(error, "getOwnCardioAccess");
      }
    },
    async getOrCreateActiveCardioRoutine(userId) {
      if (!uuidPattern.test(userId || "")) return ns.fail("Usuario inválido", "getOrCreateActiveCardioRoutine");
      const client = ns.requireClient();
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError || !authData?.user?.id) {
        return ns.fail(authError || "Sesión requerida", "getOrCreateActiveCardioRoutine:auth");
      }
      const findActive = () => client.from("routines")
        .select("*")
        .eq("user_id", userId)
        .eq("routine_type", "cardio")
        .eq("active", true)
        .limit(1)
        .maybeSingle();
      const existing = await findActive();
      if (existing.error) return ns.fail(existing.error, "getOrCreateActiveCardioRoutine:lookup");
      if (existing.data) return ns.ok(existing.data);

      const created = await client.from("routines").insert({
        user_id: userId,
        trainer_id: authData.user.id,
        name: "Rutina de cardio",
        routine_type: "cardio",
        start_date: new Date().toISOString().slice(0, 10),
        active: true
      }).select().single();
      if (!created.error) return ns.ok(created.data);
      if (created.error.code !== "23505") {
        return ns.fail(created.error, "getOrCreateActiveCardioRoutine:create");
      }
      const concurrent = await findActive();
      return concurrent.error || !concurrent.data
        ? ns.fail(concurrent.error || "No se pudo recuperar la rutina de cardio", "getOrCreateActiveCardioRoutine:race")
        : ns.ok(concurrent.data);
    },
    async getOrCreateActiveRoutine(userId) {
      if (!uuidPattern.test(userId || "")) return ns.fail("Usuario inválido", "getOrCreateActiveRoutine");
      const client = ns.requireClient();
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError || !authData?.user?.id) {
        return ns.fail(authError || "Sesión requerida", "getOrCreateActiveRoutine:auth");
      }
      const existing = await client.from("routines").select("*")
        .eq("user_id", userId).eq("trainer_id", authData.user.id).eq("active", true)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (existing.error) return ns.fail(existing.error, "getOrCreateActiveRoutine:lookup");
      if (existing.data) return ns.ok(existing.data);
      return run("getOrCreateActiveRoutine:create", db => db.from("routines").insert({
        user_id: userId,
        trainer_id: authData.user.id,
        name: "Rutina activa",
        start_date: new Date().toISOString().slice(0, 10),
        active: true
      }).select().single());
    },
    async assignExercise(value) {
      let assignment;
      try {
        assignment = validateAssignment(value);
      } catch (error) {
        return ns.fail(error, "assignExercise:validation");
      }
      const routine = await this.getOrCreateActiveRoutine(assignment.user_id);
      if (routine.error || !routine.data?.id) return routine;
      return this.syncExerciseAcrossFourWeeks({
        routine_id: routine.data.id,
        exercise_id: assignment.exercise_id,
        day_name: assignment.day_name,
        sets: assignment.sets,
        repetitions: assignment.repetitions,
        rest_seconds: assignment.rest_seconds,
        notes: value.notes ?? null,
        display_order: Number(value.display_order) || 0
      });
    },
    async syncExerciseAcrossFourWeeks(value) {
      try {
        if (!uuidPattern.test(value.routine_id || "")) throw new Error("Rutina inválida");
        if (!uuidPattern.test(value.exercise_id || "")) throw new Error("Ejercicio inválido");
        if (!days.includes(value.day_name)) throw new Error("Día inválido");
        const sets = positive(value.sets, "sets");
        const repetitions = positive(value.repetitions, "repetitions");
        const restSeconds = Number(value.rest_seconds);
        const displayOrder = Number(value.display_order) || 0;
        if (!Number.isInteger(restSeconds) || restSeconds < 0) throw new Error("Descanso inválido");
        if (!Number.isInteger(displayOrder) || displayOrder < 0) throw new Error("Orden inválido");

        const routineId = value.routine_id;
        const exerciseId = value.exercise_id;
        const dayName = value.day_name;
        const notes = value.notes;
        const rows = [1, 2, 3, 4].map((weekNumber) => ({
          routine_id: routineId,
          exercise_id: exerciseId,
          week_number: weekNumber,
          day_name: dayName,
          sets: sets,
          repetitions: repetitions,
          rest_seconds: restSeconds,
          notes: notes || null,
          display_order: displayOrder || 0
        }));

        const supabase = ns.requireClient();
        const existing = await supabase
          .from("routine_exercises")
          .select("id, week_number")
          .eq("routine_id", routineId)
          .eq("exercise_id", exerciseId)
          .eq("day_name", dayName)
          .in("week_number", [1, 2, 3, 4]);

        if (existing.error) throw existing.error;
        if ((existing.data || []).length > 0) {
          throw new Error("Este ejercicio ya está asignado a esta rutina y día");
        }

        const { data, error } = await supabase
          .from("routine_exercises")
          .insert(rows)
          .select();

        if (error?.code === "23505") {
          throw new Error("Este ejercicio ya está asignado a esta rutina y día");
        }
        if (error) throw error;

        if (!Array.isArray(data) || data.length !== 4) {
          throw new Error(
            `Se esperaban 4 semanas y Supabase devolvió ${data?.length || 0}`
          );
        }

        return ns.ok(data);
      } catch (error) {
        return ns.fail(error, "syncExerciseAcrossFourWeeks:validation");
      }
    },
    updateRoutineExercise(id, value) {
      if (!id) return Promise.resolve(ns.fail("ID obligatorio", "updateRoutineExercise"));
      return run("updateRoutineExercise", client => client.from("routine_exercises")
        .update(value).eq("id", id).select().single());
    },
    removeRoutineExercise(id) {
      if (!uuidPattern.test(id || "")) return Promise.resolve(ns.fail("ID de asignación inválido", "removeRoutineExercise"));
      return run("removeRoutineExercise", client => client.from("routine_exercises").delete().eq("id", id));
    },
    async removeMonthlyExerciseAssignment(id) {
      if (!uuidPattern.test(id || "")) {
        return ns.fail("ID de asignación inválido", "removeMonthlyExerciseAssignment");
      }
      try {
        const client = ns.requireClient();
        const assignment = await client.from("routine_exercises")
          .select("id, routine_id, exercise_id, week_number, day_name")
          .eq("id", id)
          .maybeSingle();
        if (assignment.error) throw assignment.error;
        if (!assignment.data) throw new Error("La asignación ya no existe");

        const { routine_id: routineId, exercise_id: exerciseId, day_name: dayName } = assignment.data;
        const removed = await client.from("routine_exercises")
          .delete()
          .eq("routine_id", routineId)
          .eq("exercise_id", exerciseId)
          .eq("day_name", dayName)
          .in("week_number", [1, 2, 3, 4])
          .select("id, week_number");
        if (removed.error) throw removed.error;
        return ns.ok(removed.data || []);
      } catch (error) {
        return ns.fail(error, "removeMonthlyExerciseAssignment");
      }
    }
  };
})(window.TrainerSupabase);
