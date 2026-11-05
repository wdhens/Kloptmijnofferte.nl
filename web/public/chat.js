// Live chat: an AI assistant that answers from our FAQ, with a handover to a human.
// Nothing is stored on the device. The conversation lives only in this page view.
(() => {
  const api = document.documentElement.dataset.api || "";
  const turns = [];
  const opened = Date.now();
  const SUGGESTIONS = ["Hoeveel subsidie krijg ik?", "Wat doen jullie met mijn offerte?", "Hoe lees ik de uitkomst?"];

  const css = `
  .kc-btn{position:fixed;right:16px;bottom:16px;z-index:50;border-radius:999px;padding:12px 18px;box-shadow:0 4px 16px rgba(0,0,0,.18)}
  .kc-panel{position:fixed;right:16px;bottom:16px;z-index:51;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 32px));display:flex;flex-direction:column;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.22);overflow:hidden}
  .kc-panel[hidden]{display:none}
  .kc-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--line)}
  .kc-head b{font-size:1rem}.kc-x{background:none;color:var(--fg);padding:4px 8px;font-size:1.3rem;line-height:1}
  .kc-note{font-size:.8rem;color:var(--muted);padding:8px 14px;border-bottom:1px solid var(--line)}
  .kc-log{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
  .kc-m{max-width:88%;padding:9px 12px;border-radius:12px;white-space:pre-wrap;font-size:.95rem;line-height:1.45}
  .kc-u{align-self:flex-end;background:var(--accent);color:#fff}.kc-a{align-self:flex-start;background:var(--bg);border:1px solid var(--line)}
  .kc-links{font-size:.85rem;margin-top:6px}.kc-links a{color:var(--accent);margin-right:10px}
  .kc-fb{font-size:.8rem;color:var(--muted);margin-top:6px}.kc-fb button{background:none;color:var(--muted);border:1px solid var(--line);padding:2px 8px;margin-left:6px;font-size:.8rem}
  .kc-sug{display:flex;flex-wrap:wrap;gap:6px}.kc-sug button{background:var(--bg);color:var(--fg);border:1px solid var(--line);padding:6px 10px;font-size:.85rem;border-radius:999px}
  .kc-in{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line)}
  .kc-in textarea{flex:1;resize:none;height:44px;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit;font-size:.95rem}
  .kc-in button{padding:10px 14px}
  .kc-form{display:flex;flex-direction:column;gap:8px;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:10px}
  .kc-form input,.kc-form textarea{width:100%;max-width:none;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);font:inherit;font-size:.9rem}
  .kc-hp{position:absolute;left:-9999px}`;
  const style = document.createElement("style"); style.textContent = css; document.head.append(style);

  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const btn = el("button", { className: "kc-btn", type: "button", textContent: "Stel je vraag" });
  btn.setAttribute("aria-haspopup", "dialog");
  const log = el("div", { className: "kc-log" }); log.setAttribute("aria-live", "polite");
  const input = el("textarea", { placeholder: "Typ je vraag", maxLength: 800 }); input.setAttribute("aria-label", "Je vraag");
  const send = el("button", { type: "submit", textContent: "Stuur" });
  const form = el("form", { className: "kc-in" }, input, send);
  const close = el("button", { className: "kc-x", type: "button", textContent: "×" }); close.setAttribute("aria-label", "Sluit chat");
  const panel = el("div", { className: "kc-panel", hidden: true },
    el("div", { className: "kc-head" }, el("b", { textContent: "Vragen over je offerte" }), close),
    el("div", { className: "kc-note", textContent: "Je praat met een AI-assistent die antwoordt uit onze uitleg. Deel geen namen, adressen of telefoonnummers. We bewaren dit gesprek niet." }),
    log, form);
  panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Chat");
  document.body.append(btn, panel);

  const scroll = () => { log.scrollTop = log.scrollHeight; };
  const say = (role, text) => { const m = el("div", { className: `kc-m kc-${role === "user" ? "u" : "a"}`, textContent: text }); log.append(m); scroll(); return m; };

  const linksFor = (sources) => {
    const seen = new Set(), links = [];
    for (const s of sources || []) for (const l of s.links || []) if (!seen.has(l.href)) { seen.add(l.href); links.push(l); }
    if (!links.length) return null;
    return el("div", { className: "kc-links" }, ...links.slice(0, 3).map((l) => {
      const a = el("a", { href: l.href, textContent: l.label });
      if (/^https?:/.test(l.href)) { a.target = "_blank"; a.rel = "noopener"; }
      return a;
    }));
  };

  const feedback = (kbId, intent) => {
    const box = el("div", { className: "kc-fb", textContent: "Had je hier iets aan?" });
    const vote = (helpful) => () => {
      fetch(`${api}/api/chat/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kb_id: kbId, helpful, intent }) }).catch(() => {});
      box.textContent = helpful ? "Dank je." : "Dank je. Wil je dat een mens meekijkt? Laat hieronder je e-mailadres achter.";
      if (!helpful) contactForm(null);
    };
    box.append(el("button", { type: "button", textContent: "Ja", onclick: vote(true) }), el("button", { type: "button", textContent: "Nee", onclick: vote(false) }));
    return box;
  };

  let formShown = false;
  function contactForm(kind) {
    if (formShown) return; formShown = true;
    const lastQ = [...turns].reverse().find((t) => t.role === "user")?.text || "";
    const email = el("input", { type: "email", placeholder: "Je e-mailadres", required: true, autocomplete: "email" });
    const msg = el("textarea", { rows: 3, value: lastQ, required: true, maxLength: 4000 });
    const hp = el("input", { type: "text", name: "website", tabIndex: -1, className: "kc-hp", autocomplete: "off" });
    const submit = el("button", { type: "submit", textContent: "Stuur naar een mens" });
    const f = el("form", { className: "kc-form" },
      el("span", { className: "muted", textContent: "We gebruiken je e-mailadres alleen om je te antwoorden en wissen je bericht na 30 dagen." }),
      email, msg, hp, submit);
    f.onsubmit = async (ev) => {
      ev.preventDefault(); submit.disabled = true;
      try {
        const r = await fetch(`${api}/api/contact`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: email.value, message: msg.value, kind, website: hp.value, elapsed_ms: Date.now() - opened, from_chat: true }) });
        const d = await r.json();
        if (!r.ok) { say("assistant", d.message || "Dat lukte niet. Probeer het opnieuw."); submit.disabled = false; return; }
        f.remove(); formShown = false;
        say("assistant", d.mode === "answered" ? `${d.answer}\n\nWe hebben dit antwoord ook naar je gemaild.` : d.message);
      } catch { say("assistant", "Dat lukte niet. Mail ons gerust op hallo@kloptmijnofferte.nl."); submit.disabled = false; }
    };
    log.append(f); scroll(); email.focus();
  }

  async function ask(text) {
    text = text.trim(); if (!text) return;
    say("user", text); turns.push({ role: "user", text });
    input.value = ""; send.disabled = true;
    const wait = say("assistant", "…");
    try {
      const r = await fetch(`${api}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turns }) });
      const d = await r.json();
      wait.remove();
      const m = say("assistant", d.answer || "Er ging iets mis. Probeer het later opnieuw.");
      turns.push({ role: "assistant", text: d.answer || "" });
      const links = linksFor(d.sources); if (links) m.append(links);
      if (d.answer && !d.escalate) m.append(feedback(d.sources?.[0]?.id || "", d.intent));
      if (d.show_form) contactForm(d.escalate);
    } catch {
      wait.textContent = "De chat is even niet bereikbaar. Mail ons op hallo@kloptmijnofferte.nl.";
    } finally { send.disabled = false; scroll(); }
  }

  let greeted = false;
  const open = () => {
    panel.hidden = false; btn.hidden = true; input.focus();
    if (!greeted) {
      greeted = true;
      say("assistant", "Hoi. Vraag me iets over de check, je offerte, de ISDE-subsidie of privacy.");
      log.append(el("div", { className: "kc-sug" }, ...SUGGESTIONS.map((q) => el("button", { type: "button", textContent: q, onclick: (e) => { e.target.parentElement.remove(); ask(q); } }))));
    }
  };
  btn.onclick = open;
  close.onclick = () => { panel.hidden = true; btn.hidden = false; btn.focus(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) close.onclick(); });
  form.onsubmit = (e) => { e.preventDefault(); ask(input.value); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input.value); } });
  document.querySelectorAll("[data-open-chat]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); open(); }));
})();
