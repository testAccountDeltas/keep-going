// keep-going — автодожим «оборванного» хода.
//
// Главная причина обрывов (подтверждено по opencode.db): Gemini отдаёт битый
// function-call, провайдер возвращает finishReason=MALFORMED_FUNCTION_CALL,
// opencode мапит его в finish="stop" → ход завершается с одним reasoning и
// нулевым output. Пользователю приходится вручную писать «Продолжай».
//
// Здесь мы ловим это по событию session.step.ended (в нём есть rawFinish)
// и сами отправляем короткий промпт-пинок.
//
// Env:
//   OPENCODE_KG_OFF=1        — выключить
//   OPENCODE_KG_MAX=5        — максимум автодожимов подряд на сессию
//   OPENCODE_KG_COOLDOWN_MS  — пауза между ними (по умолчанию 6000)
//   OPENCODE_KG_TEXT         — текст пинка (по умолчанию "continue")
//   OPENCODE_KG_QUIET=1      — не писать лог
const MAX = Number(process.env.OPENCODE_KG_MAX ?? 5);
const COOLDOWN = Number(process.env.OPENCODE_KG_COOLDOWN_MS ?? 6000);
const RETRY_TEXT = process.env.OPENCODE_KG_TEXT ?? "continue";
const BAD = new Set(["malformed_function_call", "prohibited_content", "unexpected_tool_call"]);
// Плагин инстанцируется дважды (две загрузки модуля) и перезагружается на лету при
// правке файла. Поколение в globalThis: живым остаётся только последний инстанс —
// иначе на один обрыв ушло бы два "continue", а hot-reload не применялся бы.
const GEN = "__opencode_keep_going_gen__";

export default {
  id: "keep-going",
  async setup(ctx) {
    if (process.env.OPENCODE_KG_OFF === "1") return {};
    const myGen = (globalThis[GEN] = (globalThis[GEN] ?? 0) + 1);
    if (!ctx.event?.subscribe || !ctx.session?.prompt) return {};

    const fs = await import("node:fs");
    const os = await import("node:os");
    const LOG = os.homedir() + "/.config/opencode/plugin/_keep-going.log";
    const QUIET = process.env.OPENCODE_KG_QUIET === "1";
    const log = QUIET ? () => {} : (m) => {
      try { fs.appendFileSync(LOG, new Date().toISOString().slice(0, 19).replace("T", " ") + " " + m + "\n"); } catch {}
    };
    try { if ((fs.statSync(LOG).size || 0) > 200000) fs.writeFileSync(LOG, ""); } catch {}
    log("=== keep-going started (gen " + myGen + ", max=" + MAX + ") ===");

    const broken = new Map();   // sid -> последняя плохая причина в текущем прогоне
    const produced = new Map(); // sid -> дал ли ПОСЛЕДНИЙ шаг текст/успешный тул
    const count = new Map();    // sid -> сколько автодожимов подряд
    const lastAt = new Map();

    async function kick(sid) {
      try {
        const r = ctx.session.prompt({ sessionID: sid, text: RETRY_TEXT });
        if (r && r.then) await r;
        log("kick sent -> " + sid);
      } catch (e) { log("kick failed: " + e.message); }
    }

    async function onEnd(sid) {
      if (!sid) return;
      const why = broken.get(sid);
      broken.delete(sid);
      if (!why) { count.set(sid, 0); return; }          // ход завершился нормально
      if (produced.get(sid)) { count.set(sid, 0); log("bad=" + why + " но шаг что-то дал — не дожимаем"); return; }
      const n = count.get(sid) ?? 0;
      if (n >= MAX) { log("cap " + MAX + " reached, stop"); return; }
      const now = Date.now();
      if (now - (lastAt.get(sid) ?? 0) < COOLDOWN) { log("cooldown"); return; }
      count.set(sid, n + 1); lastAt.set(sid, now);
      log("BROKEN (" + why + ") -> auto-continue #" + (n + 1));
      await kick(sid);
    }

    (async () => {
      try {
        const sub = await ctx.event.subscribe();
        for await (const ev of (sub.stream ?? sub)) {
          if (globalThis[GEN] !== myGen) { log("superseded by gen " + globalThis[GEN] + ", exit"); return; }
          try {
            const d = ev.data || {};
            const sid = d.sessionID || ev.durable?.aggregateID;
            switch (ev.type) {
              case "session.execution.started":
              case "session.step.started":
                // produced считаем ПО ШАГУ: ход мог сделать 3 удачных тула,
                // а последний шаг всё равно умер на битом function-call.
                if (sid) { broken.delete(sid); produced.set(sid, false); }
                break;
              case "session.text.delta":
                if (sid && (d.delta || d.text)) produced.set(sid, true);
                break;
              case "session.tool.success":
                if (sid) produced.set(sid, true);
                break;
              case "session.step.failed": {
                // транспортные обрывы CliRelay: "stream ended without finish_reason"
                const msg = String(d.error?.data?.message ?? d.error?.message ?? "");
                if (sid && /without finish_reason|GOAWAY|ECONNRESET|socket hang up|premature close/i.test(msg)) {
                  broken.set(sid, "stream-truncated"); log("step.failed: " + msg.slice(0, 120));
                }
                break;
              }
              case "session.step.ended": {
                const raw = String(d.rawFinish ?? "").toLowerCase();
                if (sid && BAD.has(raw)) { broken.set(sid, raw); log("step.ended rawFinish=" + raw); }
                break;
              }
              case "session.execution.succeeded":
              case "session.execution.failed":
                await onEnd(sid);
                break;
            }
          } catch (e) { log("ev err " + e.message); }
        }
      } catch (e) { log("loop err " + e.message); }
    })();

    return {};
  },
};
