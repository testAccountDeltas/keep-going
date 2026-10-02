// keep-going — плагин opencode v2 (авто-продолжение незавершённых задач).
// Когда ход завершается (session.execution.succeeded), но задача не закончена,
// автоматически отправляет "continue". Работает ЛОКАЛЬНО в opencode: модель/сервер agy
// не меняются — просто инициируется следующий ход, как будто ты написал "продолжай".
//
// Остановка и защита от слива токенов:
//   - не больше MAX авто-продолжений ПОДРЯД на сессию (сброс, когда ты сам пишешь сообщение);
//   - кулдаун между авто-продолжениями;
//   - если модель ответила ровно DONE (её просят об этом) — авто-продолжение прекращается;
//   - если последний текст кончается вопросом "?" — не вмешивается (ждёт твоего ответа).
//
// Настройки (env): OPENCODE_AUTOCONT_MAX (по умолч. 5), OPENCODE_AUTOCONT_COOLDOWN_MS (8000),
//                  OPENCODE_AUTOCONT_DEBUG=1 — писать лог действий в plugin/_keep-going.log.

const MAX = Number(process.env.OPENCODE_AUTOCONT_MAX ?? 5);
const COOLDOWN = Number(process.env.OPENCODE_AUTOCONT_COOLDOWN_MS ?? 8000);
const DEBUG = process.env.OPENCODE_AUTOCONT_DEBUG === "1";
const NUDGE = process.env.OPENCODE_AUTOCONT_NUDGE ||
  "[AUTO-CONTINUE] Продолжай выполнение задачи с места, где остановился. " +
  "Если задача ПОЛНОСТЬЮ выполнена и проверена (сверь с роадмапом/todo) — ответь ровно одним словом: DONE. " +
  "Если тебе нужно моё решение, которое нельзя вывести из контекста — задай конкретный вопрос. " +
  "Иначе не останавливайся после одного шага, продолжай до результата.";

export default {
  id: "keep-going",
  async setup(ctx) {
    if (!ctx.event?.subscribe || !ctx.session?.prompt) return {};
    let logf = null;
    if (DEBUG) { try { const fs = await import("node:fs"); const os = await import("node:os"); const p = os.homedir() + "/.config/opencode/plugin/_keep-going.log"; logf = (m) => { try { fs.appendFileSync(p, new Date().toISOString() + " " + m + "\n"); } catch {} }; logf("started max=" + MAX + " cooldown=" + COOLDOWN); } catch {} }
    const log = (m) => { if (logf) logf(m); };

    const count = new Map();   // sessionID -> авто-продолжений подряд
    const lastAt = new Map();  // sessionID -> время последнего
    const mine = new Map();    // sessionID -> следующее user-сообщение наше (не сбрасывать)
    const buf = new Map();     // sessionID -> накопленный текст текущего хода
    const lastText = new Map();// sessionID -> текст последнего завершённого хода

    async function onDone(sid) {
      if (!sid) return;
      const now = Date.now();
      const n = count.get(sid) ?? 0;
      const t = (lastText.get(sid) || "").trim();
      if (/(^|\s)DONE\.?\s*$/i.test(t) || /^DONE\b/i.test(t)) { count.set(sid, MAX); log("DONE -> stop"); return; }
      if (/\?\s*$/.test(t)) { log("question -> skip"); return; }
      if (n >= MAX) { log("cap reached"); return; }
      if (now - (lastAt.get(sid) ?? 0) < COOLDOWN) { log("cooldown"); return; }
      count.set(sid, n + 1); lastAt.set(sid, now); mine.set(sid, true);
      log("nudge #" + (n + 1) + " " + sid);
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
            switch (ev.type) {
              case "session.text.delta":
                if (sid) buf.set(sid, (buf.get(sid) || "") + (d.delta || d.text || ""));
                break;
              case "session.execution.started":
                // ход начал пользователь (не наш nudge) -> сброс счётчика; буфер текста очищаем
                if (sid) { if (mine.get(sid)) mine.set(sid, false); else count.set(sid, 0); buf.set(sid, ""); }
                break;
              case "session.execution.succeeded":
                if (sid) { lastText.set(sid, buf.get(sid) || ""); buf.set(sid, ""); await onDone(sid); }
                break;
            }
          } catch (e) { log("ev err " + e.message); }
        }
      } catch (e) { log("loop err " + e.message); }
    })();
    return {};
  },
};
