"""Dati inventati per provare l'app (e per gli screenshot del README) senza toccare quelli veri.

Uso:  python3 tools/demo-dati.py /tmp/daneel-demo
Crea <cartella>/dati (plancia.db, chat.json), <cartella>/config (token "demo", calendario d'esempio) e <cartella>/corsi
(materiale finto per la sezione Studio). Poi:
  DANEEL_DATI=<cartella>/dati DANEEL_CONFIG=<cartella>/config DANEEL_UNI=<cartella>/corsi .venv/bin/uvicorn server:app --port 8799
e nell'app si entra con il codice "demo". Tutti i numeri sono casuali, con un seme fisso.
"""

import json
import random
import sqlite3
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

random.seed(42)
radice = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/daneel-demo")
dati, config = radice / "dati", radice / "config"
dati.mkdir(parents=True, exist_ok=True)
config.mkdir(parents=True, exist_ok=True)
(config / "token").write_text("demo")
(config / "vapid-pubblica.txt").write_text("BDemoDemoDemoDemoDemoDemoDemoDemoDemoDemoDemoDemoDemoDemoDemoDemoDemoDemoDemoDemoDemo")
oggi = date.today()
GIORNI = 28

db = dati / "plancia.db"
db.unlink(missing_ok=True)
c = sqlite3.connect(db)
c.execute("CREATE TABLE docs (col TEXT, id TEXT, data TEXT NOT NULL, ver INTEGER NOT NULL, ts REAL NOT NULL, PRIMARY KEY (col, id))")


def metti(col, id_, d):
    c.execute("INSERT INTO docs VALUES (?,?,?,?,?)", (col, id_, json.dumps(d, ensure_ascii=False), 1, time.time()))


def k(d):
    return d.isoformat()


def voce(nome, g, kcal100, p, ca, gr):
    f = g / 100
    return {"nome": nome, "g": g, "kcal": round(kcal100 * f), "proteine": round(p * f, 1), "carboidrati": round(ca * f, 1), "grassi": round(gr * f, 1)}


def pasto(*voci):
    return {"voci": list(voci), **{m: round(sum(v[m] for v in voci), 1) for m in ("proteine", "carboidrati", "grassi")},
            "kcal": sum(v["kcal"] for v in voci)}


MENU = {
    "colazione": [lambda: pasto(voce("Yogurt greco 0%", 170, 54, 10.3, 3, 0), voce("Granola", 50, 450, 9, 64, 16), voce("Banana", 120, 89, 1.1, 23, .3)),
                  lambda: pasto(voce("Latte parzialmente scremato", 250, 46, 3.3, 5, 1.6), voce("Fiocchi d'avena", 70, 372, 13, 59, 7))],
    "pranzo": [lambda: pasto(voce("Pasta integrale (cruda)", 120, 340, 13, 64, 2.5), voce("Petto di pollo", 150, 110, 23, 0, 1.5), voce("Olio extravergine", 10, 884, 0, 0, 100)),
               lambda: pasto(voce("Riso basmati (crudo)", 110, 350, 8, 77, 1), voce("Tonno al naturale", 160, 103, 23, 0, 1), voce("Zucchine", 200, 17, 1.2, 3, .3))],
    "merenda": [lambda: pasto(voce("Yogurt greco 0%", 170, 54, 10.3, 3, 0), voce("Granola", 40, 450, 9, 64, 16))],
    "cena": [lambda: pasto(voce("Salmone", 180, 208, 20, 0, 13), voce("Patate", 250, 77, 2, 17, .1), voce("Insalata mista", 100, 20, 1.3, 3, .2)),
             lambda: pasto(voce("Uova", 150, 143, 12.6, .7, 9.5), voce("Pane integrale", 100, 247, 13, 41, 3.4), voce("Spinaci", 150, 23, 2.9, 3.6, .4))],
}
PESI_GIORNI = {0, 2, 4, 5}  # lun=0: pesi mar, gio, ven, dom come nella Plancia
peso = 72.4
for i in range(GIORNI, -1, -1):
    d = oggi - timedelta(days=i)
    w = d.weekday()
    ore = round(random.uniform(6.7, 8.6), 2)
    fine = datetime(d.year, d.month, d.day, random.choice([6, 7, 7, 8]), random.randint(0, 59))
    inizio = fine - timedelta(hours=ore + .1)
    fmt = lambda t: t.strftime("%d %b %Y at %I:%M %p").lstrip("0")
    s = {"data": k(d), "hrv": round(random.gauss(62, 7), 1), "fc_riposo": round(random.gauss(57, 2.5)), "vo2max": 46.2,
         "sonno": {"ore": ore, "profondo": round(ore * random.uniform(.12, .2), 2), "rem": round(ore * random.uniform(.18, .26), 2),
                   "sveglio": round(random.uniform(.05, .3), 2), "inizio": fmt(inizio), "fine": fmt(fine)},
         "aggiornato": fmt(fine)}
    if i > 0:  # i passi e le calorie attive di oggi arrivano domani
        s["passi"] = random.randint(6200, 12800)
        s["kcal attive"] = random.randint(320, 780)
    if i % 4 == 0:
        peso = round(peso - random.uniform(0, .25), 1)
        s["peso"] = peso
    metti("salute", k(d), s)

    h = {x: random.random() < .9 for x in ("sveglia", "acqua", "letto", "colazione", "pranzo", "merenda", "cena", "telefono", "lettura")}
    if w < 5:
        h["studio"] = random.random() < .8
    if w in (1, 3):
        h["muaythai"] = True
    giorno = {"h": h, "sonno": round(ore, 1), "sonnoFonte": "apple"}
    if i > 0 or True:
        cibo = {}
        for nome, opzioni in MENU.items():
            if i == 0 and nome == "cena":
                continue
            if h.get(nome):
                cibo[nome] = random.choice(opzioni)()
        giorno["cibo"] = cibo
    if w in PESI_GIORNI and i > 0:
        h["pesi"] = True
        wid = f"demo{i:02d}"
        es = [("Panca piana (bilanciere)", 70), ("Squat (bilanciere)", 95), ("Stacco rumeno", 85), ("Trazioni zavorrate", 15)]
        esercizi = []
        for nome, kg in random.sample(es, 3):
            serie = [{"kg": kg, "rip": random.choice([5, 6, 8]), "testo": f"{kg}kg x 6 reps", "tipo": "normale"} for _ in range(4)]
            esercizi.append({"nome": nome, "e1rm": round(kg * (1 + 6 / 30)), "serie": serie, "volumeKg": sum(x["kg"] * x["rip"] for x in serie)})
        durata = random.randint(60, 95)
        metti("allenamenti", wid, {"id": wid, "data": k(d), "titolo": "Allenamento", "durataMin": durata, "esercizi": esercizi,
                                    "volumeKg": sum(e["volumeKg"] for e in esercizi), "riepilogo": {"id": wid, "titolo": "Allenamento", "durataMin": durata, "esercizi": 3}})
        giorno["hevy"] = {"id": wid, "titolo": "Allenamento", "durataMin": durata, "esercizi": 3}
    metti("giorni", k(d), giorno)

