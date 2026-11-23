"""La scheda Pacchi dell'app: si scrive un codice di spedizione e si vede il percorso del pacco su una timeline.

Da dove arrivano i dati (scelta di Gabriele, 2026-11-02: prima i corrieri gratis, poi Ship24):
- Poste Italiane e SDA: il servizio pubblico di poste.it (DQ-REST), gratis e senza chiave;
- InPost: l'API pubblica ShipX di InPost Italia, gratis e senza chiave (codici di 24 cifre);
- Amazon (facoltativo): se l'account è collegato con la libreria amazon-orders, gli ordini in arrivo si aggiungono da
  soli e lo stato (tradotto in italiano) arriva da Amazon, senza consumare la quota di Ship24;
- tutti gli altri (DHL, GLS, BRT, UPS, Mondial Relay… e i codici TBA di Amazon): Ship24, con la chiave in
  ~/.config/daneel-app/ship24 (piano gratuito: 10 pacchi al mese). /trackers/track è idempotente: un pacco consuma
  la quota una volta sola.

I pacchi stanno nella Plancia (collezione "pacchi", un documento per codice), così la pagina si aggiorna in diretta e
finiscono nel backup notturno. Un controllo ogni ora aggiorna quelli in viaggio e manda una notifica quando cambia la
fase (in viaggio, in consegna, da ritirare, consegnato, problema). I consegnati spariscono da soli dopo 14 giorni.
Niente modelli: solo richieste ai corrieri."""

import asyncio
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException

import plancia

router = APIRouter(prefix="/api/pacchi")
log = logging.getLogger("daneel.pacchi")
COL = "pacchi"
CHIAVE_SHIP24 = Path(os.environ.get("DANEEL_CONFIG", Path.home() / ".config/daneel-app")) / "ship24"
UA = "Mozilla/5.0 (DaneelApp; https://github.com/DeStalisGabriele/daneel)"
ROMA = ZoneInfo("Europe/Rome")
OGNI = 3600            # controllo dei pacchi in viaggio, in secondi
TIENI_CONSEGNATI = 14  # giorni dopo la consegna in cui il pacco resta nella lista
_controlla = None
_notifica = None

# Le fasi, nell'ordine del viaggio. Sono le "milestone" di Ship24; Poste e InPost ci vengono ricondotte.
FASI = {
    "attesa": "In attesa del corriere",
    "viaggio": "In viaggio",
    "consegna": "In consegna oggi",
    "ritiro": "Pronto per il ritiro",
    "mancata": "Consegna non riuscita",
    "consegnato": "Consegnato",
    "problema": "C'è un problema",
}
DA_SHIP24 = {"pending": "attesa", "info_received": "attesa", "in_transit": "viaggio", "out_for_delivery": "consegna",
             "available_for_pickup": "ritiro", "failed_attempt": "mancata", "delivered": "consegnato", "exception": "problema"}
# InPost: nome dello stato → (fase, testo in italiano). Gli stati non in elenco sono "in viaggio" con il titolo inglese.
INPOST = {
    "created": ("attesa", "Spedizione creata"), "confirmed": ("attesa", "Preparata dal mittente"),
    "dispatched_by_sender": ("attesa", "Lasciata dal mittente nel locker"),
    "collected_from_sender": ("viaggio", "Ritirata dal mittente"), "taken_by_courier": ("viaggio", "Ritirata dal corriere"),
    "adopted_at_source_branch": ("viaggio", "Arrivata alla filiale di partenza"),
    "sent_from_source_branch": ("viaggio", "Partita dalla filiale di partenza"),
    "adopted_at_sorting_center": ("viaggio", "Arrivata al centro di smistamento"),
    "sent_from_sorting_center": ("viaggio", "Partita dal centro di smistamento"),
    "adopted_at_target_branch": ("viaggio", "Arrivata alla filiale di destinazione"),
    "out_for_delivery": ("consegna", "In consegna"), "ready_to_pickup": ("ritiro", "Nel locker, pronta per il ritiro"),
    "pickup_reminder_sent": ("ritiro", "Promemoria: il pacco aspetta nel locker"),
    "pickup_time_expired": ("problema", "Tempo per il ritiro scaduto"), "delivered": ("consegnato", "Ritirata / consegnata"),
    "returned_to_sender": ("problema", "Restituita al mittente"), "canceled": ("problema", "Spedizione annullata"),
    "missing": ("problema", "Pacco smarrito"), "oversized": ("problema", "Pacco troppo grande per il locker"),
}


