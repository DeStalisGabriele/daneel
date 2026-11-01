"""La Plancia dentro l'app: il suo database (prima stava su claude.ai) e l'agenda dal calendario Google.

Documenti JSON per collezione e id (giorni/2026-10-29, salute/…, allenamenti/…, portafoglio/…, config/dieta…), in
SQLite. La pagina li legge con lo shim plancia-shim.js, che imita il `db` degli artifact (collection/doc, onSnapshot,
set): ogni scrittura manda un evento sul flusso /api/plancia/eventi e le pagine aperte ricaricano quel pezzo.
Gli script e le skill scrivono con ~/bin/plancia-db, che usa le stesse API.

L'agenda legge gli indirizzi iCal segreti in ~/.config/daneel-app/calendari.json e restituisce gli eventi nel formato
di Google Calendar (summary, start.dateTime…), così la pagina non cambia.
"""

import asyncio
import json
import os
import sqlite3
import time
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import StreamingResponse

import punteggi

HOME = Path.home()
DB = Path(os.environ.get("DANEEL_DATI", HOME / ".local/share/daneel-app")) / "plancia.db"
CALENDARI = Path(os.environ.get("DANEEL_CONFIG", HOME / ".config/daneel-app")) / "calendari.json"
ROMA = ZoneInfo("Europe/Rome")
ICS_VALIDO = 5 * 60  # secondi: per quanto si tiene in memoria un calendario scaricato
NOME = r"^[A-Za-z0-9_\-.~:@+]{1,200}$"

router = APIRouter(prefix="/api/plancia")
_controlla = None  # lo imposta server.py (stesso token dell'app)
_ascoltatori: set[asyncio.Queue] = set()
_ics: dict[str, tuple[float, bytes]] = {}


def collega(controlla):
    global _controlla
    _controlla = controlla
    with _conn() as c:
        c.execute("CREATE TABLE IF NOT EXISTS docs (col TEXT, id TEXT, data TEXT NOT NULL, ver INTEGER NOT NULL, "
                  "ts REAL NOT NULL, PRIMARY KEY (col, id))")


def _conn():
    DB.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB, timeout=10)
    c.execute("PRAGMA journal_mode=WAL")
    return c


def _avvisa(col: str, id_: str):
    for q in list(_ascoltatori):
        q.put_nowait({"col": col, "id": id_})


def _leggi(col: str, id_: str):
    with _conn() as c:
        r = c.execute("SELECT data, ver FROM docs WHERE col=? AND id=?", (col, id_)).fetchone()
    return (json.loads(r[0]), r[1]) if r else (None, 0)


def _scrivi(col: str, id_: str, data: dict) -> int:
    with _conn() as c:
        r = c.execute("SELECT ver FROM docs WHERE col=? AND id=?", (col, id_)).fetchone()
        ver = (r[0] if r else 0) + 1
        c.execute("INSERT OR REPLACE INTO docs (col, id, data, ver, ts) VALUES (?,?,?,?,?)",
                  (col, id_, json.dumps(data, ensure_ascii=False), ver, time.time()))
    _avvisa(col, id_)
    return ver


def _unisci(base: dict, nuovo: dict) -> dict:
    """update: unisce in profondità; un campo {"__delete__": true} viene tolto (come ArtifactData)."""
    out = dict(base)
    for k, v in nuovo.items():
        if isinstance(v, dict) and v.get("__delete__") is True:
            out.pop(k, None)
        elif isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _unisci(out[k], v)
        else:
            out[k] = v
    return out


@router.get("/col/{col}")
async def collezione(col: str = ..., authorization: str | None = Header(None)):
    _controlla(authorization)
    with _conn() as c:
        righe = c.execute("SELECT id, data, ver FROM docs WHERE col=? ORDER BY id", (col,)).fetchall()
    return {"docs": [{"id": i, "data": json.loads(d), "version": v} for i, d, v in righe]}


@router.get("/doc/{col}/{id_}")
async def documento(col: str, id_: str, authorization: str | None = Header(None)):
    _controlla(authorization)
    data, ver = _leggi(col, id_)
    return {"exists": data is not None, "data": data, "version": ver}