metti("config", "dieta", {"obiettivoKcal": 2600, "obiettivoProteine": 140})
metti("config", "hevy", {"aggiornato": k(oggi), "inizioStorico": k(oggi - timedelta(days=GIORNI)), "totaleAllenamenti": 64, "utente": "demo"})
storico_libro = [{"d": k(oggi - timedelta(days=x)), "p": max(3, 72 - x * 5)} for x in range(14, -1, -2)]
metti("config", "libro", {"titolo": "Io, robot", "autore": "Isaac Asimov", "percentuale": 72, "pagineTotali": 280, "storico": storico_libro,
                          "daLeggere": ["Abissi d'acciaio", "Il sole nudo", "I robot dell'alba"], "fonte": "demo", "aggiornato": k(oggi), "precedenti": []})

# Portafoglio inventato: due fondi immaginari e un po' di liquidità
serie, titoli, costo = [], 3800.0, 3800.0
for x in range(120, -1, -1):
    d = oggi - timedelta(days=x)
    if x % 30 == 0 and x:
        costo += 200
        titoli += 200
    titoli *= 1 + random.gauss(.0006, .006)
    serie.append({"d": k(d), "titoli": round(titoli), "costo": round(costo, 2), "liq": 620.0})
posizioni = [{"nome": "Fondo Azionario Mondiale (demo)", "isin": "XX0000000001", "quantita": 31.5, "prezzo": 118.2, "prezzo_medio": 104.3},
             {"nome": "Oro fisico (demo)", "isin": "XX0000000002", "quantita": 4.2, "prezzo": 189.6, "prezzo_medio": 176.0}]
for p in posizioni:
    p["valore"] = round(p["quantita"] * p["prezzo"], 2)
    p["costo"] = round(p["quantita"] * p["prezzo_medio"], 2)
    p["guadagno"] = round(p["valore"] - p["costo"], 2)
    p["guadagnoPct"] = round(p["guadagno"] / p["costo"] * 100, 2)
tot_titoli = sum(p["valore"] for p in posizioni)
for p in posizioni:
    p["peso"] = round(p["valore"] / tot_titoli * 100, 1)
