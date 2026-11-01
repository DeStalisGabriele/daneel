"""La scheda Cibo dell'app: prodotti da Open Food Facts (codice a barre o ricerca per nome, gratis e senza chiave) e
pasti aggiunti a mano sulla Plancia, nello stesso formato della skill /pasto:
giorni/<data>.cibo.<pasto> = {kcal, proteine, carboidrati, grassi, voci: [{nome, g, kcal, proteine, carboidrati, grassi}]}
e la spunta giorni/<data>.h.<pasto> = true. Niente modelli: solo conti."""

import asyncio
import json
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException

import plancia

router = APIRouter(prefix="/api/cibo")
CACHE = Path(os.environ.get("DANEEL_DATI", Path.home() / ".local/share/daneel-app")) / "off-cache.json"
OFF = "https://world.openfoodfacts.org"
UA = "DaneelApp/1.0 (personal assistant; https://github.com/DeStalisGabriele/daneel)"  # Open Food Facts chiede un User-Agent riconoscibile
PASTI = ("colazione", "pranzo", "merenda", "cena")
MACRO = ("kcal", "proteine", "carboidrati", "grassi")
ROMA = ZoneInfo("Europe/Rome")
_controlla = None


def collega(controlla):
    global _controlla
    _controlla = controlla


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return json.load(urllib.request.urlopen(req, timeout=20))


def _num(x):
    try:
        return round(float(x), 1)
    except (TypeError, ValueError):
        return None


def _prodotto(p: dict, ean: str | None = None) -> dict | None:
    n = p.get("nutriments") or {}
    kcal = _num(n.get("energy-kcal_100g"))
    if kcal is None and n.get("energy_100g") is not None:
        kcal = _num(float(n["energy_100g"]) / 4.184)  # kJ → kcal
    if kcal is None:
        return None
    porzione = _num(p.get("serving_quantity"))
    return {"ean": ean or p.get("code"), "nome": (p.get("product_name_it") or p.get("product_name") or "").strip() or "Prodotto senza nome",
            "marca": (p.get("brands") or "").split(",")[0].strip(), "porzioneG": porzione,
            "porzione": p.get("serving_size"), "immagine": p.get("image_front_small_url"),
            "per100": {"kcal": kcal, "proteine": _num(n.get("proteins_100g")) or 0,
                       "carboidrati": _num(n.get("carbohydrates_100g")) or 0, "grassi": _num(n.get("fat_100g")) or 0}}


def _cache() -> dict:
    try:
        return json.loads(CACHE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


CAMPI = "code,product_name,product_name_it,brands,nutriments,serving_size,serving_quantity,image_front_small_url"


@router.get("/prodotto/{ean}")
async def prodotto(ean: str, authorization: str | None = Header(None)):
    _controlla(authorization)
    if not ean.isdigit() or not 6 <= len(ean) <= 14:
        raise HTTPException(400, "codice a barre non valido")
    c = _cache()
    if ean in c:
        return c[ean]
    try:
        j = await asyncio.to_thread(_get, f"{OFF}/api/v2/product/{ean}.json?fields={CAMPI}")
    except Exception:  # noqa: BLE001
        raise HTTPException(502, "Open Food Facts non risponde, riprova tra poco")
    p = _prodotto(j.get("product") or {}, ean) if j.get("status") == 1 else None
    if not p:
        raise HTTPException(404, "Prodotto non trovato su Open Food Facts (o senza valori nutrizionali)")
    c[ean] = p
    CACHE.write_text(json.dumps(c, ensure_ascii=False))
    return p


@router.get("/cerca")
async def cerca(q: str, authorization: str | None = Header(None)):
    _controlla(authorization)
    if len(q.strip()) < 2:
        return {"prodotti": []}
    base = f"{OFF}/cgi/search.pl?search_terms={urllib.parse.quote(q)}&search_simple=1&action=process&json=1&page_size=20&fields={CAMPI}"
    # Prima i prodotti venduti in Italia, i più scansionati in cima; la ricerca di Open Food Facts a volte risponde 503
    # proprio con i filtri, quindi in quel caso si riprova senza.
    j = None
    for url in (base + "&sort_by=unique_scans_n&countries_tags_en=italy", base):
        try:
            j = await asyncio.to_thread(_get, url)
            break
        except Exception:  # noqa: BLE001
            await asyncio.sleep(.5)
    if j is None:
        raise HTTPException(502, "Open Food Facts non risponde, riprova tra poco")
    return {"prodotti": [p for p in (_prodotto(x) for x in j.get("products", [])) if p][:12]}


def _oggi() -> str:
    return datetime.now(ROMA).date().isoformat()


def _ricalcola(pasto: dict) -> dict:
    for k in MACRO:
        pasto[k] = round(sum(v.get(k) or 0 for v in pasto.get("voci", [])), 1 if k != "kcal" else None)
    pasto["kcal"] = int(round(pasto["kcal"] or 0))
    return pasto


@router.post("/aggiungi")
async def aggiungi(dati: dict, authorization: str | None = Header(None)):
    """{pasto, nome, g, per100: {kcal, proteine, carboidrati, grassi}, data?}: una voce in più nel pasto."""
    _controlla(authorization)
    pasto, g = dati.get("pasto"), _num(dati.get("g"))
    per100 = dati.get("per100") or {}
    if pasto not in PASTI or not g or g <= 0 or not dati.get("nome"):
        raise HTTPException(400, "servono pasto, nome, grammi e valori per 100 g")
    giorno = dati.get("data") or _oggi()
    voce = {"nome": str(dati["nome"])[:120], "g": g}
    for k in MACRO:
        voce[k] = round((_num(per100.get(k)) or 0) * g / 100, 1)
    voce["kcal"] = int(round(voce["kcal"]))
    if dati.get("ean"):
        voce["ean"] = str(dati["ean"])
    doc, _ = plancia._leggi("giorni", giorno)
    doc = doc or {"h": {}, "sonno": None}
    cibo = doc.setdefault("cibo", {})
    p = cibo.setdefault(pasto, {"voci": []})
    p.setdefault("voci", []).append(voce)
    _ricalcola(p)
    doc.setdefault("h", {})[pasto] = True
    plancia._scrivi("giorni", giorno, doc)
    return {"voce": voce, "pasto": p}


@router.post("/togli")
async def togli(dati: dict, authorization: str | None = Header(None)):
    """{pasto, indice, data?}: toglie una voce da un pasto (se il pasto resta vuoto, toglie anche la spunta)."""
    _controlla(authorization)
    giorno, pasto, i = dati.get("data") or _oggi(), dati.get("pasto"), dati.get("indice")
    doc, _ = plancia._leggi("giorni", giorno)
    voci = (((doc or {}).get("cibo") or {}).get(pasto) or {}).get("voci")
    if not voci or not isinstance(i, int) or not 0 <= i < len(voci):
        raise HTTPException(404, "voce non trovata")
    voci.pop(i)
    if voci:
        _ricalcola(doc["cibo"][pasto])
    else:
        doc["cibo"].pop(pasto)
        doc.setdefault("h", {})[pasto] = False
    plancia._scrivi("giorni", giorno, doc)
    return {"ok": True}
