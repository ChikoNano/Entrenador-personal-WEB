(function(ns){
  "use strict";
  const DEMO=new Set(["admin@test.com","usuario@test.com"]);
  const fixed=["users","exerciseLibrary","userAssignments","completedExercises"];
  const read=key=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
  const snapshot=()=>{const data={exportedAt:new Date().toISOString(),origin:location.origin,items:{}};for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);data.items[k]=localStorage.getItem(k);}return data;};
  const download=(value,name,type="application/json")=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([typeof value==="string"?value:JSON.stringify(value,null,2)],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  const isoDate=v=>{if(!v)return null;const d=new Date(v);return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);};
  function detectLegacyData(){const keys=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(fixed.includes(k)||/^(profile|questionnaire|profilePhoto)_/.test(k))keys.push(k);}return{found:keys.length>0,keys:keys.sort(),containsPlaintextPasswords:Object.values(read("users")||{}).some(u=>u?.password)};}
  function buildMigrationPlan(emailToUuid={}){
    const users=read("users")||{}, exercises=read("exerciseLibrary")||[], assignments=read("userAssignments")||{}, completed=read("completedExercises")||{};
    const plan={createdAt:new Date().toISOString(),profiles:[],assessments:[],subscriptions:[],exercises:[],routines:[],completions:[],avatars:[],skipped:[],warnings:[]};
    for(const[email,legacy]of Object.entries(users)){
      if(DEMO.has(email)){plan.skipped.push({type:"user",key:email,reason:"usuario demo"});continue;}
      const id=emailToUuid[email];if(!id){plan.skipped.push({type:"user",key:email,reason:"falta UUID de Supabase Auth"});continue;}
      const p=read(`profile_${email}`)||{};plan.profiles.push({id,email,full_name:p.name||legacy.name||"",age:Number(p.age)||null,weight:Number(p.weight)||null,height:Number(p.height)||null,goal:p.goal||null,cooper_distance_km:Number(p.cooperDistance)||null,vam_kmh:Number(p.vamSpeed)||null});
      const q=read(`questionnaire_${email}`);if(q)plan.assessments.push(ns.questionnaires.normalize(q,id));
      const start=isoDate(legacy.createdAt),end=isoDate(legacy.expiresAt),ptype=ns.subscriptions.normalize(legacy.planType);if(start&&end&&ptype)plan.subscriptions.push({user_id:id,plan_type:ptype,start_date:start,expiration_date:end});
      if(read(`profilePhoto_${email}`))plan.avatars.push({user_id:id,key:`profilePhoto_${email}`,status:"manual",reason:"Base64 debe convertirse y subirse por el propietario o una función segura"});
      if(assignments[email])plan.routines.push({user_id:id,legacy:assignments[email],warning:"El legado no contiene semana; requiere elegir week_number antes de ejecutar"});
    }
    plan.exercises=exercises.map(ns.exercises.map);
    for(const[key,value]of Object.entries(completed))if(value)plan.completions.push({legacy_key:key,status:"requires_mapping",reason:"La clave compuesta debe vincularse a routine_exercise_id"});
    if(plan.routines.length)plan.warnings.push("userAssignments está organizado por día y no contiene week_number; no se inventó una semana.");
    if(plan.completions.length)plan.warnings.push("completedExercises usa claves ambiguas con correo; valide cada correspondencia antes de insertar.");
    return plan;
  }
  async function executeMigration(plan,{confirm=false}={}){
    if(!confirm)return ns.fail("La migración requiere { confirm: true } y un respaldo descargado","executeMigration");
    if(!ns.isConfigured())return ns.fail("Supabase no está configurado","executeMigration");
    const report={startedAt:new Date().toISOString(),migrated:[],skipped:[...(plan.skipped||[])],failed:[],warnings:plan.warnings||[]};
    const c=ns.requireClient();
    for(const row of plan.exercises||[]){const r=await c.from("exercises").upsert(row,{onConflict:"legacy_id"});(r.error?report.failed:report.migrated).push(r.error?{type:"exercise",key:row.legacy_id,error:r.error.message}:{type:"exercise",key:row.legacy_id});}
    for(const row of plan.profiles||[]){const r=await c.from("profiles").update(row).eq("id",row.id);(r.error?report.failed:report.migrated).push(r.error?{type:"profile",key:row.email,error:r.error.message}:{type:"profile",key:row.email});}
    for(const row of plan.assessments||[]){const r=await c.from("initial_assessments").upsert(row,{onConflict:"user_id"});(r.error?report.failed:report.migrated).push(r.error?{type:"assessment",key:row.user_id,error:r.error.message}:{type:"assessment",key:row.user_id});}
    const{data:actor,error:actorError}=await c.auth.getUser();
    if(actorError||!actor.user)report.failed.push({type:"subscriptions",error:actorError?.message||"No hay sesión administrativa"});
    else for(const row of plan.subscriptions||[]){const existing=await c.from("subscriptions").select("id").eq("user_id",row.user_id).eq("start_date",row.start_date).eq("expiration_date",row.expiration_date).eq("plan_type",row.plan_type).maybeSingle();if(existing.error){report.failed.push({type:"subscription",key:row.user_id,error:existing.error.message});continue;}if(existing.data){report.skipped.push({type:"subscription",key:row.user_id,reason:"ya existe"});continue;}const r=await c.from("subscriptions").insert({...row,created_by:actor.user.id});(r.error?report.failed:report.migrated).push(r.error?{type:"subscription",key:row.user_id,error:r.error.message}:{type:"subscription",key:row.user_id});}
    report.skipped.push(...(plan.routines||[]).map(x=>({type:"routine",key:x.user_id,reason:x.warning})),...(plan.completions||[]).map(x=>({type:"completion",key:x.legacy_key,reason:x.reason})),...(plan.avatars||[]));
    report.finishedAt=new Date().toISOString();report.safeToDeleteLocalStorage=false;return ns.ok(report);
  }
  ns.migration={detectLegacyData,createBackup(){const data=snapshot();download(data,`entrenador-backup-${Date.now()}.json`);return data;},buildMigrationPlan,executeMigration,exportReport(report){download(report,`informe-migracion-${Date.now()}.json`);}};
})(window.TrainerSupabase);
