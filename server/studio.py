"""La sezione Studio della Plancia: per ogni esame dice se basta cominciare il 27/12 e come dividere il tempo.

Richiesta di Gabriele (2026-11-03): sapendo la data dell'appello, l'app dice quando partire e con quali fasi (teoria,
esercizi, simulazioni d'esame, una settimana di solo ripasso), in base a quanto materiale c'è davvero. Solo conti,
nessun modello. Le regole (scelte con Gabriele, con le fonti):

- Abitudine di Gabriele: durante il semestre vede tutta la teoria una volta; la preparazione vera parte il 27/12.
  Quindi: prima passata entro il 27/12 (si mostrano le ore a settimana che servono), poi dal 27/12 seconda passata,
  esercizi, simulazioni e ripasso. Se dal 27/12 non basta, il piano anticipa e lo dice.
- Monte ore ufficiale: 1 CFU = 25 ore, al PoliTo 10 di lezione e 15 di studio autonomo; i tre corsi sono da 8 CFU,
  quindi ~120 ore di studio a testa. Serve da controllo: se il materiale dà molto di più o molto di meno, lo si dice.
- Teoria: le parole del TEORIA.docx (proiettate a fine corso, il file cresce a ogni lezione) alla velocità di lettura
  per imparare, ~140 parole al minuto (Carver), più qualche minuto per immagine. Una passata per fase.
- Esercizi: le pagine dei PDF di esercizi; simulazioni: i temi d'esame trovati (da 3 a 6), durata della prova × 1,5.
- Ore al giorno: al massimo 4 di studio attivo (regola pratica dei planner: 3-5), meno gli impegni del calendario.
- Gli esami si mettono in fila dal primo e ognuno riempie all'indietro i giorni liberi: prima il ripasso (gli ultimi
  7 giorni), poi simulazioni, esercizi e teoria. Se il tempo non basta, si dice quante ore mancano.

Le date vengono dal portale (screenshot di Gabriele del 2026-11-03): si usa il primo appello, il secondo è di riserva."""

import asyncio
import os
import re
import subprocess
import time
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Header

import plancia

router = APIRouter(prefix="/api/studio")
COL, IMPOSTAZIONI = "studio", "impostazioni"
UNI = Path(os.environ.get("DANEEL_UNI", Path.home() / "universita/magistrale/anno 1"))
_controlla = None
_cache: dict = {}

PREDEFINITE = {
    # esami d'esempio: quelli veri stanno nel documento studio/impostazioni della Plancia (si scrive con plancia-db)
    "esami": [
        {"id": "micro", "nome": "Microeconomia", "breve": "MICRO", "cartella": "Microeconomia",
         "data": "2027-01-18", "riserva": "2027-02-03", "tipo": "scritto", "durata_ore": 1, "cfu": 8,
         "nota": "Scritto di 1 ora."},
        {"id": "conta", "nome": "Contabilità", "breve": "CONTA", "cartella": "Contabilità",
         "data": "2027-01-25", "riserva": "2027-02-08", "tipo": "pc", "durata_ore": 2, "cfu": 8,
         "nota": "Esame al PC + progetto di gruppo.",
         "scadenze": [{"nome": "Consegna del progetto", "giorni_prima": 10}],
         "escludi": []},   # percorsi (relativi alla cartella) da non contare
    ],
    "inizio_sessione": "2026-12-27",   # da qui la preparazione seria
    "inizio_lezioni": "2026-09-21",
    "fine_lezioni": "2027-01-15",      # da confermare con il calendario accademico
    "ore_max_giorno": 4,               # studio attivo in sessione
    "ore_max_prima": 2,                # prima del 27/12, se serve anticipare (ci sono ancora le lezioni)
    "festivi": ["2026-12-31", "2027-01-01"],
    "ore_festivi": 1,
    "parole_minuto": 140,              # lettura per imparare (Carver)
    "minuti_immagine": 1.5,
    "minuti_pagina_esercizi": 12,      # una pagina di esercizi svolta e corretta
    "quota_esercizi": 0.2,             # esercizi attesi: 20% delle ore di studio dei CFU, finché i file non ci sono
    "simulazioni_min": 3, "simulazioni_max": 6,
    "ripasso_giorni": 7, "ripasso_ore_giorno": 2,
    "ore_studio_cfu": 15,
}
FASI = [("teoria", "Teoria, seconda passata"), ("esercizi", "Esercizi"), ("simulazioni", "Simulazioni d'esame"),
        ("ripasso", "Ripasso")]