def collega(controlla, notifica):
    global _controlla, _notifica
    _controlla, _notifica = controlla, notifica


def _richiesta(url: str, dati: dict | None = None, intestazioni: dict | None = None, attesa: int = 25):
    corpo = json.dumps(dati).encode() if dati is not None else None
    req = urllib.request.Request(url, data=corpo, headers={"User-Agent": UA, "Accept": "application/json",
                                                           **({"Content-Type": "application/json"} if corpo else {}),
                                                           **(intestazioni or {})})
    return json.load(urllib.request.urlopen(req, timeout=attesa))


def _iso(ms_o_testo) -> str:
    if isinstance(ms_o_testo, (int, float)):
        return datetime.fromtimestamp(ms_o_testo / 1000, timezone.utc).astimezone(ROMA).isoformat(timespec="minutes")
    return str(ms_o_testo or "")


# ---------- corrieri ----------

def _poste(codice: str) -> dict | None:
    """Poste Italiane / SDA. None se il codice non è loro (esitoRicerca 1) o non ha ancora movimenti."""
    j = _richiesta("https://www.poste.it/online/dovequando/DQ-REST/ricercasemplice",
                   {"tipoRichiedente": "WEB", "codiceSpedizione": codice, "periodoRicerca": 1},
                   {"Origin": "https://www.poste.it", "Referer": "https://www.poste.it/cerca/index.html"})
    movimenti = j.get("listaMovimenti") or []
    if not movimenti:
        return None
    eventi = []
    for m in movimenti:
        cosa = (m.get("statoLavorazione") or "").strip()
        c = cosa.lower()
        fase = ("consegnato" if "consegnat" in c and "non" not in c else
                "ritiro" if "ritiro" in c or "disponibile" in c else
                "consegna" if "in consegna" in c else
                "mancata" if "mancata" in c or "non è stato possibile" in c else
                "problema" if "restituit" in c or "rientro" in c or m.get("flagRitorno") else
                "attesa" if "presa in carico" in c and not eventi else "viaggio")
        eventi.append({"quando": _iso(m.get("dataOra")), "dove": (m.get("luogo") or "").strip().title(),
                       "cosa": cosa[:1].upper() + cosa[1:], "fase": fase})
    corriere = "SDA" if "SDA" in (j.get("tipoProdotto") or "").upper() else "Poste Italiane"
    return {"corriere": corriere, "fonte": "poste", "eventi": eventi}


def _inpost(codice: str) -> dict | None:
    if not re.fullmatch(r"\d{20,26}", codice):
        return None
    try:
        j = _richiesta(f"https://api-shipx-it.easypack24.net/v1/tracking/{codice}")
    except urllib.error.HTTPError as ex:
        if ex.code == 404:
            return None
        raise
    dettagli = j.get("tracking_details") or []
    if not dettagli:
        return None
    eventi = []
    for d in reversed(dettagli):  # InPost li dà dal più recente
        fase, cosa = INPOST.get(d.get("status"), ("viaggio", (d.get("status") or "").replace("_", " ").capitalize()))
        eventi.append({"quando": _iso(d.get("datetime")), "dove": "", "cosa": cosa, "fase": fase})
    return {"corriere": "InPost", "fonte": "inpost", "eventi": eventi}


