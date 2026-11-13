"""
Prueba de punta a punta de la API, enviando las transacciones como lo haría el
profesor desde Python (diccionarios firmados con json.dumps + HMAC-SHA256).

Uso (desde la carpeta TAREA, con el backend corriendo):
    python peticiones/prueba_profesor.py
    python peticiones/prueba_profesor.py http://localhost:3000

La llave se toma de la variable de entorno HMAC_SECRET o, si no existe, de backend/.env.
Solo usa la librería estándar (no hace falta instalar requests).

Los datos de prueba usan correos @prueba-profesor.com e idTxn únicos por corrida.
Para borrarlos después: database/limpiar-prueba-profesor.sql
"""
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000").rstrip("/")
URL = f"{BASE}/api/transacciones"
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def leer_secreto():
    if os.environ.get("HMAC_SECRET"):
        return os.environ["HMAC_SECRET"]
    with open(os.path.join(RAIZ, "backend", ".env"), encoding="utf-8") as f:
        for linea in f:
            if linea.startswith("HMAC_SECRET="):
                return linea.split("=", 1)[1].strip()
    sys.exit("No se encontró HMAC_SECRET (ni en el entorno ni en backend/.env)")


SECRETO = leer_secreto()
CORRIDA = int(time.time()) % 1_000_000          # distinto en cada ejecución
SIGUIENTE_ID = [900_000_000 + CORRIDA * 1000]   # idTxn únicos por corrida
DOMINIO = "prueba-profesor.com"
J = {"Content-Type": "application/json"}


# ─── Firma: exactamente como el enunciado ──────────────────────────────────
def firmar(datos, secreto=SECRETO, separadores=(",", ":")):
    mensaje = json.dumps(datos, sort_keys=True, separators=separadores)
    return hmac.new(secreto.encode(), mensaje.encode(), hashlib.sha256).hexdigest()


def con_hash(datos, **kw):
    d = dict(datos)
    d["hash"] = firmar(datos, **kw)
    return d


def nuevo_id():
    SIGUIENTE_ID[0] += 1
    return SIGUIENTE_ID[0]


def correo(nombre):
    return f"{nombre}.{CORRIDA}@{DOMINIO}"


HORA = [datetime(2026, 11, 12, 6, 0, 0)]


def siguiente_hora():
    """Cada transacción 'general' va 1 minuto después de la anterior: no forman ráfagas."""
    HORA[0] += timedelta(minutes=1)
    return HORA[0].strftime("%Y-%m-%dT%H:%M:%S.000")


def txn(**cambios):
    d = {"idTxn": nuevo_id(), "user": correo("general"), "date": siguiente_hora(),
         "value": 50000, "paymentMethod": "Tarjeta"}
    d.update(cambios)
    return d


# ─── HTTP ──────────────────────────────────────────────────────────────────
def peticion(metodo, url, cuerpo=None, headers=None):
    if isinstance(cuerpo, (dict, list)):
        cuerpo = json.dumps(cuerpo).encode()
    elif isinstance(cuerpo, str):
        cuerpo = cuerpo.encode("utf-8")
    req = urllib.request.Request(url, data=cuerpo, headers=headers or {}, method=metodo)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        texto = e.read()
        try:
            return e.code, json.loads(texto)
        except ValueError:
            return e.code, {"mensaje": texto.decode("utf-8", "replace")}
    except urllib.error.URLError as e:
        sys.exit(f"No se pudo conectar con {url}: {e.reason}. ¿Está corriendo el backend?")


def post(cuerpo, headers=J):
    return peticion("POST", URL, cuerpo, headers)


# ─── Registro de resultados ────────────────────────────────────────────────
resultados = []


def detalle(body):
    errs = body.get("errores") or []
    if errs:
        return "; ".join(sorted({f"{e.get('codigo')}({e.get('campo')})" for e in errs}))[:110]
    r = body.get("resumen")
    if r:
        return f"aceptadas={r['aceptadas']} rechazadas={r['rechazadas']} anomalías={r['anomalias']}"
    return (body.get("mensaje") or "")[:110]


