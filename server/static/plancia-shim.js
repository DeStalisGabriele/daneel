// La Plancia era un artifact di claude.ai: la sua pagina usa window.claude.use("db") e use("mcp"). Questo shim dà
// alla stessa pagina un `db` e un `mcp` che parlano con il server dell'app (plancia.py), così la pagina non cambia.
//   db.collection(c).onSnapshot(cb, err), db.doc("c/id").onSnapshot(cb, err), db.doc("c/id").set(data)
//   mcp.callTool("Google Calendar", "list_events", {startTime, endTime}), mcp.watchTool(…, cb, {refetchInterval})
// Gli aggiornamenti arrivano dal flusso /api/plancia/eventi: a ogni scrittura si ricarica solo il pezzo cambiato.
(function () {
  let token = "";
  try { token = localStorage.getItem("daneel-token") || ""; } catch (e) {}
  const api = (percorso, opz = {}) => fetch("api/plancia" + percorso, {...opz,
    headers: {...(opz.headers || {}), Authorization: "Bearer " + token, "Content-Type": "application/json"}})
    .then(r => { if (!r.ok) { const e = new Error("errore " + r.status); e.code = r.status === 401 ? "invalid_argument" : "unavailable"; throw e; } return r.json(); });

  // chi ascolta cosa: [{col, id|null, ricarica}]
  const ascolti = new Set();
  let flusso = null;
  function apriFlusso() {
    if (flusso) return;
    flusso = new EventSource("api/plancia/eventi?t=" + encodeURIComponent(token));
    flusso.onmessage = m => {
      let ev; try { ev = JSON.parse(m.data); } catch (e) { return; }
      for (const a of ascolti) if (a.col === ev.col && (a.id === null || a.id === ev.id)) a.ricarica();
    };
    // al ritorno in primo piano o dopo un errore di rete si ricarica tutto (il flusso può aver perso eventi)
    flusso.onerror = () => { flusso.close(); flusso = null; setTimeout(() => { apriFlusso(); for (const a of ascolti) a.ricarica(); }, 3000); };
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) for (const a of ascolti) a.ricarica(); });

  const istantanea = (id, data) => ({id, exists: data != null, data: () => data});
  function ascolta(col, id, carica, cb, err) {
    const a = {col, id, ricarica: () => carica().then(cb).catch(e => err && err(e))};
    ascolti.add(a); apriFlusso(); a.ricarica();
    return () => ascolti.delete(a);
  }

  const db = {
    collection(col) {
      return {onSnapshot: (cb, err) => ascolta(col, null,
        () => api("/col/" + col).then(r => ({docs: r.docs.map(d => istantanea(d.id, d.data)), empty: !r.docs.length})), cb, err)};
    },
    doc(percorso) {
      const [col, id] = percorso.split("/");
      return {
        onSnapshot: (cb, err) => ascolta(col, id, () => api(`/doc/${col}/${id}`).then(r => istantanea(id, r.data)), cb, err),
        get: () => api(`/doc/${col}/${id}`).then(r => istantanea(id, r.data)),
        set: data => api(`/doc/${col}/${id}`, {method: "PUT", body: JSON.stringify(data)}),
        update: data => api(`/doc/${col}/${id}`, {method: "PATCH", body: JSON.stringify(data)}),
        delete: () => api(`/doc/${col}/${id}`, {method: "DELETE"}),
      };
    },
  };

  // Solo l'agenda: list_events di Google Calendar, letto dagli indirizzi iCal sul server.
  const agenda = input => api(`/agenda?da=${encodeURIComponent(input.startTime)}&a=${encodeURIComponent(input.endTime || "")}`)
    .then(r => ({payload: {events: r.events}, cache: {storedAt: r.storedAt}}))
    .catch(e => { throw Object.assign(new Error("calendario non raggiungibile"), {code: "tool_error"}); });
  const mcp = {
    callTool: (server, tool, input) => agenda(input),
    watchTool(server, tool, input, cb, opz = {}) {
      let vivo = true;
      const giro = () => vivo && agenda(input).then(r => vivo && cb({type: "data", result: r}))
        .catch(e => vivo && cb({type: "error", error: e}));
      giro();
      const t = setInterval(giro, opz.refetchInterval || 5 * 60 * 1000);
      return () => { vivo = false; clearInterval(t); };
    },
  };

  window.claude = {use: async nome => nome === "db" ? db : nome === "mcp" ? mcp : null};
})();