def _ship24(codice: str, cap: str | None = None) -> dict | None:
    """Mondial Relay (codici di 8 cifre) risponde solo con il CAP di destinazione: senza, Ship24 crea un tracker
    vuoto che resta "pending" per sempre. Un tracker senza eventi vale come "non trovato", non come "in attesa"."""
    try:
        chiave = CHIAVE_SHIP24.read_text().strip()
    except FileNotFoundError:
        raise HTTPException(424, "Per questo corriere serve la chiave di Ship24 (in ~/.config/daneel-app/ship24)")
    try:
        richiesta = {"trackingNumber": codice}
        if cap:
            richiesta["destinationPostCode"] = cap
            if re.fullmatch(r"\d{8}", codice):
                richiesta["courierCode"] = ["mondialrelay"]
        j = _richiesta("https://api.ship24.com/public/v1/trackers/track", richiesta,
                       {"Authorization": "Bearer " + chiave}, attesa=70)  # la prima volta può metterci fino a un minuto
    except urllib.error.HTTPError as ex:
        if ex.code in (402, 429):
            raise HTTPException(429, "Quota di Ship24 finita per questo mese")
        raise
    tracce = (j.get("data") or {}).get("trackings") or []
    if not tracce:
        return None
    t = tracce[0]
    if not t.get("events"):
        return None
    corrieri = {e.get("courierCode") for e in t.get("events") or [] if e.get("courierCode")}
    eventi = []
    for e in sorted(t.get("events") or [], key=lambda e: (e.get("occurrenceDatetime") or "", -(e.get("order") or 0))):
        eventi.append({"quando": e.get("occurrenceDatetime") or "", "dove": (e.get("location") or "").strip(),
                       "cosa": (e.get("status") or "").strip(), "fase": DA_SHIP24.get(e.get("statusMilestone"), "viaggio")})
    fase = DA_SHIP24.get((t.get("shipment") or {}).get("statusMilestone"))
    return {"corriere": ", ".join(sorted(corrieri)) or "Corriere", "fonte": "ship24", "eventi": eventi, "fase": fase}


# ---------- Amazon (facoltativo: serve un account collegato) ----------
# Con la libreria amazon-orders (pip install "amazon-orders[browser]") e un accesso fatto una volta con
# `amazon-orders --domain amazon.it login --browser` (la password non passa mai di qui), la scheda legge gli ordini
# dell'account: i pacchi Amazon si aggiungono da soli e lo stato arriva da Amazon, senza usare la quota di Ship24.
# Senza libreria o senza accesso questa parte non fa nulla. Amazon la mostra in inglese: qui si traduce.

AMAZON_DOMINIO = os.environ.get("DANEEL_AMAZON_DOMINIO", "amazon.it")
AMAZON_CACHE = 600     # secondi in cui gli ordini letti restano validi (un solo giro per tutti i pacchi)
COL_TOLTI = "pacchi_tolti"  # i pacchi Amazon tolti a mano: l'importazione automatica non li rimette
_amazon_cache: dict = {"quando": 0.0, "pacchi": {}}
_amazon_blocco = threading.Lock()
MESI_EN = {"january": "gennaio", "february": "febbraio", "march": "marzo", "april": "aprile", "may": "maggio",
           "june": "giugno", "july": "luglio", "august": "agosto", "september": "settembre", "october": "ottobre",
           "november": "novembre", "december": "dicembre"}
GIORNI_EN = {"monday": "lunedì", "tuesday": "martedì", "wednesday": "mercoledì", "thursday": "giovedì",
             "friday": "venerdì", "saturday": "sabato", "sunday": "domenica"}
ADESSO_EN = {"today": "oggi", "tomorrow": "domani", "yesterday": "ieri"}


