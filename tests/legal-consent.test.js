const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const schema = fs.readFileSync(path.join(root, "supabase", "schema.sql"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase", "legal-consents-v1.sql"), "utf8");
const privacy = fs.readFileSync(path.join(root, "legal", "aviso-privacidad-v1.0.txt"), "utf8");
const terms = fs.readFileSync(path.join(root, "legal", "terminos-condiciones-v1.0.txt"), "utf8");

test("la pantalla legal contiene las tres aceptaciones exactas y desmarcadas", () => {
  assert.match(html, /id="privacyNoticeAccepted" type="checkbox"/);
  assert.match(html, /id="termsAccepted" type="checkbox"/);
  assert.match(html, /id="sensitiveDataConsent" type="checkbox"/);
  assert.doesNotMatch(html, /id="(?:privacyNoticeAccepted|termsAccepted|sensitiveDataConsent)"[^>]*checked/);
  assert.match(html, /PRIVACIDAD, TÉRMINOS Y CONSENTIMIENTO/);
  assert.match(html, /ACEPTAR Y FINALIZAR/);
});

test("el botón legal exige exactamente las tres casillas", () => {
  const start = app.indexOf("function updateLegalConsentButtonState");
  const end = app.indexOf("async function openLegalDocument", start);
  const elements = Object.fromEntries([
    "privacyNoticeAccepted", "termsAccepted", "sensitiveDataConsent", "btnAcceptLegal"
  ].map(id => [id, { checked: false, disabled: false }]));
  const context = { isAssessmentSubmitting: false, $: id => elements[id] };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context);
  assert.equal(context.updateLegalConsentButtonState(), false);
  assert.equal(elements.btnAcceptLegal.disabled, true);
  elements.privacyNoticeAccepted.checked = true;
  assert.equal(context.updateLegalConsentButtonState(), false);
  assert.equal(elements.btnAcceptLegal.disabled, true);
  elements.termsAccepted.checked = true;
  assert.equal(context.updateLegalConsentButtonState(), false);
  assert.equal(elements.btnAcceptLegal.disabled, true);
  elements.sensitiveDataConsent.checked = true;
  assert.equal(context.updateLegalConsentButtonState(), true);
  assert.equal(elements.btnAcceptLegal.disabled, false);
  elements.termsAccepted.checked = false;
  assert.equal(context.updateLegalConsentButtonState(), false);
  assert.equal(elements.btnAcceptLegal.disabled, true);
});

test("los documentos internos están completos y conservan el marcador literal", () => {
  assert.match(privacy, /^AVISO DE PRIVACIDAD INTEGRAL/);
  assert.match(privacy, /\[DOMICILIO QUE SE DETERMINE PARA EFECTOS DEL PRESENTE AVISO\]/);
  assert.match(privacy, /Fecha de entrada en vigor: 27 de agosto 2026/);
  assert.match(terms, /^TÉRMINOS Y CONDICIONES DE USO/);
  assert.match(terms, /CONSENTIMIENTO Y DECLARACIÓN DEL USUARIO/);
  assert.match(terms, /Al seleccionar el botón “ACEPTAR Y FINALIZAR”/);
  assert.ok(privacy.length > 7000);
  assert.ok(terms.length > 9500);
});

test("los documentos se abren dentro de FIT51 y el modal es responsive", () => {
  assert.match(app, /legal\/aviso-privacidad-v1\.0\.txt/);
  assert.match(app, /legal\/terminos-condiciones-v1\.0\.txt/);
  assert.match(app, /content\.textContent = await response\.text\(\)/);
  assert.match(css, /\.legal-document-content[\s\S]*overflow: auto/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.legal-document-panel/);
});

test("el esquema registra UUID, tres aceptaciones, versiones y timestamp de servidor", () => {
  for (const sql of [schema, migration]) {
    assert.match(sql, /create table if not exists public\.legal_consents/);
    assert.match(sql, /user_id uuid not null references public\.profiles\(id\)/);
    assert.match(sql, /privacy_notice_accepted boolean not null/);
    assert.match(sql, /terms_accepted boolean not null/);
    assert.match(sql, /sensitive_data_consent boolean not null/);
    assert.match(sql, /legal_accepted_at timestamptz not null default now\(\)/);
  }
});

test("RLS limita inserción al UUID autenticado y conserva lectura administrativa", () => {
  assert.match(migration, /alter table public\.legal_consents enable row level security/);
  assert.match(migration, /user_id=auth\.uid\(\)/);
  assert.match(migration, /public\.can_manage_user\(user_id\)/);
  assert.match(migration, /and privacy_notice_accepted[\s\S]*and terms_accepted[\s\S]*and sensitive_data_consent/);
});

test("el versionado vigente es central y una versión diferente exige nueva fila", () => {
  assert.match(app, /privacyNotice: "1\.0"/);
  assert.match(app, /terms: "1\.0"/);
  assert.match(schema, /primary key \(user_id, privacy_notice_version, terms_version\)/);
  assert.match(app, /status: ASSESSMENT_STATUS\.LEGAL_REQUIRED/);
});

test("el flujo guarda consentimiento antes de completar evaluación y navegar", () => {
  const consent = app.indexOf("acceptCurrentConsent(");
  const assessment = app.indexOf("questionnaires.saveAssessment(", consent);
  const dashboard = app.indexOf('goToPage("dashboardPage")', assessment);
  assert.ok(consent > 0 && assessment > consent && dashboard > assessment);
  assert.match(app, /if \(consentResult\.error\) throw/);
  assert.match(app, /if \(assessmentResult\.error\) throw/);
  assert.match(app, /isAssessmentSubmitting = true/);
});

test("regresión integrada: siete preguntas conducen al consentimiento sin completar ni navegar", async () => {
  const start = app.indexOf("async function nextSlide");
  const end = app.indexOf("async function acceptLegalConsentAndFinish", start);
  const pages = [];
  let legalScreenCalls = 0;
  let assessmentWrites = 0;
  const context = {
    currentSlide: 0,
    document: { querySelectorAll: () => Array.from({ length: 7 }, () => ({})) },
    validateCurrentAssessmentSlide: () => true,
    showSlide() {},
    showLegalConsentScreen: completed => {
      assert.equal(completed, false);
      legalScreenCalls += 1;
    },
    localStorage: { getItem: () => "usuario@fit51.test" },
    alert() {},
    saveAssessmentResponses: () => { assessmentWrites += 1; },
    goToPage: page => pages.push(page),
    window: {
      TrainerSupabase: {
        questionnaires: { saveAssessment: () => { assessmentWrites += 1; } }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context);

  for (let question = 1; question <= 7; question += 1) {
    await context.nextSlide();
  }

  assert.equal(context.currentSlide, 6);
  assert.equal(legalScreenCalls, 1);
  assert.equal(assessmentWrites, 0);
  assert.deepEqual(pages, []);
});

test("producción invalida el bundle anterior del flujo de cuestionario", () => {
  assert.match(html, /styles\.css\?v=20260911-session-ux/);
  assert.match(html, /app\.js\?v=20260911-session-ux/);
  assert.doesNotMatch(html, /(?:styles\.css|app\.js)\?v=20260731/);
});

test("los checkbox legales no heredan el ancho completo de los inputs globales", () => {
  assert.match(css, /\.legal-consent-options input\[type="checkbox"\]\s*\{[\s\S]*?flex:\s*0 0 22px/);
  assert.match(css, /\.legal-consent-options input\[type="checkbox"\]\s*\{[\s\S]*?width:\s*22px/);
  assert.match(css, /\.legal-consent-options input\[type="checkbox"\]\s*\{[\s\S]*?min-height:\s*22px/);
  assert.match(css, /\.legal-consent-options label\s*\{[\s\S]*?width:\s*100%/);
  assert.match(css, /\.legal-consent-options label > span\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(css, /\.legal-consent-options label > span\s*\{[\s\S]*?white-space:\s*normal/);
  assert.match(css, /\.legal-consent-options label > span\s*\{[\s\S]*?word-break:\s*normal/);
});

test("el botón legal disabled tiene apariencia neutral y no conserva interacción activa", () => {
  assert.match(css, /#btnAcceptLegal:disabled\s*\{[\s\S]*?background:\s*#d7dbe1/);
  assert.match(css, /#btnAcceptLegal:disabled\s*\{[\s\S]*?cursor:\s*not-allowed/);
  assert.match(css, /#btnAcceptLegal:disabled\s*\{[\s\S]*?box-shadow:\s*none/);
  assert.match(css, /#btnAcceptLegal:disabled:hover,[\s\S]*?#btnAcceptLegal:disabled:active/);
  assert.match(css, /#btnAcceptLegal:disabled::after\s*\{[\s\S]*?display:\s*none/);
});

test("la evidencia legal no depende de localStorage ni usa timestamp cliente", () => {
  const service = fs.readFileSync(path.join(root, "js", "supabase-legal.js"), "utf8");
  assert.doesNotMatch(service, /localStorage/);
  assert.doesNotMatch(service, /legal_accepted_at\s*:/);
  assert.match(service, /privacy_notice_version: versions\.privacyNotice/);
  assert.match(service, /terms_version: versions\.terms/);
});
