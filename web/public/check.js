(() => {
  const form = document.getElementById("check");
  const out = document.getElementById("result");
  const api = form.dataset.api || "";
  const eur = (x) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(x);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const track = (s) => window.kmo && window.kmo.track(s);
  form.querySelector('input[type=file]').addEventListener("change", () => track("upload_started"), { once: true });
  const label = { laag: "Laag", gemiddeld: "Rond de middenprijs", hoog: "Hoog" };
  const color = { laag: "var(--low)", gemiddeld: "var(--mid)", hoog: "var(--high)" };

  function render(r) {
    const f = r.fairness, b = f.band;
    const basis = b.source === "eigen_data" ? `gebaseerd op ${b.n} offertes van andere huiseigenaren` : "indicatie uit openbare prijzen, nog niet uit eigen offertes";
    const diff = f.diff_from_median === 0 ? "precies op de middenprijs" : `${eur(Math.abs(f.diff_from_median))} ${f.diff_from_median > 0 ? "boven" : "onder"} de middenprijs`;
    let html = `<div class="card"><h2 style="margin-top:0;color:${color[f.position]}">${label[f.position]}</h2>
      <p>Je offerte: <strong>${eur(f.total)}</strong> inclusief btw, vóór subsidie. Dat is ${diff} van ${eur(b.median)}.</p>
      <p class="muted">Gebruikelijke bandbreedte ${eur(b.p25)} tot ${eur(b.p75)} (${basis}).</p></div>`;
    if (f.component_flags.length) html += `<div class="card"><h2 style="margin-top:0">Opvallende onderdelen</h2><ul>${f.component_flags.map((c) => `<li>${esc(c.category.replace(/_/g, " "))}: ${eur(c.amount)}, gebruikelijk ${eur(c.band[0])} tot ${eur(c.band[1])}</li>`).join("")}</ul></div>`;
    if (f.missing.length) html += `<div class="card"><h2 style="margin-top:0">Vragen voor je installateur</h2><ul>${f.missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>`;
    if (r.subsidy) {
      const s = r.subsidy;
      html += `<div class="card"><h2 style="margin-top:0">ISDE-subsidie</h2>` +
        (s.amount != null ? `<p>Naar schatting <strong>${eur(s.amount)}</strong> (${s.status}, regels ${s.year}).</p>` : "") +
        s.notes.map((n) => `<p class="muted">${esc(n)}</p>`).join("") +
        `<p class="muted">Voorwaarden: ${r.subsidy_conditions.map(esc).join("; ")}.</p></div>`;
    }
    if (r.stored) html += `<div class="card"><p>Dank je. Je offerte telt anoniem mee. Wil je dat intrekken? Bewaar deze code: <strong>${esc(r.check_code)}</strong> (30 dagen geldig).</p></div>`;
    html += `<form id="signup" class="card"><label>Wil je bericht als de prijzen veranderen? <br /><input type="email" name="email" required placeholder="je e-mailadres" /></label><button type="submit">Aanmelden</button><p class="muted">We koppelen je e-mailadres niet aan je offerte.</p></form>`;
    out.innerHTML = html;
    out.hidden = false;
    document.getElementById("signup").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = new FormData(e.target).get("email");
      const res = await fetch(`${api}/api/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      if (res.ok) track("email_signup");
      e.target.innerHTML = res.ok ? "<p>Je bent aangemeld.</p>" : "<p>Dat lukte niet. Controleer je e-mailadres.</p>";
    });
    out.scrollIntoView({ behavior: "smooth" });
    new IntersectionObserver((es, o) => { if (es.some((x) => x.isIntersecting)) { track("report_viewed"); o.disconnect(); } }, { threshold: 0.5 }).observe(out.firstElementChild);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button");
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.disabled = true; btn.textContent = "Bezig met lezen, dit duurt ongeveer 30 seconden";
    try {
      const res = await fetch(`${api}/api/check`, { method: "POST", body: new FormData(form) });
      const data = await res.json();
      if (!res.ok) { out.innerHTML = `<div class="card"><p>${esc(data.message || "Er ging iets mis.")}</p></div>`; out.hidden = false; }
      else { track("upload_finished"); render(data); }
    } catch { out.innerHTML = `<div class="card"><p>Geen verbinding. Probeer het opnieuw.</p></div>`; out.hidden = false; }
    btn.disabled = false; btn.textContent = btn.dataset.label || "Check mijn offerte";
  });
})();