def _it_quando(resto: str) -> str:
    """'tomorrow' → 'domani', '22 November' → 'il 22 novembre', '25 - 27 November' → 'tra il 25 e il 27 novembre',
    'Monday, 24 November' → 'lunedì 24 novembre'."""
    r = re.sub(r"[,.]", " ", resto.strip().lower())
    r = " ".join(r.split())
    if not r:
        return ""
    for en, it in {**MESI_EN, **GIORNI_EN, **ADESSO_EN}.items():
        r = re.sub(rf"\b{en}\b", it, r)
    r = re.sub(r"\bby\b", "entro", r)
    intervallo = re.match(r"(?:\w+ )?(\d{1,2}) ?- ?(\d{1,2}) (\w+)$", r)
    if intervallo:
        return f"tra il {intervallo.group(1)} e il {intervallo.group(2)} {intervallo.group(3)}"
    r = re.sub(r"^(?:(\w+) )?(\d{1,2}) (\w+)$", lambda m: f"{m.group(1) + ' ' if m.group(1) else ''}{m.group(2)} {m.group(3)}", r)
    return ("il " + r) if re.match(r"\d", r) else r


def _amazon_traduci(testo: str) -> tuple[str, str]:
    """Lo stato che Amazon scrive sulla spedizione (inglese) → (fase, testo in italiano). Lo stato non riconosciuto
    resta com'è, "in viaggio", con le date già in italiano."""
    t = " ".join((testo or "").split())
    c = t.lower()

    def dopo(*prefissi):
        for p in prefissi:
            if c.startswith(p):
                return t[len(p):].strip()
        return None

    def con(base: str, resto: str) -> str:
        q = _it_quando(re.sub(r"^(on|by|between)\s+", "", resto, flags=re.I))
        return f"{base} {q}".strip()

    if "not yet shipped" in c or c.startswith(("preparing", "order placed", "ordered", "processing")):
        return "attesa", "Il venditore sta preparando il pacco"
    r = dopo("delivered")
    if r is not None:
        return "consegnato", con("Consegnato", r)
    r = dopo("collected", "picked up")
    if r is not None:
        return "consegnato", con("Ritirato", r)
    if "left" in c and ("door" in c or "porch" in c or "neighbo" in c or "safe place" in c):
        return "consegnato", "Lasciato dal corriere (porta o vicino)"
    if "out for delivery" in c:
        return "consegna", "In consegna oggi"
    if "pickup" in c or "pick-up" in c or "locker" in c or "collection point" in c:
        return "ritiro", "Pronto per il ritiro"
    if "attempt" in c or "undeliverable" in c or "could not be delivered" in c:
        return "mancata", "Consegna non riuscita"
    if "return" in c or "refund" in c or "cancel" in c:
        return "problema", ("Rimborsato" if "refund" in c else "Annullato" if "cancel" in c else "Reso")
    if "delay" in c or "running late" in c or c.startswith("late"):
        return "viaggio", "In ritardo" + (" · " + _it_quando(c.split("by", 1)[1]) if "by" in c else "")
    r = dopo("now arriving", "arriving", "arrives", "expected")
    if r is not None:
        if r.lower().startswith("today"):
            return "consegna", "Arriva oggi"
        return "viaggio", con("Arriva", r)
    if c.startswith(("shipped", "dispatched", "on the way", "on its way")):
        return "viaggio", "Spedito"
    return "viaggio", re.sub(r"\s+", " ", t) or "In viaggio"


class _SenzaDomande:
    """Sul server nessuno può rispondere a un codice o a una domanda di Amazon: meglio un errore subito."""

    def echo(self, msg, **kw):
        log.info("amazon: %s", msg)

    def prompt(self, msg, type=None, **kw):
        raise RuntimeError("Amazon chiede un'altra verifica: rifai l'accesso con `amazon-orders login --browser`")


def _amazon_sessione():
    """Un AmazonOrders con la sessione già salvata. Solleva HTTPException(424) se la libreria o l'accesso mancano."""
    try:
        from amazonorders.conf import AmazonOrdersConfig
        from amazonorders.orders import AmazonOrders
        from amazonorders.session import AmazonSession
    except ImportError:
        raise HTTPException(424, "Per gli ordini Amazon serve la libreria amazon-orders")
    conf = AmazonOrdersConfig(data={"domain": AMAZON_DOMINIO})
    if not Path(conf.cookie_jar_path).exists():
        raise HTTPException(424, "Account Amazon non collegato: serve `amazon-orders login --browser`")
    sessione = AmazonSession(config=conf, io=_SenzaDomande())
    try:
        sessione.login()
    except Exception as ex:  # noqa: BLE001
        log.warning("amazon: accesso non riuscito: %s", str(ex)[:200])
        raise HTTPException(424, "Sessione Amazon scaduta: rifai l'accesso con `amazon-orders login --browser`")
    return AmazonOrders(sessione)


