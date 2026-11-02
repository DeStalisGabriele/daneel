"""Daneel come app per iPhone (PWA): una chat che parla con Claude Code su questo server, sul piano di Gabriele.

Ogni messaggio lancia `claude -p` nella cartella della memoria (~/claude-mind), riprendendo la stessa sessione
(--resume), quindi valgono CLAUDE.md, le skill e i subagenti di Daneel. Niente chiave API: conta sui limiti del piano.
Il turno gira in background: se l'app va in secondo piano a metà, la risposta si salva lo stesso e l'app la
ritrova alla riapertura (/api/stato, /api/segui).

Avvio: .venv/bin/uvicorn server:app --host 127.0.0.1 --port 8791 (servizio utente daneel-app); lo espone
solo `tailscale serve` in HTTPS sulla tailnet: https://<server>.<tailnet>.ts.net:8444
Il token sta in ~/.config/daneel-app/token; l'app lo chiede la prima volta e lo tiene sul telefono.
"""

import asyncio
import hmac
import json
import logging
import os
import re
import secrets
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

import cibo
import plancia

HOME = Path.home()
QUI = Path(__file__).resolve().parent
# Cartelle di dati e configurazione: si possono cambiare con le variabili d'ambiente (la demo degli screenshot
# gira con cartelle sue, così non tocca i dati veri).
DATI = Path(os.environ.get("DANEEL_DATI", HOME / ".local/share/daneel-app"))
CONFIG = Path(os.environ.get("DANEEL_CONFIG", HOME / ".config/daneel-app"))
FOTO = HOME / "tmp/app-foto"
TOKEN_FILE = CONFIG / "token"
CLAUDE = Path(os.environ.get("DANEEL_CLAUDE", HOME / ".local/bin/claude"))
MAX_FOTO = 8 * 1024 * 1024  # byte per foto
AUDIO = HOME / "tmp/app-vocali"
MAX_AUDIO = 20 * 1024 * 1024  # byte per vocale (qualche minuto)
TIMEOUT = 15 * 60  # secondi massimi per un turno
ISCRIZIONI = DATI / "iscrizioni.json"  # i telefoni iscritti alle notifiche (Web Push)
CODA = DATI / "coda.json"  # i messaggi che aspettano il loro turno, e fino a quando il piano è in pausa per il limite
PAUSA_SENZA_ORA = 30 * 60  # secondi: se il limite non dice quando si azzera, si riprova dopo mezz'ora
ROMA = ZoneInfo("Europe/Rome")
VAPID_PEM = CONFIG / "vapid.pem"
VAPID_PUB = CONFIG / "vapid-pubblica.txt"
# chi manda le notifiche: un URL https senza porta (lo vuole py_vapid), per esempio l'indirizzo del server sulla tailnet
VAPID_SUB = os.environ.get("DANEEL_VAPID_SUB", "mailto:daneel@example.com")  # py_vapid vuole un mailto: o un URL https senza percorso
VISIBILE_PER = 25  # secondi: se l'app non dà segni di vita da più di così, a fine risposta parte la notifica
EMOJI = {"daneel": "🤖", "calendario": "📅", "postino": "✉️", "nutrizionista": "🥗", "amanuense": "✍️"}

SISTEMA = """Stai parlando con Gabriele dall'app "Daneel" sul suo iPhone, non da Telegram.
- Rispondi direttamente nel testo, in italiano, con Markdown semplice (grassetto, elenchi, link). Non usare il tool \
reply di Telegram né react: quando una skill dice "manda su Telegram" o "reply", qui vuol dire scriverlo nella risposta.
- Le foto che Gabriele allega arrivano come percorsi locali nel messaggio: leggile con Read (non serve download_attachment).
- Per mostrare un'immagine che sta sul web (per esempio la foto di un prodotto Amazon, il campo `immagine`) scrivi \
![nome](https://…): l'app la mostra. Non usare percorsi locali nelle immagini.
- **Ogni risposta ha qualche emoji** (richiesta di Gabriele): di solito 1-3 per messaggio, per esempio all'inizio, \
accanto a un risultato o a un elenco; mai una per riga e mai al posto delle parole. Anche le risposte brevi.
- La Plancia sta su questo server (pagina plancia.html dell'app): leggila e scrivila con `~/bin/plancia-db` \
(`get`, `list`, `set`, `update`, `agenda`; `~/bin/plancia-db --help`), come dicono le skill.
- Le altre regole di CLAUDE.md valgono come sempre (bozze da approvare prima di inviare, subagenti, memoria)."""