def collega(controlla):
    global _controlla
    _controlla = controlla


def _impostazioni() -> dict:
    d, _ = plancia._leggi(COL, IMPOSTAZIONI)
    if not d:
        plancia._scrivi(COL, IMPOSTAZIONI, PREDEFINITE)
        d = PREDEFINITE
    return {**PREDEFINITE, **d}


# ---------- materiale ----------

def _docx(p: Path) -> dict:
    try:
        with zipfile.ZipFile(p) as z:
            xml = z.read("word/document.xml").decode("utf-8", "ignore")
            immagini = sum(1 for n in z.namelist() if n.startswith("word/media/"))
    except Exception:  # noqa: BLE001
        return {"parole": 0, "immagini": 0}
    testo = re.sub(r"<[^>]+>", " ", xml.replace("</w:p>", "\n"))
    return {"parole": len(re.findall(r"\w+", testo)), "immagini": immagini}


def _pagine_pdf(p: Path) -> int:
    try:
        out = subprocess.run(["pdfinfo", str(p)], capture_output=True, text=True, timeout=20).stdout
        m = re.search(r"^Pages:\s+(\d+)", out, re.M)
        return int(m.group(1)) if m else 0
    except Exception:  # noqa: BLE001
        return 0


SALTA = re.compile(r"scheda insegnamento|orari|lettura|lavoro di gruppo|istruzioni|proposta", re.I)
APPELLO = re.compile(r"appello|tema d.esame|compito|simulazion|domande", re.I)


def _materiale(cartella: str, escludi: tuple = ()) -> dict:
    base = UNI / cartella
    m = {"parole": 0, "immagini": 0, "teoria_aggiornata": None,
         "slide_pagine": 0, "esercizi_pagine": 0, "esercizi_file": 0, "appelli": 0, "lezioni": 0}
    if not base.exists():
        return m
    t = base / "TEORIA.docx"
    if t.exists():
        m.update(_docx(t))
        m["teoria_aggiornata"] = date.fromtimestamp(t.stat().st_mtime).isoformat()
    temi = set()   # lo stesso appello svolto da studenti diversi conta una volta sola: si conta per data
    for p in sorted(base.rglob("*.pdf")):
        rel = p.relative_to(base).as_posix()
        if SALTA.search(rel) or rel.count("/") > 1 or rel in escludi or re.match(r"(BPMN|ClassDiagram)_", p.name):
            continue
        if APPELLO.search(p.name):
            d = re.search(r"\d{1,2}[-_.]\d{1,2}[-_.]\d{2,4}", p.name)
            temi.add(d.group(0) if d else p.stem)
            m["appelli"] = len(temi)
        elif p.parent.name.lower() == "esercizi" or re.search(r"eserciz|esercitaz", p.name, re.I):
            m["esercizi_file"] += 1
            m["esercizi_pagine"] += _pagine_pdf(p)
        else:
            m["slide_pagine"] += _pagine_pdf(p)
    reg = Path.home() / "universita/registrazioni"
    if reg.exists():
        nomi = {re.sub(r" - Parte \d+.*", "", f.stem) for f in reg.iterdir()}
        m["lezioni"] = sum(1 for n in nomi if n.lower().startswith(cartella.lower()))
    return m


# ---------- ore ----------

def _r(x: float) -> float:
    return round(x * 2) / 2


