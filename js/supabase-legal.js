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

  function validateVersions(versions) {
    return Boolean(versions?.privacyNotice && versions?.terms);
  }

  ns.legal = {
    getCurrentConsent(userId, versions) {
      if (!userId || !validateVersions(versions)) {
        return Promise.resolve(ns.fail("Datos legales incompletos", "getCurrentConsent"));
      }
      return run("getCurrentConsent", client => client
        .from("legal_consents")
        .select("user_id,privacy_notice_accepted,terms_accepted,sensitive_data_consent,privacy_notice_version,terms_version,legal_accepted_at")
        .eq("user_id", userId)
        .eq("privacy_notice_version", versions.privacyNotice)
        .eq("terms_version", versions.terms)
        .eq("privacy_notice_accepted", true)
        .eq("terms_accepted", true)
        .eq("sensitive_data_consent", true)
        .maybeSingle());
    },

    async acceptCurrentConsent(userId, versions) {
      if (!userId || !validateVersions(versions)) {
        return ns.fail("Datos legales incompletos", "acceptCurrentConsent");
      }

      const existing = await this.getCurrentConsent(userId, versions);
      if (existing.error || existing.data) return existing;

      return run("acceptCurrentConsent", client => client
        .from("legal_consents")
        .insert({
          user_id: userId,
          privacy_notice_accepted: true,
          terms_accepted: true,
          sensitive_data_consent: true,
          privacy_notice_version: versions.privacyNotice,
          terms_version: versions.terms
        })
        .select("user_id,privacy_notice_accepted,terms_accepted,sensitive_data_consent,privacy_notice_version,terms_version,legal_accepted_at")
        .single());
    }
  };
})(window.TrainerSupabase);
