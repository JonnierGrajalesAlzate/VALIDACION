"""
Envía a la API los casos de uso del enunciado (diapositivas) y muestra, por transacción,
el estado que asignó la ventana deslizante.

Uso (desde la carpeta TAREA, con el backend corriendo):
    python peticiones/casos_enunciado.py [http://localhost:3000]

Firma igual que el profesor: json.dumps(sort_keys=True, separators=(",", ":")) + HMAC-SHA256.
Cada corrida usa correos nuevos (@prueba-profesor.com) para no mezclar ventanas entre corridas.
Para borrar estos datos: database/limpiar-prueba-profesor.sql
"""
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000").rstrip("/")
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORRIDA = int(time.time()) % 1_000_000
ID = [800_000_000 + CORRIDA * 100]
FECHA = "2026-09-23"


def secreto():
    if os.environ.get("HMAC_SECRET"):
        return os.environ["HMAC_SECRET"]
    with open(os.path.join(RAIZ, "backend", ".env"), encoding="utf-8") as f:
        for linea in f:
            if linea.startswith("HMAC_SECRET="):
                return linea.split("=", 1)[1].strip()
    sys.exit("No se encontró HMAC_SECRET")


SECRETO = secreto()


def txn(usuario, hora, valor=50000):
    ID[0] += 1
    d = {"idTxn": ID[0], "user": f"{usuario}.{CORRIDA}@prueba-profesor.com", "date": f"{FECHA}T{hora}",
         "value": valor, "paymentMethod": "Tarjeta"}
    mensaje = json.dumps(d, sort_keys=True, separators=(",", ":"))
    d["hash"] = hmac.new(SECRETO.encode(), mensaje.encode(), hashlib.sha256).hexdigest()
    return d


def http(metodo, ruta, cuerpo=None):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(BASE + ruta, data=datos, method=metodo, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


# (nombre, transacciones, resultado esperado según el enunciado: True = hay POSIBLE_FRAUDE)
CASOS = [
    ("Enunciado: a@a.com 10:30:01, :02, :03 ($50.000, $30.000, $20.000)",
     [("a", "10:30:01", 50000), ("a", "10:30:02", 30000), ("a", "10:30:03", 20000)], True),
    ("Caso 1: b@b.com 10:00:01, :02, :03",
     [("b", "10:00:01", 50000), ("b", "10:00:02", 50000), ("b", "10:00:03", 50000)], True),
    ("Caso 2: b@b.com 10:00:01, :05, :09",
     [("b2", "10:00:01", 50000), ("b2", "10:00:05", 50000), ("b2", "10:00:09", 50000)], False),
    ("Caso 3: usuarios distintos 10:00:01, :02, :03",
     [("usuario1", "10:00:01", 50000), ("usuario2", "10:00:02", 50000), ("usuario3", "10:00:03", 50000)], False),
]


def main():
    s, cfg = http("GET", "/api/config")
    r = cfg["reglas"]
    fh = r["franjasHorarias"]
    franjas = ", ".join(f"{f['nombre']} {f['segundosVentana']} s" for f in fh["franjas"]) if fh["activo"] else "desactivadas"
    print(f"API {BASE} · umbral {r['ventanaDeslizante']['umbral']} · ventana fija {r['ventanaDeslizante']['segundos']} s"
          f" · franjas: {franjas}\n")

    bien = 0
    for nombre, filas, espera_anomalia in CASOS:
        lote = [txn(u, h, v) for u, h, v in filas]
        s, b = http("POST", "/api/transacciones", lote)
        hubo = b.get("resumen", {}).get("anomalias", 0) > 0
        ok = s == 201 and hubo == espera_anomalia
        bien += ok
        print(f"[{'OK   ' if ok else 'DIFIERE'}] {nombre}")
        print(f"         enunciado: {'POSIBLE ANOMALÍA' if espera_anomalia else 'comportamiento normal'}"
              f"  ·  API: HTTP {s}, {b.get('resumen', {}).get('anomalias', '?')} anomalía(s)")
        for a in b.get("aceptadas", []):
            an = a["anomalias"][0] if a["anomalias"] else None
            extra = f"  {an['tipo']} {an['nivel']} ({an['cantidad']} en {an['ventanaSegundos']} s, franja {an.get('franja')})" if an else ""
            print(f"           {a['fecha'][11:19]}  {a['usuario'].split('.')[0]:9s} {a['estado']:8s}{extra}")
        for e in b.get("errores", []):
            print(f"           ERROR {e.get('codigo')}: {e.get('mensaje')}")
        print()
    print(f"RESULTADO: {bien}/{len(CASOS)} casos coinciden con el enunciado")
    return 0 if bien == len(CASOS) else 1


if __name__ == "__main__":
    sys.exit(main())
