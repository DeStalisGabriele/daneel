// I tre anelli della scheda Salute (Sonno, Recupero, Sforzo da 0 a 100), con i conti fatti dal server
// (/api/plancia/punteggi, punteggi.py). Toccando un anello si vedono le parti del calcolo e gli ultimi 14 giorni.
// Si aggiornano da soli quando cambiano salute, allenamenti o giorni.
(function () {
  const sezione = document.querySelector('section[aria-label="Salute"]');
  if (!sezione) return;
  let token = ""; try { token = localStorage.getItem("daneel-token") || ""; } catch (e) {}

  const stile = document.createElement("style");
  stile.textContent = `
  .anelli{display:grid;gap:14px}
  .anelli-testa{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}
  .anelli-testa b{font-size:var(--t-sub);font-weight:600}
  .anelli-testa span{font-size:var(--t-foot);color:var(--muted)}
  .anelli-tre{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .anello{border:0;background:none;padding:6px 2px;border-radius:14px;display:grid;justify-items:center;gap:4px;cursor:pointer;color:var(--ink)}
  .anello[aria-pressed="true"]{background:var(--fill)}
  .anello svg{width:92px;height:92px;max-width:100%}
  .anello .val{font-family:var(--f-rounded);font-size:26px;font-weight:700;fill:var(--ink)}
  .anello .nome{font-size:var(--t-sub);font-weight:600}
  .anello .giudizio{font-size:var(--t-cap);color:var(--muted);text-align:center;line-height:1.25;min-height:2.5em}
  .anelli-dett{display:grid;gap:10px;background:var(--fill);border-radius:12px;padding:12px 14px}
  .anelli-dett .righe{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;font-size:var(--t-foot);font-variant-numeric:tabular-nums}
  .anelli-dett .righe span:nth-child(even){text-align:right;font-weight:600}
  .barre{display:flex;align-items:flex-end;gap:3px;height:56px}
  .barre i{flex:1;border-radius:3px 3px 0 0;background:var(--c);opacity:.85;min-height:3px}
  .barre i.vuota{background:var(--empty);opacity:1}
  .barre i.oggi{opacity:1}
  .anelli-nota{font-size:var(--t-cap);color:var(--muted)}`;
  document.head.appendChild(stile);

  const card = document.createElement("div");
  card.className = "card anelli";
  card.innerHTML = '<div class="anelli-testa"><b>I tuoi punteggi</b><span id="anelliData">Calcolo…</span></div>' +
    '<div class="anelli-tre" id="anelliTre"></div><div class="anelli-dett" id="anelliDett" hidden></div>' +
    '<div class="anelli-nota" id="anelliNota"></div>';
  const testa = sezione.querySelector(":scope > .sec-head");
  testa ? testa.after(card) : sezione.prepend(card);

  const METRICHE = [
    {id: "sonno", nome: "Sonno", colore: "var(--indigo)",
     giudizio: (v) => v >= 85 ? "Ottimo" : v >= 70 ? "Buono" : "Sotto il fabbisogno"},
    {id: "recupero", nome: "Recupero", colore: "var(--green)",
     giudizio: (v) => v >= 67 ? "Pronto per spingere" : v >= 34 ? "Giornata normale" : "Meglio andare leggero"},
    {id: "sforzo", nome: "Sforzo", colore: "var(--orange)",
     giudizio: (v, g) => g.obiettivoSforzo != null ? `${v} su ${g.obiettivoSforzo} di obiettivo` : "Oggi"},
  ];
  let dati = [], scelta = null;
  const fmt = (n, d = 0) => n == null ? "—" : Number(n).toLocaleString("it-IT", {maximumFractionDigits: d});
  const giorno = (k) => new Date(k + "T12:00:00").toLocaleDateString("it-IT", {weekday: "short", day: "numeric", month: "short"});

  // Lo sforzo di oggi si riempie solo il giorno dopo (i passi arrivano la mattina seguente): finché è vuoto si
  // mostra quello di ieri, detto chiaramente.
  function valore(m, g) {
    if (g[m.id] != null || m.id !== "sforzo") return {v: g[m.id], g, ieri: false};
    const i = dati.findIndex((x) => x.data === g.data), prima = i > 0 ? dati[i - 1] : null;
    return prima && prima.sforzo != null ? {v: prima.sforzo, g: prima, ieri: true} : {v: null, g, ieri: false};
  }

  function anello(m, g) {
    const {v, g: gv, ieri} = valore(m, g);
    const r = 38, c = 2 * Math.PI * r, pieno = v == null ? 0 : Math.max(0, Math.min(100, v)) / 100;
    const arco = pieno > 0 ? `<circle cx="46" cy="46" r="${r}" fill="none" stroke="${m.colore}" stroke-width="9" stroke-linecap="round"
          stroke-dasharray="${(c * pieno).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 46 46)"/>` : "";
    const giudizio = v == null ? "Mancano i dati" : (ieri ? "Ieri: " : "") + m.giudizio(v, gv);
    return `<button class="anello" type="button" data-id="${m.id}" aria-pressed="${scelta === m.id}" style="--c:${m.colore}">
      <svg viewBox="0 0 92 92" role="img" aria-label="${m.nome} ${v ?? "non disponibile"}">
        <circle cx="46" cy="46" r="${r}" fill="none" stroke="var(--empty)" stroke-width="9"/>${arco}
        <text x="46" y="55" text-anchor="middle" class="val">${v ?? "—"}</text>
      </svg>
      <span class="nome">${m.nome}</span>
      <span class="giudizio">${giudizio}</span></button>`;
  }

  function dettagli(m, g) {
    const d = g.dettagli || {}, s = d.sonno || {};
    let righe = [];
    if (m.id === "sonno") righe = [["Ore dormite", fmt(s.ore, 1) + " h"], ["Tuo fabbisogno", fmt(s.bisogno, 1) + " h"],
      ["Durata (55%)", fmt(s.durata)], ["Sonno profondo (12,5%)", fmt(s.profondo)], ["REM (12,5%)", fmt(s.rem)],
      ["Efficienza (5%)", fmt(s.efficienza)], ["Regolarità dell'orario (15%)", fmt(s.regolarita)]];
    if (m.id === "recupero") righe = [["HRV", fmt(d.hrv) + " ms"], ["Rispetto alla tua media (z)", fmt(d.zHrv, 2)],
      ["FC a riposo", fmt(d.fcRiposo) + " bpm"], ["Rispetto alla tua media (z)", fmt(d.zFc, 2)],
      ["Sonno di stanotte", fmt(g.sonno)], ["Giorni di base (servono 14)", fmt(d.giorniDiBase)]];
    if (m.id === "sforzo") righe = [["Passi", fmt(d.passi)], ["Calorie attive", d.kcalAttive ? fmt(d.kcalAttive) + " kcal" : "—"],
      ["Pesi (Hevy)", d.minutiPesi ? fmt(d.minutiPesi) + " min" : "—"], ["Muay Thai", d.muaythai ? "Sì" : "—"],
      ["Obiettivo di oggi (dal recupero)", fmt(g.obiettivoSforzo)]];
    const ultimi = dati.slice(-14);
    const barre = ultimi.map((x) => x[m.id] == null ? `<i class="vuota" title="${giorno(x.data)}: nessun dato"></i>`
      : `<i class="${x.data === g.data ? "oggi" : ""}" style="height:${Math.max(4, x[m.id])}%" title="${giorno(x.data)}: ${x[m.id]}"></i>`).join("");
    return `<div class="righe">${righe.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join("")}</div>
      <div class="anelli-nota">Ultimi 14 giorni</div><div class="barre" style="--c:${m.colore}">${barre}</div>`;
  }

  function disegna() {
    const g = [...dati].reverse().find((x) => x.sonno != null || x.recupero != null || x.sforzo != null);
    const tre = document.getElementById("anelliTre"), dett = document.getElementById("anelliDett");
    if (!g) { document.getElementById("anelliData").textContent = "Ancora nessun dato"; tre.innerHTML = ""; return; }
    const oggi = new Date().toISOString().slice(0, 10);
    document.getElementById("anelliData").textContent = g.data === oggi ? "Oggi" : giorno(g.data);
    tre.innerHTML = METRICHE.map((m) => anello(m, g)).join("");
    tre.querySelectorAll(".anello").forEach((b) => b.onclick = () => { scelta = scelta === b.dataset.id ? null : b.dataset.id; disegna(); });
    const m = METRICHE.find((x) => x.id === scelta);
    dett.hidden = !m;
    if (m) dett.innerHTML = dettagli(m, valore(m, g).g);
    document.getElementById("anelliNota").textContent = g.provvisorio
      ? "Provvisori: diventano affidabili con almeno 14 giorni di dati. Tocca un anello per il calcolo."
      : "Rispetto alla tua media degli ultimi 30 giorni. Tocca un anello per il calcolo.";
  }

  let attesa = null;
  function carica() {
    clearTimeout(attesa);
    attesa = setTimeout(() => fetch("api/plancia/punteggi?giorni=30", {headers: {Authorization: "Bearer " + token}})
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((j) => { dati = j.giorni || []; disegna(); })
      .catch(() => { document.getElementById("anelliData").textContent = "Punteggi non disponibili"; }), 300);
  }
  carica();
  // si ricalcolano quando arrivano dati nuovi (sincronizzazione della salute, Hevy, una spunta)
  (async () => {
    try {
      const db = await window.claude?.use("db");
      if (!db) return;
      for (const col of ["salute", "allenamenti", "giorni"]) db.collection(col).onSnapshot(carica, () => {});
    } catch (e) {}
  })();
})();
