"""
Réplica del código Python del profesor para generar el hash de una transacción:

    mensaje = json.dumps(datos, sort_keys=True, separators=(",", ":"))
    hash    = hmac.new(secreto.encode(), mensaje.encode(), hashlib.sha256).hexdigest()

Genera tests/fixtures/hashes-python.json, que la prueba de Jest usa para
comprobar que Node produce EXACTAMENTE la misma cadena y el mismo hash.

Uso:
    python scripts/hash_profesor.py            -> escribe el archivo de fixtures
    python scripts/hash_profesor.py --stdout   -> imprime el JSON (lo usa la prueba en vivo)
"""
import hashlib
import hmac
import json
import os
import random
import sys

SECRETO = "secreto-de-pruebas"  # el mismo que tests/setup/entornoPruebas.js


def generar_hash(datos, secreto=SECRETO):
    """Así firma el profesor (según el enunciado)."""
    mensaje = json.dumps(datos, sort_keys=True, separators=(",", ":"))
    firma = hmac.new(secreto.encode(), mensaje.encode(), hashlib.sha256).hexdigest()
    return mensaje, firma


CASOS = [
    ("Ejemplo del enunciado",
     {"idTxn": 10001, "user": "aa@aa.com", "date": "2026-09-23T10:30:01.120", "value": 50000, "paymentMethod": "Tarjeta"}),
    ("value como float 50000.0 (Python lo escribe 50000.0, JS lo escribiría 50000)",
     {"idTxn": 10002, "user": "b@b.com", "date": "2026-09-23T10:00:01", "value": 50000.0, "paymentMethod": "Nequi"}),
    ("value con decimales",
     {"idTxn": 10003, "user": "c@c.com", "date": "2026-09-23T10:00:10.5", "value": 12345.67, "paymentMethod": "Daviplata"}),
    ("caracteres no ASCII (ñ, tildes) -> \\uXXXX",
     {"idTxn": 10004, "user": "peña@café.com", "date": "2026-09-23T23:59:59.999-05:00", "value": 1, "paymentMethod": "Transferencia"}),
    ("emoji, comillas, barra invertida, control y DEL",
     {"idTxn": 10005, "user": "x@x.com", "date": "2026-09-23T00:00:00Z", "value": 0.5,
      "paymentMethod": "Tarj\"eta\\ ☃ \U0001F600 \t\n\x01\x7f"}),
    ("floats en notación científica de Python",
     {"idTxn": 10006, "user": "y@y.com", "date": "2026-01-01T00:00:00", "value": 1e16, "paymentMethod": "Efectivo",
      "extra": [1e-05, 0.0001, 123456789012345680.0, 1.5e-7, 100.0]}),
    ("objeto anidado y claves desordenadas",
     {"z": {"b": 1, "a": [True, False, None]}, "A": "mayúscula", "_": 0, "idTxn": 7}),
]


def main():
    salida = {"secreto": SECRETO, "casos": [], "floats": []}
    for descripcion, datos in CASOS:
        mensaje, firma = generar_hash(datos)
        con_hash = dict(datos, hash=firma)
        salida["casos"].append({
            "descripcion": descripcion,
            # JSON tal como se enviaría a la API (formato por defecto de json.dumps)
            "jsonEnviado": json.dumps(con_hash),
            "cadenaFirmada": mensaje,
            "hmac": firma,
            "sha256": hashlib.sha256(mensaje.encode()).hexdigest(),
        })

    # Muchos floats aleatorios de distintas magnitudes para probar repr(float).
    rnd = random.Random(2026)
    for _ in range(400):
        x = rnd.uniform(0, 10) * (10 ** rnd.randint(-12, 22))
        salida["floats"].append([repr(x), json.dumps(x)])
    for x in [0.1, 0.2 + 0.1, 1e-4, 1e-5, 9999999999999998.0, 1e16, 2.5, 5e-324, 1.7976931348623157e308, 50000.0]:
        salida["floats"].append([repr(x), json.dumps(x)])

    texto = json.dumps(salida, ensure_ascii=True, indent=2)
    if "--stdout" in sys.argv:
        print(texto)
        return
    ruta = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "hashes-python.json")
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(texto + "\n")
    print(f"Fixtures escritos en {os.path.normpath(ruta)} ({len(salida['casos'])} casos, {len(salida['floats'])} floats)")


if __name__ == "__main__":
    main()
