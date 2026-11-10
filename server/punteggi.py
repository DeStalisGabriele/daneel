"""Punteggi di salute della scheda Salute: Sonno, Recupero e Sforzo da 0 a 100, calcolati dai dati della Plancia
(salute/<data> da Apple Health, allenamenti/ da Hevy, giorni/<data> per la spunta della Muay Thai). Niente modelli:
solo conti, sempre rispetto alla media personale di Gabriele (vedi la pagina "Punteggio di salute" della memoria).

- Sonno: ore contro il fabbisogno (media delle proprie notti, almeno 7 h, più metà del debito delle ultime 3 notti,
  al massimo 1 h) per il 55%; sonno profondo (obiettivo 15% della notte) e REM (20%) per il 25%; efficienza (piena dal
  97%) per il 5%; regolarità dell'ora in cui ci si addormenta (scarto dalla media di 14 notti) per il 15%.
- Recupero: 60 + 16·z(ln HRV) − 11·z(FC a riposo) + 0,2·(Sonno − 70), con z rispetto ai 30 giorni prima; senza
  almeno 5 giorni di base il punteggio è "provvisorio".
- Sforzo: passi (pieni a 10.000) o calorie attive (piene a 600) fino a 35 punti, pesi fino a 45 (pieni a 90 minuti
  su Hevy), Muay Thai 45; massimo 100. L'obiettivo del giorno sale con il recupero.
- Malattia (collezione `malattia`, un documento per giorno: sintomi, febbre, gravità, note; dal 2026-11-10): i giorni
  segnati come malattia non entrano nelle medie di riferimento (HRV, FC a riposo, ore e orari del sonno), così una
  malattia non sposta per settimane il "normale" di Gabriele. Il giorno di malattia i punteggi si calcolano lo stesso
  (si vede quanto si è scostato) ma sono marcati, e per lo Sforzo non c'è obiettivo: è un giorno di riposo.
  Scelta nostra, non validata da uno studio.
"""

import json
import math
import os
import re
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path
from statistics import mean, pstdev

DB = Path(os.environ.get("DANEEL_DATI", Path.home() / ".local/share/daneel-app")) / "plancia.db"


def _leggi(col: str) -> dict:
    c = sqlite3.connect(DB)
    try:
        return {i: json.loads(d) for i, d in c.execute("SELECT id, data FROM docs WHERE col=?", (col,))}
    finally:
        c.close()


def _num(x):
    try:
        return float(x) if x is not None and not (isinstance(x, float) and math.isnan(x)) else None
    except (TypeError, ValueError):
        return None


def _ora_addormentamento(inizio: str | None):
    """'30 Oct 2026 at 10:38 PM' → minuti dopo mezzogiorno (così le 23 e l'1 di notte sono vicine)."""
    if not inizio:
        return None
    m = re.search(r"at (\d{1,2}):(\d{2})\s*([AP]M)", inizio)
    if not m:
        return None
    h, mi = int(m.group(1)) % 12, int(m.group(2))
    if m.group(3) == "PM":
        h += 12
    return (h * 60 + mi - 12 * 60) % (24 * 60)


def _data_fine(fine: str | None):
    """'31 Oct 2026 at 7:02 AM' → '2026-10-31' (None se non si legge)."""
    if not fine:
        return None
    try:
        return datetime.strptime(fine.split(" at ")[0].strip(), "%d %b %Y").date().isoformat()
    except ValueError:
        return None


def _tra(v, lo, hi):
    return max(lo, min(hi, v))


def _z(v, storico):
    s = [x for x in storico if x is not None]
    if v is None or len(s) < 5:
        return None
    sd = pstdev(s) or 1e-9
    return (v - mean(s)) / sd