# Il menu dell'app: "daneel" è l'automatico (Daneel decide da sé se e a chi delegare); scegliere un subagente non
# apre un'altra chat: nella stessa conversazione Daneel affida a lui le richieste (NOTA_SUB in fondo al messaggio).
# Redattore e Cacciatore di slide restano dentro /lezione.
AGENTI = ("daneel", "calendario", "postino", "nutrizionista", "amanuense")
NOTA_SUB = ("\n\n[Dal menu dell'app Gabriele ha scelto il subagente `{0}`: affida a lui questa richiesta (strumento "
            "Agent/Task, subagent_type `{0}`) e riporta il suo risultato. Se la richiesta non c'entra con il suo ruolo, "
            "fai tu e diglielo in una riga.]")

log = logging.getLogger("daneel-app")
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def _token() -> str:
    if not TOKEN_FILE.exists():
        TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_FILE.write_text(secrets.token_urlsafe(24))
        TOKEN_FILE.chmod(0o600)
    return TOKEN_FILE.read_text().strip()


def _controlla(authorization: str | None):
    atteso = "Bearer " + _token()
    if not authorization or not hmac.compare_digest(authorization, atteso):
        raise HTTPException(401, "token mancante o sbagliato")


def _agente(nome: str | None) -> str:
    nome = (nome or "daneel").strip().lower()
    if nome not in AGENTI:
        raise HTTPException(400, "agente sconosciuto")
    return nome


def _file_storia(agente: str) -> Path:
    return DATI / ("chat.json" if agente == "daneel" else f"chat-{agente}.json")


def _leggi_storia(agente: str) -> dict:
    try:
        return json.loads(_file_storia(agente).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {"sessione": None, "messaggi": []}


def _scrivi_storia(agente: str, s: dict):
    DATI.mkdir(parents=True, exist_ok=True)
    f = _file_storia(agente)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(s, ensure_ascii=False, indent=1))
    tmp.replace(f)


_NOMI_STRUMENTI = {
    "Bash": "comando sul server", "Read": "leggo un file", "Edit": "modifico un file", "Write": "scrivo un file",
    "Grep": "cerco nei file", "Glob": "cerco file", "WebSearch": "cerco sul web", "WebFetch": "leggo una pagina web",
    "Task": "chiedo a un subagente", "Agent": "chiedo a un subagente", "Skill": "uso una skill",
}


def _nome_strumento(nome: str, input_: dict) -> str:
    if nome == "Bash" and "amazon-cerca" in str(input_.get("command", "")):
        return "cerco su Amazon"
    if nome == "Skill" and input_.get("skill"):
        return f"skill {input_['skill']}"
    if nome in ("Task", "Agent") and input_.get("subagent_type"):
        return f"chiedo al {input_['subagent_type']}"
    if nome.startswith("mcp__"):
        servizio = nome.split("__")[1].replace("claude_ai_", "").replace("_", " ")
        return f"{servizio}: {nome.split('__')[-1].replace('_', ' ')}"
    return _NOMI_STRUMENTI.get(nome, nome)


class Turno:
    """Un messaggio di Gabriele e la risposta che si sta scrivendo. Gli eventi restano qui finché il turno è
    vivo, così chi si ricollega li riceve tutti dall'inizio."""

    def __init__(self, testo: str, agente: str):
        self.testo = testo
        self.agente = agente
        self.timer = False  # True se il turno l'ha avviato un timer (/api/sistema)
        self.voce: dict | None = None  # la voce della coda da cui viene: se il piano è al limite, ci torna
        self.eventi: list[dict] = []
        self.fatto = False
        self.cambiato = asyncio.Condition()
        self.inizio = time.time()

    async def aggiungi(self, ev: dict):
        async with self.cambiato:
            self.eventi.append(ev)
            self.cambiato.notify_all()

    async def segui(self):
        i = 0
        while True:
            async with self.cambiato:
                while i >= len(self.eventi) and not self.fatto:
                    try:
                        await asyncio.wait_for(self.cambiato.wait(), 15)
                    except asyncio.TimeoutError:
                        break
                nuovi, i = self.eventi[i:], len(self.eventi)
                finito = self.fatto and not nuovi
            if not nuovi and not finito:
                yield ": ping\n\n"  # tiene viva la connessione
            for ev in nuovi:
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
            if finito:
                return


