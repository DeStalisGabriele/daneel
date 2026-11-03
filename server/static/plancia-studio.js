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
  .st-nota{font-size:var(--t-foot);color:var(--muted);margin:0;line-height:1.35}
  /* corsie */
  .st-tl{position:relative;padding:22px 0 4px}
  .st-assi{position:absolute;left:0;right:34px;top:0;bottom:0;pointer-events:none}
  .st-assi i{position:absolute;top:14px;bottom:0;border-left:1px solid var(--sep)}
  .st-assi i span{position:absolute;top:-14px;left:3px;font-size:var(--t-cap2);color:var(--muted);font-style:normal;white-space:nowrap}
  .st-assi .st-sess{border-left:1.5px dashed var(--indigo)} .st-assi .st-sess span{color:var(--indigo);font-weight:600}
  .st-assi .st-ora{left:0;border-left:2px solid var(--red)} .st-assi .st-ora span{color:var(--red);font-weight:700;left:4px}
  .st-corsia{all:unset;box-sizing:border-box;display:block;width:100%;cursor:pointer;padding:8px 0 10px;position:relative}
  .st-corsia:active{opacity:.7}
  .st-et{display:flex;gap:8px;align-items:baseline;margin-bottom:5px;padding-right:34px;min-width:0}
  .st-et b{font-size:var(--t-sub);flex:none}
  .st-et span{font-size:var(--t-cap);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .st-pista{position:relative;height:14px;margin-right:34px;border-radius:7px;background:color-mix(in srgb,var(--ink) 5%,transparent)}
  .st-barra{position:absolute;top:0;bottom:0;border-radius:7px;opacity:.9}
  .st-pp{position:absolute;top:6px;height:2px;background:repeating-linear-gradient(90deg,var(--muted) 0 4px,transparent 4px 8px);opacity:.7}
  .st-flag{position:absolute;top:-4px;font-style:normal;font-size:15px;line-height:1}
  .st-flag small{position:absolute;left:18px;top:3px;font-size:var(--t-cap2);color:var(--muted);white-space:nowrap}
  .st-leg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:var(--t-cap);color:var(--muted);padding:6px 0 12px}
  .st-leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
  .st-leg i.tr{height:2px;vertical-align:3px;background:repeating-linear-gradient(90deg,var(--muted) 0 3px,transparent 3px 6px)}
  /* timeline verticale del dettaglio */
  .st-vt{display:grid}
  .st-passo{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:10px;position:relative;padding-bottom:16px}
  .st-passo:last-child{padding-bottom:0}
  .st-passo:not(:last-child)::before{content:"";position:absolute;left:10px;top:18px;bottom:0;width:2px;background:var(--sep)}
  .st-passo.fatta:not(:last-child)::before{background:var(--c)}
  .st-nodo{width:14px;height:14px;margin:2px 0 0 3px;border-radius:50%;border:2px solid var(--c);background:var(--surface);box-sizing:border-box}
  .st-passo.fatta .st-nodo{background:var(--c)}
  .st-passo.ora .st-nodo{background:var(--c);box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 25%,transparent)}
  .st-passo.fine .st-nodo{border-radius:3px}
  .st-passo b{font-size:var(--t-sub)}
  .st-passo em{font-style:normal;font-size:var(--t-cap);font-weight:700;color:var(--c);margin-left:6px}
  .st-passo div span{display:block;font-size:var(--t-foot);color:var(--muted);margin-top:1px}
  .st-passo .h{font-variant-numeric:tabular-nums;font-weight:600;font-size:var(--t-sub)}`;
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
    if (e.anticipa) return {colore: "var(--orange)", testo: (e.ore.avanzamento < 1 ? "Per ora: " : "") + "anticipa al " + gg(e.inizio) + " · " + ore(e.ore.sessione) + " in sessione"};
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
    const av = Math.min(...piano.esami.map((e) => e.ore.avanzamento));
    const provv = av < 1 ? `<div class="st-oggi"><span>📈 Stima provvisoria: il corso è al ${Math.round(av * 100)}% e mancano ancora lezioni e file. Il piano si ricalcola da solo quando il TEORIA cresce o aggiungi esercizi e temi d'esame.</span></div>` : "";
    card.innerHTML = oggi + corsie() + provv;
    card.querySelectorAll(".st-corsia").forEach((b) => b.onclick = () => apri(b.dataset.id));
  }

  // Corsie (una per esame) da oggi all'ultimo esame: le fasi sono barre colorate, la prima passata è tratteggiata,
  // le linee verticali segnano i mesi e l'inizio della sessione, la bandierina è l'esame.
  const COLORI = {teoria: "var(--blue)", esercizi: "var(--orange)", simulazioni: "var(--purple)", ripasso: "var(--green)"};
  const giorno = (iso) => Math.round(new Date(iso + "T12:00") / 864e5);
  function corsie() {
    const t0 = giorno(piano.oggi), t1 = Math.max(...piano.esami.map((e) => giorno(e.data))) + 1;
    const x = (iso) => Math.max(0, Math.min(100, (giorno(iso) - t0) / (t1 - t0) * 100));
    const righe = [];
    const d = new Date(piano.oggi + "T12:00"); d.setDate(1);
    for (d.setMonth(d.getMonth() + 1); giorno(d.toISOString().slice(0, 10)) < t1; d.setMonth(d.getMonth() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      righe.push(`<i class="st-mese" style="left:${x(iso)}%"><span>${MESI[d.getMonth()]}</span></i>`);
    }
    if (piano.inizio_sessione > piano.oggi)
      righe.push(`<i class="st-sess" style="left:${x(piano.inizio_sessione)}%"><span>${gg(piano.inizio_sessione)}</span></i>`);
    const lane = piano.esami.map((e) => {
      const s = stato(e, piano.oggi);
      const pp = piano.oggi < piano.inizio_sessione
        ? `<i class="st-pp" style="left:0;width:${x(e.inizio && e.inizio < piano.inizio_sessione ? e.inizio : piano.inizio_sessione)}%"></i>` : "";
      const barre = Object.entries(e.fasi).filter(([, f]) => f.da).map(([k, f]) => {
        const a = x(f.da), b = Math.max(a + 1.2, x(new Date(giorno(f.a) * 864e5 + 864e5).toISOString().slice(0, 10)));
        return `<i class="st-barra" style="left:${a}%;width:${b - a}%;background:${COLORI[k]}"></i>`;
      }).join("");
      return `<button class="st-corsia" type="button" data-id="${esc(e.id)}" aria-label="${esc(e.nome)}: ${esc(s.testo)}">
        <div class="st-et"><b>${esc(e.breve)}</b><span style="color:${s.colore}">${esc(s.testo)}</span></div>
        <div class="st-pista">${pp}${barre}<i class="st-flag" style="left:${x(e.data)}%">🏁<small>${gg(e.data)}</small></i></div></button>`;
    }).join("");
    const leg = Object.entries(COLORI).map(([k, c]) => `<span><i style="background:${c}"></i>${FASE[k]}</span>`).join("")
      + (piano.oggi < piano.inizio_sessione ? '<span><i class="tr"></i>Prima passata</span>' : "");
    return `<div class="st-tl"><div class="st-assi">${righe.join("")}<i class="st-ora"><span>oggi</span></i></div>${lane}</div><div class="st-leg">${leg}</div>`;
  }

  function chiudi() { document.querySelectorAll(".st-velo").forEach((v) => v.remove()); }
  addEventListener("hashchange", chiudi);  // la Plancia è un solo iframe: cambiando scheda il foglio si chiude

  function apri(id) {
    const e = piano.esami.find((x) => x.id === id); if (!e) return;
    chiudi();
    const m = e.materiale, o = e.ore, ip = piano.ipotesi;
    // timeline verticale: prima passata, le quattro fasi, l'esame; ● fatta, ◉ in corso, ○ da fare
    const passo = (titolo, quando, h, colore, st) => `<div class="st-passo ${st}" style="--c:${colore}">
      <i class="st-nodo"></i><div><b>${titolo}</b>${st === "ora" ? '<em>ora</em>' : ""}<span>${quando}</span></div><span class="h">${h}</span></div>`;
    const statoFase = (f, k) => e.fase_oggi === k ? "ora" : f.a && f.a < piano.oggi ? "fatta" : "";
    const fasi = passo("Prima passata della teoria", "durante il semestre, entro il " + gg(e.prima_passata.entro) + " · ~" + ore(e.prima_passata.ore_settimana) + " a settimana",
        ore(e.prima_passata.ore), "var(--muted)", piano.oggi < piano.inizio_sessione ? "ora" : "fatta")
      + Object.entries(e.fasi).map(([k, f]) => passo(esc(f.nome),
        (f.da ? gg(f.da) + (f.a !== f.da ? " → " + gg(f.a) : "") : "nessun giorno libero") + (f.mancano > 0 ? " · mancano " + ore(f.mancano) : ""),
        ore(f.ore), COLORI[k], statoFase(f, k))).join("")
      + passo("🏁 Esame", gg(e.data) + " · riserva " + gg(e.riserva), "", "var(--red)", "fine");
    const v = document.createElement("div");
    v.className = "st-velo";
    v.innerHTML = `<div class="st-foglio" role="dialog" aria-label="${esc(e.nome)}">
      <div class="st-testa"><div><h3>${esc(e.nome)}</h3><small>Appello del ${gg(e.data)} · tra ${e.giorni_mancanti} giorni · riserva ${gg(e.riserva)}</small></div>
        <button class="x" type="button" aria-label="Chiudi">✕</button></div>
      <div class="st-box"><h4>Piano</h4>
        ${e.inizio ? `<p class="st-consiglio"><b>${e.anticipa ? "Anticipa: inizia il " : "In sessione dal "}${gg(e.inizio)}</b>: ${ore(e.ore.sessione)} in sessione, ${ore(e.ore.totale)} in tutto (i CFU ne prevedono ~${e.ore.cfu_ore}).</p>` : ""}
        <div class="st-vt">${fasi}</div></div>
      ${e.ore.stime.length || e.andamento.ore ? `<div class="st-box"><h4>Stima provvisoria</h4>${e.ore.stime.map((s) => `<p class="st-nota">• ${esc(s)}</p>`).join("")}${e.andamento.ore ? `<p class="st-nota">• Dal ${gg(e.andamento.dal)}: ${e.andamento.ore > 0 ? "+" : ""}${ore(e.andamento.ore)} in sessione${e.andamento.inizio && e.andamento.inizio !== e.inizio ? " (inizio era il " + gg(e.andamento.inizio) + ")" : ""}.</p>` : ""}</div>` : ""}
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
