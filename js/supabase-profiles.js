(function (ns) {
  "use strict";
  const ownFields = ["full_name","phone","age","weight","height","goal","cooper_distance_km","vam_kmh","avatar_path"];
  const clean = (input, fields) => Object.fromEntries(fields.filter(k => input[k] !== undefined).map(k => [k, input[k] === "" ? null : input[k]]));
  const run = async (context, op) => { try { const { data, error } = await op(ns.requireClient()); return error ? ns.fail(error, context) : ns.ok(data); } catch(e) { return ns.fail(e, context); } };
  ns.profiles = {
    getOwnProfile: () => run("getOwnProfile", async c => { const { data: u, error } = await c.auth.getUser(); if (error) return { data:null, error }; return c.from("profiles").select("*").eq("id",u.user.id).single(); }),
    getProfile(userId) { if (!userId) return Promise.resolve(ns.fail("ID obligatorio", "getProfile")); return run("getProfile", c => c.from("profiles").select("*").eq("id", userId).maybeSingle()); },
    updateOwnProfile(values) { return run("updateOwnProfile", async c => { const { data: u } = await c.auth.getUser(); return c.from("profiles").update(clean(values, ownFields)).eq("id", u.user.id).select().single(); }); },
    getClients: () => run("getClients", c => c.from("profiles").select("*").eq("role","user").order("full_name")),
    updateClient(id, values) { if (!id) return Promise.resolve(ns.fail("ID obligatorio", "updateClient")); return run("updateClient", c => c.from("profiles").update(clean(values, ownFields.concat(["trainer_id","active"]))).eq("id",id).select().single()); }
  };
})(window.TrainerSupabase);