def verificar(grupo, nombre, status, body, esperado, extra_ok=True, extra_msg=""):
    ok = status == esperado and extra_ok
    resultados.append((grupo, nombre, ok))
    marca = "OK  " if ok else "FALLA"
    print(f"  [{marca}] {nombre:55s} HTTP {status} (esperado {esperado})  {detalle(body)}{extra_msg}")
    return ok


# ═══════════════════════════════════════════════════════════════════════════
def main():
    s, salud = peticion("GET", f"{BASE}/api/health")
    if s != 200:
        sys.exit(f"/api/health respondió {s}: {salud}")
    s, cfg = peticion("GET", f"{BASE}/api/config")
    reglas = cfg.get("reglas", cfg.get("datos", cfg))
    umbral = reglas["ventanaDeslizante"]["umbral"]
    print(f"API: {BASE}  ·  BD: {salud['baseDeDatos']['nombre']}  ·  umbral configurado: {umbral}  ·  corrida: {CORRIDA}\n")

    # ── 1. Transacciones válidas en los formatos que produce Python ─────────
    G = "1. Transacciones válidas (guía y variantes de bots)"
    print(G)
    t0 = datetime(2026, 11, 12, 4, 15, 30, 120000)
    casos = [
        ("requests.post(json=...)  (caso del enunciado)", con_hash(txn()), J),
        ("requests.post(data=json.dumps(...)) sin Content-Type", con_hash(txn()), {}),
        ("Postman raw 'Text' (Content-Type: text/plain)", con_hash(txn()), {"Content-Type": "text/plain"}),
        ("value float 50000.0", con_hash(txn(value=50000.0)), J),
        ("value con 2 decimales 12345.67", con_hash(txn(value=12345.67)), J),
        ("date exacta de la guía (…T04:15:30.120)", con_hash(txn(date="2026-11-12T04:15:30.120")), J),
        ("date sin milisegundos", con_hash(txn(date="2026-11-12T04:20:00")), J),
        ("date con zona horaria -05:00", con_hash(txn(date="2026-11-12T04:25:00-05:00")), J),
        ("hash en MAYÚSCULAS", None, J),
        # Compatibilidad con bots: se aceptan y la respuesta trae 'advertencias'
        ("bot: campos extra ip y estado (firmados)", con_hash(txn(ip="192.168.1.10", estado="APROBADA")), J),
        ("bot: firma json.dumps(d) sin sort_keys ni separators", None, J),
        ("bot: firma json.dumps(d, sort_keys=True)", con_hash(txn(), separadores=None), J),
        ("bot: value 12345.678912 (se redondea a 12345.68)", con_hash(txn(value=12345.678912)), J),
        ("bot: paymentMethod 'nequi' (se guarda 'Nequi')", con_hash(txn(paymentMethod="nequi")), J),
        ("bot: idTxn float (pandas)", con_hash(txn(idTxn=float(nuevo_id()))), J),
        ("bot: date = datetime.isoformat() (microsegundos)", con_hash(txn(date=t0.isoformat())), J),
        ("bot: date = str(datetime) (con espacio)", con_hash(txn(date=str(t0 + timedelta(minutes=2)))), J),
        ("cada método de pago permitido (lote de 5)", None, J),
    ]
    for nombre, cuerpo, h in casos:
        if nombre.startswith("hash en"):
            cuerpo = con_hash(txn()); cuerpo["hash"] = cuerpo["hash"].upper()
        if nombre.startswith("bot: firma json.dumps(d) sin"):
            cuerpo = txn(); cuerpo["hash"] = hmac.new(SECRETO.encode(), json.dumps(cuerpo).encode(), hashlib.sha256).hexdigest()
        if nombre.startswith("cada método"):
            cuerpo = [con_hash(txn(paymentMethod=m, date=f"2026-11-12T09:0{i}:00"))
                      for i, m in enumerate(reglas["metodosPago"])]
        s, b = post(cuerpo, h)
        verificar(G, nombre, s, b, 201)

    # ── 2. Lote grande de varios usuarios ──────────────────────────────────
    G = "2. Lote grande"
    print(f"\n{G}")
    lote = [con_hash(txn(user=correo(f"cliente{i % 10}"), date=f"2026-11-12T13:{i // 10:02d}:{(i * 7) % 60:02d}",
                         value=round(1000 + i * 137.5, 2), paymentMethod=reglas["metodosPago"][i % len(reglas["metodosPago"])]))
            for i in range(100)]
    s, b = post(lote)
    verificar(G, "lote de 100 transacciones, 10 usuarios", s, b, 201,
              b.get("resumen", {}).get("aceptadas") == 100)

    # ── 3. Ventana deslizante (casos de uso) ───────────────────────────────
    G = "3. Ventana deslizante"
    print(f"\n{G}  (umbral {umbral}: una ráfaga de 3 genera {max(0, 3 - umbral + 1)} anomalía(s))")

    def rafaga(nombre, usuario, horas, anomalias_esperadas):
        lote = [con_hash(txn(user=correo(usuario), date=f"2026-11-12T{h}")) for h in horas]
        s, b = post(lote)
        n = b.get("resumen", {}).get("anomalias")
        verificar(G, nombre, s, b, 201, n == anomalias_esperadas, f"  → esperadas {anomalias_esperadas}")
        return lote

    ráfaga3 = max(0, 3 - umbral + 1)
    rafaga("Caso 1: 10:00:01, :02, :03", "caso1", ["10:00:01", "10:00:02", "10:00:03"], ráfaga3)
    franjas_on = reglas["franjasHorarias"]["activo"]
    rafaga("Diapositiva: 10:00:01, :05, :09" + (" (franja mañana 10 s)" if franjas_on else " (normal en 3 s)"),
           "manana", ["10:00:01", "10:00:05", "10:00:09"], ráfaga3 if franjas_on else 0)
    rafaga("Noche: 21:00:01, :05, :09 (ventana 3 s)", "noche", ["21:00:01", "21:00:05", "21:00:09"], 0)
    rafaga("Normal: 10:00, 10:30, 11:00", "normal", ["10:00:01", "10:30:01", "11:00:01"], 0)
    # Anomalía repartida en peticiones separadas (una transacción por petición)
    sep = [con_hash(txn(user=correo("separadas"), date=f"2026-11-12T15:00:0{i}")) for i in (1, 2, 3)]
    total = 0
    for t in sep:
        s, b = post(t)
        total += b.get("resumen", {}).get("anomalias", 0)
    verificar(G, "misma ráfaga enviada en 3 peticiones separadas", s, b, 201, total == ráfaga3,
              f"  → total {total}, esperadas {ráfaga3}")

    # ── 4. Datos inválidos: deben rechazarse ───────────────────────────────
    G = "4. Datos inválidos (deben rechazarse)"
    print(f"\n{G}")
    malos = [
        ("idTxn como string '123'", con_hash(txn(idTxn=str(nuevo_id()))), 422),
        ("value como string '50000'", con_hash(txn(value="50000")), 422),
        ("idTxn decimal 10.5", con_hash(txn(idTxn=10.5)), 422),
        ("idTxn booleano true", con_hash(txn(idTxn=True)), 422),
        ("user como número", con_hash(txn(user=12345)), 422),
        ("user con 65 caracteres antes de @", con_hash(txn(user="a" * 65 + "@" + DOMINIO)), 422),
        ("date como número (timestamp)", con_hash(txn(date=1762938000000)), 422),
        ("value como arreglo [50000]", con_hash(txn(value=[50000])), 422),
        ("paymentMethod como número", con_hash(txn(paymentMethod=1)), 422),
        ("hash como número", None, 422),
        ("value negativo", con_hash(txn(value=-100)), 422),
        ("value null", con_hash(txn(value=None)), 422),
        ("correo inválido", con_hash(txn(user="no-es-correo")), 422),
        ("fecha imposible 2026-02-30", con_hash(txn(date="2026-02-30T10:00:00")), 422),
        ("fecha en formato 12/11/2026", con_hash(txn(date="12/11/2026 10:00")), 422),
        ("método de pago no permitido 'Bitcoin'", con_hash(txn(paymentMethod="Bitcoin")), 422),
        ("falta el campo value", None, 422),
        ("hash alterado (último carácter)", None, 422),
        ("valor cambiado después de firmar", None, 422),
        ("hash firmado con otra llave", con_hash(txn(), secreto="otra-llave"), 422),
        ("campo agregado DESPUÉS de firmar", None, 422),
        ("value que redondeado queda en 0 (0.001)", con_hash(txn(value=0.001)), 422),
    ]
    for nombre, cuerpo, esperado in malos:
        if nombre.startswith("falta"):
            d = txn(); del d["value"]; cuerpo = con_hash(d)
        if nombre.startswith("hash alterado"):
            cuerpo = con_hash(txn()); cuerpo["hash"] = cuerpo["hash"][:-1] + ("0" if cuerpo["hash"][-1] != "0" else "1")
        if nombre.startswith("hash como número"):
            cuerpo = txn(); cuerpo["hash"] = 12345
        if nombre.startswith("campo agregado"):
            cuerpo = con_hash(txn()); cuerpo["descuento"] = 5
        if nombre.startswith("valor cambiado"):
            cuerpo = con_hash(txn()); cuerpo["value"] = 1
        s, b = post(cuerpo)
        verificar(G, nombre, s, b, esperado)

    s, b = post('{"idTxn": 1, "user": "a@a.com",}')
    verificar(G, "JSON malformado (coma sobrante)", s, b, 400)
    s, b = post("")
    verificar(G, "cuerpo vacío", s, b, 400)
    s, b = post("{'idTxn': 1}")
    verificar(G, "diccionario Python pegado tal cual (comillas simples)", s, b, 400)

    # ── 5. Duplicados y lote mixto ─────────────────────────────────────────
    G = "5. Duplicados y lote mixto"
    print(f"\n{G}")
    t = con_hash(txn())
    post(t)
    s, b = post(t)
    verificar(G, "mismo idTxn enviado dos veces", s, b, 409)
    mixto = [con_hash(txn()), con_hash(txn(value="malo")), con_hash(txn())]
    s, b = post(mixto)
    verificar(G, "lote mixto (2 buenas + 1 mala)", s, b, 207,
              b.get("resumen", {}).get("aceptadas") == 2 and b.get("resumen", {}).get("rechazadas") == 1)

    # ── 6. Consultas ───────────────────────────────────────────────────────
    G = "6. Consultas"
    print(f"\n{G}")
    s, b = peticion("GET", f"{BASE}/api/transacciones?usuario={correo('caso1')}")
    verificar(G, "GET /api/transacciones?usuario=caso1", s, b, 200, b.get("total") == 3, f"  → total {b.get('total')}")
    s, b = peticion("GET", f"{BASE}/api/anomalias?usuario={correo('caso1')}")
    n = len(b.get("datos", []))
    verificar(G, "GET /api/anomalias?usuario=caso1", s, b, 200, n == ráfaga3, f"  → {n} anomalía(s)")
    if b.get("datos"):
        s, d = peticion("GET", f"{BASE}/api/anomalias/{b['datos'][0]['id']}")
        verificar(G, "GET /api/anomalias/:id (detalle y pasos de la ventana)", s, d, 200)
    s, b = peticion("GET", f"{BASE}/api/usuarios")
    verificar(G, "GET /api/usuarios", s, b, 200)
    s, b = peticion("GET", f"{BASE}/api/estadisticas")
    verificar(G, "GET /api/estadisticas (dashboard)", s, b, 200)

    # ── Resumen ────────────────────────────────────────────────────────────
    total = len(resultados)
    bien = sum(ok for *_, ok in resultados)
    print(f"\n{'═' * 70}\nRESULTADO: {bien}/{total} pruebas correctas")
    for g, n, ok in resultados:
        if not ok:
            print(f"  FALLA → [{g}] {n}")
    return 0 if bien == total else 1


if __name__ == "__main__":
    sys.exit(main())
