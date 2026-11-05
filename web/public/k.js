// Cookieless measurement: nothing is stored on the device; the variant lives only for this page view.
(() => {
  const api = document.documentElement.dataset.api || "";
  const path = location.pathname;
  const state = { exp: "", variant: "" };
  const send = (step, extra) => {
    const body = JSON.stringify({ step, path, exp: state.exp, variant: state.variant, ...(extra || {}) });
    if (!(navigator.sendBeacon && navigator.sendBeacon(`${api}/api/e`, new Blob([body], { type: "text/plain" }))))
      fetch(`${api}/api/e`, { method: "POST", body, keepalive: true }).catch(() => {});
  };
  window.kmo = { track: send };
  const start = () => send("landing");
  fetch(`${api}/api/experiments`).then((r) => (r.ok ? r.json() : [])).then((exps) => {
    const e = exps.find((x) => x.page === path && x.variants.length);
    if (e) {
      const v = e.variants[Math.floor(Math.random() * e.variants.length)];
      state.exp = e.id; state.variant = v.id;
      for (const [key, text] of Object.entries(v.copy))
        document.querySelectorAll(`[data-copy="${key}"]`).forEach((el) => { el.textContent = text; });
    }
  }).catch(() => {}).finally(() => { document.documentElement.classList.add("ready"); start(); });
})();