def _amazon_attivo() -> bool:
    try:
        from amazonorders.conf import AmazonOrdersConfig
        return Path(AmazonOrdersConfig(data={"domain": AMAZON_DOMINIO}).cookie_jar_path).exists()
    except Exception:  # noqa: BLE001
        return False


def _amazon_spedizioni(ordine) -> dict:
    """Le spedizioni di un ordine come pacchi: {codice: {...}}. Un ordine con più spedizioni ha un suffisso A, B…"""
    cifre = re.sub(r"\D", "", ordine.order_number or "")
    out = {}
    spedizioni = [s for s in (ordine.shipments or []) if s.delivery_status]
    for i, s in enumerate(spedizioni):
        codice = "AMZ" + cifre + (chr(65 + i) if len(spedizioni) > 1 else "")
        articoli = [a.title for a in (s.items or []) if a.title] or [a.title for a in (ordine.items or []) if a.title]
        out[codice] = {"ordine": ordine.order_number, "spedizione": s.shipment_id, "stato": s.delivery_status,
                       "nome": (articoli[0] if articoli else "Ordine Amazon")[:60]}
    return out


def _amazon_leggi(forza: bool = False) -> dict:
    """Gli ordini degli ultimi 30 giorni, in cache per qualche minuto (un giro solo per tutti i pacchi Amazon)."""
    with _amazon_blocco:
        if not forza and time.time() - _amazon_cache["quando"] < AMAZON_CACHE:
            return _amazon_cache["pacchi"]
        ordini = _amazon_sessione().get_orders(time_filter="last30", full_details=True)
        pacchi = {}
        for o in ordini:
            if not getattr(o, "cancelled", False):
                pacchi.update(_amazon_spedizioni(o))
        _amazon_cache.update(quando=time.time(), pacchi=pacchi)
        return pacchi


def _amazon(p: dict) -> dict | None:
    """Aggiorna un pacco Amazon già in lista. Aggiunge un evento a ogni cambio di stato."""
    info = _amazon_leggi().get(p["codice"])
    if not info and p.get("ordine"):  # ordine più vecchio di 30 giorni: si chiede da solo
        try:
            info = _amazon_spedizioni(_amazon_sessione().get_order(p["ordine"])).get(p["codice"])
        except HTTPException:
            raise
        except Exception:  # noqa: BLE001
            log.exception("amazon: ordine %s", p.get("ordine"))
    if not info:
        return None
    fase, cosa = _amazon_traduci(info["stato"])
    eventi = list(p.get("eventi") or [])
    if not eventi or eventi[-1].get("cosa") != cosa:
        eventi.append({"quando": datetime.now(ROMA).isoformat(timespec="minutes"), "dove": "", "cosa": cosa, "fase": fase})
    return {"corriere": "Amazon", "fonte": "amazon", "eventi": eventi, "fase": fase,
            "ordine": info["ordine"], "spedizione": info["spedizione"]}


async def importa_amazon() -> int:
    """Aggiunge alla lista i pacchi Amazon in arrivo che non ci sono ancora (i consegnati e quelli tolti a mano no)."""
    pacchi = await asyncio.to_thread(_amazon_leggi, True)
    nuovi = 0
    for codice, info in pacchi.items():
        fase, cosa = _amazon_traduci(info["stato"])
        if fase == "consegnato" or plancia._leggi(COL, codice)[0] or plancia._leggi(COL_TOLTI, codice)[0]:
            continue
        adesso = datetime.now(ROMA).isoformat(timespec="minutes")
        plancia._scrivi(COL, codice, {
            "codice": codice, "nome": info["nome"], "aggiunto": adesso, "controllato": adesso, "cap": None,
            "corriere": "Amazon", "fonte": "amazon", "ordine": info["ordine"], "spedizione": info["spedizione"],
            "eventi": [{"quando": adesso, "dove": "", "cosa": cosa, "fase": fase}], "fase": fase, "errore": None})
        nuovi += 1
    return nuovi


