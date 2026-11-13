"""
Simula las formas razonables en que un bot (Python) puede enviar transacciones a la API
y comprueba que todas se acepten. Uso, desde la carpeta TAREA con el backend corriendo:

    python peticiones/prueba_bot.py [http://localhost:3000]

La llave se toma de HMAC_SECRET o de backend/.env. Usa correos @prueba-profesor.com
(se borran con database/limpiar-prueba-profesor.sql).
"""
import hashlib, hmac, json, os, random, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000").rstrip("/")
URL = BASE + "/api/transacciones"
ENV = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend", ".env")
SECRETO = os.environ.get("HMAC_SECRET") or next(
    l.split("=", 1)[1].strip() for l in open(ENV, encoding="utf-8") if l.startswith("HMAC_SECRET="))
RUN = int(time.time()) % 1_000_000
ID = [700_000_000 + RUN * 1000]
T = [datetime(2026, 11, 13, 6, 0, 0)]
rnd = random.Random(RUN)

def nid():
    ID[0] += 1; return ID[0]

def hora():
    T[0] += timedelta(minutes=3); return T[0]

def base(**kw):
    d = {"idTxn": nid(), "user": f"bot{RUN}@prueba-profesor.com", "date": hora().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3],
         "value": 50000, "paymentMethod": "Tarjeta"}
    d.update(kw); return d

def h(msg): return hmac.new(SECRETO.encode(), msg.encode(), hashlib.sha256).hexdigest()
def firma_guia(d): return h(json.dumps(d, sort_keys=True, separators=(",", ":")))
def firmar(d, f=firma_guia):
    d = dict(d); d["hash"] = f(d); return d

def post(cuerpo, headers={"Content-Type": "application/json"}, timeout=120):
    data = cuerpo if isinstance(cuerpo, bytes) else json.dumps(cuerpo).encode()
    req = urllib.request.Request(URL, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except Exception: return e.code, {}

def det(b):
    errs = b.get("errores") or []
    if errs: return "; ".join(sorted({f"{e.get('codigo')}({e.get('campo')})" for e in errs}))[:90]
    r = b.get("resumen") or {}
    return f"aceptadas={r.get('aceptadas')} rechazadas={r.get('rechazadas')}"

res = []
def caso(nombre, cuerpo, **kw):
    t0 = time.time(); s, b = post(cuerpo, **kw); dt = time.time() - t0
    ok = s == 201
    res.append(ok)
    print(f"[{'ACEPTA ' if ok else 'RECHAZA'}] {nombre:58s} HTTP {s} {dt:5.2f}s  {det(b)}")

print(f"API {BASE}\n")
caso("A  guía exacta (json=, firma compacta ordenada)", firmar(base()))
caso("B  campos extra del contexto: ip, estado", firmar(base(ip="192.168.1.10", estado="APROBADA")))
caso("C  firma json.dumps(d, sort_keys=True) (sep. por defecto)", firmar(base(), lambda d: h(json.dumps(d, sort_keys=True))))
caso("D  firma json.dumps(d) (sin ordenar, sep. por defecto)", firmar(base(), lambda d: h(json.dumps(d))))
caso("E  firma json.dumps(d, separators) sin ordenar", firmar(base(), lambda d: h(json.dumps(d, separators=(",", ":")))))
caso("F  value = random.uniform (muchos decimales)", firmar(base(value=rnd.uniform(1000, 100000))))
caso("G  value round(x, 2)", firmar(base(value=round(rnd.uniform(1000, 100000), 2))))
caso("H  paymentMethod en minúscula 'nequi'", firmar(base(paymentMethod="nequi")))
caso("I  paymentMethod 'TARJETA'", firmar(base(paymentMethod="TARJETA")))
caso("J  date = datetime.isoformat() (microsegundos)", firmar(base(date=hora().replace(microsecond=123456).isoformat())))
caso("K  date = str(datetime) (espacio)", firmar(base(date=str(hora().replace(microsecond=120000)))))
caso("L  date sin ms 'YYYY-mm-ddTHH:MM:SS'", firmar(base(date=hora().strftime("%Y-%m-%dT%H:%M:%S"))))
caso("M  date UTC con Z", firmar(base(date=hora().strftime("%Y-%m-%dT%H:%M:%S.000Z"))))
caso("N  idTxn float (pandas)", firmar(base(idTxn=float(nid()))))
caso("O  Content-Type text/plain", firmar(base()), headers={"Content-Type": "text/plain"})
caso("P  ip + estado + firma json.dumps(d) + value float", firmar(base(ip="10.0.0.1", estado="OK", value=rnd.uniform(1, 9e4)), lambda d: h(json.dumps(d))))

def lote(n):
    return [firmar(base(user=f"bot{RUN}.{i % 50}@prueba-profesor.com", value=round(rnd.uniform(1000, 90000), 2),
                        paymentMethod=rnd.choice(["Tarjeta", "Efectivo", "Nequi", "Daviplata", "Transferencia"]))) for i in range(n)]
caso("Q  lote de 1000", lote(1000))
caso("R  lote de 5000", lote(5000))

print("\nS  200 transacciones enviadas una por una, 20 en paralelo ...", end=" ")
items = lote(200); t0 = time.time()
with ThreadPoolExecutor(20) as ex: estados = list(ex.map(lambda t: post(t)[0], items))
ok = estados.count(201); res.append(ok == 200)
print(f"{ok}/200 aceptadas en {time.time() - t0:.1f}s  otros: {sorted(set(estados) - {201})}")
print(f"\nACEPTADAS: {sum(res)}/{len(res)}")
sys.exit(0 if all(res) else 1)