@router.put("/doc/{col}/{id_}")
async def imposta(col: str, id_: str, data: dict, if_version: int | None = Query(None),
                  authorization: str | None = Header(None)):
    _controlla(authorization)
    _, ver = _leggi(col, id_)
    if if_version is not None and if_version != ver:
        raise HTTPException(409, f"versione cambiata: ora è {ver}")
    return {"version": _scrivi(col, id_, data)}


@router.patch("/doc/{col}/{id_}")
async def aggiorna(col: str, id_: str, data: dict, if_version: int | None = Query(None),
                   authorization: str | None = Header(None)):
    _controlla(authorization)
    vecchio, ver = _leggi(col, id_)
    if if_version is not None and if_version != ver:
        raise HTTPException(409, f"versione cambiata: ora è {ver}")
    return {"version": _scrivi(col, id_, _unisci(vecchio or {}, data))}


@router.delete("/doc/{col}/{id_}")
async def cancella(col: str, id_: str, authorization: str | None = Header(None)):
    _controlla(authorization)
    with _conn() as c:
        c.execute("DELETE FROM docs WHERE col=? AND id=?", (col, id_))
    _avvisa(col, id_)
    return {"ok": True}


@router.get("/eventi")
async def eventi(t: str = "", authorization: str | None = Header(None)):
    """Flusso SSE dei cambiamenti ({col, id}). EventSource non manda intestazioni: il token arriva in ?t=."""
    _controlla(authorization or "Bearer " + t)
    q: asyncio.Queue = asyncio.Queue()
    _ascoltatori.add(q)

    async def flusso():
        try:
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), 20)
                    yield f"data: {json.dumps(ev)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            _ascoltatori.discard(q)
    return StreamingResponse(flusso(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


# ---------- agenda (Google Calendar via iCal segreto) ----------

def _scarica(url: str) -> bytes:
    ora = time.time()
    if url in _ics and ora - _ics[url][0] < ICS_VALIDO:
        return _ics[url][1]
    dati = urllib.request.urlopen(url, timeout=20).read()
    _ics[url] = (ora, dati)
    return dati


def _quando(v) -> dict:
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=ROMA)
        return {"dateTime": v.astimezone(ROMA).isoformat()}
    return {"date": v.isoformat()}


def _eventi(da: date, a: date) -> list[dict]:
    import icalendar
    import recurring_ical_events
    cal = json.loads(CALENDARI.read_text())["calendari"]
    out = []
    for c in cal:
        ics = icalendar.Calendar.from_ical(_scarica(c["ics"]))
        for e in recurring_ical_events.of(ics).between(da, a):
            stato = str(e.get("STATUS", "CONFIRMED")).lower()
            out.append({
                "summary": str(e.get("SUMMARY", "")), "location": str(e.get("LOCATION", "")) or None,
                "start": _quando(e.decoded("DTSTART")),
                "end": _quando(e.decoded("DTEND")) if e.get("DTEND") else _quando(e.decoded("DTSTART")),
                "status": "cancelled" if stato == "cancelled" else "confirmed",
                "htmlLink": "https://calendar.google.com/calendar/r/day/" + da.strftime("%Y/%m/%d"),
                "calendario": c.get("nome"),
            })
    # prima gli eventi di tutto il giorno, poi in ordine di ora
    out.sort(key=lambda e: (0, "") if "date" in e["start"] else (1, e["start"]["dateTime"]))
    return out


@router.get("/agenda")
async def agenda(da: str, a: str | None = None, authorization: str | None = Header(None)):
    _controlla(authorization)
    if not CALENDARI.exists():
        raise HTTPException(404, "nessun calendario configurato")
    d0 = date.fromisoformat(da[:10])
    d1 = date.fromisoformat(a[:10]) if a else d0 + timedelta(days=1)
    try:
        ev = await asyncio.to_thread(_eventi, d0, d1)
    except Exception as ex:  # noqa: BLE001
        raise HTTPException(502, f"calendario non raggiungibile: {ex}")
    return {"events": ev, "storedAt": time.time() * 1000}


# ---------- punteggi di salute (Sonno, Recupero, Sforzo: punteggi.py, solo conti) ----------

@router.get("/punteggi")
async def punteggi_salute(giorni: int = 30, authorization: str | None = Header(None)):
    _controlla(authorization)
    return {"giorni": await asyncio.to_thread(punteggi.calcola, max(1, min(giorni, 365)))}
