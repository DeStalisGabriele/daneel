// La sezione Coach (scheda Allenamento): l'ultima analisi del coach (allenamento o settimana), con i punti, le fonti
// scientifiche citate e le domande aperte. Si risponde **sotto la domanda**: la risposta si salva subito nel documento
// e il coach la legge in background (messaggio breve al server) e scrive il suo commento sotto la risposta.
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

  let token = ""; try { token = localStorage.getItem("daneel-token") || ""; } catch (e) {}
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
  a.ch-fonte{color:var(--accent);text-decoration:none}
  .ch-sez{margin:0;font-size:var(--t-foot);color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.02em}
  .ch-dom{display:grid;gap:8px}
  .ch-q{background:var(--surface);border-radius:12px;padding:10px 12px;display:grid;gap:8px}
  .ch-q p{margin:0;font-size:var(--t-sub);line-height:1.38}
  .ch-q .ris{color:var(--muted);font-size:var(--t-foot)}
  .ch-q .ris b{color:var(--ink);font-weight:600}
  .ch-q .com{font-size:var(--t-sub);line-height:1.38;border-left:3px solid var(--accent);padding-left:10px}
  .ch-q .att{color:var(--muted);font-size:var(--t-foot)}
  .ch-q textarea{box-sizing:border-box;width:100%;min-height:78px;border:0;border-radius:10px;background:var(--fill);color:var(--ink);font:inherit;font-size:17px;padding:10px;resize:none}
  .ch-riga{display:flex;gap:8px;align-items:center}
  .ch-btn,.ch-q button{border:0;border-radius:12px;background:var(--accent);color:#fff;font-weight:700;font-size:var(--t-sub);padding:9px 14px;cursor:pointer;justify-self:start}
  .ch-q button.sec{background:none;color:var(--muted);font-weight:600}
  .ch-q button:disabled{opacity:.5}
  .ch-err{color:var(--red);font-size:var(--t-foot)}
  .ch-azioni{margin:10px 0 4px}
  .ch-pros{background:color-mix(in srgb,var(--accent) 10%,transparent);border-radius:12px;padding:10px 12px;font-size:var(--t-sub)}
  .ch-pros b{display:block;font-size:var(--t-foot);color:var(--muted);text-transform:uppercase;letter-spacing:.02em;margin-bottom:2px}
  .ch-det{background:var(--surface);border-radius:14px;padding:4px 14px;margin-top:8px}
  .ch-det summary{cursor:pointer;padding:10px 0;font-size:var(--t-sub);font-weight:600}
  .ch-det .ch-card{padding:6px 0 12px;box-shadow:none;background:none}
  `;
  document.head.appendChild(stile);

  const card = sezione.querySelector("#chCard"), storico = sezione.querySelector("#chStorico"), stato = sezione.querySelector("#chStato");
  const scriviChat = (testo) => parent.postMessage({tipo: "scrivi", agente: "coach", testo}, location.origin);
  sezione.querySelector("#chChiedi").onclick = () => scriviChat("");

  function quando(d) {
    if (!d) return "";
    const x = new Date(d.length === 10 ? d + "T12:00:00" : d);
    return isNaN(x) ? d : x.toLocaleDateString("it-IT", {weekday: "short", day: "numeric", month: "short"});
  }
  function corpo(doc, interattivo) {
    const titolo = doc.tipo === "settimana" ? "Revisione della settimana" : (doc.titolo || "Allenamento");
    let h = '<div class="ch-testa"><b>' + esc(titolo) + '</b><span>' + esc(quando(doc.data || doc.creato)) + '</span></div>';
    if (doc.sintesi) h += '<p class="ch-sintesi">' + esc(doc.sintesi) + '</p>';
    if ((doc.punti || []).length) {
      h += '<ul class="ch-punti">' + doc.punti.map((p) => '<li>' + esc(p.testo) +
        (p.fonte ? '<span class="ch-fonte">📖 ' + esc(p.fonte) + '</span>' : '') +
        (/^https?:\/\//.test(p.video || "") ? '<a class="ch-fonte" href="' + esc(p.video) + '" target="_blank" rel="noopener">▶️ Video scientifico</a>' : '') +
        '</li>').join("") + '</ul>';
    }
    const dom = doc.domande || [];
    if (dom.length) {
      h += '<p class="ch-sez">Domande del coach</p><div class="ch-dom">' + dom.map((q, i) =>
        '<div class="ch-q" data-i="' + i + '"><p>' + esc(q.testo) + '</p>' +
        (q.risposta
          ? '<div class="ris"><b>Tu:</b> ' + esc(q.risposta) + '</div>' +
            (q.commento ? '<div class="com">' + esc(q.commento) + '</div>'
                        : (interattivo && q.inviata ? '<div class="att">🏋️ Il coach sta leggendo la tua risposta…</div>' : ""))
          : (interattivo ? '<button data-apri>Rispondi</button>' : "")) + '</div>').join("") + '</div>';
    }
    if (doc.prossima) h += '<div class="ch-pros"><b>Prossima volta</b>' + esc(doc.prossima) + '</div>';
    return h;
  }

  // Risposta sotto la domanda: campo + Invia. Si salva subito nel documento, poi il coach la legge in background.
  function apriCampo(q, riquadro, id, doc, i) {
    const bottone = riquadro.querySelector("[data-apri]"); if (!bottone) return;
    const campo = document.createElement("div"); campo.className = "ch-campo"; campo.style.display = "grid"; campo.style.gap = "8px";
    campo.innerHTML = '<textarea placeholder="La tua risposta…"></textarea><div class="ch-riga">' +
      '<button data-invia>Invia</button><button class="sec" data-annulla>Annulla</button><span class="ch-err"></span></div>';
    bottone.replaceWith(campo);
    const ta = campo.querySelector("textarea"), invia = campo.querySelector("[data-invia]"), err = campo.querySelector(".ch-err");
    ta.focus();
    campo.querySelector("[data-annulla]").onclick = () => disegna();
    invia.onclick = async () => {
      const testo = ta.value.trim(); if (!testo) { ta.focus(); return; }
      invia.disabled = true; err.textContent = "";
      const domande = (doc.domande || []).map((d, k) => k === i ? Object.assign({}, d, {risposta: testo, rispostaIl: new Date().toISOString(), inviata: true}) : d);
      try {
        await db.doc("coach/" + id).update({domande});
      } catch (e) { err.textContent = "Non riesco a salvare: riprova."; invia.disabled = false; return; }
      // il coach la legge in background: il suo commento arriva sotto la risposta (e una notifica)
      const fd = new FormData();
      fd.append("agente", "coach"); fd.append("breve", "1");
      fd.append("testo", "[Risposta data dalla scheda Coach dell'app, non serve rispondere in chat con un muro di testo] " +
        "Gabriele ha risposto alla domanda " + (q.id || ("q" + (i + 1))) + " del documento coach/" + id + ": «" + q.testo + "». " +
        "La risposta è già salvata nel documento (campo `risposta`). Leggila, scrivi nel documento un `commento` breve (1-3 frasi) " +
        "nella stessa domanda (2-5 frasi: valuta la risposta con le prove e le fonti, dissenti se serve), aggiorna `prossima` e `coach/profilo` se serve, " +
        "chiudi lo `stato` se non restano domande aperte. In chat rispondi con una riga sola.\nRisposta di Gabriele: " + testo);
      fetch("api/messaggio", {method: "POST", body: fd, headers: {Authorization: "Bearer " + token}}).catch(() => {});
    };
  }

  let elenco = [];   // [{id, d}]
  function disegna() {
    const docs = elenco.slice().sort((a, b) => String(b.d.creato || b.d.data || "").localeCompare(String(a.d.creato || a.d.data || "")));
    const aperte = docs.reduce((n, x) => n + (x.d.domande || []).filter((q) => !q.risposta).length, 0);
    stato.textContent = aperte ? aperte + (aperte === 1 ? " domanda aperta" : " domande aperte") : "";
    if (!docs.length) {
      card.innerHTML = '<p class="ch-vuoto">Il coach scrive dopo ogni allenamento nuovo (e la domenica sera fa la revisione della settimana): ' +
        'analizza i dati, ti chiede come è andata e perché hai fatto certe scelte, sempre con fonti scientifiche.</p>';
      storico.innerHTML = ""; return;
    }
    const [ultimo, ...resto] = docs;
    card.innerHTML = corpo(ultimo.d, true);
    card.querySelectorAll(".ch-q").forEach((r) => {
      const i = +r.dataset.i, b = r.querySelector("[data-apri]");
      if (b) b.onclick = () => apriCampo(ultimo.d.domande[i], r, ultimo.id, ultimo.d, i);
    });
    storico.innerHTML = resto.length ? '<details class="ch-det"><summary>Analisi precedenti (' + resto.length + ')</summary>' +
      resto.slice(0, 12).map((x) => '<div class="card ch-card">' + corpo(x.d, false) + '</div>').join("") + '</details>' : "";
  }
  const avvia = () => {
    if (typeof db === "undefined") return setTimeout(avvia, 300);
    db.collection("coach").onSnapshot((snap) => {
      // non ridisegnare mentre Gabriele sta scrivendo una risposta
      if (card.querySelector("textarea") && document.activeElement === card.querySelector("textarea")) return;
      elenco = []; for (const d of snap.docs) if (d.exists && d.id !== "profilo") elenco.push({id: d.id, d: d.data()});
      disegna();
    }, () => {});
  };
  avvia();
})();
