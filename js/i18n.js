/* =========================================================================
   i18n.js — localization. Translates the app chrome (nav, quiz/resources
   headings, landing cards, settings) and lets lessons ship translations.
   Ships English, Spanish and Portuguese; lessons default to English and fall
   back gracefully. Language is persisted and a change re-renders the view.
   Exposes window.I18n. A lesson translation registers via:
       registerLessonI18n("lesson-id", "es", "# título…")
   ========================================================================= */
(function () {
  "use strict";

  var LOCALES = { en: "English", es: "Español", pt: "Português" };

  var DICT = {
    en: {
      nav_prev: "Previous", nav_next: "Next", nav_start: "You're at the start",
      nav_end: "🎉 End of course", nav_mark: "Mark complete & continue →",
      nav_done: "✓ Completed — click to unmark",
      quiz_heading: "📝 Knowledge check", quiz_answer_all: "Answer all the questions to see your score.",
      quiz_scored: "You scored", res_heading: "📚 Further reading",
      ref_review: "Review", ref_review_sub: "Spaced-repetition flashcards",
      ref_radar: "Progress", ref_radar_sub: "Your skills radar",
      ref_guides: "Study guides", ref_guides_sub: "Printable revision sheets",
      ref_glossary: "Glossary", ref_glossary_sub: "Every key term, defined",
      ref_cheats: "API Cheat-sheets", ref_cheats_sub: "Quick reference for core modules",
      ref_cert: "Certificate", set_language: "Language", set_theme: "Theme"
    },
    es: {
      nav_prev: "Anterior", nav_next: "Siguiente", nav_start: "Estás al principio",
      nav_end: "🎉 Fin del curso", nav_mark: "Marcar como completado y continuar →",
      nav_done: "✓ Completado — clic para desmarcar",
      quiz_heading: "📝 Comprueba lo aprendido", quiz_answer_all: "Responde todas las preguntas para ver tu puntuación.",
      quiz_scored: "Tu puntuación es", res_heading: "📚 Lecturas adicionales",
      ref_review: "Repaso", ref_review_sub: "Tarjetas de repetición espaciada",
      ref_radar: "Progreso", ref_radar_sub: "Tu radar de habilidades",
      ref_guides: "Guías de estudio", ref_guides_sub: "Hojas de repaso imprimibles",
      ref_glossary: "Glosario", ref_glossary_sub: "Cada término clave, definido",
      ref_cheats: "Chuletas de API", ref_cheats_sub: "Referencia rápida de módulos",
      ref_cert: "Certificado", set_language: "Idioma", set_theme: "Tema"
    },
    pt: {
      nav_prev: "Anterior", nav_next: "Próximo", nav_start: "Você está no início",
      nav_end: "🎉 Fim do curso", nav_mark: "Marcar como concluído e continuar →",
      nav_done: "✓ Concluído — clique para desmarcar",
      quiz_heading: "📝 Teste seus conhecimentos", quiz_answer_all: "Responda todas as perguntas para ver sua pontuação.",
      quiz_scored: "Você acertou", res_heading: "📚 Leitura adicional",
      ref_review: "Revisão", ref_review_sub: "Cartões de repetição espaçada",
      ref_radar: "Progresso", ref_radar_sub: "Seu radar de habilidades",
      ref_guides: "Guias de estudo", ref_guides_sub: "Fichas de revisão para imprimir",
      ref_glossary: "Glossário", ref_glossary_sub: "Cada termo-chave, definido",
      ref_cheats: "Referências de API", ref_cheats_sub: "Referência rápida dos módulos",
      ref_cert: "Certificado", set_language: "Idioma", set_theme: "Tema"
    }
  };

  var KEY = "ultimate-node-course:locale";
  var listeners = [];
  var lessonI18n = {}; // lessonId -> { locale -> markdown }
  var loadedI18n = {}; // "<locale>/<moduleId>" -> true

  window.registerLessonI18n = function (lessonId, locale, markdown) {
    (lessonI18n[lessonId] = lessonI18n[lessonId] || {})[locale] = markdown;
  };
  // Same, but the markdown lives inside a function comment (no escaping needed).
  window.registerLessonI18nSrc = function (lessonId, locale, fn) {
    var s = String(fn), a = s.indexOf("/*"), b = s.lastIndexOf("*/");
    var body = (a !== -1 && b > a) ? s.slice(a + 2, b) : "";
    window.registerLessonI18n(lessonId, locale, body.replace(/^\r?\n/, ""));
  };

  function get() {
    var l;
    try { l = localStorage.getItem(KEY); } catch (e) {}
    return l && DICT[l] ? l : "en";
  }

  var I18n = {
    locales: LOCALES,
    get: get,
    set: function (locale) {
      if (!DICT[locale]) return;
      try { localStorage.setItem(KEY, locale); } catch (e) {}
      document.documentElement.setAttribute("lang", locale);
      listeners.forEach(function (fn) { try { fn(locale); } catch (e) {} });
    },
    t: function (key) {
      var l = get();
      return (DICT[l] && DICT[l][key]) || DICT.en[key] || key;
    },
    onChange: function (fn) { listeners.push(fn); },
    // Returns a translated lesson markdown for the current locale, or null.
    lessonMarkdown: function (lessonId) {
      var l = get();
      return (l !== "en" && lessonI18n[lessonId] && lessonI18n[lessonId][l]) || null;
    },
    hasLessonTranslation: function (lessonId) {
      var l = get();
      return l !== "en" && !!(lessonI18n[lessonId] && lessonI18n[lessonId][l]);
    },
    // Lazily load a module's translation file for the current locale (if any).
    loadModule: function (moduleId) {
      var l = get();
      if (l === "en") return Promise.resolve();
      var k = l + "/" + moduleId;
      if (loadedI18n[k]) return Promise.resolve();
      return new Promise(function (resolve) {
        var s = document.createElement("script");
        s.src = "content/i18n/" + l + "/" + moduleId + ".js";
        s.onload = function () { loadedI18n[k] = true; resolve(); };
        s.onerror = function () { loadedI18n[k] = true; resolve(); }; // no translation = English
        document.head.appendChild(s);
      });
    }
  };

  document.documentElement.setAttribute("lang", get());
  window.I18n = I18n;
})();
