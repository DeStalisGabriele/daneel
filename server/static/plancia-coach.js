// La sezione Coach (scheda Allenamento): l'ultima analisi del coach (allenamento o settimana), con i punti, le fonti
// scientifiche citate e le domande aperte. "Rispondi" apre la chat con il Coach già scelto e il testo pronto.
// I documenti stanno nella collezione "coach" della Plancia (li scrive il subagente coach; vedi .claude/agents/coach.md).
(function () {
  const wrap = document.querySelector(".wrap");
  if (!wrap) return;
  const sezione = document.createElement("section");
  sezione.className = "sec tint-orange";
  sezione.setAttribute("aria-label", "Coach");
  sezione.innerHTML = '<div class="sec-head"><h2>Coach</h2><span class="status" id="chStato"></span></div>' +
    '<div class="card ch-card" id="chCard"><p class="ch-vuoto">Carico il coach…</p></div>' +
    '<div class="ch-azioni"><button class="ch-btn" id="chChiedi">💬 Chiedi al coach</button></div>' +
    '<div id="chStorico"></div>';
  const prima = document.querySelector('section[aria-label="Palestra"]');
  if (prima) prima.before(sezione); else wrap.appendChild(sezione);

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const stile = document.createElement("style");
  stile.textContent = `
  .ch-card{display:grid;gap:12px;padding:14px 16px}
  .ch-vuoto{color:var(--muted);font-size:var(--t-sub);margin:2px 0}
  .ch-testa{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
  .ch-testa b{font-size:var(--t-body);overflow-wrap:anywhere}
  .ch-testa span{font-size:var(--t-foot);color:var(--muted);white-space:nowrap}
  .ch-sintesi{font-size:var(--t-body);line-height:1.4;margin:0}
  .ch-punti{display:grid;gap:8px;margin:0;padding:0;list-style:none}
  .ch-punti li{font-size:var(--t-sub);line-height:1.38;padding-left:14px;position:relative}
  .ch-punti li::before{content:"";position:absolute;left:0;top:.55em;width:6px;height:6px;border-radius:50%;background:var(--warn,#ff8a3d)}
  .ch-fonte{display:block;font-size:var(--t-foot);color:var(--muted);margin-top:2px}
  .ch-sez{margin:0;font-size:var(--t-foot);color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.02em}
  .ch-dom{display:grid;gap:8px}
  .ch-q{background:var(--surface);border-radius:12px;padding:10px 12px;display:grid;gap:8px}
  .ch-q p{margin:0;font-size:var(--t-sub);line-height:1.38}
  .ch-q .ris{color:var(--muted);font-size:var(--t-foot)}
  .ch-q .ris b{color:var(--ink);font-weight:600}
  .ch-btn,.ch-q button{border:0;border-radius:12px;background:var(--accent);color:#fff;font-weight:700;font-size:var(--t-sub);padding:9px 14px;cursor:pointer;justify-self:start}
  .ch-azioni{margin:10px 0 4px}
  .ch-pros{background:color-mix(in srgb,var(--accent) 10%,transparent);border-radius:12px;padding:10px 12px;font-size:var(--t-sub)}
  .ch-pros b{display:block;font-size:var(--t-foot);color:var(--muted);text-transform:uppercase;letter-spacing:.02em;margin-bottom:2px}
  .ch-det{background:var(--surface);border-radius:14px;padding:4px 14px;margin-top:8px}
  .ch-det summary{cursor:pointer;padding:10px 0;font-size:var(--t-sub);font-weight:600}
  .ch-det .ch-card{padding:6px 0 12px;box-shadow:none;background:none}
  `;
  document.head.appendChild(stile);

  const card = sezione.querySelector("#chCard"), storico = sezione.querySelector("#chStorico"), stato = sezione.querySelector("#chStato");
  const scrivi = (testo) => parent.postMessage({tipo: "scrivi", agente: "coach", testo}, location.origin);
  sezione.querySelector("#chChiedi").onclick = () => scrivi("");

  function quando(d) {
    if (!d) return "";
    const x = new Date(d.length === 10 ? d + "T12:00:00" : d);
    return isNaN(x) ? d : x.toLocaleDateString("it-IT", {weekday: "short", day: "numeric", month: "short"});
  }
  function corpo(doc) {
    const titolo = doc.tipo === "settimana" ? "Revisione della settimana" : (doc.titolo || "Allenamento");
    let h = '<div class="ch-testa"><b>' + esc(titolo) + '</b><span>' + esc(quando(doc.data || doc.creato)) + '</span></div>';
    if (doc.sintesi) h += '<p class="ch-sintesi">' + esc(doc.sintesi) + '</p>';
    if ((doc.punti || []).length) {
      h += '<ul class="ch-punti">' + doc.punti.map((p) => '<li>' + esc(p.testo) +
        (p.fonte ? '<span class="ch-fonte">📖 ' + esc(p.fonte) + '</span>' : '') +
        (/^https?:\/\//.test(p.video || "") ? '<a class="ch-fonte" href="' + esc(p.video) + '" target="_blank" rel="noopener">▶️ Video scientifico</a>' : '') + '</li>').join("") + '</ul>';
    }
    const dom = doc.domande || [];
    if (dom.length) {
      h += '<p class="ch-sez">Domande del coach</p><div class="ch-dom">' + dom.map((q, i) =>
        '<div class="ch-q"><p>' + esc(q.testo) + '</p>' +
        (q.risposta ? '<div class="ris"><b>Tu:</b> ' + esc(q.risposta) + '</div>'
                    : '<button data-q="' + i + '">Rispondi</button>') + '</div>').join("") + '</div>';
    }
    if (doc.prossima) h += '<div class="ch-pros"><b>Prossima volta</b>' + esc(doc.prossima) + '</div>';
    return h;
  }
  function disegna(docs) {
    docs.sort((a, b) => String(b.creato || b.data || "").localeCompare(String(a.creato || a.data || "")));
    const aperte = docs.reduce((n, d) => n + (d.domande || []).filter((q) => !q.risposta).length, 0);
    stato.textContent = aperte ? aperte + (aperte === 1 ? " domanda aperta" : " domande aperte") : "";
    if (!docs.length) {
      card.innerHTML = '<p class="ch-vuoto">Il coach scrive dopo ogni allenamento nuovo (e la domenica sera fa la revisione della settimana): ' +
        'analizza i dati, ti chiede come è andata e perché hai fatto certe scelte, sempre con fonti scientifiche.</p>';
      storico.innerHTML = ""; return;
    }
    const [ultimo, ...resto] = docs;
    card.innerHTML = corpo(ultimo);
    card.querySelectorAll("button[data-q]").forEach((b) => b.onclick = () => {
      const q = (ultimo.domande || [])[+b.dataset.q];
      scrivi("Alla domanda «" + q.testo + "»: ");
    });
    storico.innerHTML = resto.length ? '<details class="ch-det"><summary>Analisi precedenti (' + resto.length + ')</summary>' +
      resto.slice(0, 12).map((d) => '<div class="card ch-card">' + corpo(d).replace(/<button[^>]*>Rispondi<\/button>/g, "") + '</div>').join("") + '</details>' : "";
  }
  let docs = {};
  const avvia = () => {
    if (typeof db === "undefined") return setTimeout(avvia, 300);
    db.collection("coach").onSnapshot((snap) => {
      docs = {}; for (const d of snap.docs) if (d.exists && d.id !== "profilo") docs[d.id] = d.data();
      disegna(Object.values(docs));
    }, () => {});
  };
  avvia();
})();