def _cerca(codice: str, fonte: str | None = None, cap: str | None = None) -> dict | None:
    """Prova i corrieri gratis prima di Ship24, così la quota si usa solo quando serve. Con `fonte` (pacco già
    trovato) va dritto da quel corriere. I codici di Amazon Logistics (TBA…) li conosce solo Ship24."""
    if fonte:
        prove = [{"poste": _poste, "inpost": _inpost, "ship24": _ship24}[fonte]]
    elif cap and re.fullmatch(r"\d{8}", codice):  # Mondial Relay: solo Ship24
        prove = [_ship24]
    elif codice.startswith("TBA"):
        prove = [_ship24]
    else:
        prove = [_inpost, _poste, _ship24] if codice.isdigit() else [_poste, _ship24]
    for prova in prove:
        try:
            r = prova(codice, cap) if prova is _ship24 else prova(codice)
        except HTTPException:
            raise
        except Exception:  # noqa: BLE001
            log.exception("tracking %s con %s", codice, prova.__name__)
            r = None
        if r:
            r.setdefault("fase", r["eventi"][-1]["fase"] if r["eventi"] else "attesa")
            return r
    return None


def _senza_info(p: dict) -> str:
    if re.fullmatch(r"\d{8}", p["codice"]) and not p.get("cap"):
        return "Se è Mondial Relay serve il CAP di destinazione: aggiungilo qui sotto"
    return "Ancora nessuna informazione dal corriere"


# ---------- archivio (Plancia) ----------

def _pulisci(codice: str) -> str:
    return re.sub(r"[\s-]", "", codice or "").upper()


def _tutti() -> list[dict]:
    with plancia._conn() as c:
        return [json.loads(r[0]) for r in c.execute("SELECT data FROM docs WHERE col=?", (COL,))]


def _togli(codice: str):
    with plancia._conn() as c:
        c.execute("DELETE FROM docs WHERE col=? AND id=?", (COL, codice))
    plancia._avvisa(COL, codice)


async def _aggiorna(p: dict, avvisa: bool) -> dict:
    if p.get("fonte") == "amazon":
        trovato = await asyncio.to_thread(_amazon, p)
    else:
        trovato = await asyncio.to_thread(_cerca, p["codice"], p.get("fonte"), p.get("cap"))
    adesso = datetime.now(ROMA).isoformat(timespec="minutes")
    p["controllato"] = adesso
    if not trovato:
        if not p.get("eventi"):
            p.update(fase="attesa", corriere="" if p.get("fonte") == "ship24" else p.get("corriere", ""), errore=_senza_info(p))
        else:
            p["errore"] = None
        plancia._scrivi(COL, p["codice"], p)
        return p
    prima = p.get("fase")
    p.update(trovato, errore=None)
    if p["fase"] == "consegnato" and not p.get("consegnato"):
        p["consegnato"] = adesso
    plancia._scrivi(COL, p["codice"], p)
    if avvisa and prima and prima != p["fase"] and _notifica:
        ultimo = p["eventi"][-1] if p["eventi"] else {}
        await _notifica(f"📦 {p.get('nome') or p['codice']}: {FASI[p['fase']].lower()}",
                        " · ".join(x for x in (ultimo.get("cosa"), ultimo.get("dove")) if x))
    return p


