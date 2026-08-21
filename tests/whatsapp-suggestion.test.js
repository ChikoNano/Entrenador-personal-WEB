const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const constantStart = source.indexOf("const TRAINER_WHATSAPP_NUMBER");
const constantEnd = source.indexOf(";", constantStart) + 1;
const suggestionStart = source.indexOf("function sendProfileSuggestionByWhatsApp");
const suggestionEnd = source.indexOf("function getPanelUsers", suggestionStart);
const therapyStart = source.indexOf("function contactTherapy");
const therapyEnd = source.indexOf("/* INICIO */", therapyStart);
const whatsappSource = [
  source.slice(constantStart, constantEnd),
  source.slice(suggestionStart, suggestionEnd),
  source.slice(therapyStart, therapyEnd)
].join("\n");

function createContext(userAgent = "Android") {
  const opened = [];
  const alerts = [];
  const context = {
    currentSupabaseProfile: { full_name: "Cliente Real", user_number: 27 },
    navigator: { userAgent },
    alert: message => alerts.push(message),
    window: {
      open: (...args) => opened.push(args)
    }
  };
  vm.createContext(context);
  vm.runInContext(whatsappSource, context);
  return { context, opened, alerts };
}

test("el buzón móvil abre WhatsApp al número oficial con su mensaje prellenado", () => {
  const state = createContext("Android Mobile");
  state.context.sendProfileSuggestionByWhatsApp();

  assert.equal(state.alerts.length, 0);
  assert.equal(state.opened.length, 1);
  const [url, target, features] = state.opened[0];
  assert.match(url, /^https:\/\/wa\.me\/525624774731\?text=/);
  assert.match(decodeURIComponent(url.split("?text=")[1]), /Hola, soy Cliente Real, usuario #27/);
  assert.match(decodeURIComponent(url.split("?text=")[1]), /sugerencia sobre la plataforma/);
  assert.equal(target, "_blank");
  assert.equal(features, "noopener,noreferrer");
});

test("el buzón de escritorio usa el mismo número oficial en WhatsApp Web", () => {
  const state = createContext("Windows NT");
  state.context.sendProfileSuggestionByWhatsApp();
  assert.match(
    state.opened[0][0],
    /^https:\/\/web\.whatsapp\.com\/send\?phone=525624774731&text=/
  );
});

test("Terapias conserva su mensaje y reutiliza el número centralizado", () => {
  const state = createContext();
  state.context.contactTherapy();
  const url = state.opened[0][0];
  assert.match(url, /^https:\/\/wa\.me\/525624774731\?text=/);
  assert.match(decodeURIComponent(url.split("?text=")[1]), /agendar una terapia/);
});
