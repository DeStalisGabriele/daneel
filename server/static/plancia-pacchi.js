// La scheda Pacchi: si scrive (o incolla) un codice di spedizione e il pacco compare con la sua fase e una barra di
// avanzamento; toccandolo si apre la timeline completa. I dati li cerca il server (pacchi.py: Poste, InPost, Ship24)
// e stanno nella collezione "pacchi" della Plancia, quindi la lista si aggiorna da sola quando il controllo orario
// trova novità o quando Daneel aggiunge un codice trovato nelle mail.
(function () {
  const wrap = document.querySelector(".wrap");
  if (!wrap) return;
  const sezione = document.createElement("section");
  sezione.className = "sec tint-brown";
  sezione.setAttribute("aria-label", "Pacchi");
  sezione.innerHTML = '<div class="sec-head"><h2>Pacchi</h2></div>';
  wrap.appendChild(sezione);

  let token = ""; try { token = localStorage.getItem("daneel-token") || ""; } catch (e) {}
  const api = (u, dati) => fetch("api/pacchi/" + u, {method: "POST", body: JSON.stringify(dati),
    headers: {Authorization: "Bearer " + token, "Content-Type": "application/json"}})
    .then(async (r) => r.ok ? r.json() : Promise.reject((await r.json().catch(() => ({}))).detail || "Errore " + r.status));
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));

  const FASI = {
    attesa:     {testo: "In attesa del corriere", colore: "var(--muted)",  passo: 0, emoji: "🏷️"},
    viaggio:    {testo: "In viaggio",             colore: "var(--blue)",   passo: 1, emoji: "🚚"},
    consegna:   {testo: "In consegna oggi",       colore: "var(--orange)", passo: 2, emoji: "🛵"},
    ritiro:     {testo: "Pronto per il ritiro",   colore: "var(--purple)", passo: 2, emoji: "📍"},
    mancata:    {testo: "Consegna non riuscita",  colore: "var(--red)",    passo: 2, emoji: "⚠️"},
    consegnato: {testo: "Consegnato",             colore: "var(--green)",  passo: 3, emoji: "✅"},
    problema:   {testo: "C'è un problema",        colore: "var(--red)",    passo: 1, emoji: "⚠️"},
  };
  const PASSI = ["Spedito", "In viaggio", "Quasi lì", "Consegnato"];
  const fase = (p) => FASI[p.fase] || FASI.attesa;

  function quando(s, conOra = true) {
    if (!s) return "";
    const d = new Date(s.length === 10 ? s + "T12:00:00" : s);
    if (isNaN(d)) return s;
    const oggi = new Date(), ieri = new Date(Date.now() - 864e5);
    const ora = conOra && s.length > 10 ? ", " + d.toLocaleTimeString("it-IT", {hour: "2-digit", minute: "2-digit"}) : "";
    if (d.toDateString() === oggi.toDateString()) return "Oggi" + ora;
    if (d.toDateString() === ieri.toDateString()) return "Ieri" + ora;
    return d.toLocaleDateString("it-IT", {weekday: "short", day: "numeric", month: "short"}) + ora;
  }

  const stile = document.createElement("style");
  stile.textContent = `
  .pc-nuovo{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}
  .pc-nuovo input{box-sizing:border-box;width:100%;min-width:0;border:0;background:var(--fill);border-radius:12px;padding:12px;font-size:17px;color:var(--ink)}
  .pc-nuovo #pcNome{grid-column:1/-1}
  .pc-nuovo button{border:0;border-radius:12px;background:var(--accent);color:#fff;font-weight:700;font-size:16px;padding:0 16px;cursor:pointer}
  .pc-nuovo button:disabled{opacity:.5}
  .pc-msg{grid-column:1/-1;font-size:var(--t-foot);color:var(--muted)}
  .pc-msg.err{color:var(--red)}
  .pc-lista{display:grid;gap:10px}
  .pc-pacco{border:0;width:100%;text-align:left;cursor:pointer;color:var(--ink);font:inherit}
  .pc-riga{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:12px;align-items:center}
  .pc-icona{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;font-size:21px;background:color-mix(in srgb,var(--c) 16%,transparent)}
  .pc-nome{font-weight:600;font-size:var(--t-body);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pc-sotto{font-size:var(--t-foot);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pc-fase{font-size:var(--t-foot);font-weight:600;color:var(--c);white-space:nowrap}
  .pc-passi{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
  .pc-passi i{height:5px;border-radius:3px;background:var(--empty)}
  .pc-passi i.si{background:var(--c)}
  .pc-passi-et{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;font-size:var(--t-cap2);color:var(--muted)}
  .pc-passi-et span:last-child{text-align:right}
  .pc-ultimo{font-size:var(--t-foot);color:var(--ink);display:flex;justify-content:space-between;gap:10px}
  .pc-ultimo span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pc-ultimo span:last-child{color:var(--muted);white-space:nowrap}
  .pc-titolo{font-size:var(--t-foot);color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:6px 4px 0}
  .pc-consegnati .pc-pacco{opacity:.72}
  .pc-vuoto{font-size:var(--t-foot);color:var(--muted);text-align:center;padding:18px 8px}
  .pc-velo{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.45);display:grid;align-items:end}
  .pc-foglio{background:var(--bg);border-radius:20px 20px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom,0px));display:grid;gap:14px;max-height:90dvh;overflow:auto}
  .pc-testa{display:grid;grid-template-columns:minmax(0,1fr) 30px;gap:10px;align-items:start}
  .pc-testa h3{margin:0;font-size:var(--t-title3);overflow-wrap:anywhere}
  .pc-testa small{display:block;color:var(--muted);font-size:var(--t-foot);margin-top:2px;overflow-wrap:anywhere}
  .pc-x{border:0;background:var(--fill);border-radius:50%;width:30px;height:30px;color:var(--muted);cursor:pointer}
  .pc-stato{display:flex;align-items:center;gap:10px;font-size:var(--t-title3);font-weight:700;color:var(--c)}
  .pc-tl{list-style:none;margin:0;padding:0;display:grid}
  .pc-tl li{display:grid;grid-template-columns:22px minmax(0,1fr);gap:10px;position:relative;padding-bottom:16px}
  .pc-tl li::before{content:"";position:absolute;left:10px;top:16px;bottom:-2px;width:2px;background:var(--line)}
  .pc-tl li:last-child::before{display:none}
  .pc-tl .pt{width:12px;height:12px;border-radius:50%;margin:4px 0 0 5px;background:var(--empty);box-shadow:0 0 0 3px var(--surface);position:relative;z-index:1}
  .pc-tl li:first-child .pt{width:16px;height:16px;margin:2px 0 0 3px;background:var(--c);box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 25%,transparent)}
  .pc-tl b{display:block;font-size:var(--t-sub);font-weight:600}
  .pc-tl li:not(:first-child) b{font-weight:500}
  .pc-tl span{display:block;font-size:var(--t-foot);color:var(--muted)}
  .pc-azioni{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .pc-azioni button{border:0;border-radius:12px;background:var(--surface);color:var(--ink);padding:11px 6px;font-weight:600;font-size:var(--t-foot);cursor:pointer}
  .pc-azioni button.via{color:var(--red)}
  .pc-azioni button:disabled{opacity:.5}`;
  document.head.appendChild(stile);

  const blocco = document.createElement("div");
  blocco.style.cssText = "display:grid;gap:12px";
  blocco.innerHTML = `
    <form class="card pc-nuovo" id="pcForm" autocomplete="off">
      <input id="pcCodice" placeholder="Codice di spedizione" autocapitalize="characters" spellcheck="false" enterkeyhint="go">
      <button id="pcVai" type="submit">Traccia</button>
      <input id="pcNome" placeholder="Nome (facoltativo): es. felpa Vinted">
      <div class="pc-msg" id="pcMsg">Poste, SDA, InPost, Amazon, BRT, GLS, DHL, UPS, Mondial Relay…</div>
    </form>
    <div class="pc-lista" id="pcAttivi"></div>
    <div class="pc-lista pc-consegnati" id="pcFatti"></div>`;
  sezione.appendChild(blocco);

  // ---------- lista ----------
  let pacchi = [];
  const ultimo = (p) => (p.eventi && p.eventi.length) ? p.eventi[p.eventi.length - 1] : null;
  function scheda(p) {
    const f = fase(p), u = ultimo(p);
    const passi = PASSI.map((_, i) => `<i class="${i <= f.passo ? "si" : ""}"></i>`).join("");
    return `<button class="card pc-pacco" type="button" data-codice="${esc(p.codice)}" style="--c:${f.colore}">
      <div class="pc-riga"><div class="pc-icona">${f.emoji}</div>
        <div style="min-width:0"><div class="pc-nome">${esc(p.nome || p.codice)}</div>
          <div class="pc-sotto">${esc([p.corriere, p.nome ? p.codice : ""].filter(Boolean).join(" · ") || "Corriere da trovare")}</div></div>
        <div class="pc-fase">${esc(f.testo)}</div></div>
      <div class="pc-passi">${passi}</div>
      <div class="pc-passi-et">${PASSI.map((t) => `<span>${t}</span>`).join("")}</div>
      ${u ? `<div class="pc-ultimo"><span>${esc(u.cosa)}${u.dove ? " · " + esc(u.dove) : ""}</span><span>${esc(quando(u.quando))}</span></div>`
          : `<div class="pc-ultimo"><span>${esc(p.errore || "Nessun movimento per ora")}</span><span></span></div>`}
    </button>`;
  }
  function disegna() {
    const recente = (p) => (ultimo(p) || {}).quando || p.aggiunto || "";
    const attivi = pacchi.filter((p) => p.fase !== "consegnato").sort((a, b) => recente(b).localeCompare(recente(a)));
    const fatti = pacchi.filter((p) => p.fase === "consegnato").sort((a, b) => (b.consegnato || "").localeCompare(a.consegnato || ""));
    document.getElementById("pcAttivi").innerHTML = attivi.length ? attivi.map(scheda).join("")
      : `<div class="pc-vuoto">📦 Nessun pacco in arrivo.<br>Scrivi un codice qui sopra, oppure lo aggiunge Daneel quando lo trova nelle mail.</div>`;
    document.getElementById("pcFatti").innerHTML = fatti.length ? `<div class="pc-titolo">Consegnati</div>` + fatti.map(scheda).join("") : "";
    const aperto = document.querySelector(".pc-velo");
    if (aperto) { const p = pacchi.find((x) => x.codice === aperto.dataset.codice); if (p) apri(p); }
  }
  sezione.addEventListener("click", (e) => {
    const b = e.target.closest(".pc-pacco"); if (!b) return;
    const p = pacchi.find((x) => x.codice === b.dataset.codice); if (p) apri(p);
  });

  // ---------- aggiunta ----------
  const msg = (t, err) => { const m = document.getElementById("pcMsg"); m.textContent = t; m.classList.toggle("err", !!err); };
  document.getElementById("pcForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const codice = document.getElementById("pcCodice").value.trim(), nome = document.getElementById("pcNome").value.trim();
    if (!codice) return;
    const vai = document.getElementById("pcVai"); vai.disabled = true;
    msg("Cerco il pacco… (con alcuni corrieri ci vuole fino a un minuto)");
    try {
      const p = await api("aggiungi", {codice, nome});
      document.getElementById("pcCodice").value = ""; document.getElementById("pcNome").value = "";
      document.activeElement && document.activeElement.blur();
      msg(p.corriere ? `Trovato: ${p.corriere} ✅` : "Aggiunto: il corriere non ha ancora informazioni, riprovo ogni ora.");
      if (!pacchi.some((x) => x.codice === p.codice)) { pacchi.push(p); disegna(); }
      apri(p);
    } catch (err) { msg(String(err), true); }
    vai.disabled = false;
  });

  // ---------- timeline ----------
  function apri(p) {
    const f = fase(p);
    const eventi = (p.eventi || []).slice().reverse();
    const lista = eventi.length ? eventi.map((e) => `<li style="--c:${(FASI[e.fase] || f).colore}"><i class="pt"></i>
        <div><b>${esc(e.cosa || "Aggiornamento")}</b><span>${esc([quando(e.quando), e.dove].filter(Boolean).join(" · "))}</span></div></li>`).join("")
      : `<li><i class="pt"></i><div><b>${esc(p.errore || "Nessun movimento per ora")}</b><span>Aggiunto ${esc(quando(p.aggiunto))}</span></div></li>`;
    let velo = document.querySelector(".pc-velo");
    if (!velo) {
      velo = document.createElement("div"); velo.className = "pc-velo";
      velo.addEventListener("click", (e) => { if (e.target === velo) velo.remove(); });
      document.body.appendChild(velo);
    }
    velo.dataset.codice = p.codice;
    velo.innerHTML = `<div class="pc-foglio" style="--c:${f.colore}">
      <div class="pc-testa"><div><h3>${esc(p.nome || "Pacco")}</h3><small>${esc([p.corriere, p.codice].filter(Boolean).join(" · "))}</small></div>
        <button class="pc-x" type="button" aria-label="Chiudi">✕</button></div>
      <div class="card"><div class="pc-stato">${f.emoji} ${esc(f.testo)}</div>
        <div class="pc-passi">${PASSI.map((_, i) => `<i class="${i <= f.passo ? "si" : ""}"></i>`).join("")}</div>
        <div class="pc-passi-et">${PASSI.map((t) => `<span>${t}</span>`).join("")}</div></div>
      <div class="card"><ol class="pc-tl">${lista}</ol>
        <span style="font-size:var(--t-cap);color:var(--muted)">${p.controllato ? "Controllato " + esc(quando(p.controllato)).toLowerCase() : ""}</span></div>
      <div class="pc-azioni"><button type="button" data-a="aggiorna">🔄 Aggiorna</button>
        <button type="button" data-a="copia">📋 Copia codice</button><button type="button" class="via" data-a="togli">🗑️ Togli</button></div>
    </div>`;
    velo.querySelector(".pc-x").onclick = () => velo.remove();
    velo.querySelectorAll(".pc-azioni button").forEach((b) => b.onclick = async () => {
      const a = b.dataset.a;
      if (a === "copia") { try { await navigator.clipboard.writeText(p.codice); b.textContent = "✅ Copiato"; } catch (e) {} return; }
      if (a === "togli") {
        if (b.dataset.sicuro !== "1") { b.dataset.sicuro = "1"; b.textContent = "Sicuro?"; return; }
        await api("togli", {codice: p.codice}).catch(() => {});
        pacchi = pacchi.filter((x) => x.codice !== p.codice); velo.remove(); disegna(); return;
      }
      b.disabled = true; b.textContent = "Aggiorno…";
      try { const n = await api("aggiorna", {codice: p.codice}); pacchi = pacchi.map((x) => x.codice === n.codice ? n : x); disegna(); }
      catch (err) { b.textContent = "⚠️ " + err; }
    });
  }

  // ---------- dati in diretta ----------
  (async () => {
    try {
      const db = await window.claude?.use("db");
      if (!db) return;
      db.collection("pacchi").onSnapshot((snap) => { pacchi = snap.docs.filter((d) => d.exists).map((d) => d.data()); disegna(); }, () => {});
    } catch (e) {}
  })();
  disegna();
})();
