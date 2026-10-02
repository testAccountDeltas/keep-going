// keep-going — плагин opencode v2.
// Авто-продолжает сессию, ТОЛЬКО если ход реально делал работу инструментами
// (session.tool.*). Чистый текстовый ответ (разговор, «что умеешь») не трогается.
// Работает локально: модель/провайдер agy не меняются.
//
// Остановка/защита: не больше MAX продолжений подряд (сброс при твоём ходе),
// кулдаун, стоп если модель ответила DONE или задала вопрос.
// env: OPENCODE_AUTOCONT_MAX (5), OPENCODE_AUTOCONT_COOLDOWN_MS (8000),
//      OPENCODE_AUTOCONT_NUDGE, OPENCODE_AUTOCONT_DEBUG=1.

const MAX = Number(process.env.OPENCODE_AUTOCONT_MAX ?? 5);
const COOLDOWN = Number(process.env.OPENCODE_AUTOCONT_COOLDOWN_MS ?? 8000);
const DEBUG = process.env.OPENCODE_AUTOCONT_DEBUG === "1";
const NUDGE = process.env.OPENCODE_AUTOCONT_NUDGE || "Продолжай. Если задача полностью готова — ответь одним словом: DONE. Если нужен мой ответ — задай вопрос.";

let STARTED = false;

export default {
  id: "keep-going",
  async setup(ctx) {
    if (STARTED) return {};
    STARTED = true;
    if (!ctx.event?.subscribe || !ctx.session?.prompt) return {};
    let log = () => {};
    if (DEBUG) { try { const fs = await import("node:fs"); const os = await import("node:os"); const p = os.homedir() + "/.config/opencode/plugin/_keep-going.log"; log = (m) => { try { fs.appendFileSync(p, new Date().toISOString() + " " + m + "\n"); } catch {} }; log("started max=" + MAX); } catch {} }

    const count = new Map();     // авто-продолжений подряд
    const lastAt = new Map();    // время последнего
    const mine = new Map();      // следующий ход — наш (не сбрасывать счётчик)
    const worked = new Map();    // в текущем ходе был вызов инструмента
    const buf = new Map();       // текст текущего хода
    const lastText = new Map();  // текст прошлого хода

    async function onDone(sid) {
      if (!sid) return;
      if (!worked.get(sid)) { log("no tools -> skip (разговор)"); return; } // главный гейт
      const now = Date.now(), n = count.get(sid) ?? 0;
      const t = (lastText.get(sid) || "").trim();
      if (/(^|\s)DONE\.?\s*$/i.test(t) || /^DONE\b/i.test(t)) { count.set(sid, MAX); log("DONE -> stop"); return; }
      if (/\?\s*$/.test(t)) { log("question -> skip"); return; }
      if (n >= MAX) { log("cap"); return; }
      if (now - (lastAt.get(sid) ?? 0) < COOLDOWN) { log("cooldown"); return; }
      count.set(sid, n + 1); lastAt.set(sid, now); mine.set(sid, true);
      log("nudge #" + (n + 1));
      try { const r = ctx.session.prompt({ sessionID: sid, text: NUDGE }); if (r?.then) await r; }
      catch (e) { log("send err " + e.message); }
    }

    (async () => {
      try {
        const sub = await ctx.event.subscribe();
        for await (const ev of (sub.stream ?? sub)) {
          try {
            const d = ev.data || {};
            const sid = d.sessionID || ev.durable?.aggregateID;
            if (!sid && !String(ev.type).startsWith("session.")) continue;
            if (ev.type === "session.execution.started") {
              if (sid) { if (mine.get(sid)) mine.set(sid, false); else count.set(sid, 0); worked.set(sid, false); buf.set(sid, ""); }
            } else if (ev.type.startsWith("session.tool.")) {
              if (sid) worked.set(sid, true);
            } else if (ev.type === "session.text.delta") {
              if (sid) buf.set(sid, (buf.get(sid) || "") + (d.delta || d.text || ""));
            } else if (ev.type === "session.execution.succeeded") {
              if (sid) { lastText.set(sid, buf.get(sid) || ""); await onDone(sid); }
            }
          } catch (e) { log("ev " + e.message); }
        }
      } catch (e) { log("loop " + e.message); }
    })();
    return {};
  },
};
