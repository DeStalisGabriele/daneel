// La scheda Cibo: pasti di oggi (con la ✕ per togliere una voce), aggiunta da codice a barre o ricerca su
// Open Food Facts (/api/cibo, cibo.py: gratis, niente token), "Descrivi a Daneel" per i piatti fatti in casa
// e l'andamento del peso. Si aggiorna da sola quando cambiano i giorni o la salute.
(function () {
  const sezione = document.querySelector('section[aria-label="Alimentazione"]');
  if (!sezione) return;
  let token = ""; try { token = localStorage.getItem("daneel-token") || ""; } catch (e) {}
  const api = (u, o = {}) => fetch(u, {...o, headers: {...(o.headers || {}), Authorization: "Bearer " + token, "Content-Type": "application/json"}})
    .then(async (r) => r.ok ? r.json() : Promise.reject((await r.json().catch(() => ({}))).detail || "Errore " + r.status));
  const PASTI = [["colazione", "Colazione"], ["pranzo", "Pranzo"], ["merenda", "Merenda"], ["cena", "Cena"]];
  const fmt = (n, d = 0) => n == null ? "—" : Number(n).toLocaleString("it-IT", {maximumFractionDigits: d});
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const oggiK = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  function pastoDellOra() {
    const m = new Date().getHours() * 60 + new Date().getMinutes();
    return m < 11 * 60 ? "colazione" : m < 15 * 60 + 30 ? "pranzo" : m < 18 * 60 + 30 ? "merenda" : "cena";
  }

  const stile = document.createElement("style");
  stile.textContent = `
  .cb-azioni{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .cb-azioni button{border:0;border-radius:14px;background:var(--fill);color:var(--ink);padding:12px 6px;display:grid;justify-items:center;gap:4px;font-size:var(--t-foot);font-weight:600;cursor:pointer}
  .cb-azioni button span{font-size:22px;line-height:1}
  .cb-tot{display:grid;gap:8px}
  .cb-riga{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:var(--t-sub)}
  .cb-riga b{font-family:var(--f-rounded);font-size:22px}
  .cb-pasto{border-top:.5px solid var(--sep);padding-top:10px;display:grid;gap:4px}
  .cb-pasto h4{margin:0;display:flex;justify-content:space-between;font-size:var(--t-sub)}
  .cb-pasto h4 span{color:var(--muted);font-weight:400;font-variant-numeric:tabular-nums}
  .cb-voce{display:grid;grid-template-columns:minmax(0,1fr) auto 30px;gap:8px;align-items:center;font-size:var(--t-foot);color:var(--muted)}
  .cb-voce span:first-child{color:var(--ink);overflow-wrap:anywhere}
  .cb-voce button{border:0;background:none;color:var(--muted);font-size:15px;cursor:pointer;min-height:30px}
  .cb-vuoto{font-size:var(--t-foot);color:var(--muted)}
  .cb-velo{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.45);display:grid;align-items:end}
  .cb-foglio{background:var(--surface);border-radius:20px 20px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom,0px));display:grid;gap:14px;max-height:88dvh;overflow:auto}
  .cb-foglio h3{margin:0;font-size:var(--t-title3)}
  .cb-foglio .x{justify-self:end;border:0;background:var(--fill);border-radius:50%;width:30px;height:30px;color:var(--muted);cursor:pointer}
  .cb-testa{display:grid;grid-template-columns:minmax(0,1fr) 30px;gap:10px;align-items:start}
  .cb-foglio input,.cb-foglio select{box-sizing:border-box;width:100%;border:0;background:var(--fill);border-radius:10px;padding:10px 12px;font-size:17px;color:var(--ink)}
  .cb-campi{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .cb-campi label{display:grid;gap:4px;font-size:var(--t-foot);color:var(--muted)}
  .cb-valori{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;text-align:center}
  .cb-valori div{background:var(--fill);border-radius:10px;padding:8px 4px;display:grid;gap:2px}
  .cb-valori b{font-family:var(--f-rounded);font-size:18px}
  .cb-valori small{font-size:var(--t-cap);color:var(--muted)}
  .cb-ok{border:0;border-radius:14px;background:var(--green);color:#fff;font-weight:700;font-size:17px;padding:14px;cursor:pointer}
  .cb-ok:disabled{opacity:.5}
  .cb-errore{color:var(--red);font-size:var(--t-foot)}
  .cb-lista{display:grid;gap:6px}
  .cb-lista button{border:0;background:var(--fill);border-radius:12px;padding:10px 12px;text-align:left;display:grid;gap:2px;cursor:pointer;color:var(--ink)}
  .cb-lista small{color:var(--muted)}
  .cb-video{width:100%;aspect-ratio:3/4;max-height:52dvh;object-fit:cover;border-radius:14px;background:#000}
  .cb-mirino{position:relative}
  .cb-mirino::after{content:"";position:absolute;left:12%;right:12%;top:42%;height:16%;border:2px solid rgba(255,255,255,.85);border-radius:10px}
  .cb-peso svg{width:100%;height:110px;display:block}
  .cb-peso svg text{fill:var(--muted);font-size:10px}`;
  document.head.appendChild(stile);

  const head = sezione.querySelector(":scope > .sec-head");
  const blocco = document.createElement("div");
  blocco.style.cssText = "display:grid;gap:12px";
  blocco.innerHTML = `
    <div class="card cb-azioni">
      <button type="button" id="cbScan"><span>📷</span>Codice a barre</button>
      <button type="button" id="cbCerca"><span>🔎</span>Cerca alimento</button>
      <button type="button" id="cbDescrivi"><span>💬</span>Descrivi a Daneel</button>
    </div>
    <div class="card cb-tot" id="cbOggi"><div class="card-title"><b>Pasti di oggi</b><span>Carico…</span></div></div>
    <div class="card cb-peso" id="cbPeso"><div class="card-title"><b>Peso</b><span>Carico…</span></div></div>`;
  head ? head.after(blocco) : sezione.prepend(blocco);

  // ---------- pasti di oggi e peso ----------
  let giorno = null, dieta = {obiettivoKcal: 3300, obiettivoProteine: 150}, salute = {};
  function disegnaOggi() {
    const c = (giorno && giorno.cibo) || {};
    let kcal = 0, prot = 0;
    for (const [k] of PASTI) { kcal += (c[k] || {}).kcal || 0; prot += (c[k] || {}).proteine || 0; }
    const barra = (v, max) => `<div class="meter"><span style="width:${Math.min(100, v / max * 100)}%;background:var(--green)"></span></div>`;
    let html = `<div class="card-title"><b>Pasti di oggi</b><span>${new Date().toLocaleDateString("it-IT", {weekday: "long", day: "numeric", month: "long"})}</span></div>
      <div class="cb-riga"><span>Calorie</span><span><b>${fmt(kcal)}</b> / ${fmt(dieta.obiettivoKcal)} kcal</span></div>${barra(kcal, dieta.obiettivoKcal)}
      <div class="cb-riga"><span>Proteine</span><span><b>${fmt(prot)}</b> / ${fmt(dieta.obiettivoProteine)} g</span></div>${barra(prot, dieta.obiettivoProteine)}`;
    for (const [k, nome] of PASTI) {
      const p = c[k];
      html += `<div class="cb-pasto"><h4>${nome}<span>${p ? fmt(p.kcal) + " kcal · " + fmt(p.proteine) + " g prot." : ""}</span></h4>`;
      if (!p || !(p.voci || []).length) html += `<div class="cb-vuoto">Niente ancora</div>`;
      else (p.voci || []).forEach((v, i) => {
        html += `<div class="cb-voce"><span>${esc(v.nome)}${v.g ? " · " + fmt(v.g) + " g" : ""}</span><span>${fmt(v.kcal)} kcal</span>
          <button type="button" data-pasto="${k}" data-i="${i}" aria-label="Togli ${esc(v.nome)}">✕</button></div>`;
      });
      html += `</div>`;
    }
    const box = document.getElementById("cbOggi");
    box.innerHTML = html;
    box.querySelectorAll(".cb-voce button").forEach((b) => b.onclick = () => {
      b.disabled = true;
      api("api/cibo/togli", {method: "POST", body: JSON.stringify({pasto: b.dataset.pasto, indice: +b.dataset.i})}).catch(() => { b.disabled = false; });
    });
  }

  function disegnaPeso() {
    // il comando rapido manda l'ultimo peso degli ultimi 30 giorni: si tengono solo i giorni in cui cambia
    const punti = [];
    for (const k of Object.keys(salute).sort()) {
      const p = salute[k] && salute[k].peso;
      if (p && (!punti.length || punti[punti.length - 1].p !== p)) punti.push({k, p});
    }
    const box = document.getElementById("cbPeso");
    if (!punti.length) { box.innerHTML = `<div class="card-title"><b>Peso</b><span>Ancora nessuna pesata da Apple Health</span></div>`; return; }
    const ult = punti[punti.length - 1], prima = punti.find((x) => (new Date(ult.k) - new Date(x.k)) / 864e5 <= 21) || punti[0];
    const diff = ult.p - prima.p, sett = Math.max(1, (new Date(ult.k) - new Date(prima.k)) / (7 * 864e5));
    const W = 320, H = 110, P = 24, ks = punti.map((x) => new Date(x.k).getTime()), lo = Math.min(...punti.map((x) => x.p)) - .5, hi = Math.max(...punti.map((x) => x.p)) + .5;
    const t0 = Math.min(...ks), t1 = Math.max(...ks, t0 + 864e5);
    const X = (t) => P + (W - 2 * P) * (t - t0) / (t1 - t0), Y = (p) => 10 + (H - 30) * (1 - (p - lo) / (hi - lo));
    const linea = punti.map((x) => `${X(new Date(x.k).getTime()).toFixed(1)},${Y(x.p).toFixed(1)}`).join(" ");
    const giornoBreve = (k) => new Date(k + "T12:00").toLocaleDateString("it-IT", {day: "numeric", month: "short"});
    box.innerHTML = `<div class="card-title"><b>Peso</b><span>Ultima pesata: ${giornoBreve(ult.k)}</span></div>
      <div class="cb-riga"><span>Adesso</span><span><b>${fmt(ult.p, 1)}</b> kg</span></div>
      <div class="cb-riga"><span>Dal ${giornoBreve(prima.k)}</span><span>${diff > 0 ? "+" : ""}${fmt(diff, 1)} kg${punti.length > 1 ? ` (${diff > 0 ? "+" : ""}${fmt(diff / sett, 2)} kg a settimana)` : ""}</span></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Andamento del peso">
        <polyline points="${linea}" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linejoin="round"/>
        ${punti.map((x) => `<circle cx="${X(new Date(x.k).getTime()).toFixed(1)}" cy="${Y(x.p).toFixed(1)}" r="3.5" fill="var(--green)"/>`).join("")}
        <text x="${P}" y="${H - 4}">${giornoBreve(punti[0].k)}</text><text x="${W - P}" y="${H - 4}" text-anchor="end">${giornoBreve(ult.k)}</text>
        <text x="4" y="${Y(hi - .5) + 4}">${fmt(hi - .5, 1)}</text><text x="4" y="${Y(lo + .5) + 4}">${fmt(lo + .5, 1)}</text>
      </svg>
      <div class="cb-vuoto">Le pesate arrivano da Apple Health con il comando rapido del mattino.</div>`;
  }

  (async () => {
    try {
      const db = await window.claude?.use("db");
      if (!db) return;
      db.doc("giorni/" + oggiK()).onSnapshot((s) => { giorno = s.exists ? s.data() : null; disegnaOggi(); }, () => {});
      db.doc("config/dieta").onSnapshot((s) => { if (s.exists) dieta = Object.assign({}, dieta, s.data()); disegnaOggi(); }, () => {});
      db.collection("salute").onSnapshot((snap) => { salute = {}; for (const d of snap.docs) if (d.exists) salute[d.id] = d.data(); disegnaPeso(); }, () => {});
    } catch (e) {}
  })();

  // ---------- fogli: prodotto, ricerca, scanner ----------
  function foglio(html) {
    chiudi();
    const v = document.createElement("div");
    v.className = "cb-velo"; v.id = "cbVelo";
    v.innerHTML = `<div class="cb-foglio" role="dialog">${html}</div>`;
    v.addEventListener("click", (e) => { if (e.target === v) chiudi(); });
    document.body.appendChild(v);
    v.querySelectorAll(".x").forEach((b) => b.onclick = chiudi);
    return v;
  }
  let scanner = null;
  function chiudi() {
    if (scanner) { try { scanner.reset(); } catch (e) {} scanner = null; }
    document.getElementById("cbVelo")?.remove();
  }
  addEventListener("hashchange", chiudi);  // cambiando scheda il foglio (e la fotocamera) si chiude

  function mostraProdotto(p) {
    const g0 = p.porzioneG && p.porzioneG > 5 ? p.porzioneG : 100;
    const v = foglio(`<div class="cb-testa"><div><h3>${esc(p.nome)}</h3><div class="cb-vuoto">${esc(p.marca || "")}${p.porzione ? " · porzione " + esc(p.porzione) : ""}</div></div><button class="x" type="button" aria-label="Chiudi">✕</button></div>
      <div class="cb-vuoto">Per 100 g: ${fmt(p.per100.kcal)} kcal · ${fmt(p.per100.proteine, 1)} g proteine · ${fmt(p.per100.carboidrati, 1)} g carboidrati · ${fmt(p.per100.grassi, 1)} g grassi</div>
      <div class="cb-campi"><label>Grammi<input id="cbG" type="number" inputmode="decimal" min="1" value="${g0}"></label>
        <label>Pasto<select id="cbPasto">${PASTI.map(([k, n]) => `<option value="${k}"${k === pastoDellOra() ? " selected" : ""}>${n}</option>`).join("")}</select></label></div>
      <div class="cb-valori" id="cbValori"></div>
      <button class="cb-ok" type="button" id="cbAggiungi">Aggiungi</button><div class="cb-errore" id="cbErr"></div>`);
    const gIn = v.querySelector("#cbG");
    const aggiorna = () => {
      const g = parseFloat(String(gIn.value).replace(",", ".")) || 0;
      v.querySelector("#cbValori").innerHTML = [["kcal", "kcal", 0], ["proteine", "proteine", 1], ["carboidrati", "carboidr.", 1], ["grassi", "grassi", 1]]
        .map(([k, n, d]) => `<div><b>${fmt(p.per100[k] * g / 100, d)}</b><small>${n}</small></div>`).join("");
      v.querySelector("#cbAggiungi").disabled = !(g > 0);
    };
    gIn.oninput = aggiorna; aggiorna();
    v.querySelector("#cbAggiungi").onclick = (e) => {
      e.target.disabled = true;
      api("api/cibo/aggiungi", {method: "POST", body: JSON.stringify({pasto: v.querySelector("#cbPasto").value, nome: p.marca ? `${p.nome} (${p.marca})` : p.nome,
        g: parseFloat(String(gIn.value).replace(",", ".")), per100: p.per100, ean: p.ean})})
        .then(() => chiudi()).catch((err) => { v.querySelector("#cbErr").textContent = err; e.target.disabled = false; });
    };
  }

  function apriEan(ean, v) {
    if (v) v.querySelector(".cb-errore").textContent = "Cerco " + ean + "…";
    api("api/cibo/prodotto/" + ean).then(mostraProdotto).catch((err) => {
      const w = v || foglio(`<div class="cb-testa"><h3>Codice ${esc(ean)}</h3><button class="x" type="button" aria-label="Chiudi">✕</button></div><div class="cb-errore"></div>`);
      w.querySelector(".cb-errore").textContent = err + ". Puoi cercarlo per nome o descriverlo a Daneel.";
    });
  }

  document.getElementById("cbCerca").onclick = () => {
    const v = foglio(`<div class="cb-testa"><h3>Cerca un alimento</h3><button class="x" type="button" aria-label="Chiudi">✕</button></div>
      <input id="cbQ" type="search" placeholder="Es. yogurt greco, Barilla spaghetti" autocomplete="off" enterkeyhint="search">
      <div class="cb-lista" id="cbRis"></div><div class="cb-errore"></div>`);
    const q = v.querySelector("#cbQ"), ris = v.querySelector("#cbRis");
    let t = null, prodotti = [];
    q.oninput = () => { clearTimeout(t); t = setTimeout(() => {
      if (q.value.trim().length < 2) { ris.innerHTML = ""; return; }
      ris.innerHTML = `<div class="cb-vuoto">Cerco…</div>`;
      api("api/cibo/cerca?q=" + encodeURIComponent(q.value.trim())).then((j) => {
        prodotti = j.prodotti;
        ris.innerHTML = prodotti.length ? prodotti.map((p, i) => `<button type="button" data-i="${i}"><span>${esc(p.nome)}</span><small>${esc(p.marca || "")} · ${fmt(p.per100.kcal)} kcal e ${fmt(p.per100.proteine, 1)} g proteine per 100 g</small></button>`).join("")
          : `<div class="cb-vuoto">Niente su Open Food Facts: prova con altre parole o descrivilo a Daneel.</div>`;
        ris.querySelectorAll("button").forEach((b) => b.onclick = () => mostraProdotto(prodotti[+b.dataset.i]));
      }).catch((err) => { ris.innerHTML = ""; v.querySelector(".cb-errore").textContent = err; });
    }, 450); };
    setTimeout(() => q.focus(), 50);
  };

  document.getElementById("cbDescrivi").onclick = () => {
    try { window.parent.postMessage({tipo: "scrivi", testo: "/pasto "}, location.origin); } catch (e) {}
  };

  document.getElementById("cbScan").onclick = async () => {
    const v = foglio(`<div class="cb-testa"><h3>Inquadra il codice a barre</h3><button class="x" type="button" aria-label="Chiudi">✕</button></div>
      <div class="cb-mirino"><video class="cb-video" id="cbVideo" playsinline muted></video></div>
      <div class="cb-campi"><label>Oppure scrivi il codice<input id="cbEan" type="text" inputmode="numeric" placeholder="8000500310427"></label>
        <label>&nbsp;<button class="cb-ok" type="button" id="cbVai" style="padding:10px">Cerca</button></label></div>
      <div class="cb-errore"></div>`);
    v.querySelector("#cbVai").onclick = () => { const e = v.querySelector("#cbEan").value.replace(/\D/g, ""); if (e) { chiudi(); apriEan(e); } };
    try {
      if (!window.ZXing) await new Promise((ok, ko) => { const s = document.createElement("script"); s.src = "vendor/zxing.min.js"; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
      const Z = window.ZXing, hints = new Map();
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
      scanner = new Z.BrowserMultiFormatReader(hints);
      await scanner.decodeFromConstraints({video: {facingMode: "environment"}}, v.querySelector("#cbVideo"), (r) => {
        if (r && scanner) { const ean = r.getText(); try { navigator.vibrate && navigator.vibrate(60); } catch (e) {} chiudi(); apriEan(ean); }
      });
    } catch (e) {
      v.querySelector(".cb-errore").textContent = "La fotocamera non si apre (serve il permesso: Impostazioni → Daneel o Safari → Fotocamera). Puoi scrivere il codice qui sopra.";
    }
  };
})();
