(function (ns) {
  "use strict";
  const numberOrNull = value => { if(value === "" || value == null) return null; const match=String(value).match(/\d+(?:[.,]\d+)?/); return match ? Number(match[0].replace(",",".")) : null; };
  const normalize = (v, userId) => { const rawInjury=v.hasInjury ?? v.has_injury; const injury=typeof rawInjury==="string"?/^(sí|si|true)$/i.test(rawInjury):rawInjury??null; return { user_id:userId, goal:v.goal ?? v.objetivo ?? null, previous_training:v.previousTraining ?? v.previous_training ?? null, training_days:numberOrNull(v.trainingDays ?? v.training_days), session_duration:numberOrNull(v.sessionDuration ?? v.session_duration), gym_experience:v.gymExperience ?? v.gym_experience ?? null, physical_activity:v.physicalActivity ?? v.physical_activity ?? null, has_injury:injury, injury_description:injury?(v.injuryDescription ?? v.injury_description ?? null):null, completed:Boolean(v.completed), completed_at:v.completed ? (v.completedAt ?? v.completed_at ?? new Date().toISOString()) : null }; };
  const run=async(context,op)=>{try{const{data,error}=await op(ns.requireClient());return error?ns.fail(error,context):ns.ok(data);}catch(e){return ns.fail(e,context);}};
  ns.questionnaires={
    getAssessment(userId){if(!userId)return Promise.resolve(ns.fail("ID obligatorio","getAssessment"));return run("getAssessment",c=>c.from("initial_assessments").select("*").eq("user_id",userId).maybeSingle());},
    saveAssessment(userId,values){if(!userId||!values)return Promise.resolve(ns.fail("Datos incompletos","saveAssessment"));return run("saveAssessment",c=>c.from("initial_assessments").upsert(normalize(values,userId),{onConflict:"user_id"}).select().single());}, normalize
  };
})(window.TrainerSupabase);