@router.post("/aggiungi")
async def aggiungi(dati: dict, authorization: str | None = Header(None)):
    """{codice, nome?, cap?}: aggiunge il pacco e lo cerca subito. Se c'è già, aggiorna nome e CAP (se dati);
    con un CAP nuovo lo cerca di nuovo."""
    _controlla(authorization)
    codice = _pulisci(dati.get("codice"))
    if not re.fullmatch(r"[A-Z0-9]{6,40}", codice):
        raise HTTPException(400, "Codice di spedizione non valido")
    cap = re.sub(r"\s", "", str(dati.get("cap") or ""))[:10] or None
    p, _ = plancia._leggi(COL, codice)
    if p:
        if dati.get("nome"):
            p["nome"] = str(dati["nome"])[:60]
        if cap and cap != p.get("cap"):
            p.update(cap=cap, fonte=None)
            return await _aggiorna(p, avvisa=False)
        plancia._scrivi(COL, codice, p)
        return p
    p = {"codice": codice, "nome": str(dati.get("nome") or "")[:60], "aggiunto": datetime.now(ROMA).isoformat(timespec="minutes"),
         "eventi": [], "fase": None, "cap": cap}
    trovato = await asyncio.to_thread(_cerca, codice, None, cap)
    if not trovato:
        # il corriere magari non l'ha ancora registrato: lo teniamo e riproviamo al prossimo giro
        p.update(corriere="", fonte=None, fase="attesa", errore=_senza_info(p))
        plancia._scrivi(COL, codice, p)
        return p
    p.update(trovato, errore=None)
    if p["fase"] == "consegnato":
        p["consegnato"] = p["aggiunto"]
    plancia._scrivi(COL, codice, p)
    return p


@router.post("/aggiorna")
async def aggiorna(dati: dict, authorization: str | None = Header(None)):
    """{codice}: chiede di nuovo al corriere (tasto "Aggiorna" o trascinando giù)."""
    _controlla(authorization)
    p, _ = plancia._leggi(COL, _pulisci(dati.get("codice")))
    if not p:
        raise HTTPException(404, "Pacco non trovato")
    return await _aggiorna(p, avvisa=False)


@router.post("/togli")
async def togli(dati: dict, authorization: str | None = Header(None)):
    _controlla(authorization)
    codice = _pulisci(dati.get("codice"))
    p, _ = plancia._leggi(COL, codice)
    if p and p.get("fonte") == "amazon":  # tolto a mano: l'importazione automatica non lo rimette
        plancia._scrivi(COL_TOLTI, codice, {"codice": codice, "quando": datetime.now(ROMA).isoformat(timespec="minutes")})
    _togli(codice)
    return {"ok": True}


@router.post("/amazon")
async def amazon(authorization: str | None = Header(None)):
    """Importa ora i pacchi in arrivo dall'account Amazon collegato (di solito lo fa da solo il controllo orario)."""
    _controlla(authorization)
    return {"aggiunti": await importa_amazon()}


async def controlla_periodicamente():
    """Ogni ora: aggiorna i pacchi non ancora consegnati (notifica se cambia la fase) e toglie i consegnati vecchi."""
    while True:
        await asyncio.sleep(OGNI)
        if await asyncio.to_thread(_amazon_attivo):
            try:
                if nuovi := await importa_amazon():
                    log.info("amazon: %d pacchi nuovi", nuovi)
            except HTTPException as ex:
                log.warning("amazon: %s", ex.detail)
            except Exception:  # noqa: BLE001
                log.exception("importazione degli ordini Amazon")
        for p in _tutti():
            try:
                if p.get("fase") == "consegnato":
                    quando = datetime.fromisoformat(p.get("consegnato") or p["aggiunto"])
                    if (datetime.now(ROMA) - quando).days >= TIENI_CONSEGNATI:
                        _togli(p["codice"])
                    continue
                await _aggiorna(p, avvisa=True)
            except HTTPException as ex:  # chiave o quota di Ship24: si riprova al prossimo giro
                log.warning("pacco %s: %s", p.get("codice"), ex.detail)
            except Exception:  # noqa: BLE001
                log.exception("controllo del pacco %s", p.get("codice"))
            await asyncio.sleep(2)  # gentili con i siti dei corrieri
