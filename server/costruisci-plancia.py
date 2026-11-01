"""Costruisce static/plancia.html dalla pagina della Plancia di claude.ai (plancia-sorgente.html):
aggiunge lo shim del database, i meta per l'app su iPhone, il tasto "‹ Chat" e nasconde il pulsante di Telegram.

Viste (dal 2026-11-01): l'app mostra la Plancia nelle schede della barra in basso, una vista per scheda, scelta
dall'hash: plancia.html#oggi, #salute, #cibo, #soldi. Senza hash si vede tutto, come prima. Dentro l'app (in un
iframe) il tasto "‹ Chat" sparisce, perché c'è la barra."""
from pathlib import Path
qui = Path(__file__).resolve().parent
s = (qui / "plancia-sorgente.html").read_text(encoding="utf-8")
testa = """<head><meta charset=utf8>
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Daneel"><link rel="manifest" href="manifest.json"><link rel="apple-touch-icon" href="icona-180.png">
<script src="plancia-shim.js"></script>
<script>if (window.self !== window.top) document.documentElement.classList.add("incorporata");</script>
<style>
#botFab,#botPanel{display:none!important}
.wrap{padding-top:calc(env(safe-area-inset-top,0px) + 52px)!important}
.navbar{padding-left:96px!important}
#torna{position:fixed;z-index:25;top:calc(env(safe-area-inset-top,0px) + 6px);left:max(10px,env(safe-area-inset-left,0px));
  display:flex;align-items:center;gap:2px;height:32px;padding:0 12px 0 8px;border-radius:999px;text-decoration:none;
  color:var(--blue);background:var(--bar);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);
  box-shadow:0 0 0 .5px var(--sep);font:600 16px -apple-system,BlinkMacSystemFont,sans-serif}
/* dentro l'app: niente tasto per tornare (c'è la barra in basso) e niente spazio per lui */
html.incorporata #torna{display:none}
html.incorporata .wrap{padding-top:calc(env(safe-area-inset-top,0px) + 16px)!important;padding-bottom:calc(96px + env(safe-area-inset-bottom,0px))!important}
html.incorporata .navbar{padding-left:max(16px,env(safe-area-inset-left,0px))!important}
html.vista footer{display:none}
/* la vecchia Prontezza (riquadro e grafico) è sostituita dagli anelli Sonno, Recupero e Sforzo (2026-11-01) */
#healthTiles>.tile:first-child,.card:has(#readChart){display:none!important}
</style>"""
# Quali sezioni (aria-label delle <section>) vanno in ciascuna scheda dell'app.
viste = """<script>
(function () {
  const VISTE = {
    oggi:   {titolo: "Oggi",   sezioni: ["Oggi", "Riepilogo", "Andamento", "Lettura"]},
    salute: {titolo: "Salute", sezioni: ["Salute", "Palestra"]},
    cibo:   {titolo: "Cibo",   sezioni: ["Alimentazione"]},
    soldi:  {titolo: "Soldi",  sezioni: ["Portafoglio"]},
  };
  function applica() {
    const v = VISTE[(location.hash || "").slice(1)];
    document.documentElement.classList.toggle("vista", !!v);
    let prima = true;
    for (const s of document.querySelectorAll("section[aria-label]")) {
      s.hidden = !!v && !v.sezioni.includes(s.getAttribute("aria-label"));
      // la prima sezione della vista ripeterebbe il titolo grande: il suo titolo si nasconde
      const h2 = s.querySelector(":scope > .sec-head h2");
      if (h2) h2.hidden = !!v && !s.hidden && prima;
      if (!s.hidden) prima = false;
    }
    const titolo = v ? v.titolo : "Plancia";
    document.getElementById("bigTitle").textContent = titolo;
    const barra = document.querySelector("#navbar span"); if (barra) barra.textContent = titolo;
    window.scrollTo(0, 0);
  }
  addEventListener("hashchange", applica);
  applica();
})();
</script>
"""
assert s.count("<head>") == 1
s = s.replace("<head>", testa, 1)
s = s.replace('<div class="navbar" id="navbar"', '<a id="torna" href="./" aria-label="Torna alla chat">'
              '<svg viewBox="0 0 12 20" width="10" height="16" aria-hidden="true"><path d="M10 2 2 10l8 8" fill="none" '
              'stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>Chat</a>\n'
              '<div class="navbar" id="navbar"', 1)
s = s.rstrip() + "\n" + viste
s += '<script src="plancia-anelli.js"></script>\n'  # anelli di Salute: Sonno, Recupero, Sforzo (punteggi.py)
s += '<script src="plancia-cibo.js"></script>\n'  # scheda Cibo: pasti di oggi, codice a barre, ricerca, peso (cibo.py)
(qui / "static/plancia.html").write_text(s, encoding="utf-8")
print("plancia.html:", len(s), "caratteri")