metti("portafoglio", "oggi", {"data": k(oggi), "ora": "22:30", "totale": round(tot_titoli + 620, 2), "titoli": round(tot_titoli, 2), "liquidita": 620.0,
                              "costo": round(sum(p["costo"] for p in posizioni), 2), "guadagno": round(sum(p["guadagno"] for p in posizioni), 2),
                              "guadagnoPct": 11.8, "variazioneGiorno": 14.6, "posizioni": posizioni, "movimentiOggi": [], "speseOggi": 0,
                              "scartoLiquidita": 0.0, "nuoviTitoli": [],
                              "commento": "Giornata tranquilla: +14,60 € sui titoli. Il fondo azionario resta il motore del portafoglio (+13%), l'oro tiene. Nessun movimento oggi."})
metti("portafoglio", "storico", {"aggiornato": k(oggi), "serie": serie})
CAT = [("Supermercato", "Spesa"), ("Bar Centrale", "Ristoranti e bar"), ("Libreria", "Svago"), ("Abbonamento palestra", "Sport"),
       ("Treno regionale", "Trasporti"), ("Farmacia", "Salute")]
mov = []
for x in range(60):
    d = oggi - timedelta(days=x)
    for _ in range(random.randint(0, 2)):
        n, cat = random.choice(CAT)
        mov.append({"d": k(d), "n": n, "v": -round(random.uniform(3, 45), 2), "conto": random.choice(["Conto A", "Conto B"]), "tipo": "carta", "cat": cat})
    if d.day == 1:
        mov.append({"d": k(d), "n": "Stipendio (demo)", "v": 900.0, "conto": "Conto A", "tipo": "bonifico", "cat": "Entrate"})
metti("portafoglio", "spese", {"aggiornato": k(oggi), "movimenti": mov})

# Calendario d'esempio (un file .ics locale: il server lo legge come se fosse l'indirizzo segreto di Google)
ev, n = [], 0
for x in range(-2, 8):
    d = oggi + timedelta(days=x)
    for (h1, m1, h2, m2, titolo) in [(7, 30, 8, 0, "🌅 Sveglia e colazione"), (9, 0, 11, 0, "📖 Studio"), (13, 0, 13, 45, "🍝 Pranzo"),
                                     (18, 0, 19, 30, "🏋️ Palestra"), (20, 0, 20, 45, "🍽️ Cena")]:
        n += 1
        ev.append(f"BEGIN:VEVENT\r\nUID:demo{n}@daneel\r\nDTSTART;TZID=Europe/Rome:{d:%Y%m%d}T{h1:02d}{m1:02d}00\r\n"
                  f"DTEND;TZID=Europe/Rome:{d:%Y%m%d}T{h2:02d}{m2:02d}00\r\nSUMMARY:{titolo}\r\nEND:VEVENT")
ics = radice / "agenda-demo.ics"
ics.write_text("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Daneel demo//IT\r\nX-WR-TIMEZONE:Europe/Rome\r\n" + "\r\n".join(ev) + "\r\nEND:VCALENDAR\r\n")
(config / "calendari.json").write_text(json.dumps({"calendari": [{"nome": "Demo", "ics": ics.resolve().as_uri()}]}))

# Pacchi d'esempio (codici inventati)
def ev(giorni_fa, ora, dove, cosa, fase):
    return {"quando": f"{oggi - timedelta(days=giorni_fa)}T{ora}:00+01:00", "dove": dove, "cosa": cosa, "fase": fase}
metti("pacchi", "DEMO000123456IT", {"codice": "DEMO000123456IT", "nome": "Cavo USB-C", "corriere": "Poste Italiane", "fonte": "poste",
    "fase": "consegna", "aggiunto": str(oggi - timedelta(days=3)), "controllato": time.time(), "eventi": [
        ev(3, "10:12", "Milano", "Spedizione accettata", "attesa"), ev(2, "06:40", "Centro di smistamento Bologna", "In transito", "viaggio"),
        ev(1, "21:05", "Torino", "Arrivata al centro di distribuzione", "viaggio"), ev(0, "08:02", "Torino", "In consegna", "consegna")]})
metti("pacchi", "DEMO987654321000000000000", {"codice": "DEMO987654321000000000000", "nome": "Paratibie", "corriere": "InPost", "fonte": "inpost",
    "fase": "viaggio", "aggiunto": str(oggi - timedelta(days=1)), "controllato": time.time(), "eventi": [
        ev(1, "15:30", "", "Etichetta creata", "attesa"), ev(0, "07:15", "", "In viaggio verso il locker", "viaggio")]})

# Studio: due corsi d'esempio con un TEORIA.docx e qualche PDF finti, per la sezione Studio (studio.py, DANEEL_UNI)
import zipfile  # noqa: E402

