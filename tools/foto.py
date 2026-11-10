"""Rifà tutti gli screenshot del README su un'istanza demo (dati inventati da tools/demo-dati.py).

Uso (sul server, dove c'è Playwright):
  python3 tools/demo-dati.py /tmp/daneel-demo
  DANEEL_DATI=/tmp/daneel-demo/dati DANEEL_CONFIG=/tmp/daneel-demo/config DANEEL_UNI=/tmp/daneel-demo/corsi \
      .venv/bin/uvicorn server:app --port 8799 &
  ~/opt/hevy-venv/bin/python tools/foto.py docs/screenshots

Chromium, 390×664 a 3×, sempre in modalità scura. Il prodotto della foto 7 e il 404 della 12 sono risposte finte
(`route`), così non dipendono da Open Food Facts.
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/screenshots")
OUT.mkdir(parents=True, exist_ok=True)
URL = "http://127.0.0.1:8799/"
UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
      "Version/18.0 Mobile/15E148 Safari/604.1")

PRODOTTO = {"ean": "8000500310427", "nome": "Cioccolato fondente 70% (demo)", "marca": "Marca Demo", "porzioneG": 25,
            "porzione": "25 g", "immagine": None,
            "per100": {"kcal": 570, "proteine": 8.5, "carboidrati": 36, "grassi": 42}}


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 664}, device_scale_factor=3, is_mobile=True, has_touch=True,
                            color_scheme="dark", user_agent=UA)
        ctx.add_init_script("try{localStorage.setItem('daneel-token','demo')}catch(e){}")
        ctx.route("**/api/cibo/prodotto/8000500310427", lambda r: r.fulfill(
            status=200, content_type="application/json", body=json.dumps(PRODOTTO)))
        ctx.route("**/api/cibo/prodotto/2000000000008", lambda r: r.fulfill(
            status=404, content_type="application/json", body=json.dumps({"detail": "Prodotto non trovato"})))
        pg = ctx.new_page()
        pg.goto(URL)
        pg.wait_for_timeout(1500)

        def foto(nome):
            pg.screenshot(path=str(OUT / nome))
            print("ok", nome)

        def frame():
            return next(f for f in pg.frames if f != pg.main_frame)

        def vai(scheda, attesa=2200):
            pg.evaluate("id => { scheda(id); nascondiRete(); }", scheda)
            pg.wait_for_timeout(attesa)

        # 13 · la rete (ferma, con un angolo bello)
        # sceglie l'angolo in cui i nodi stanno più lontani dalla mascotte e fra loro (nessuno ne copre un altro)
        pg.evaluate("""() => {
          vy = 0; vp = 0; ultimoTocco = Date.now() + 1e9;
          let migliore = null;
          for (let a = 0; a < 6.28; a += 0.1) for (const pi of [0.25, 0.4, 0.55]) {
            yaw = a; pitch = pi; disegnaRete(0);
            const c = centroRete, pts = nodi.map(n => n.p);
            let m = 1e9;
            pts.forEach((p, i) => { m = Math.min(m, Math.hypot(p.x - c.x, p.y - c.y) - 30);
              pts.forEach((q, j) => { if (j > i) m = Math.min(m, Math.hypot(p.x - q.x, p.y - q.y)); }); });
            if (!migliore || m > migliore.m) migliore = {m, a, pi};
          }
          yaw = migliore.a; pitch = migliore.pi;
        }""")
        pg.wait_for_timeout(500)
        foto("13-rete.png")

        # 1 · chat, 2 · menu dei subagenti
        vai("chat", 1500)
        foto("1-chat.png")
        pg.click("#agenti")
        pg.wait_for_timeout(600)
        foto("2-subagenti.png")
        pg.evaluate("chiudiTendina()")

        # schede della Plancia
        for nome, scheda in [("3-oggi.png", "oggi"), ("4-salute.png", "salute"), ("5-cibo.png", "cibo"), ("6-soldi.png", "soldi"),
                             ("11-pacchi.png", "pacchi"), ("14-allenamento.png", "allenamento"), ("15-letture.png", "letture")]:
            vai(scheda)
            foto(nome)

        # 16 · Salute: la card Malattia (tre giorni inventati, con i dati di salute accanto alla media)
        vai("salute")
        frame().evaluate("() => document.querySelector('.card.mal').scrollIntoView({block: 'start'}); window.scrollBy(0, -72)")
        pg.wait_for_timeout(900)
        foto("16-malattia.png")

        # 9-10 · Studio e il suo dettaglio
        vai("oggi")
        frame().evaluate("() => document.querySelector('section[aria-label=\"Studio\"]').scrollIntoView()")
        pg.wait_for_timeout(800)
        foto("9-studio.png")
        frame().locator(".st-corsia").first.click()
        pg.wait_for_timeout(900)
        foto("10-studio-dettaglio.png")

        # 7 · prodotto da codice a barre, 12 · codice che non c'è (nuovo alimento)
        vai("cibo")
        fr = pg.frame_locator("#pagina")
        fr.locator("#cbScan").click()
        fr.locator("#cbEan").fill("8000500310427")
        fr.locator("#cbVai").click()
        pg.wait_for_timeout(900)
        foto("7-cibo-prodotto.png")
        pg.reload()
        pg.wait_for_timeout(1500)
        vai("cibo")
        fr = pg.frame_locator("#pagina")
        fr.locator("#cbScan").click()
        fr.locator("#cbEan").fill("2000000000008")
        fr.locator("#cbVai").click()
        pg.wait_for_timeout(900)
        for campo, valore in [("naNome", "Skyr bianco"), ("naMarca", "Latteria"), ("naKcal", "63"), ("naProt", "11"),
                              ("naCarb", "4"), ("naGrassi", "0,2"), ("naPorz", "150")]:
            fr.locator("#" + campo).fill(valore)
        foto("12-cibo-nuovo.png")

        # 8 · le mascotte: sette umori e i sette subagenti (collage senza barra)
        pg.reload()
        pg.wait_for_timeout(800)
        pg.set_viewport_size({"width": 1000, "height": 400})
        pg.evaluate("""() => {
          document.querySelectorAll('body > *').forEach(e => e.style.display = 'none');
          const g = document.createElement('div');
          g.style.cssText = 'position:fixed;inset:0;z-index:99;background:#0f1115;padding:24px;display:flex;flex-direction:column;gap:22px;color:#8d93a3;font:15px system-ui';
          const riga = (voci) => { const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:26px';
            voci.forEach(([nome, opz, umore]) => { const c = document.createElement('div'); c.style.cssText = 'text-align:center;width:100px';
              const s = document.createElement('div'); c.appendChild(s); creaDaneel(s, Object.assign({dimensione: 84}, opz)).umore(umore || 'calmo');
              c.append(nome); r.appendChild(c); }); g.appendChild(r); };
          riga(['calmo', 'ascolta', 'pensa', 'parla', 'felice', 'dorme', 'confuso'].map(u => [u, {}, u]));
          riga([['Daneel', {}], ['Calendario', {figura: 'calendario'}], ['Postino', {figura: 'postino'}],
                ['Nutrizionista', {figura: 'nutrizionista'}], ['Coach', {figura: 'coach'}], ['Medico', {figura: 'medico'}], ['Amanuense', {figura: 'amanuense'}]]);
          document.body.appendChild(g);
        }""")
        pg.wait_for_timeout(1200)
        foto("8-mascotte.png")
        b.close()


main()