def calcola(giorni: int = 30) -> list[dict]:
    salute, allen, gg, mal = _leggi("salute"), _leggi("allenamenti"), _leggi("giorni"), _leggi("malattia")
    oggi = date.today()
    tutte = sorted(set(salute) | {oggi.isoformat()})
    inizio = max(date.fromisoformat(tutte[0]), oggi - timedelta(days=giorni - 1))
    pesi_per_giorno: dict[str, float] = {}
    for w in allen.values():
        if w.get("data"):
            pesi_per_giorno[w["data"]] = pesi_per_giorno.get(w["data"], 0) + (_num(w.get("durataMin")) or 60)

    def ore(d):
        """Ore di sonno della notte che finisce la mattina del giorno d. Se il comando rapido ha preso un pezzo della
        notte prima (succede quando stanotte l'orologio non ha registrato niente), quel sonno non vale per d."""
        sonno = salute.get(d, {}).get("sonno") or {}
        fine = _data_fine(sonno.get("fine"))
        if fine is not None and fine != d:
            return None
        return _num(sonno.get("ore"))

    out = []
    d = inizio
    while d <= oggi:
        k = d.isoformat()
        s = salute.get(k, {})
        prima = [(d - timedelta(days=i)).isoformat() for i in range(1, 31)]
        base_ok = [p for p in prima if p not in mal]          # i giorni di malattia non fanno media

        # --- Sonno
        sonno = None
        dett_sonno = {}
        o = ore(k)
        if o:
            notti = sorted(x for x in (ore(p) for p in base_ok) if x)
            if len(notti) >= 5:
                taglio = max(1, len(notti) // 10)
                base = mean(notti[taglio:-taglio] or notti)
            else:
                base = 7.5
            debito = sum(max(0.0, base - (ore(p) or base)) for p in prima[:3])
            bisogno = max(7.0, base) + min(1.0, debito / 2)
            durata = _tra(100 - (1 - o / bisogno) * 250, 0, 100)
            fasi = s.get("sonno") or {}
            prof, rem, sveglio = _num(fasi.get("profondo")), _num(fasi.get("rem")), _num(fasi.get("sveglio")) or 0
            p_prof = _tra((prof or 0) / o / 0.15 * 100, 0, 100) if prof is not None else 70
            p_rem = _tra((rem or 0) / o / 0.20 * 100, 0, 100) if rem is not None else 70
            eff = o / (o + sveglio) if o + sveglio else 1
            p_eff = _tra((eff - 0.85) / (0.97 - 0.85) * 100, 0, 100)
            ora = _ora_addormentamento(fasi.get("inizio"))
            storiche = [x for x in (_ora_addormentamento((salute.get(p, {}).get("sonno") or {}).get("inizio")) for p in base_ok[:14]) if x is not None]
            if ora is not None and len(storiche) >= 4:
                scarto = abs(ora - mean(storiche))
                p_reg = _tra(100 - (scarto - 30) / 90 * 100, 0, 100)
            else:
                p_reg = 70
            sonno = round(0.55 * durata + 0.125 * p_prof + 0.125 * p_rem + 0.05 * p_eff + 0.15 * p_reg)
            dett_sonno = {"ore": round(o, 1), "bisogno": round(bisogno, 1), "durata": round(durata),
                          "profondo": round(p_prof), "rem": round(p_rem), "efficienza": round(p_eff), "regolarita": round(p_reg)}

        # --- Recupero
        hrv, fc = _num(s.get("hrv")), _num(s.get("fc_riposo"))
        storia_hrv = [x for x in (_num(salute.get(p, {}).get("hrv")) for p in base_ok) if x]
        storia_fc = [x for x in (_num(salute.get(p, {}).get("fc_riposo")) for p in base_ok) if x]
        zh = _z(math.log(hrv), [math.log(x) for x in storia_hrv]) if hrv else None
        zf = _z(fc, storia_fc) if fc else None
        base_giorni = len(storia_hrv)
        recupero = None
        if zh is not None or zf is not None:
            v = 60 + 16 * (zh or 0) - 11 * (zf or 0) + (0.2 * (sonno - 70) if sonno is not None else 0)
            recupero = round(_tra(v, 1, 100))

        # --- Sforzo
        passi, kcal = _num(s.get("passi")), _num(s.get("kcal attive") or s.get("kcal_attive"))
        movimento = 35 * min(1, kcal / 600) if kcal else (35 * min(1, passi / 10000) if passi else 0)
        pesi = 45 * min(1, pesi_per_giorno.get(k, 0) / 90) if k in pesi_per_giorno else 0
        mt = 45 if (gg.get(k, {}).get("h") or {}).get("muaythai") else 0
        sforzo = round(min(100, movimento + pesi + mt)) if (passi or kcal or pesi or mt) else None
        obiettivo = round(30 + 0.4 * recupero) if recupero is not None else None

        # --- Malattia: dati segnati a mano (collezione `malattia`)
        mk, malattia = mal.get(k), None
        if mk is not None:
            n = 1
            while (d - timedelta(days=n)).isoformat() in mal:
                n += 1
            malattia = {"sintomi": mk.get("sintomi") or [], "febbre": _num(mk.get("febbre")), "gravita": mk.get("gravita"),
                        "note": mk.get("note") or "", "giornoDellaMalattia": n}
            obiettivo = None            # giorno di riposo: niente obiettivo di sforzo

        out.append({"data": k, "sonno": sonno, "recupero": recupero, "sforzo": sforzo, "obiettivoSforzo": obiettivo,
                    "provvisorio": base_giorni < 14, "malattia": malattia, "dettagli": {
                        "sonno": dett_sonno, "hrv": hrv, "fcRiposo": fc, "zHrv": round(zh, 2) if zh is not None else None,
                        "zFc": round(zf, 2) if zf is not None else None, "giorniDiBase": base_giorni,
                        "hrvMedia": round(math.exp(mean(math.log(x) for x in storia_hrv)), 1) if storia_hrv else None,
                        "fcMedia": round(mean(storia_fc), 1) if storia_fc else None,
                        "passi": passi, "kcalAttive": kcal, "minutiPesi": pesi_per_giorno.get(k), "muaythai": bool(mt)}})
        d += timedelta(days=1)
    return out


if __name__ == "__main__":
    for r in calcola(14):
        print(r["data"], "sonno", r["sonno"], "recupero", r["recupero"], "sforzo", r["sforzo"], "obiettivo", r["obiettivoSforzo"],
              "provvisorio" if r["provvisorio"] else "", r["dettagli"]["sonno"])
