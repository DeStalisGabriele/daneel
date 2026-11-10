// La scheda "Malattia" della sezione Salute (2026-11-10): si segnano uno o più giorni di malattia con i sintomi, la febbre,
// la gravità e una nota; sotto, per ogni episodio, i dati di salute di quei giorni (HRV, FC a riposo, sonno, passi) messi
// accanto alla tua media (calcolata senza i giorni di malattia: lo fa punteggi.py). Niente diagnosi né consigli medici:
// sono i tuoi numeri e basta. I documenti stanno nella collezione "malattia" della Plancia, uno per giorno (id AAAA-MM-GG):
// {data, sintomi:[…], febbre, gravita:1-3, note}. Daneel li può scrivere anche dalla chat (`plancia-db set malattia/<data>`).
(function () {
  const sezione = document.querySelector('section[aria-label="Salute"]');
  if (!sezione) return;
  let token = ""; try { token = localStorage.getItem("daneel-token") || ""; } catch (e) {}
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const SINTOMI = ["Febbre", "Brividi", "Mal di gola", "Tosse", "Raffreddore", "Mal di testa", "Dolori muscolari",
    "Stanchezza", "Nausea", "Mal di stomaco", "Diarrea", "Vertigini"];
  const GRAVITA = ["Lieve", "Media", "Forte"];

  const stile = document.createElement("style");
  stile.textContent = `
  .mal{display:grid;gap:12px;padding:14px 16px}
  .mal-testa{display:flex;justify-content:space-between;align-items:center;gap:10px}
  .mal-testa b{font-size:var(--t-sub);font-weight:600;display:flex;align-items:center;gap:6px}
  .mal-btn{border:0;border-radius:999px;background:var(--accent);color:#fff;font-weight:700;font-size:var(--t-sub);padding:7px 14px;cursor:pointer;display:inline-flex;align-items:center;gap:4px}
  .mal-btn.sec{background:var(--fill);color:var(--ink);font-weight:600}
  .mal-btn.rosso{background:none;color:var(--red);font-weight:600}
  .mal-btn:disabled{opacity:.5}
  .mal-ora{border-radius:12px;padding:10px 12px;background:color-mix(in srgb,var(--red) 14%,transparent);font-size:var(--t-sub);line-height:1.35}
  .mal-vuoto,.mal-nota{font-size:var(--t-cap);color:var(--muted);margin:0;line-height:1.35}
  .mal-ep{background:var(--fill);border-radius:14px;padding:4px 14px}
  .mal-ep summary{cursor:pointer;padding:10px 0;display:grid;gap:4px;list-style:none}
  .mal-ep summary::-webkit-details-marker{display:none}
  .mal-ep .t{display:flex;justify-content:space-between;gap:10px;align-items:baseline;font-size:var(--t-sub);font-weight:600}
  .mal-ep .t span{font-weight:400;color:var(--muted);font-size:var(--t-foot);white-space:nowrap}
  .mal-chips{display:flex;flex-wrap:wrap;gap:6px}
  .mal-chips i{font-style:normal;font-size:var(--t-foot);padding:3px 9px;border-radius:999px;background:var(--surface);color:var(--ink)}
  .mal-chips i.f{background:color-mix(in srgb,var(--red) 18%,var(--surface))}
  .mal-dati{display:grid;gap:8px;padding:2px 0 12px}
  .mal-tab{width:100%;border-collapse:collapse;font-size:var(--t-foot);font-variant-numeric:tabular-nums}
  .mal-tab th{font-weight:600;color:var(--muted);text-align:right;padding:3px 0 5px 8px}
  .mal-tab th:first-child,.mal-tab td:first-child{text-align:left;padding-left:0}
  .mal-tab td{padding:5px 0 5px 8px;text-align:right;border-top:.5px solid var(--sep);white-space:nowrap}
  .mal-tab td small{display:block;color:var(--muted);font-size:var(--t-cap)}
  .mal-tab tr.media td{color:var(--muted)}
  .mal-giu{color:var(--red)} .mal-su{color:var(--orange)}
  .mal-az{display:flex;gap:8px;flex-wrap:wrap}
  .mal-gg{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;font-size:var(--t-foot)}
  .mal-gg>span{min-width:0;flex:1;overflow-wrap:anywhere}
  .mal-gg .mal-btn{flex:none;padding:5px 12px}
  .mal-form{display:grid;gap:12px;background:var(--fill);border-radius:14px;padding:14px}
  .mal-form label,.mal-form .et{font-size:var(--t-foot);color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.02em;display:grid;gap:5px}
  .mal-form input,.mal-form textarea{box-sizing:border-box;width:100%;border:0;border-radius:10px;background:var(--surface);color:var(--ink);font:inherit;font-size:17px;padding:10px;text-transform:none;letter-spacing:0;font-weight:400}
  .mal-form textarea{min-height:64px;resize:none}
  .mal-riga{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .mal-pas{display:flex;align-items:center;gap:6px}
  .mal-pas button{width:38px;height:38px;border:0;border-radius:10px;background:var(--surface);color:var(--ink);font-size:20px;cursor:pointer}
  .mal-pas span{min-width:2.4em;text-align:center;font-size:17px;font-weight:600;color:var(--ink);text-transform:none;letter-spacing:0}
  .mal-sc{display:flex;flex-wrap:wrap;gap:6px}
  .mal-sc button{border:0;border-radius:999px;background:var(--surface);color:var(--ink);font-size:var(--t-sub);padding:7px 12px;cursor:pointer}
  .mal-sc button[aria-pressed="true"]{background:var(--accent);color:#fff;font-weight:600}
  .mal-err{color:var(--red);font-size:var(--t-foot)}`;
  document.head.appendChild(stile);

  const card = document.createElement("div");
  card.className = "card mal";
  const anelli = sezione.querySelector(".card.anelli");
  anelli ? anelli.after(card) : (sezione.querySelector(":scope > .sec-head") ? sezione.querySelector(":scope > .sec-head").after(card) : sezione.prepend(card));

  let giorni = [], punteggi = {}, db = null, form = null, errore = "";
  const ISO = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const oggi = () => ISO(new Date());
  const piu = (k, n) => { const d = new Date(k + "T12:00:00"); d.setDate(d.getDate() + n); return ISO(d); };
  const fmt = (n, d = 0) => n == null ? "—" : Number(n).toLocaleString("it-IT", {maximumFractionDigits: d});
  const breve = (k) => new Date(k + "T12:00:00").toLocaleDateString("it-IT", {day: "numeric", month: "short"});
  const lungo = (k) => new Date(k + "T12:00:00").toLocaleDateString("it-IT", {weekday: "short", day: "numeric", month: "short"});

  // Giorni consecutivi = un episodio.
  function episodi() {
    const ord = [...giorni].sort((a, b) => a.id < b.id ? -1 : 1), out = [];
    for (const g of ord) {
      const ult = out[out.length - 1];
      if (ult && piu(ult.fine, 1) === g.id) { ult.fine = g.id; ult.giorni.push(g); } else out.push({inizio: g.id, fine: g.id, giorni: [g]});
    }
    return out.reverse();
  }

  function descrivi(ep) {
    const sint = [...new Set(ep.giorni.flatMap((g) => g.sintomi || []))];
    const feb = Math.max(0, ...ep.giorni.map((g) => Number(g.febbre) || 0));
    const gr = Math.max(0, ...ep.giorni.map((g) => Number(g.gravita) || 0));
    return {sint, feb, gr};
  }

  function differenza(v, media, unita, inverso) {
    if (v == null || media == null) return "";
    const d = v - media, perc = media ? Math.round(d / media * 100) : 0;
    if (Math.abs(perc) < 3) return "";
    const brutto = inverso ? d > 0 : d < 0;
    return `<small class="${brutto ? (inverso ? "mal-su" : "mal-giu") : ""}">${d > 0 ? "+" : "−"}${fmt(Math.abs(unita === "%" ? perc : d))}${unita === "%" ? "%" : " " + unita}</small>`;
  }

  function tabella(ep) {
    const righe = ep.giorni.map((g) => {
      const p = punteggi[g.id], d = p && p.dettagli;
      if (!d) return `<tr><td>${breve(g.id)}</td><td colspan="4">dati non ancora arrivati</td></tr>`;
      const ore = d.sonno && d.sonno.ore;
      return `<tr><td>${breve(g.id)}</td>
        <td>${d.hrv != null ? fmt(d.hrv) + " ms" : "—"}${differenza(d.hrv, d.hrvMedia, "%", false)}</td>
        <td>${d.fcRiposo != null ? fmt(d.fcRiposo) + " bpm" : "—"}${differenza(d.fcRiposo, d.fcMedia, "bpm", true)}</td>
        <td>${ore != null ? fmt(ore, 1) + " h" : "—"}</td>
        <td>${d.passi != null ? fmt(d.passi) : "—"}</td></tr>`;
    });
    // la tua media: dall'ultimo giorno dell'episodio con dati
    const ult = [...ep.giorni].reverse().map((g) => punteggi[g.id] && punteggi[g.id].dettagli).find((d) => d && (d.hrvMedia != null || d.fcMedia != null));
    const media = ult ? `<tr class="media"><td>Tua media</td><td>${ult.hrvMedia != null ? fmt(ult.hrvMedia) + " ms" : "—"}</td><td>${ult.fcMedia != null ? fmt(ult.fcMedia) + " bpm" : "—"}</td><td></td><td></td></tr>` : "";
    return `<table class="mal-tab"><thead><tr><th>Giorno</th><th>HRV</th><th>FC</th><th>Sonno</th><th>Passi</th></tr></thead><tbody>${righe.join("")}${media}</tbody></table>`;
  }

  function dettaglioGiorni(ep) {
    return ep.giorni.map((g) => {
      const s = (g.sintomi || []).join(", "), extra = [g.febbre ? "febbre " + fmt(g.febbre, 1) + " °C" : "", g.gravita ? "gravità " + GRAVITA[g.gravita - 1].toLowerCase() : ""].filter(Boolean).join(" · ");
      return `<div class="mal-gg">
        <span><b>${lungo(g.id)}</b>${s || extra ? ": " + esc([s, extra].filter(Boolean).join(" · ")) : ""}${g.note ? `<br><span style="color:var(--muted)">${esc(g.note)}</span>` : ""}</span>
        <button class="mal-btn sec" data-mod="${g.id}" type="button">Modifica</button></div>`;
    }).join("");
  }

  function formHtml() {
    const f = form, mod = f.modifica;
    return `<div class="mal-form">
      <div class="mal-riga">
        <label>${mod ? "Giorno" : "Da"}<input type="date" id="malData" value="${f.data}" max="${piu(oggi(), 0)}" ${mod ? "disabled" : ""}></label>
        ${mod ? "" : `<div class="et">Giorni<div class="mal-pas"><button type="button" data-n="-1" aria-label="Meno">−</button><span id="malN">${f.n}</span><button type="button" data-n="1" aria-label="Più">+</button></div></div>`}
      </div>
      <div class="et">Sintomi<div class="mal-sc">${SINTOMI.map((s) => `<button type="button" data-s="${s}" aria-pressed="${f.sintomi.includes(s)}">${s}</button>`).join("")}</div></div>
      <div class="mal-riga">
        <label>Febbre massima (°C)<input type="text" id="malFebbre" inputmode="decimal" placeholder="es. 38,2" value="${esc(f.febbre)}"></label>
        <div class="et">Gravità<div class="mal-sc">${GRAVITA.map((g, i) => `<button type="button" data-g="${i + 1}" aria-pressed="${f.gravita === i + 1}">${g}</button>`).join("")}</div></div>
      </div>
      <label>Note<textarea id="malNote" placeholder="Farmaci, come ti senti, cosa hai fatto…">${esc(f.note)}</textarea></label>
      ${errore ? `<div class="mal-err">${esc(errore)}</div>` : ""}
      <div class="mal-az">
        <button class="mal-btn" type="button" id="malSalva">${mod ? "Salva" : "Segna"}</button>
        <button class="mal-btn sec" type="button" id="malAnnulla">Annulla</button>
        ${mod ? '<button class="mal-btn rosso" type="button" id="malElimina">Togli il giorno</button>' : ""}
      </div></div>`;
  }

  function disegna() {
    const eps = episodi(), k = oggi(), ieri = piu(k, -1);
    const inCorso = giorni.some((g) => g.id === k) ? k : (giorni.some((g) => g.id === ieri) ? ieri : null);
    let html = `<div class="mal-testa"><b>${IC("thermo", 18)} Malattia</b>${form ? "" : `<button class="mal-btn" type="button" id="malNuova">${IC("plus", 16)} Segna</button>`}</div>`;
    if (inCorso && !form) {
      const ep = eps.find((e) => e.fine === inCorso), n = ep.giorni.length;
      html += `<div class="mal-ora">${inCorso === k ? "Oggi sei segnato come malato" : "Ieri eri segnato come malato"} · ${n === 1 ? "1° giorno" : n + "° giorno"}. I punteggi di questi giorni non entrano nella tua media.</div>`;
    }
    if (form) html += formHtml();
    else if (!eps.length) html += `<p class="mal-vuoto">Nessun giorno di malattia segnato. Se stai male, tocca «Segna»: scegli i sintomi e Daneel tiene i tuoi dati di salute di quei giorni separati dalla tua media.</p>`;
    else {
      html += eps.slice(0, 6).map((ep, i) => {
        const {sint, feb, gr} = descrivi(ep), n = ep.giorni.length;
        const titolo = n === 1 ? breve(ep.inizio) : breve(ep.inizio) + " – " + breve(ep.fine);
        return `<details class="mal-ep" ${i === 0 ? "open" : ""}><summary>
          <div class="t">${titolo}<span>${n === 1 ? "1 giorno" : n + " giorni"}${gr ? " · gravità " + GRAVITA[gr - 1].toLowerCase() : ""}</span></div>
          <div class="mal-chips">${feb ? `<i class="f">Febbre ${fmt(feb, 1)} °C</i>` : ""}${sint.filter((s) => !(feb && s === "Febbre")).map((s) => `<i>${esc(s)}</i>`).join("") || (feb ? "" : '<i>Nessun sintomo indicato</i>')}</div>
          </summary><div class="mal-dati">${tabella(ep)}${dettaglioGiorni(ep)}</div></details>`;
      }).join("");
      html += `<p class="mal-nota">Le medie di HRV, FC a riposo e sonno sono calcolate sui 30 giorni prima, senza i giorni di malattia. Il giorno di malattia lo Sforzo non ha obiettivo. Sono conti nostri, non una valutazione medica.</p>`;
    }
    card.innerHTML = html;
    collega();
  }

  function apri(f) { errore = ""; form = f; disegna(); }
  function collega() {
    const q = (id) => card.querySelector(id);
    if (q("#malNuova")) q("#malNuova").onclick = () => apri({data: oggi(), n: 1, sintomi: [], febbre: "", gravita: 0, note: "", modifica: false});
    card.querySelectorAll("[data-mod]").forEach((b) => b.onclick = () => {
      const g = giorni.find((x) => x.id === b.dataset.mod); if (!g) return;
      apri({data: g.id, n: 1, sintomi: [...(g.sintomi || [])], febbre: g.febbre ? String(g.febbre).replace(".", ",") : "", gravita: Number(g.gravita) || 0, note: g.note || "", modifica: true});
    });
    if (!form) return;
    const leggi = () => { form.data = (q("#malData") || {}).value || form.data; form.febbre = q("#malFebbre").value; form.note = q("#malNote").value; };
    card.querySelectorAll("[data-s]").forEach((b) => b.onclick = () => { leggi(); const s = b.dataset.s;
      form.sintomi = form.sintomi.includes(s) ? form.sintomi.filter((x) => x !== s) : [...form.sintomi, s]; disegna(); });
    card.querySelectorAll("[data-g]").forEach((b) => b.onclick = () => { leggi(); const g = Number(b.dataset.g); form.gravita = form.gravita === g ? 0 : g; disegna(); });
    card.querySelectorAll("[data-n]").forEach((b) => b.onclick = () => { leggi(); const max = Math.max(1, Math.min(14, Math.round((new Date(oggi()) - new Date(form.data)) / 864e5) + 1)); form.n = Math.max(1, Math.min(max, form.n + Number(b.dataset.n))); disegna(); });
    q("#malAnnulla").onclick = () => { form = null; disegna(); };
    if (q("#malElimina")) q("#malElimina").onclick = async () => {
      try { await db.doc("malattia/" + form.data).delete(); form = null; } catch (e) { errore = "Non sono riuscito a togliere il giorno."; }
      disegna();
    };
    q("#malSalva").onclick = async () => {
      leggi();
      const feb = form.febbre.trim() ? Number(form.febbre.replace(",", ".")) : null;
      if (feb != null && !(feb >= 34 && feb <= 43)) { errore = "La febbre va tra 34 e 43 °C (oppure lasciala vuota)."; return disegna(); }
      if (!form.sintomi.length && feb == null && !form.note.trim()) { errore = "Indica almeno un sintomo, la febbre o una nota."; return disegna(); }
      if (form.data > oggi()) { errore = "Non puoi segnare un giorno futuro."; return disegna(); }
      q("#malSalva").disabled = true;
      try {
        for (let i = 0; i < (form.modifica ? 1 : form.n); i++) {
          const id = piu(form.data, i);
          if (id > oggi()) break;
          const doc = {data: id, sintomi: form.sintomi, gravita: form.gravita || null, note: form.note.trim(), inserito: new Date().toISOString()};
          if (feb != null) doc.febbre = feb;
          await db.doc("malattia/" + id).set(doc);
        }
        form = null;
      } catch (e) { errore = "Non sono riuscito a salvare: riprova."; }
      disegna();
      carica();
    };
  }

  let attesa = null;
  function carica() {
    clearTimeout(attesa);
    attesa = setTimeout(() => fetch("api/plancia/punteggi?giorni=120", {headers: {Authorization: "Bearer " + token}})
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((j) => { punteggi = Object.fromEntries((j.giorni || []).map((g) => [g.data, g])); if (!form) disegna(); })
      .catch(() => {}), 400);
  }

  disegna();
  (async () => {
    try {
      db = await window.claude?.use("db");
      if (!db) return;
      db.collection("malattia").onSnapshot((snap) => {
        giorni = snap.docs.filter((d) => d.exists).map((d) => ({id: d.id, ...d.data()}));
        if (!form) disegna();
        carica();
      }, () => {});
      for (const col of ["salute"]) db.collection(col).onSnapshot(carica, () => {});
    } catch (e) {}
  })();
})();