turno: Turno | None = None
_lucchetto = asyncio.Lock()
_ultimo_visibile = 0.0  # quando l'app aperta in primo piano si è fatta sentire l'ultima volta


# ---------- Coda: i messaggi mandati mentre Daneel risponde, o mentre il piano è al limite ----------
# Una voce è {id, prompt, vocale, testo, timer, etichetta}; il suo messaggio nella chat ha "coda": true finché non
# parte. Se un turno trova il limite del piano, la sua voce torna in testa e la coda si ferma fino al reset.

def _leggi_coda() -> dict:
    try:
        c = json.loads(CODA.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        c = {}
    return {"voci": c.get("voci", []), "pausa_fino": c.get("pausa_fino", 0)}


def _scrivi_coda(c: dict):
    CODA.parent.mkdir(parents=True, exist_ok=True)
    CODA.write_text(json.dumps(c, ensure_ascii=False))


def _accoda(voce: dict, in_testa: bool = False):
    c = _leggi_coda()
    c["voci"].insert(0 if in_testa else len(c["voci"]), voce)
    _scrivi_coda(c)


def _segna_in_coda(storia: dict, id_: str, si: bool):
    for m in reversed(storia["messaggi"]):
        if m.get("id") == id_:
            if si:
                m["coda"] = True
            else:
                m.pop("coda", None)
            return


def _e_limite(testo: str) -> bool:
    return bool(re.search(r"usage limit|hit your limit|limit reached|rate.?limit", testo or "", re.I))


def _ora(ts: float) -> str:
    d = datetime.fromtimestamp(ts, ROMA)
    return ("alle " if d.date() == datetime.now(ROMA).date() else d.strftime("%d/%m alle ")) + d.strftime("%H:%M")


def _prossimo(finito: "Turno | None" = None) -> "Turno | None":
    """Fa partire la prima voce della coda, se Daneel è libero e il piano non è in pausa. Va chiamata con _lucchetto;
    `finito` è il turno che sta chiudendo (conta già come libero)."""
    global turno
    c = _leggi_coda()
    if not c["voci"] or time.time() < c["pausa_fino"] or not (turno is None or turno.fatto or turno is finito):
        return None
    voce = c["voci"].pop(0)
    c["pausa_fino"] = 0
    _scrivi_coda(c)
    if voce.get("timer"):
        _aggiungi_alla_chat("sistema", "⏰ " + voce.get("etichetta", "Messaggio automatico"))
    else:
        storia = _leggi_storia("daneel")
        _segna_in_coda(storia, voce["id"], False)
        _scrivi_storia("daneel", storia)
    t = Turno(voce.get("testo", ""), "daneel")
    t.timer, t.voce = bool(voce.get("timer")), voce
    turno = t
    asyncio.create_task(_esegui(t, voce["prompt"], Path(voce["vocale"]) if voce.get("vocale") else None))
    return t


async def _sveglia():
    """Ogni 30 s riprende la coda se si è fermata: pausa per il limite finita, o server appena ripartito."""
    while True:
        try:
            async with _lucchetto:
                _prossimo()
        except Exception:  # noqa: BLE001
            log.exception("coda ferma")
        await asyncio.sleep(30)


@app.on_event("startup")
async def _avvio():
    asyncio.create_task(_sveglia())


# ---------- Notifiche push (Web Push: su iPhone funzionano per le app aggiunte alla schermata Home) ----------

def _leggi_iscrizioni() -> list[dict]:
    try:
        return json.loads(ISCRIZIONI.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _manda_push(dati: dict) -> int:
    """Manda la notifica a ogni telefono iscritto; toglie le iscrizioni che il servizio di Apple dà per scadute.
    Sincrona (pywebpush usa requests): chiamarla con asyncio.to_thread."""
    from pywebpush import WebPushException, webpush
    iscrizioni, tenute, mandate = _leggi_iscrizioni(), [], 0
    for s in iscrizioni:
        try:
            webpush(s, json.dumps(dati, ensure_ascii=False), vapid_private_key=str(VAPID_PEM),
                    vapid_claims={"sub": VAPID_SUB}, ttl=3600, timeout=15)
            mandate += 1
            tenute.append(s)
        except WebPushException as ex:
            stato = ex.response.status_code if ex.response is not None else None
            if stato not in (404, 410):  # 404/410: iscrizione morta (app tolta, permesso revocato)
                tenute.append(s)
            log.warning("push fallita (%s): %s", stato, ex)
    if len(tenute) != len(iscrizioni):
        ISCRIZIONI.write_text(json.dumps(tenute))
    return mandate


def _testo_notifica(testo: str, massimo: int = 600) -> str:
    """La risposta come testo semplice per la notifica: niente Markdown, immagini e link, gli a capo restano
    (iOS li mostra; la notifica aperta col dito fa vedere tutto)."""
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", testo)                 # immagini
    t = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", t)               # [testo](link) -> testo
    t = re.sub(r"https?://\S+", "", t)                              # link nudi
    t = re.sub(r"[*_`#>|]", "", t)
    righe = []
    for r in t.splitlines():
        r = re.sub(r"^\s*[-•]\s+", "• ", r).strip()
        r = re.sub(r"\s{2,}", " ", r)
        if r and not re.fullmatch(r"[-:• ]+", r):
            righe.append(r)
    t = "\n".join(righe)
    return t if len(t) <= massimo else t[:massimo - 1].rstrip() + "…"


async def notifica(titolo: str, testo: str, agente: str = "daneel"):
    """Senza titolo iOS scriverebbe "Daneel" accanto all'icona, e Gabriele non lo vuole: il titolo diventa la prima
    riga della risposta e il corpo il resto. L'anteprima corta e l'espansione col dito le fa iOS da sé."""
    if not _leggi_iscrizioni():
        return 0
    pulito = _testo_notifica(testo)
    if not titolo:
        titolo, _, pulito = pulito.partition("\n")
        if len(titolo) > 70:   # prima riga lunga: il titolo è il suo inizio, il resto va nel corpo
            taglio = titolo.rfind(" ", 0, 60)
            taglio = taglio if taglio > 20 else 60
            titolo, pulito = titolo[:taglio].rstrip(" ,;:") + "…", "…" + titolo[taglio:].lstrip() + ("\n" + pulito if pulito else "")
    return await asyncio.to_thread(_manda_push, {"titolo": titolo, "testo": pulito, "agente": agente})


async def _trascrivi(audio: Path) -> str:
    """Il vocale registrato dall'app, con lo stesso Whisper dei vocali di Telegram (~/bin/trascrivi, sulla GPU)."""
    proc = await asyncio.create_subprocess_exec(str(HOME / "bin/trascrivi"), str(audio), stdin=asyncio.subprocess.DEVNULL,
                                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    out, _ = await asyncio.wait_for(proc.communicate(), 180)
    return out.decode(errors="replace").strip()


async def _esegui(t: Turno, prompt: str, audio: Path | None = None):
    if audio:  # prima il vocale diventa testo, poi il turno va avanti come un messaggio scritto
        await t.aggiungi({"tipo": "strumento", "nome": "trascrivo il vocale"})
        try:
            detto = await _trascrivi(audio)
        except Exception:  # noqa: BLE001
            log.exception("trascrizione fallita")
            detto = ""
        storia = _leggi_storia(t.agente)
        for m in reversed(storia["messaggi"]):
            if m["ruolo"] == "gabriele":
                m["testo"] = detto or "(vocale non capito)"
                break
        if not detto:
            storia["messaggi"].append({"ruolo": "errore", "testo": "Non ho capito il vocale: riprova.", "ts": time.time()})
            _scrivi_storia(t.agente, storia)
            await t.aggiungi({"tipo": "errore", "testo": "Non ho capito il vocale: riprova."})
            await t.aggiungi({"tipo": "fine"})
            async with t.cambiato:
                t.fatto = True
                t.cambiato.notify_all()
            return
        _scrivi_storia(t.agente, storia)
        await t.aggiungi({"tipo": "trascritto", "testo": detto})
        prompt = detto + prompt  # prompt qui ha solo le eventuali foto e la nota del subagente scelto
        if t.voce:  # se il piano è al limite la voce torna in coda già trascritta
            t.voce.update(prompt=prompt, vocale=None, testo=detto)
    storia = _leggi_storia(t.agente)
    cmd = [str(CLAUDE), "-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages",
           "--settings", str(HOME / ".claude/app-settings.json"),
           "--append-system-prompt", SISTEMA + (SISTEMA_TIMER if t.timer else "")]
    if storia.get("sessione"):
        cmd += ["--resume", storia["sessione"]]
    env = {**os.environ, "PATH": f"{HOME}/.local/bin:{HOME}/bin:{os.environ.get('PATH', '/usr/bin:/bin')}"}
    risposta, sessione, errore = "", storia.get("sessione"), None
    limite = None  # il piano è al limite: quando si azzera (secondi Unix, 0 se non si sa)
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, cwd=HOME / "claude-mind", env=env, stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, limit=16 * 1024 * 1024)
        strumenti: dict[int, dict] = {}
        async def leggi():
            nonlocal risposta, sessione, errore, limite
            async for riga in proc.stdout:
                try:
                    m = json.loads(riga)
                except json.JSONDecodeError:
                    continue
                sessione = m.get("session_id") or sessione
                if m.get("type") == "stream_event" and not m.get("parent_tool_use_id"):
                    e = m["event"]
                    if e["type"] == "content_block_start" and e["content_block"]["type"] == "tool_use":
                        strumenti[e["index"]] = {"nome": e["content_block"]["name"], "json": ""}
                    elif e["type"] == "content_block_delta":
                        d = e["delta"]
                        if d["type"] == "text_delta":
                            risposta += d["text"]
                            await t.aggiungi({"tipo": "testo", "testo": d["text"]})
                        elif d["type"] == "input_json_delta" and e["index"] in strumenti:
                            strumenti[e["index"]]["json"] += d["partial_json"]
                    elif e["type"] == "content_block_stop" and e["index"] in strumenti:
                        s = strumenti.pop(e["index"])
                        try:
                            inp = json.loads(s["json"] or "{}")
                        except json.JSONDecodeError:
                            inp = {}
                        await t.aggiungi({"tipo": "strumento", "nome": _nome_strumento(s["nome"], inp)})
                    elif e["type"] == "message_start" and risposta and not risposta.endswith("\n\n"):
                        risposta += "\n\n"  # un nuovo messaggio dopo gli strumenti: a capo
                        await t.aggiungi({"tipo": "testo", "testo": "\n\n"})
                elif m.get("type") == "result" and m.get("is_error"):
                    errore = m.get("result") or "errore di Claude"
                elif m.get("type") == "rate_limit_event":
                    info = m.get("rate_limit_info", {})
                    if info.get("status") not in ("allowed", "allowed_warning", None) and \
                            info.get("overageStatus") not in ("allowed", "allowed_warning"):
                        limite = info.get("resetsAt") or 0
                        errore = "Limite del piano raggiunto: riprova dopo il reset."
        await asyncio.wait_for(leggi(), TIMEOUT)
        await proc.wait()
        if proc.returncode and not errore and not risposta:
            errore = (await proc.stderr.read()).decode(errors="replace")[-500:] or f"claude è uscito con {proc.returncode}"
    except asyncio.TimeoutError:
        proc.kill()
        errore = "Ci ho messo troppo e ho interrotto."
    except Exception as ex:  # noqa: BLE001
        log.exception("turno fallito")
        errore = str(ex)

    if limite is None and errore and _e_limite(errore):
        limite = 0
    storia = _leggi_storia(t.agente)
    storia["sessione"] = sessione
    if limite is not None and not risposta.strip() and t.voce:
        # Piano al limite prima di rispondere: il messaggio torna in testa alla coda e si riprende dopo il reset.
        fino = float(limite) + 60 if limite and float(limite) > time.time() else time.time() + PAUSA_SENZA_ORA
        _accoda(t.voce, in_testa=True)
        c = _leggi_coda()
        c["pausa_fino"] = fino
        _scrivi_coda(c)
        if not t.voce.get("timer"):
            _segna_in_coda(storia, t.voce["id"], True)
        errore = None
        risposta = f"⏸️ Limite del piano raggiunto: riprendo da solo {_ora(fino)} ({len(c['voci'])} in coda)."
        storia["messaggi"].append({"ruolo": "sistema", "testo": risposta, "ts": time.time()})
        await t.aggiungi({"tipo": "pausa", "testo": risposta})
    else:
        if risposta.strip():
            storia["messaggi"].append({"ruolo": "daneel", "testo": risposta.strip(), "ts": time.time()})
        if errore:
            storia["messaggi"].append({"ruolo": "errore", "testo": errore, "ts": time.time()})
            await t.aggiungi({"tipo": "errore", "testo": errore})
    _scrivi_storia(t.agente, storia)
    # Se intanto Gabriele ha chiuso l'app (o lo schermo è spento), lo avvisa con una notifica.
    if time.time() - _ultimo_visibile > VISIBILE_PER and (risposta.strip() or errore):
        try:
            await notifica("", risposta.strip() or f"Errore: {errore}", t.agente)
        except Exception:  # noqa: BLE001
            log.exception("notifica non mandata")
    async with _lucchetto:  # parte il prossimo della coda prima della "fine", così l'app lo trova già in corso
        _prossimo(finito=t)
    await t.aggiungi({"tipo": "fine"})
    async with t.cambiato:
        t.fatto = True
        t.cambiato.notify_all()


@app.get("/api/stato")
async def stato(agente: str = "daneel", authorization: str | None = Header(None)):
    _controlla(authorization)
    agente = _agente(agente)
    s = _leggi_storia(agente)
    vivo = turno is not None and not turno.fatto
    # in_corso: la risposta che si sta scrivendo è in questa chat; occupato: è in un'altra (una alla volta)
    c = _leggi_coda()
    return {"messaggi": s["messaggi"][-200:], "in_corso": vivo and turno.agente == agente,
            "occupato": turno.agente if vivo and turno.agente != agente else None,
            "coda": len(c["voci"]), "pausa_fino": c["pausa_fino"] if c["pausa_fino"] > time.time() else 0}


@app.post("/api/messaggio")
async def messaggio(testo: str = Form(""), agente: str = Form("daneel"), foto: list[UploadFile] = File(default=[]),
                    audio: UploadFile | None = File(default=None), authorization: str | None = Header(None)):
    global turno
    _controlla(authorization)
    via = _agente(agente)   # il subagente scelto dal menu ("daneel" = automatico)
    agente = "daneel"       # la conversazione è sempre quella di Daneel
    testo = testo.strip()
    if not testo and not foto and not audio:
        raise HTTPException(400, "messaggio vuoto")
    async with _lucchetto:
        # Se Daneel sta già rispondendo (o il piano è in pausa) il messaggio aspetta in coda: niente più "aspetta".
        id_ = secrets.token_hex(6)
        percorsi = []
        if foto:
            FOTO.mkdir(parents=True, exist_ok=True)
            for i, f in enumerate(foto[:6]):
                dati = await f.read(MAX_FOTO + 1)
                if len(dati) > MAX_FOTO:
                    raise HTTPException(413, "foto troppo grande")
                est = Path(f.filename or "").suffix.lower()
                est = est if est in (".jpg", ".jpeg", ".png", ".heic", ".webp") else ".jpg"
                p = FOTO / f"{time.strftime('%Y%m%d-%H%M%S')}-{id_}-{i}{est}"
                p.write_bytes(dati)
                percorsi.append(str(p))
        vocale = None
        if audio:
            dati = await audio.read(MAX_AUDIO + 1)
            if len(dati) > MAX_AUDIO:
                raise HTTPException(413, "vocale troppo lungo")
            AUDIO.mkdir(parents=True, exist_ok=True)
            est = Path(audio.filename or "").suffix.lower()
            est = est if est in (".m4a", ".mp4", ".webm", ".ogg", ".wav") else ".m4a"
            vocale = AUDIO / f"{time.strftime('%Y%m%d-%H%M%S')}-{id_}{est}"
            vocale.write_bytes(dati)
        foto_txt = ("\n\n[Foto allegate: " + ", ".join(percorsi) + "]") if percorsi else ""
        nota = NOTA_SUB.format(via) if via != "daneel" else ""
        prompt = (foto_txt if vocale else (testo or "(nessun testo)") + foto_txt) + nota
        storia = _leggi_storia(agente)
        storia["messaggi"].append({"ruolo": "gabriele", "testo": "…" if vocale else testo, "foto": len(percorsi),
                                   "vocale": bool(vocale), "via": via if via != "daneel" else None,
                                   "ts": time.time(), "id": id_, "coda": True})
        _scrivi_storia(agente, storia)
        _accoda({"id": id_, "prompt": prompt, "vocale": str(vocale) if vocale else None, "testo": testo})
        t = _prossimo()
        if t is None or t.voce["id"] != id_:
            c = _leggi_coda()
            return {"in_coda": True, "id": id_, "posizione": len(c["voci"]),
                    "pausa_fino": c["pausa_fino"] if c["pausa_fino"] > time.time() else 0}
    return StreamingResponse(t.segui(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.post("/api/coda/togli")
async def coda_togli(dati: dict, authorization: str | None = Header(None)):
    """Toglie un messaggio che aspetta ancora in coda (e la sua bolla dalla chat)."""
    _controlla(authorization)
    id_ = str(dati.get("id", ""))
    async with _lucchetto:
        c = _leggi_coda()
        resto = [v for v in c["voci"] if v.get("id") != id_]
        if len(resto) == len(c["voci"]):
            raise HTTPException(404, "non è più in coda")
        c["voci"] = resto
        if not resto:
            c["pausa_fino"] = 0
        _scrivi_coda(c)
        storia = _leggi_storia("daneel")
        storia["messaggi"] = [m for m in storia["messaggi"] if m.get("id") != id_]
        _scrivi_storia("daneel", storia)
    return {"ok": True}


@app.get("/api/segui")
async def segui(agente: str = "daneel", authorization: str | None = Header(None)):
    _controlla(authorization)
    if turno is None or turno.fatto or turno.agente != _agente(agente):
        raise HTTPException(404, "nessun turno in corso")
    return StreamingResponse(turno.segui(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.post("/api/nuova")
async def nuova(agente: str = "daneel", authorization: str | None = Header(None)):
    """Nuova conversazione: la storia vecchia va in archivio e la prossima volta parte una sessione nuova."""
    _controlla(authorization)
    agente = _agente(agente)
    if turno is not None and not turno.fatto and turno.agente == agente:
        raise HTTPException(409, "aspetta che finisca la risposta")
    s = _leggi_storia(agente)
    if s["messaggi"]:
        (DATI / "archivio").mkdir(parents=True, exist_ok=True)
        (DATI / "archivio" / f"{time.strftime('%Y%m%d-%H%M%S')}-{agente}.json").write_text(
            json.dumps(s, ensure_ascii=False, indent=1))
    # i messaggi ancora in coda passano nella conversazione nuova
    _scrivi_storia(agente, {"sessione": None, "messaggi": [m for m in s["messaggi"] if m.get("coda")]})
    return {"ok": True}


@app.get("/api/push/chiave")
async def push_chiave(authorization: str | None = Header(None)):
    _controlla(authorization)
    return {"chiave": VAPID_PUB.read_text().strip(), "iscritti": len(_leggi_iscrizioni())}


@app.post("/api/push/iscrivi")
async def push_iscrivi(iscrizione: dict, authorization: str | None = Header(None)):
    _controlla(authorization)
    if not str(iscrizione.get("endpoint", "")).startswith("https://") or "keys" not in iscrizione:
        raise HTTPException(400, "iscrizione non valida")
    altre = [s for s in _leggi_iscrizioni() if s.get("endpoint") != iscrizione["endpoint"]]
    DATI.mkdir(parents=True, exist_ok=True)
    ISCRIZIONI.write_text(json.dumps(altre + [{"endpoint": iscrizione["endpoint"], "keys": iscrizione["keys"]}]))
    ISCRIZIONI.chmod(0o600)
    return {"ok": True}


@app.post("/api/push/disiscrivi")
async def push_disiscrivi(dati: dict, authorization: str | None = Header(None)):
    _controlla(authorization)
    altre = [s for s in _leggi_iscrizioni() if s.get("endpoint") != dati.get("endpoint")]
    ISCRIZIONI.write_text(json.dumps(altre))
    return {"ok": True}


@app.post("/api/push/prova")
async def push_prova(authorization: str | None = Header(None)):
    _controlla(authorization)
    return {"mandate": await notifica("", "Le notifiche funzionano ✅")}


@app.post("/api/notifica")
async def api_notifica(dati: dict, authorization: str | None = Header(None)):
    """Per gli script del server e per Daneel (~/bin/notifica-app): una notifica sull'iPhone."""
    _controlla(authorization)
    agente = dati.get("agente") if dati.get("agente") in AGENTI else "daneel"
    titolo = dati.get("titolo") or ""
    if not dati.get("testo"):
        raise HTTPException(400, "manca il testo")
    return {"mandate": await notifica(titolo, str(dati["testo"]), agente)}


# ---------- Messaggi che partono dal server (timer, avvisi): prima andavano a Daneel su Telegram ----------

SISTEMA_TIMER = """
- Questo messaggio non l'ha scritto Gabriele: l'ha mandato un timer del server. Fai quello che chiede; quello che \
scrivi arriva a Gabriele nella chat dell'app e come notifica."""
SISTEMA_SILENZIO = SISTEMA_TIMER + """
- È un lavoro silenzioso: se non c'è niente che Gabriele debba sapere (tutto a posto), rispondi esattamente NIENTE. \
Altrimenti scrivi solo l'avviso, in poche righe."""


def _aggiungi_alla_chat(ruolo: str, testo: str):
    storia = _leggi_storia("daneel")
    storia["messaggi"].append({"ruolo": ruolo, "testo": testo, "ts": time.time()})
    _scrivi_storia("daneel", storia)


@app.post("/api/avviso")
async def avviso(dati: dict, authorization: str | None = Header(None)):
    """Un avviso già scritto (Revolut, NotebookLM, Muay Thai…): va nella chat di Daneel e arriva come notifica."""
    _controlla(authorization)
    testo = str(dati.get("testo", "")).strip()
    if not testo:
        raise HTTPException(400, "manca il testo")
    _aggiungi_alla_chat("daneel", testo)
    return {"mandate": await notifica("", testo)}


@app.post("/api/sistema")
async def sistema(dati: dict, authorization: str | None = Header(None)):
    """Un compito da un timer (~/bin/manda-a-daneel). Con `silenzioso` gira in una sessione a parte e scrive in chat
    (con notifica) solo se c'è qualcosa da dire; altrimenti è un turno della chat di Daneel, con un'etichetta ⏰,
    che si mette in coda come i messaggi di Gabriele."""
    _controlla(authorization)
    prompt = str(dati.get("prompt", "")).strip()
    if not prompt:
        raise HTTPException(400, "manca il prompt")
    etichetta = str(dati.get("etichetta") or "Messaggio automatico")
    if dati.get("silenzioso"):
        return await _silenzioso(prompt)
    async with _lucchetto:
        _accoda({"id": secrets.token_hex(6), "prompt": prompt, "timer": True, "etichetta": etichetta, "testo": etichetta})
        partito = _prossimo() is not None
    return {"ok": True, "in_coda": not partito}


async def _silenzioso(prompt: str):
    if _leggi_coda()["pausa_fino"] > time.time():
        return {"detto": None, "saltato": "piano al limite"}  # riproverà il timer al prossimo giro
    env = {**os.environ, "PATH": f"{HOME}/.local/bin:{HOME}/bin:{os.environ.get('PATH', '/usr/bin:/bin')}"}
    proc = await asyncio.create_subprocess_exec(
        str(CLAUDE), "-p", prompt, "--output-format", "json", "--settings", str(HOME / ".claude/app-settings.json"),
        "--append-system-prompt", SISTEMA + SISTEMA_SILENZIO, cwd=HOME / "claude-mind", env=env,
        stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await asyncio.wait_for(proc.communicate(), TIMEOUT)
    try:
        esito = json.loads(out)
        testo = (esito.get("result") or "").strip()
        if esito.get("is_error"):
            if _e_limite(testo):  # piano al limite: niente avviso, la coda si ferma e il timer riproverà
                c = _leggi_coda()
                c["pausa_fino"] = max(c["pausa_fino"], time.time() + PAUSA_SENZA_ORA)
                _scrivi_coda(c)
                return {"detto": None, "saltato": "piano al limite"}
            testo = f"⚠️ Un lavoro automatico non è andato: {testo or 'errore di Claude'}"
    except json.JSONDecodeError:
        testo = f"⚠️ Un lavoro automatico non è andato: {err.decode(errors='replace')[-300:]}"
    if testo and testo.strip(" .") != "NIENTE":
        _aggiungi_alla_chat("daneel", testo)
        await notifica("", testo)
        return {"detto": testo}
    return {"detto": None}


@app.post("/api/visibile")
async def visibile(token: str = Form(""), stato: str = Form("si"), authorization: str | None = Header(None)):
    """L'app in primo piano si fa sentire ogni ~15 s; quando va in background lo dice (sendBeacon, che non
    manda intestazioni: il token arriva nel corpo)."""
    global _ultimo_visibile
    _controlla(authorization or "Bearer " + token)
    _ultimo_visibile = time.time() if stato == "si" else 0.0
    return {"ok": True}


@app.get("/")
async def indice():
    return FileResponse(QUI / "static/index.html", headers={"Cache-Control": "no-cache"})


plancia.collega(_controlla)  # la Plancia (database e agenda), con lo stesso token dell'app
app.include_router(plancia.router)
cibo.collega(_controlla)  # la scheda Cibo: Open Food Facts e pasti aggiunti a mano
app.include_router(cibo.router)
app.mount("/", StaticFiles(directory=QUI / "static"), name="static")