def pdf(percorso, pagine):
    """Un PDF minimo valido con N pagine vuote (pdfinfo ne legge il numero)."""
    ogg = ["<< /Type /Catalog /Pages 2 0 R >>",
           "<< /Type /Pages /Kids [" + " ".join(f"{3 + i} 0 R" for i in range(pagine)) + f"] /Count {pagine} >>"]
    ogg += ["<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>"] * pagine
    out, pos = b"%PDF-1.4\n", []
    for i, o in enumerate(ogg, 1):
        pos.append(len(out)); out += f"{i} 0 obj\n{o}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(ogg) + 1}\n0000000000 65535 f \n".encode() + b"".join(f"{p:010d} 00000 n \n".encode() for p in pos)
    out += f"trailer\n<< /Size {len(ogg) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    percorso.parent.mkdir(parents=True, exist_ok=True); percorso.write_bytes(out)

def teoria(percorso, parole, immagini):
    testo = " ".join(random.choice(["mercato", "domanda", "offerta", "costo", "prezzo", "equilibrio", "impresa", "bilancio"]) for _ in range(parole))
    percorso.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(percorso, "w") as z:
        z.writestr("word/document.xml", f"<w:document><w:body><w:p><w:r><w:t>{testo}</w:t></w:r></w:p></w:body></w:document>")
        for i in range(immagini):
            z.writestr(f"word/media/image{i}.png", b"")

corsi = radice / "corsi"
teoria(corsi / "Microeconomia" / "TEORIA.docx", 30000, 40)
pdf(corsi / "Microeconomia" / "Esercizi" / "Esercizi capitolo 1-6.pdf", 40)
for d in ("12-01-2026", "02-02-2026"):
    pdf(corsi / "Microeconomia" / "Esercizi" / f"Appello {d}.pdf", 4)
teoria(corsi / "Contabilità" / "TEORIA.docx", 24000, 15)
pdf(corsi / "Contabilità" / "Esercizi" / "Esercizi di contabilità.pdf", 70)
for d in ("19-01-2026", "09-02-2026", "26-01-2025", "16-02-2025"):
    pdf(corsi / "Contabilità" / "Esercizi" / f"Appello {d}.pdf", 6)
g = lambda n: str(oggi + timedelta(days=n))  # noqa: E731
metti("studio", "impostazioni", {
    "esami": [
        {"id": "micro", "nome": "Microeconomia", "breve": "MICRO", "cartella": "Microeconomia", "data": g(70), "riserva": g(86),
         "tipo": "scritto", "durata_ore": 1, "cfu": 8, "nota": "Scritto di 1 ora."},
        {"id": "conta", "nome": "Contabilità", "breve": "CONTA", "cartella": "Contabilità", "data": g(77), "riserva": g(91),
         "tipo": "pc", "durata_ore": 2, "cfu": 8, "nota": "Esame al PC + progetto di gruppo.",
         "scadenze": [{"nome": "Consegna del progetto", "giorni_prima": 10}]},
    ],
    "inizio_sessione": g(45), "inizio_lezioni": g(-45), "fine_lezioni": g(60), "festivi": []})

c.commit()
c.close()

# Una chat d'esempio
t = time.time() - 3 * 3600
chat = [
    ("sistema", "⏰ Routine del mattino"),
    ("daneel", "☀️ Buongiorno! Com'è andata la routine di stamattina?\n\n1. Sveglia entro le 8?\n2. Due bicchieri d'acqua?\n3. Letto rifatto?\n\nOggi cambia qualcosa rispetto al solito?"),
    ("gabriele", "Sveglia alle 7:20, acqua e letto fatti. Oggi palestra alle 18"),
    ("daneel", "Segnato sulla Plancia ✅ sveglia, acqua e letto. La palestra delle 18 è già in calendario 💪 Recupero a 71: puoi spingere."),
    ("gabriele", "Cercami un cavo USB-C da 2 metri su Amazon, max 15 euro"),
    ("daneel", "🔌 Ecco i 3 migliori sotto i 15 €:\n\n**1. Cavo USB-C 100W, 2 m, nylon**: **8,99 €**, ★4,7 (40.000 recensioni)\n**2. Cavo USB-C 240W, 2 m, confezione da 2**: **11,99 €**, ★4,6\n**3. Cavo USB-C 60W, 2 m**: **6,49 €**, ★4,5\n\n**Prenderei il primo**: il più recensito, lungo proprio 2 m e con 100W carica anche un portatile."),
]
msg = []
for i, (ruolo, testo) in enumerate(chat):
    m = {"ruolo": ruolo, "testo": testo, "ts": t + i * 600}
    if i == 4:
        m["via"] = None
    msg.append(m)
(dati / "chat.json").write_text(json.dumps({"sessione": None, "messaggi": msg}, ensure_ascii=False, indent=1))
print("demo pronta in", radice)
