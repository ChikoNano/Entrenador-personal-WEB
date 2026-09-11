(function (global) {
  "use strict";

  const positiveInteger = (value, label) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) throw new Error(`${label} debe ser un entero positivo`);
    return number;
  };

  const normalizePhase = (phase, index) => {
    const name = String(phase?.name || "").trim();
    const intensity = String(phase?.intensity || "").trim();
    if (!name) throw new Error(`La fase ${index + 1} necesita un nombre`);
    if (!intensity) throw new Error(`La fase ${index + 1} necesita un nivel o intensidad`);
    const level = Number(intensity.match(/^Nivel (\d{1,2})$/)?.[1]);
    if (!Number.isInteger(level) || level < 0 || level > 20) {
      throw new Error(`El nivel de la fase ${index + 1} debe estar entre Nivel 0 y Nivel 20`);
    }
    return {
      name,
      intensity,
      duration_seconds: positiveInteger(phase?.duration_seconds, `Duración de fase ${index + 1}`)
    };
  };

  function normalizeConfig(value) {
    const phases = Array.isArray(value?.phases) ? value.phases.map(normalizePhase) : [];
    if (!phases.length) throw new Error("Agrega al menos una fase");
    const cooldownSeconds = Number(value?.cooldown?.duration_seconds ?? 0);
    if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 60 || cooldownSeconds > 1800 || cooldownSeconds % 60 !== 0) {
      throw new Error("La duración del enfriamiento no es válida");
    }
    const cooldownIntensity = String(value?.cooldown?.intensity || "").trim();
    const cooldownLevel = Number(cooldownIntensity.match(/^Nivel (\d{1,2})$/)?.[1]);
    if (!Number.isInteger(cooldownLevel) || cooldownLevel < 0 || cooldownLevel > 20) {
      throw new Error("El nivel del enfriamiento debe estar entre Nivel 0 y Nivel 20");
    }
    const rounds = positiveInteger(value?.rounds, "Rondas");
    if (rounds > 999) throw new Error("Rondas no puede ser mayor a 999");
    const workSeconds = positiveInteger(value?.work_seconds, "Tiempo de trabajo");
    if (workSeconds > 1800) throw new Error("El tiempo de trabajo máximo permitido es de 30 minutos.");
    return {
      rounds,
      work_seconds: workSeconds,
      phases,
      cooldown: {
        name: String(value?.cooldown?.name || "Enfriamiento").trim() || "Enfriamiento",
        intensity: cooldownIntensity,
        duration_seconds: cooldownSeconds
      }
    };
  }

  function calculateSummary(value) {
    const config = normalizeConfig(value);
    const roundSeconds = config.phases.reduce((total, phase) => total + phase.duration_seconds, 0);
    const configuredWorkSeconds = roundSeconds * config.rounds;
    return {
      roundSeconds,
      configuredWorkSeconds,
      workSeconds: config.work_seconds,
      matchesWorkTime: configuredWorkSeconds === config.work_seconds,
      cooldownSeconds: config.cooldown.duration_seconds,
      totalSeconds: config.work_seconds + config.cooldown.duration_seconds
    };
  }

  const formatClock = value => {
    const seconds = Math.max(0, Number(value) || 0);
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };

  function validateConfig(value) {
    const config = normalizeConfig(value);
    const summary = calculateSummary(config);
    if (!summary.matchesWorkTime) {
      throw new Error(`La configuración suma ${formatClock(summary.configuredWorkSeconds)} min y el tiempo de trabajo indicado es ${formatClock(summary.workSeconds)} min. Ajusta rondas o tiempos antes de continuar.`);
    }
    return config;
  }

  function getRemainingStages(value, snapshot, limit = Number.POSITIVE_INFINITY) {
    const config = normalizeConfig(value);
    if (!snapshot || snapshot.mode === "finished") return [];
    if (snapshot.mode === "cooldown") {
      return [{ ...config.cooldown, duration_seconds: snapshot.remainingSeconds, state: "current", kind: "cooldown", round: config.rounds }];
    }
    const phaseIndex = Number.isInteger(snapshot.phaseIndex) ? snapshot.phaseIndex : 0;
    const stages = [];
    const maximumWorkItems = Math.max(1, limit - 1);
    const totalWorkItems = (config.phases.length - phaseIndex) + ((config.rounds - snapshot.round) * config.phases.length);
    let reachedLimit = false;
    for (let round = Math.max(1, snapshot.round); round <= config.rounds; round += 1) {
      const firstPhase = round === snapshot.round ? phaseIndex : 0;
      for (let index = firstPhase; index < config.phases.length; index += 1) {
        const isCurrent = round === snapshot.round && index === phaseIndex;
        stages.push({
          ...config.phases[index],
          duration_seconds: isCurrent ? snapshot.remainingSeconds : config.phases[index].duration_seconds,
          state: isCurrent ? "current" : stages.length === 1 ? "next" : "pending",
          kind: "work",
          round
        });
        if (stages.length >= maximumWorkItems) {
          reachedLimit = true;
          break;
        }
      }
      if (reachedLimit) break;
    }
    stages.push({ ...config.cooldown, state: stages.length ? "pending" : "current", kind: "cooldown", round: config.rounds });
    stages.omittedCount = Math.max(0, totalWorkItems + 1 - stages.length);
    return stages;
  }

  class IntervalEngine {
    constructor(value, options = {}) {
      this.config = validateConfig(value);
      this.summary = calculateSummary(this.config);
      this.now = options.now || (() => Date.now());
      this.onEvent = options.onEvent || (() => {});
      this.status = "idle";
      this.startedAt = 0;
      this.elapsedBeforeStart = 0;
      this.lastSegmentKey = "";
      this.lastCountdown = null;
    }

    elapsedMs(at = this.now()) {
      return this.elapsedBeforeStart + (this.status === "running" ? Math.max(0, at - this.startedAt) : 0);
    }

    start(at = this.now()) {
      if (this.status !== "idle") return this.snapshot(at);
      this.status = "running";
      this.startedAt = at;
      this.onEvent("start", this.snapshot(at));
      return this.tick(at);
    }

    pause(at = this.now()) {
      if (this.status !== "running") return this.snapshot(at);
      this.elapsedBeforeStart = this.elapsedMs(at);
      this.status = "paused";
      return this.snapshot(at);
    }

    resume(at = this.now()) {
      if (this.status !== "paused") return this.snapshot(at);
      this.status = "running";
      this.startedAt = at;
      return this.tick(at);
    }

    finish(at = this.now()) {
      if (this.status === "finished") return this.snapshot(at);
      this.elapsedBeforeStart = this.summary.totalSeconds * 1000;
      this.status = "finished";
      const snapshot = this.snapshot(at);
      this.onEvent("finish", snapshot);
      return snapshot;
    }

    snapshot(at = this.now()) {
      const totalMs = this.summary.totalSeconds * 1000;
      const elapsedMs = Math.min(this.elapsedMs(at), totalMs);
      if (elapsedMs >= totalMs) {
        return {
          status: "finished",
          mode: "finished",
          round: this.config.rounds,
          rounds: this.config.rounds,
          phase: null,
          next: null,
          remainingSeconds: 0,
          totalRemainingSeconds: 0,
          countdown: null,
          progress: 1,
          segmentKey: "finished"
        };
      }

      const intervalMs = this.summary.configuredWorkSeconds * 1000;
      if (elapsedMs >= intervalMs) {
        const remainingMs = totalMs - elapsedMs;
        return {
          status: this.status,
          mode: "cooldown",
          round: this.config.rounds,
          rounds: this.config.rounds,
          phase: this.config.cooldown,
          next: null,
          remainingSeconds: Math.ceil(remainingMs / 1000),
          totalRemainingSeconds: Math.ceil(remainingMs / 1000),
          countdown: remainingMs <= 3000 ? Math.ceil(remainingMs / 1000) : null,
          progress: totalMs ? elapsedMs / totalMs : 1,
          segmentKey: "cooldown"
        };
      }

      const roundMs = this.summary.roundSeconds * 1000;
      const roundIndex = Math.floor(elapsedMs / roundMs);
      const withinRoundMs = elapsedMs - roundIndex * roundMs;
      let phaseStartMs = 0;
      let phaseIndex = 0;
      for (; phaseIndex < this.config.phases.length; phaseIndex += 1) {
        const phaseMs = this.config.phases[phaseIndex].duration_seconds * 1000;
        if (withinRoundMs < phaseStartMs + phaseMs) break;
        phaseStartMs += phaseMs;
      }
      const phase = this.config.phases[Math.min(phaseIndex, this.config.phases.length - 1)];
      const phaseRemainingMs = (phaseStartMs + phase.duration_seconds * 1000) - withinRoundMs;
      const isLastPhase = phaseIndex === this.config.phases.length - 1;
      const isLastRound = roundIndex === this.config.rounds - 1;
      const next = !isLastPhase
        ? this.config.phases[phaseIndex + 1]
        : !isLastRound
          ? this.config.phases[0]
          : this.config.cooldown.duration_seconds > 0 ? this.config.cooldown : null;
      return {
        status: this.status,
        mode: "interval",
        round: roundIndex + 1,
        rounds: this.config.rounds,
        phaseIndex,
        phase,
        next,
        remainingSeconds: Math.ceil(phaseRemainingMs / 1000),
        totalRemainingSeconds: Math.ceil((totalMs - elapsedMs) / 1000),
        countdown: phaseRemainingMs <= 3000 ? Math.ceil(phaseRemainingMs / 1000) : null,
        progress: totalMs ? elapsedMs / totalMs : 1,
        segmentKey: `round-${roundIndex + 1}-phase-${phaseIndex}`
      };
    }

    tick(at = this.now()) {
      const snapshot = this.snapshot(at);
      if (snapshot.status === "finished" || snapshot.mode === "finished") {
        if (this.status !== "finished") {
          this.status = "finished";
          this.elapsedBeforeStart = this.summary.totalSeconds * 1000;
          this.onEvent("finish", snapshot);
        }
        return snapshot;
      }

      if (this.lastSegmentKey && snapshot.segmentKey !== this.lastSegmentKey) {
        if (snapshot.mode === "cooldown") this.onEvent("cooldown", snapshot);
        else if (snapshot.round > Number(this.lastSegmentKey.match(/round-(\d+)/)?.[1] || 0)) {
          this.onEvent("round", snapshot);
        } else this.onEvent("phase", snapshot);
      }
      if (snapshot.countdown && snapshot.countdown !== this.lastCountdown) {
        this.onEvent("countdown", snapshot);
      }
      this.lastSegmentKey = snapshot.segmentKey;
      this.lastCountdown = snapshot.countdown;
      return snapshot;
    }
  }

  global.FIT51IntervalTimer = Object.freeze({ normalizeConfig, calculateSummary, validateConfig, getRemainingStages, IntervalEngine });
})(window);