def _ore(e: dict, m: dict, imp: dict, oggi: date) -> dict:
    d0, d1 = date.fromisoformat(imp["inizio_lezioni"]), date.fromisoformat(imp["fine_lezioni"])
    fatto = max(1, (min(oggi, d1) - d0).days)
    avanzamento = min(1.0, fatto / max(1, (d1 - d0).days))          # quanto del corso è passato (0-1)
    proiezione = min(3.0, max(1.0, 1 / avanzamento))                 # quanto crescerà ancora il TEORIA
    parole = m["parole"] * proiezione
    passata = parole / imp["parole_minuto"] / 60 + m["immagini"] * proiezione * imp["minuti_immagine"] / 60
    if not m["parole"]:
        passata = m["slide_pagine"] * proiezione * 4 / 60                # niente TEORIA: 4 minuti a slide
    cfu = e.get("cfu", 8) * imp["ore_studio_cfu"]
    # Esercizi: i file si raccolgono durante il corso (Gabriele non li ha ancora cercati tutti), quindi finché il corso
    # non è finito la stima misurata si mescola con una attesa dai CFU, che pesa sempre meno; mai sotto il misurato.
    misurati = m["esercizi_pagine"] * imp["minuti_pagina_esercizi"] / 60
    attesi = cfu * imp["quota_esercizi"]
    esercizi = max(misurati, (1 - avanzamento) * attesi + avanzamento * misurati)
    n_sim = max(imp["simulazioni_min"], min(imp["simulazioni_max"], m["appelli"]))
    simulazioni = n_sim * e.get("durata_ore", 2) * 1.5                   # la prova a tempo + la correzione
    ripasso = imp["ripasso_giorni"] * imp["ripasso_ore_giorno"]
    sessione = passata + esercizi + simulazioni + ripasso
    stime = []
    if avanzamento < 1:
        stime.append(f"TEORIA proiettato a fine corso (×{proiezione:.1f}): oggi è al {avanzamento:.0%} delle lezioni")
    if misurati < esercizi:
        stime.append(f"esercizi: trovati {misurati:.0f} h, ne conto {esercizi:.0f} finché non aggiungi altri file")
    if m["appelli"] < imp["simulazioni_min"]:
        stime.append(f"temi d'esame: trovati {m['appelli']}, ne conto {imp['simulazioni_min']}")
    return {"prima_passata": _r(passata), "teoria": _r(passata), "esercizi": _r(esercizi),
            "simulazioni": _r(simulazioni), "ripasso": _r(ripasso), "sessione": _r(sessione),
            "totale": _r(passata + sessione), "cfu_ore": cfu, "n_simulazioni": n_sim,
            "proiezione": round(proiezione, 2), "parole_previste": int(parole),
            "avanzamento": round(avanzamento, 2), "stime": stime}


def _capacita(oggi: date, fine: date, imp: dict) -> dict[date, float]:
    occupato: dict[date, float] = {}
    try:
        for ev in plancia._eventi(oggi, fine + timedelta(days=1)):
            s, f = ev["start"].get("dateTime"), ev["end"].get("dateTime")
            if not s or not f or ev.get("status") == "cancelled":
                continue
            s, f = datetime.fromisoformat(s), datetime.fromisoformat(f)
            g = s.date()
            a = max(s.hour + s.minute / 60, 8)
            b = min(f.hour + f.minute / 60 if f.date() == g else 24, 20)
            if b > a:
                occupato[g] = occupato.get(g, 0) + (b - a)
    except Exception:  # noqa: BLE001  (niente calendario: si usa solo il massimo)
        pass
    inizio = date.fromisoformat(imp["inizio_sessione"])
    cap, g = {}, oggi
    while g < fine:
        if g.isoformat() in imp["festivi"]:
            c = imp["ore_festivi"]
        else:
            mx = imp["ore_max_giorno"] if g >= inizio else imp["ore_max_prima"]
            c = max(0.5, min(mx, 12 - occupato.get(g, 0) - 2))      # 12 ore di giornata utile, 2 per pasti e pause
        cap[g] = float(c)
        g += timedelta(days=1)
    return cap


# ---------- piano ----------

