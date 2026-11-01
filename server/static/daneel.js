// Daneel, la mascotte: una testa di robot (visiera scura, occhi luminosi, antenna) disegnata in SVG e animata in JS.
// Respira, sbatte le palpebre, segue il dito con gli occhi e cambia espressione con l'umore:
// calmo, ascolta, pensa, parla, felice, dorme, confuso. Toccandolo fa un saltello.
// Uso: const d = creaDaneel(contenitore, {dimensione: 120, segui: true}); d.umore("pensa"); d.tocca();
// Con "riduci movimento" attivo sull'iPhone resta fermo (cambia solo espressione).

(function () {
  const NS = "http://www.w3.org/2000/svg";
  const fermo = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tutti = [];
  let dito = null; // ultima posizione del dito o del mouse, in coordinate della pagina

  addEventListener("pointermove", e => { dito = {x: e.clientX, y: e.clientY, t: performance.now()}; }, {passive: true});
  addEventListener("pointerdown", e => { dito = {x: e.clientX, y: e.clientY, t: performance.now()}; }, {passive: true});

  function el(nome, attr, padre) {
    const n = document.createElementNS(NS, nome);
    for (const k in attr) n.setAttribute(k, attr[k]);
    if (padre) padre.appendChild(n);
    return n;
  }

  const SVG_STATICO = `<svg xmlns="${NS}" viewBox="0 0 200 200">
    <line x1="100" y1="42" x2="100" y2="24" stroke="#9aa3b5" stroke-width="5" stroke-linecap="round"/>
    <circle cx="100" cy="19" r="8" fill="#6d9cff"/>
    <rect x="22" y="88" width="16" height="30" rx="7" fill="#c3c9d6"/><rect x="162" y="88" width="16" height="30" rx="7" fill="#c3c9d6"/>
    <rect x="32" y="40" width="136" height="122" rx="46" fill="#e9ecf3"/>
    <rect x="48" y="70" width="104" height="54" rx="27" fill="#141a2a"/>
    <ellipse cx="80" cy="97" rx="9" ry="11" fill="#7fb0ff"/><ellipse cx="120" cy="97" rx="9" ry="11" fill="#7fb0ff"/>
    <path d="M88 140 Q100 147 112 140" stroke="#6b7385" stroke-width="5" fill="none" stroke-linecap="round"/></svg>`;

  // La famiglia: stessa testa, un accessorio e un colore degli occhi per ciascuno. `disegna` restituisce la "luce",
  // la parte che pulsa quando pensa (per Daneel l'antenna, che cambia anche colore con l'umore).
  const FIGURE = {
    daneel: {occhi: "#7fb0ff", luceColorata: true, disegna({dietro, el, id}) {
      el("line", {x1: 100, y1: 42, x2: 100, y2: 24, stroke: "#9aa3b5", "stroke-width": 5, "stroke-linecap": "round"}, dietro);
      return el("circle", {cx: 100, cy: 19, r: 8, fill: "#6d9cff", filter: `url(#${id}g)`}, dietro);
    }},
    calendario: {occhi: "#ff9b9b", disegna({sopra, el, clipTesta}) {   // pagina di calendario: fascia rossa e anelli
      const fascia = el("rect", {x: 32, y: 40, width: 136, height: 24, fill: "#e5484d", "clip-path": clipTesta}, sopra);
      for (const x of [70, 118]) el("rect", {x, y: 26, width: 12, height: 28, rx: 6, fill: "#9aa3b5"}, sopra);
      return fascia;
    }},
    postino: {occhi: "#ffd76a", disegna({sopra, el}) {                 // berretto da postino con la busta
      el("path", {d: "M38 66 Q38 20 100 20 Q162 20 162 66 Z", fill: "#2f5fd0"}, sopra);
      const banda = el("rect", {x: 38, y: 54, width: 124, height: 12, fill: "#ffd23f"}, sopra);
      el("ellipse", {cx: 100, cy: 67, rx: 66, ry: 6, fill: "#234aa8"}, sopra);
      el("rect", {x: 87, y: 28, width: 26, height: 18, rx: 3, fill: "#ffffff"}, sopra);
      el("path", {d: "M88 30 L100 40 L112 30", stroke: "#2f5fd0", "stroke-width": 3, fill: "none", "stroke-linejoin": "round"}, sopra);
      return banda;
    }},
    nutrizionista: {occhi: "#86e3a8", disegna({dietro, el}) {          // germoglio al posto dell'antenna
      el("path", {d: "M100 44 Q99 32 102 20", stroke: "#3fa45b", "stroke-width": 5, fill: "none", "stroke-linecap": "round"}, dietro);
      const foglie = el("g", {}, dietro);
      el("path", {d: "M101 30 Q80 14 70 30 Q86 40 101 30 Z", fill: "#4cc26b"}, foglie);
      el("path", {d: "M102 22 Q118 2 134 14 Q120 30 102 22 Z", fill: "#3fa45b"}, foglie);
      return foglie;
    }},
    amanuense: {occhi: "#f4c86a", disegna({dietro, el}) {              // piuma d'oca infilata in testa
      const piuma = el("g", {}, dietro);
      el("path", {d: "M116 48 Q100 18 70 0 Q108 6 124 44 Z", fill: "#f1d38a"}, piuma);
      el("path", {d: "M120 48 Q102 20 72 2", stroke: "#b08d3a", "stroke-width": 3, fill: "none", "stroke-linecap": "round"}, piuma);
      el("path", {d: "M84 12 l-8 6 M94 18 l-8 7 M103 26 l-7 7", stroke: "#e0bb62", "stroke-width": 3, "stroke-linecap": "round"}, piuma);
      return piuma;
    }},
  };

  function creaDaneel(contenitore, opz = {}) {
    const dim = opz.dimensione || 40;
    const svg = el("svg", {viewBox: "0 0 200 200", width: dim, height: dim, role: "img", "aria-label": "Daneel"});
    svg.style.overflow = "visible";
    svg.style.touchAction = "manipulation";
    const defs = el("defs", {}, svg);
    const id = "d" + Math.random().toString(36).slice(2, 8);
    const glow = el("filter", {id: id + "g", x: "-50%", y: "-50%", width: "200%", height: "200%"}, defs);
    el("feGaussianBlur", {stdDeviation: "3", result: "b"}, glow);
    const fm = el("feMerge", {}, glow); el("feMergeNode", {in: "b"}, fm); el("feMergeNode", {in: "SourceGraphic"}, fm);
    const clip = el("clipPath", {id: id + "c"}, defs);
    el("rect", {x: 48, y: 70, width: 104, height: 54, rx: 27}, clip);

    const fig = FIGURE[opz.figura] || FIGURE.daneel;
    const testaClip = el("clipPath", {id: id + "t"}, defs);
    el("rect", {x: 32, y: 40, width: 136, height: 122, rx: 46}, testaClip);

    const corpo = el("g", {}, svg);              // tutto ciò che salta e respira
    const dietro = el("g", {}, corpo);           // accessori dietro la testa (antenna, foglie, piuma)
    const orecchie = el("g", {fill: "#c3c9d6"}, corpo);
    el("rect", {x: 22, y: 88, width: 16, height: 30, rx: 7}, orecchie);
    el("rect", {x: 162, y: 88, width: 16, height: 30, rx: 7}, orecchie);
    el("rect", {x: 32, y: 40, width: 136, height: 122, rx: 46, fill: "#e9ecf3"}, corpo);
    el("rect", {x: 40, y: 46, width: 60, height: 16, rx: 8, fill: "#ffffff", opacity: .55}, corpo); // riflesso
    const sopra = el("g", {}, corpo);            // accessori sulla testa (cappello, fascia del calendario)
    const luce = fig.disegna({dietro, sopra, el, id, clipTesta: `url(#${id}t)`});
    el("rect", {x: 48, y: 70, width: 104, height: 54, rx: 27, fill: "#141a2a"}, corpo);
    const visiera = el("g", {"clip-path": `url(#${id}c)`}, corpo);
    const scansione = el("rect", {x: 0, y: 70, width: 14, height: 54, fill: fig.occhi, opacity: 0}, visiera);
    const occhi = el("g", {fill: fig.occhi, stroke: fig.occhi, filter: `url(#${id}g)`}, visiera);
    const occhio = [80, 120].map(cx => ({
      cx,
      tondo: el("ellipse", {cx, cy: 97, rx: 9, ry: 11, stroke: "none"}, occhi),
      arco: el("path", {d: `M${cx - 9} 101 Q${cx} 88 ${cx + 9} 101`, fill: "none", "stroke-width": 5, "stroke-linecap": "round"}, occhi),
    }));
    const guance = el("g", {fill: "#ff8fa3", opacity: 0}, corpo);
    el("ellipse", {cx: 58, cy: 136, rx: 9, ry: 5}, guance);
    el("ellipse", {cx: 142, cy: 136, rx: 9, ry: 5}, guance);
    const bocca = el("path", {stroke: "#6b7385", "stroke-width": 5, fill: "none", "stroke-linecap": "round"}, corpo);
    const zeta = el("text", {x: 150, y: 40, fill: "#8d93a3", "font-size": 26, "font-weight": 700,
      "font-family": "-apple-system, system-ui, sans-serif", opacity: 0}, svg);
    zeta.textContent = "z";
    contenitore.appendChild(svg);

    const s = {
      umore: "calmo", mostrato: "calmo", inizio: performance.now(), salto: 0, tremito: 0,
      palpebre: 1, prossimoBlink: 1500 + Math.random() * 3000, sguardo: {x: 0, y: 0}, guanceV: 0, apertura: 0,
    };

    function tocca() {
      s.salto = 1;
      if (s.umore === "calmo" || s.umore === "dorme") {
        const prima = s.umore;
        imposta("felice");
        clearTimeout(s.tTocco);
        s.tTocco = setTimeout(() => { if (s.umore === "felice") imposta(prima === "dorme" ? "calmo" : prima); }, 1400);
      }
    }
    svg.addEventListener("click", tocca);

    function imposta(u) {
      if (u === s.umore) return;
      s.umore = u;
      if (u === "confuso") s.tremito = 1;
      if (u === "felice") s.salto = Math.max(s.salto, .8);
      s.palpebre = 0; // chiude gli occhi un attimo e cambia espressione "dietro le palpebre"
      s.cambio = performance.now();
    }

    function frame(ora) {
      const t = (ora - s.inizio) / 1000;
      const u = s.umore;
      if (s.cambio && ora - s.cambio > 90) { s.mostrato = u; s.cambio = 0; }
      const m = s.mostrato;

      // palpebre: si riaprono dopo un cambio, e ogni 3-6 s un battito
      if (!fermo && m !== "dorme" && m !== "felice") {
        s.prossimoBlink -= 16;
        if (s.prossimoBlink < 0) { s.palpebre = 0; s.prossimoBlink = 2800 + Math.random() * 3500; }
      }
      s.palpebre = Math.min(1, s.palpebre + (fermo ? 1 : 0.14));

      // sguardo: verso il dito (se recente), in alto a destra quando pensa, altrimenti vaga piano
      let gx = 0, gy = 0;
      if (m === "pensa") { gx = 5 + Math.sin(t * 3) * 2; gy = -5; }
      else if (opz.segui && dito && ora - dito.t < 4000 && m !== "dorme") {
        const r = svg.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const dx = dito.x - cx, dy = dito.y - cy, d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 160);
        gx = dx / d * 7 * k; gy = dy / d * 5 * k;
      } else if (!fermo) { gx = Math.sin(t * .5) * 2.5; gy = Math.sin(t * .37) * 1; }
      s.sguardo.x += (gx - s.sguardo.x) * .15; s.sguardo.y += (gy - s.sguardo.y) * .15;

      // occhi
      const ry = m === "ascolta" ? 13 : m === "confuso" ? 7 : m === "dorme" ? 1.6 : 11;
      const rx = m === "ascolta" ? 10.5 : m === "confuso" ? 7 : m === "dorme" ? 10 : 9;
      occhio.forEach((o, i) => {
        const arco = m === "felice";
        o.tondo.style.display = arco ? "none" : "";
        o.arco.style.display = arco ? "" : "none";
        const x = o.cx + s.sguardo.x, y = 97 + s.sguardo.y;
        o.tondo.setAttribute("cx", x); o.tondo.setAttribute("cy", m === "dorme" ? 100 : y);
        o.tondo.setAttribute("rx", rx);
        o.tondo.setAttribute("ry", Math.max(1.4, ry * (m === "dorme" ? 1 : s.palpebre)));
        if (m === "confuso" && i === 1) o.tondo.setAttribute("ry", Math.max(1.4, ry * 1.5 * s.palpebre));
        o.arco.setAttribute("d", `M${x - 9} ${y + 4} Q${x} ${y - 9} ${x + 9} ${y + 4}`);
      });

      // bocca: sorriso che cambia con l'umore; quando parla si apre e chiude
      if (m === "parla" && !fermo) s.apertura = (Math.sin(t * 16) * .5 + .5) * (Math.sin(t * 3.1) * .3 + .7);
      else s.apertura *= .7;
      const curva = {calmo: 7, ascolta: 4, pensa: 1, parla: 6, felice: 13, dorme: 3, confuso: -4}[m] ?? 6;
      const larg = m === "felice" ? 15 : m === "pensa" ? 8 : 12, bx = m === "pensa" ? 106 : 100;
      const ap = s.apertura * 9;
      bocca.setAttribute("d", ap > .5
        ? `M${bx - larg} 140 Q${bx} ${140 + curva + ap} ${bx + larg} 140 Q${bx} ${140 + ap * .25} ${bx - larg} 140`
        : `M${bx - larg} 140 Q${bx} ${140 + curva} ${bx + larg} 140`);
      bocca.setAttribute("fill", ap > .5 ? "#6b7385" : "none");

      // guance rosa quando è felice
      s.guanceV += ((m === "felice" ? .8 : 0) - s.guanceV) * .12;
      guance.setAttribute("opacity", s.guanceV.toFixed(2));

      // antenna: pulsa quando pensa, si spegne quando dorme, rossa quando è confuso
      const pulsa = m === "pensa" ? .55 + .45 * Math.sin(t * 7) : m === "parla" ? .8 : m === "dorme" ? .25 : 1;
      luce.setAttribute("opacity", fermo ? 1 : (fig.luceColorata ? pulsa : .6 + .4 * pulsa).toFixed(2));
      if (fig.luceColorata) luce.setAttribute("fill", m === "confuso" ? "#ff6b5b" : m === "felice" ? "#7ee0a1" : "#6d9cff");

      // scansione sulla visiera quando pensa
      if (m === "pensa" && !fermo) {
        scansione.setAttribute("x", 48 + ((t * 70) % 120) - 14);
        scansione.setAttribute("opacity", .22);
      } else scansione.setAttribute("opacity", 0);

      // zeta che sale quando dorme
      if (m === "dorme" && !fermo) {
        const f = (t * .4) % 1;
        zeta.setAttribute("opacity", (Math.sin(f * Math.PI) * .9).toFixed(2));
        zeta.setAttribute("x", 146 + f * 14); zeta.setAttribute("y", 44 - f * 24);
        zeta.setAttribute("font-size", 18 + f * 12);
      } else zeta.setAttribute("opacity", 0);

      // corpo: respiro, saltello, dondolio, tremito
      let sy = 1, sx = 1, dy = 0, rot = 0;
      if (!fermo) {
        const lento = m === "dorme" ? .55 : 1;
        const respiro = Math.sin(t * 2.2 * lento) * .025;
        sx = 1 + respiro; sy = 1 - respiro;
        dy = Math.sin(t * 1.1 * lento) * 2.5;
        rot = m === "pensa" ? Math.sin(t * 2.4) * 4 : Math.sin(t * .7) * 1.5;
        if (m === "felice") dy -= Math.abs(Math.sin(t * 7)) * 6;
        if (s.salto > 0) { dy -= Math.sin(s.salto * Math.PI) * 16; sy += Math.sin(s.salto * Math.PI * 2) * .06; s.salto = Math.max(0, s.salto - .045); }
        if (s.tremito > 0) { rot += Math.sin(t * 40) * 6 * s.tremito; s.tremito = Math.max(0, s.tremito - .03); }
        if (opz.segui && dito && ora - dito.t < 4000 && m !== "dorme") rot += s.sguardo.x * .5;
      }
      corpo.setAttribute("transform", `translate(100 ${162 + dy}) rotate(${rot.toFixed(2)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(-100 -162)`);
    }

    const io = {svg, umore: imposta, tocca, frame, get stato() { return s.umore; }};
    tutti.push(io);
    frame(performance.now());
    return io;
  }

  (function giro(ora) {
    for (const d of tutti) if (d.svg.isConnected) d.frame(ora);
    for (let i = tutti.length - 1; i >= 0; i--) if (!tutti[i].svg.isConnected && tutti[i].staccato) tutti.splice(i, 1);
    tutti.forEach(d => { if (!d.svg.isConnected) d.staccato = true; });
    requestAnimationFrame(giro);
  })(performance.now());

  window.creaDaneel = creaDaneel;
  window.DANEEL_SVG = SVG_STATICO;
})();
