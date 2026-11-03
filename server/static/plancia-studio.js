// La sezione Studio (scheda Oggi): per ogni esame dice quando cominciare a studiare e cosa fare oggi.
// I conti li fa il server (studio.py: materiale del corso, ore libere dal calendario, fasi all'indietro dall'esame).
// Toccando un esame si apre il foglio con le fasi, il materiale misurato, le ipotesi e i suggerimenti.
(function () {
  const wrap = document.querySelector(".wrap");
  if (!wrap) return;
  const sezione = document.createElement("section");
  sezione.className = "sec tint-indigo";
  sezione.setAttribute("aria-label", "Studio");
  sezione.innerHTML = '<div class="sec-head"><h2>Studio</h2></div><div class="card st-card"><p class="st-vuoto">Calcolo il piano…</p></div>';
  const dopo = document.querySelector('section[aria-label="Oggi"]');
  if (dopo) dopo.after(sezione); else wrap.appendChild(sezione);
  const card = sezione.querySelector(".st-card");

  const stile = document.createElement("style");
  stile.textContent = `
  .st-card{display:grid;gap:0;padding:4px 16px}
  .st-vuoto{color:var(--muted);font-size:var(--t-sub);margin:12px 0}
  .st-oggi{padding:12px 0;border-bottom:.5px solid var(--sep);display:grid;gap:4px}
  .st-oggi b{font-size:var(--t-sub)}
  .st-oggi span{font-size:var(--t-foot);color:var(--muted)}
  .st-esame{all:unset;box-sizing:border-box;width:100%;cursor:pointer;display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:10px;align-items:center;padding:12px 0;border-bottom:.5px solid var(--sep)}
  .st-esame:last-child{border-bottom:0}
  .st-pallino{width:10px;height:10px;border-radius:50%}
  .st-nome{font-weight:600;font-size:var(--t-body);overflow-wrap:anywhere}
  .st-sotto{font-size:var(--t-foot);color:var(--muted);margin-top:2px}
  .st-giorni{text-align:right;font-family:var(--f-rounded);font-weight:700;font-size:var(--t-title3);font-variant-numeric:tabular-nums}
  .st-giorni small{display:block;font-family:var(--f-text);font-weight:400;font-size:var(--t-cap);color:var(--muted)}
  .st-velo{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.45);display:grid;align-items:end}
  .st-foglio{box-sizing:border-box;background:var(--bg);border-radius:20px 20px 0 0;padding:18px 16px calc(18px + var(--basso,env(safe-area-inset-bottom,0px)));display:grid;gap:14px;grid-template-columns:minmax(0,1fr);max-height:90dvh;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y}
  .st-testa{display:grid;grid-template-columns:minmax(0,1fr) 30px;gap:12px;align-items:start}
  .st-testa h3{margin:0;font-size:var(--t-title3);overflow-wrap:anywhere}
  .st-testa small{display:block;color:var(--muted);font-size:var(--t-foot);margin-top:2px}
  .st-testa .x{width:30px;height:30px;border-radius:50%;border:0;background:var(--fill);color:var(--muted);cursor:pointer}
  .st-box{background:var(--surface);border-radius:14px;padding:12px 14px;display:grid;gap:8px}
  .st-box h4{margin:0;font-size:var(--t-foot);color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.02em}
  .st-fase{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;padding:6px 0;border-bottom:.5px solid var(--sep)}
  .st-fase:last-child{border-bottom:0}
  .st-fase b{font-size:var(--t-sub)} .st-fase span{font-size:var(--t-foot);color:var(--muted)}
  .st-fase .h{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;font-size:var(--t-sub);color:var(--ink)}
  .st-fase.ora b{color:var(--accent)}
  .st-riga{display:flex;justify-content:space-between;gap:10px;font-size:var(--t-sub)}
  .st-riga span:last-child{font-variant-numeric:tabular-nums;color:var(--muted);text-align:right}
  .st-consiglio{font-size:var(--t-sub);line-height:1.35;margin:0}
  .st-nota{font-size:var(--t-foot);color:var(--muted);margin:0;line-height:1.35}`;
  document.head.appendChild(stile);

  let token = ""; try { token = localStorage.getItem("daneel-token") || ""; } catch (e) {}
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
  const gg = (iso) => { if (!iso) return "—"; const d = new Date(iso + "T12:00"); return d.getDate() + " " + MESI[d.getMonth()]; };
  const ore = (h) => (Math.round(h * 2) / 2).toLocaleString("it-IT") + " h";
  const FASE = {teoria: "Teoria", esercizi: "Esercizi", simulazioni: "Simulazioni", ripasso: "Ripasso"};
  let piano = null;

  function stato(e, oggi) {
    if (e.mancano > 0) return {colore: "var(--red)", testo: "Non ci sta: mancano " + ore(e.mancano) + ", anticipa"};
    if (e.anticipa) return {colore: "var(--orange)", testo: "Anticipa: inizia il " + gg(e.inizio) + " · " + ore(e.ore.sessione) + " in sessione"};
    if (e.fase_oggi) return {colore: "var(--green)", testo: "Oggi: " + FASE[e.fase_oggi].toLowerCase() + " · " + ore(e.ore.sessione) + " in sessione"};
    if (oggi < piano.inizio_sessione) return {colore: "var(--green)", testo: "Il " + gg(piano.inizio_sessione) + " basta · teoria vista entro allora: ~" + ore(e.prima_passata.ore_settimana) + "/sett."};
    return {colore: "var(--blue)", testo: "Inizia il " + gg(e.inizio) + " · " + ore(e.ore.sessione) + " in sessione"};
  }

  function disegna() {
    if (!piano) return;
    const nomi = Object.fromEntries(piano.esami.map((e) => [e.id, e.breve]));
    const oggi = piano.oggi_piano.length
      ? `<div class="st-oggi"><b>Oggi: ${piano.oggi_piano.map(([id, f, h]) => esc(nomi[id]) + " " + FASE[f].toLowerCase() + " " + ore(h)).join(" · ")}</b></div>`
      : piano.oggi < piano.inizio_sessione
        ? `<div class="st-oggi"><b>Fino al ${gg(piano.inizio_sessione)}: prima passata della teoria</b><span>Lezioni e TEORIA in pari, così il ${gg(piano.inizio_sessione)} hai visto tutto: ~${ore(piano.esami.reduce((s, e) => s + e.prima_passata.ore_settimana, 0))} a settimana per i tre corsi. In sessione restano ~${ore(piano.margine_ore)} di margine.</span></div>`
        : `<div class="st-oggi"><b>Oggi niente studio d'esame in programma</b><span>Margine in sessione: ~${ore(piano.margine_ore)}.</span></div>`;
    card.innerHTML = oggi + piano.esami.map((e) => {
      const s = stato(e, piano.oggi);
      return `<button class="st-esame" type="button" data-id="${esc(e.id)}">
        <i class="st-pallino" style="background:${s.colore}"></i>
        <div><div class="st-nome">${esc(e.nome)}</div><div class="st-sotto">${esc(s.testo)}</div></div>
        <div class="st-giorni">${e.giorni_mancanti}<small>giorni · ${gg(e.data)}</small></div></button>`;
    }).join("");
    card.querySelectorAll(".st-esame").forEach((b) => b.onclick = () => apri(b.dataset.id));
  }

  function chiudi() { document.querySelectorAll(".st-velo").forEach((v) => v.remove()); }
  addEventListener("hashchange", chiudi);  // la Plancia è un solo iframe: cambiando scheda il foglio si chiude

  function apri(id) {
    const e = piano.esami.find((x) => x.id === id); if (!e) return;
    chiudi();
    const m = e.materiale, o = e.ore, ip = piano.ipotesi;
    const fasi = Object.entries(e.fasi).map(([k, f]) => `<div class="st-fase${e.fase_oggi === k ? " ora" : ""}">
      <b>${esc(f.nome)}</b><span class="h">${ore(f.ore)}</span>
      <span>${f.da ? gg(f.da) + (f.a !== f.da ? " → " + gg(f.a) : "") : "nessun giorno libero"}${f.mancano > 0 ? " · mancano " + ore(f.mancano) : ""}</span></div>`).join("");
    const v = document.createElement("div");
    v.className = "st-velo";
    v.innerHTML = `<div class="st-foglio" role="dialog" aria-label="${esc(e.nome)}">
      <div class="st-testa"><div><h3>${esc(e.nome)}</h3><small>Appello del ${gg(e.data)} · tra ${e.giorni_mancanti} giorni · riserva ${gg(e.riserva)}</small></div>
        <button class="x" type="button" aria-label="Chiudi">✕</button></div>
      <div class="st-box"><h4>Piano</h4>
        <div class="st-fase"><b>Prima passata della teoria</b><span class="h">${ore(e.prima_passata.ore)}</span><span>durante il semestre, entro il ${gg(e.prima_passata.entro)} · ~${ore(e.prima_passata.ore_settimana)} a settimana</span></div>
        ${e.inizio ? `<p class="st-consiglio"><b>${e.anticipa ? "Anticipa: inizia il " : "In sessione dal "}${gg(e.inizio)}</b>: ${ore(e.ore.sessione)} in sessione, ${ore(e.ore.totale)} in tutto (i CFU ne prevedono ~${e.ore.cfu_ore}).</p>` : ""}${fasi}</div>
      <div class="st-box"><h4>Suggerimenti</h4>${e.consigli.map((c) => `<p class="st-consiglio">${esc(c)}</p>`).join("")}</div>
      <div class="st-box"><h4>Materiale misurato</h4>
        <div class="st-riga"><span>TEORIA.docx oggi</span><span>${m.parole.toLocaleString("it-IT")} parole · ${m.immagini} immagini</span></div>
        <div class="st-riga"><span>TEORIA previsto a fine corso</span><span>~${o.parole_previste.toLocaleString("it-IT")} parole (×${o.proiezione.toLocaleString("it-IT")})</span></div>
        <div class="st-riga"><span>Slide</span><span>${m.slide_pagine} pagine</span></div>
        <div class="st-riga"><span>Esercizi</span><span>${m.esercizi_file} file · ${m.esercizi_pagine} pagine</span></div>
        <div class="st-riga"><span>Temi d'esame</span><span>${m.appelli} (simulazioni: ${o.n_simulazioni})</span></div>
        <div class="st-riga"><span>Lezioni registrate</span><span>${m.lezioni}</span></div>
        <div class="st-riga"><span>TEORIA aggiornato il</span><span>${gg(m.teoria_aggiornata)}</span></div></div>
      <p class="st-nota">${esc(e.nota || "")} Come calcolo: teoria a ${ip.parole_minuto} parole al minuto (lettura per imparare, Carver), ${ip.minuti_pagina_esercizi} minuti per pagina di esercizi, ogni simulazione vale la durata della prova più la correzione, ripasso di ${ip.ripasso_giorni} giorni da ${ip.ripasso_ore_giorno} ore. In sessione al massimo ${ip.ore_max_giorno} ore di studio attivo al giorno (prima del ${gg(piano.inizio_sessione)} ${ip.ore_max_prima}), meno gli impegni del calendario. Controllo con i CFU: ${ip.ore_studio_cfu} ore di studio per CFU (regola PoliTo). Fine lezioni ipotizzata: ${gg(ip.fine_lezioni)}.</p>
    </div>`;
    v.addEventListener("click", (ev) => { if (ev.target === v) chiudi(); });
    document.body.appendChild(v);
    v.querySelector(".x").onclick = chiudi;
    const f = v.querySelector(".st-foglio");
    f.style.setProperty("--accent", "var(--indigo)");
    f.style.maxHeight = Math.round((window.visualViewport?.height || window.innerHeight) * 0.9) + "px";
  }

  function carica() {
    fetch("api/studio/piano", {headers: {Authorization: "Bearer " + token}})
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((p) => { piano = p; disegna(); })
      .catch(() => { card.innerHTML = '<p class="st-vuoto">Piano di studio non disponibile.</p>'; });
  }
  carica();
  addEventListener("hashchange", () => { if (location.hash === "#oggi") carica(); });
})();