def _piano() -> dict:
    imp = _impostazioni()
    oggi = date.today()
    inizio_s = date.fromisoformat(imp["inizio_sessione"])
    esami = sorted((dict(e) for e in imp["esami"]), key=lambda e: e["data"])
    ultima = max(date.fromisoformat(e["data"]) for e in esami)
    libero = _capacita(oggi, ultima, imp)
    giorni: dict[str, list] = {}

    def prendi(e, k, g, h):
        libero[g] -= h
        giorni.setdefault(g.isoformat(), []).append([e["id"], k, h])
        f = e["fasi"][k]
        f["a"] = f["a"] or g.isoformat()
        f["da"] = g.isoformat()

    for e in esami:
        dx = date.fromisoformat(e["data"])
        m = _materiale(e["cartella"], tuple(e.get("escludi", [])))
        ore = _ore(e, m, imp, oggi)
        e["materiale"], e["ore"] = m, ore
        e["fasi"] = {k: {"nome": n, "ore": ore[k], "da": None, "a": None, "mancano": 0.0} for k, n in FASI}
        # ripasso: solo negli ultimi giorni prima dell'esame
        resta, g = ore["ripasso"], dx - timedelta(days=1)
        while resta > 0 and g >= oggi and g > dx - timedelta(days=imp["ripasso_giorni"] + 1):
            h = min(libero.get(g, 0), imp["ripasso_ore_giorno"], resta)
            if h > 0:
                prendi(e, "ripasso", g, h); resta -= h
            g -= timedelta(days=1)
        e["fasi"]["ripasso"]["mancano"] = resta
        # le altre fasi riempiono all'indietro i giorni che restano liberi, da prima del ripasso
        rd = e["fasi"]["ripasso"]["da"]
        g = date.fromisoformat(rd) - timedelta(days=1) if rd else dx - timedelta(days=1)
        for k in ("simulazioni", "esercizi", "teoria"):
            resta = ore[k]
            while resta > 0 and g >= oggi:
                h = min(libero.get(g, 0), resta)
                if h > 0:
                    prendi(e, k, g, h); resta -= h
                if libero.get(g, 0) <= 0 or resta > 0:
                    g -= timedelta(days=1)
            e["fasi"][k]["mancano"] = resta
        inizi = [f["da"] for f in e["fasi"].values() if f["da"]]
        e["inizio"] = min(inizi) if inizi else None
        e["anticipa"] = bool(e["inizio"] and e["inizio"] < inizio_s.isoformat())
        e["mancano"] = sum(f["mancano"] for f in e["fasi"].values())
        e["giorni_mancanti"] = (dx - oggi).days
        settimane = max(1.0, (inizio_s - oggi).days / 7)
        e["prima_passata"] = {"entro": inizio_s.isoformat(), "ore": ore["prima_passata"],
                              "ore_settimana": _r(ore["prima_passata"] / settimane)}
        e["scadenze"] = [{"nome": s["nome"], "data": (dx - timedelta(days=s["giorni_prima"])).isoformat()}
                         for s in e.get("scadenze", [])]
    # margine: ore ancora libere in sessione dopo aver messo tutti gli esami
    margine = sum(h for g, h in libero.items() if inizio_s <= g < ultima and h > 0)
    # storico: le ore stimate di ogni giorno, per vedere come cambia il piano mentre il materiale cresce
    storico, _ = plancia._leggi(COL, "storico")
    storico = storico or {}
    storico[oggi.isoformat()] = {e["id"]: {"sessione": e["ore"]["sessione"], "inizio": e["inizio"]} for e in esami}
    storico = {k: storico[k] for k in sorted(storico)[-90:]}
    plancia._scrivi(COL, "storico", storico)
    prima = [k for k in sorted(storico) if k <= (oggi - timedelta(days=7)).isoformat()]
    rif = storico[prima[-1]] if prima else storico[min(storico)]
    for e in esami:
        e["consigli"] = _consigli(e, oggi, esami, imp)
        e["fase_oggi"] = next((k for k, f in e["fasi"].items()
                               if f["da"] and f["da"] <= oggi.isoformat() <= f["a"]), None)
        r = rif.get(e["id"])
        e["andamento"] = {"dal": prima[-1] if prima else min(storico),
                          "ore": _r(e["ore"]["sessione"] - r["sessione"]) if r else 0, "inizio": r["inizio"] if r else None}
    return {"oggi": oggi.isoformat(), "inizio_sessione": inizio_s.isoformat(), "esami": esami, "giorni": giorni,
            "oggi_piano": giorni.get(oggi.isoformat(), []), "margine_ore": _r(margine),
            "ipotesi": {k: imp[k] for k in ("parole_minuto", "minuti_immagine", "minuti_pagina_esercizi",
                                            "ripasso_giorni", "ripasso_ore_giorno", "ore_max_giorno", "ore_max_prima",
                                            "fine_lezioni", "ore_studio_cfu")},
            "calcolato": time.time()}


def _consigli(e: dict, oggi: date, esami: list, imp: dict) -> list[str]:
    c, m, o = [], e["materiale"], e["ore"]
    dx = date.fromisoformat(e["data"])
    if e["mancano"] > 0:
        c.append(f"⚠️ Mancano {e['mancano']:.0f} ore anche usando ogni giorno libero: anticipa, oppure valuta il "
                 f"secondo appello ({_gg(e.get('riserva'))}).")
    elif e["anticipa"]:
        c.append(f"⏩ Dal {_gg(imp['inizio_sessione'])} non basta: per questo esame conviene iniziare il {_gg(e['inizio'])}.")
    if o["totale"] > o["cfu_ore"] * 1.3:
        c.append(f"📚 Il materiale richiede ~{o['totale']:.0f} ore, più delle ~{o['cfu_ore']} previste dai CFU: è un corso "
                 "lungo, tieni il passo con la teoria durante il semestre.")
    elif o["totale"] < o["cfu_ore"] * 0.5:
        c.append(f"🔎 Il materiale misurato vale solo ~{o['totale']:.0f} ore contro le ~{o['cfu_ore']} dei CFU: forse "
                 "mancano file nella cartella o lezioni nel TEORIA.")
    for a in esami:
        da = date.fromisoformat(a["data"])
        if a is not e and 0 < (dx - da).days <= 7:
            c.append(f"📅 È a {(dx - da).days} giorni da {a['breve']} ({_gg(a['data'])}): la teoria di {e['breve']} va "
                     f"fatta prima, perché a ridosso di {a['breve']} ci sarà il suo ripasso.")
    for s in e.get("scadenze", []):
        c.append(f"📌 {s['nome']}: entro il {_gg(s['data'])}.")
    if m["appelli"] >= 3:
        c.append(f"📝 Nella cartella ci sono {m['appelli']} temi d'esame: usali per le simulazioni, a tempo e senza appunti.")
    else:
        c.append("📝 Non ci sono abbastanza temi d'esame nella cartella: procurane almeno 3 prima delle simulazioni.")
    if m["teoria_aggiornata"] and (oggi - date.fromisoformat(m["teoria_aggiornata"])).days > 10:
        c.append(f"📄 Il TEORIA non si aggiorna dal {_gg(m['teoria_aggiornata'])}: mancano delle lezioni?")
    c += ["🧠 Teoria: a fine capitolo chiudi il file e scrivi a memoria i punti chiave, poi controlla.",
          "🔁 Riprendi ogni capitolo dopo circa 1, 3 e 7 giorni con 15-20 minuti di domande a memoria.",
          "🔀 Esercizi: alterna tipi diversi invece di farne dieci uguali di fila.",
          "🌙 Il giorno prima dell'esame: solo schemi e i tuoi errori tipici, niente argomenti nuovi."]
    return c


def _gg(iso: str | None) -> str:
    if not iso:
        return "—"
    d = date.fromisoformat(iso)
    return f"{d.day}/{d.month}"


@router.get("/piano")
async def piano(authorization: str | None = Header(None)):
    _controlla(authorization)
    if _cache.get("t", 0) > time.time() - 600 and _cache.get("giorno") == date.today().isoformat():
        return _cache["piano"]
    p = await asyncio.to_thread(_piano)
    _cache.update(t=time.time(), giorno=date.today().isoformat(), piano=p)
    return p
