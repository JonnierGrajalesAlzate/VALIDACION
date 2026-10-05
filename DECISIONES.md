# DECISIONES.md — Suposiciones y decisiones de diseño

Este archivo recoge todo lo que el enunciado **no define con precisión** y cómo se resolvió.
Cada decisión es configurable o está aislada en un solo lugar para poder cambiarla fácilmente.

Archivos clave:
- Reglas configurables: `backend/config/reglas.json` (también vía `GET/PUT /api/config`).
- Hash: `backend/src/hashing.js`.
- Algoritmo: `backend/src/ventana/ventanaDeslizante.js` y `franjas.js`.

---

## 1. Base de datos

| # | Tema | Decisión | Motivo |
|---|------|----------|--------|
| 1.1 | Tipos de `id` | `BIGINT`. En `usuarios` y `anomalias` es `GENERATED ALWAYS AS IDENTITY`; en `transacciones` **no** es autogenerado, porque se guarda el `idTxn` recibido | Con el `idTxn` del cliente, la PRIMARY KEY detecta los duplicados sola (código 23505) |
| 1.2 | `transacciones.usuario_id` | `ON DELETE RESTRICT` | No se puede borrar un usuario con historial; para darlo de baja se marca `INACTIVO`. La evidencia de fraude no se pierde |
| 1.3 | `anomalias.transaccion_id` | `ON DELETE CASCADE` | Una anomalía no tiene sentido sin su transacción. `DELETE /api/transacciones/:id` (limpieza de pruebas) no deja filas huérfanas |
| 1.4 | `usuarios.email` | `VARCHAR(254) UNIQUE NOT NULL` + `CHECK (email = LOWER(email))` | Se normaliza a minúsculas: `AA@aa.com` y `aa@aa.com` son el mismo usuario |
| 1.5 | `transacciones.hash` | `CHAR(64)` + `CHECK (hash ~ '^[0-9a-f]{64}$')` | Se guarda en minúsculas. Se aceptan mayúsculas en la entrada |
| 1.6 | `metodo_pago` | `VARCHAR(30)` sin CHECK de lista | La lista es configurable en la aplicación; cambiarla no debe exigir migrar la BD |
| 1.7 | `anomalias(transaccion_id)` | **No** se creó un índice aparte | Ya lo cubre el índice de `UNIQUE (transaccion_id, tipo)` (columna líder). Uno duplicado solo haría más lentas las escrituras |
| 1.8 | `UNIQUE (transaccion_id, tipo)` en anomalías | Una transacción no puede tener dos anomalías del mismo tipo. El sistema solo genera `POSIBLE_FRAUDE` (el CHECK de `tipo` también admite `EXCESO_FRANJA_HORARIA`, ver §6) | Si dos ventanas la señalan con el mismo tipo, se guarda la de mayor conteo |
| 1.9 | Seed | IDs `900001+`; los 3 casos de uso el **01/09/2026** | Para no chocar con los `idTxn` ni con las ventanas de los datos del profesor. Antes de cargar sus datos se puede vaciar todo con `database/limpiar-datos.sql` |
| 1.10 | Dónde se guarda la configuración | En `backend/config/reglas.json`, no en la BD | Así no hubo que agregar tablas al modelo acordado |

## 2. Mapeo JSON → base de datos

| Campo | Decisión |
|-------|----------|
| `user` | Se busca por correo (en minúsculas). Si no existe, se crea con estado `ACTIVO` |
| `nombre` | El JSON no trae nombre: se guarda la **parte local del correo** (`aa@aa.com` → `aa`) |
| `date` | Se guarda en `TIMESTAMPTZ` como instante absoluto. La API lo devuelve en hora de Bogotá con offset (`…-05:00`) |
| Usuario creado + lote que falla | La creación del usuario está dentro de la misma transacción SQL: si hay `ROLLBACK`, el usuario tampoco queda creado |

## 3. Validación

| # | Tema | Decisión |
|---|------|----------|
| 3.1 | Formato de `date` | `YYYY-MM-DDTHH:mm:ss[.S…SSS][Z\|±HH:mm]`. Exige la letra `T` y de 1 a 3 decimales en los segundos. Más de 3 (microsegundos, como produce `datetime.isoformat()` de Python) se rechaza con un mensaje explícito |
| 3.2 | Fecha sin zona horaria | Se asume `TZ_NEGOCIO` (`America/Bogota`, UTC−5, sin horario de verano) |
| 3.3 | Fechas futuras o muy antiguas | **Se aceptan** (el enunciado no las prohíbe). Si se quisieran limitar, se agrega una regla en `validacion/fechas.js` |
| 3.4 | `idTxn` escrito `10001.0` o `1e4` | **Rechazado**: no es un entero literal. Se detecta leyendo el texto original del JSON |
| 3.5 | `idTxn` máximo | `9007199254740991` (2^53−1). Por encima, JavaScript ya no lo representa exacto |
| 3.6 | `value` con más de 2 decimales | **Rechazado** (no se redondea en silencio). La columna es `NUMERIC(14,2)`; máximo `999999999999.99` |
| 3.7 | `paymentMethod` | Coincidencia **exacta**, distingue mayúsculas: `tarjeta` ≠ `Tarjeta`. Lista en `reglas.json → metodosPago` |
| 3.8 | Orden de las validaciones | El hash se verifica **solo si el esquema pasó**: sin campos válidos, la cadena firmada no tiene sentido. Dentro del esquema se reportan **todos** los errores juntos (un error por campo) |
| 3.9 | Claves repetidas en el JSON (`{"value":1,"value":2}`) | Se usa la última, igual que `JSON.parse` y `json.loads` de Python. No se detecta como error |
| 3.10 | Tamaño de lote | Máximo `lote.maxTransacciones` (1000); cuerpo máximo 5 MB |
| 3.11 | `idTxn` repetido dentro del mismo lote | Se procesa la **primera** aparición; las siguientes se rechazan con `DUPLICADO_EN_LOTE` |

## 4. Hash

| # | Tema | Decisión |
|---|------|----------|
| 4.1 | Mensaje firmado | La transacción sin `hash`, igual que `json.dumps(datos, sort_keys=True, separators=(",", ":"))` de Python: claves ordenadas, sin espacios, no ASCII como `\uXXXX` |
| 4.2 | Números | Se reproduce exactamente a Python. Un literal entero (`50000`) se escribe como entero; un literal con `.` o `e` (`50000.0`) se escribe como float de Python (`repr`: `50000.0`, `1e-05`, `1e+16`). Para eso se conserva el texto original de cada número con `JSON.parse` + `context.source` (Node ≥ 21). Probado contra 410 floats y 7 casos generados con Python |
| 4.3 | Modos | `hash.modo = "hmac"` (por defecto): HMAC-SHA256 con `HMAC_SECRET`. `"sha256"`: SHA-256 simple del mensaje, **sin llave** |
| 4.4 | Mayúsculas en el hash recibido | Se aceptan; se comparan en minúsculas con `crypto.timingSafeEqual` |
| 4.5 | Hash esperado en la respuesta | **Solo en `NODE_ENV=development`.** Fuera de desarrollo la API no lo devuelve: sería un "oráculo" que firma cualquier transacción inventada. Siempre queda en el log (recibido y esperado) |
| 4.6 | Cadena firmada en el log | Solo con `LOG_LEVEL=debug`, como pide el enunciado |
| 4.7 | `/api/dev/calcular-hash` | Solo se registra con `NODE_ENV=development` (en otro caso responde 404). Firma cualquier objeto sin validar sus tipos, para poder armar pruebas de "tipo incorrecto con hash correcto" |

## 5. Ventana deslizante (`POSIBLE_FRAUDE`)

| # | Tema | Decisión |
|---|------|----------|
| 5.1 | Regla | Una transacción está dentro si `(fecha_actual − fecha_txn) ≤ segundos_ventana`, en **milisegundos**: con ventana de 3 s, 3,000 s entra y 3,001 s no. `segundos_ventana` depende de la franja (§6) |
| 5.2 | Umbral | `conteo ≥ umbral` (3) → anomalía |
| 5.3 | 4.ª, 5.ª… transacción en la ventana | **Cada una** que deja el conteo ≥ umbral genera su propia anomalía, con su conteo (3, 4, 5…) |
| 5.4 | Empates de fecha | Se ordena por fecha y luego por `idTxn`. Ambas cuentan dentro de la ventana |
| 5.5 | Entre lotes | Para cada usuario se cargan de la BD sus transacciones en `[min − ventana máxima, max + ventana máxima]` (la más grande de las franjas, 10 s por defecto) |
| 5.6 | **Llegada tardía** (una nueva con fecha anterior a otras ya guardadas) | El historial **no se reclasifica**: las ya guardadas siguen `VALIDA`. Si la nueva completa un grupo que supera el umbral, la anomalía se asocia a **la nueva** (fue la que "hizo superar el umbral"). Para lotes en orden cronológico esto equivale exactamente a la regla clásica |
| 5.7 | Concurrencia | Cada lote toma un candado de PostgreSQL (`pg_advisory_xact_lock`): dos lotes simultáneos se procesan uno tras otro, así ninguno calcula su ventana sin ver lo que guardó el otro |
| 5.8 | `ventana_segundos` | Se guarda la ventana **con que se detectó** (10, 6 o 3 s). Entero (la columna es `INTEGER`), configurable de 1 a 86400 |

## 6. Ventana según la franja horaria

El enunciado pide que el **tamaño de la ventana** dependa de la hora en que llega la transacción (configurable). Se configura en `reglas.json → franjasHorarias`.

> Corrección: una versión anterior leyó "venta de 10" (errata de **ventana**) como "hasta 10 ventas por franja" y generaba una anomalía aparte, `EXCESO_FRANJA_HORARIA`. Esa regla se eliminó: las franjas solo deciden el tamaño de la ventana de `POSIBLE_FRAUDE`.

| Franja | Horario | `segundosVentana` |
|---|---|---|
| `MANANA` | 05:00:01 → 12:00:00 | 10 |
| `TARDE_NOCHE` | 12:00:01 → 20:00:00 | 6 |
| `NOCHE_MADRUGADA` | 20:00:01 → 05:00:00 (día siguiente) | 3 |

| # | Tema | Decisión |
|---|------|----------|
| 6.1 | Unidad | "Ventana de 10" = **10 segundos**, la misma unidad de la ventana de 3 s del enunciado. El umbral sigue siendo 3 transacciones a cualquier hora |
| 6.2 | Qué hora decide la ventana | La de la transacción **que entra**. Ej.: a las 05:00:03 (mañana, 10 s) cuentan las de 04:59:55 en adelante aunque esas fueran de la noche; a las 20:00:03 (noche, 3 s) ya no cuentan las de 19:59:58 |
| 6.3 | Ejemplo del enunciado "10:00:01, 10:00:05, 10:00:09 → NORMAL" | Ese ejemplo supone una ventana de 3 s. Con la ventana de la mañana (10 s) las tres caben en 8 s y es **ANOMALÍA**; en la noche (3 s) sigue siendo NORMAL. Los casos obligatorios 1, 2 y 3 dan el mismo resultado con 10 s |
| 6.4 | Milisegundos entre franjas | La hora se **trunca al segundo**: 12:00:00.500 se lee como 12:00:00 y cae en MAÑANA, igual que en un reloj. Así las franjas "05:00:01 → 12:00:00" no dejan huecos |
| 6.5 | Zona horaria | Las franjas se evalúan en hora de Bogotá, no en UTC |
| 6.6 | Validación de la configuración | Las franjas deben cubrir las 24 h **sin huecos ni solapes**; si no, `PUT /api/config` responde 422 con el detalle |
| 6.7 | Desactivar | `franjasHorarias.activo = false` → se usa la ventana fija `ventanaDeslizante.segundos` (3 s) a cualquier hora |
| 6.8 | Base de datos | No se cambió el esquema: el CHECK de `anomalias.tipo` todavía admite `EXCESO_FRANJA_HORARIA`, pero la API ya no lo genera. Quitarlo exigiría una migración |

## 7. Niveles BAJO / MEDIO / ALTO

`excedente = cantidad − umbral`.

| excedente | nivel | ejemplo (umbral 3) |
|---|---|---|
| 0 | BAJO | 3 transacciones |
| 1 – 2 | MEDIO | 4 o 5 |
| ≥ 3 | ALTO | 6 o más |

Se configura en `reglas.json → niveles` (`medioDesdeExcedente`, `altoDesdeExcedente`).

## 8. Respuestas HTTP

| Situación | HTTP |
|---|---|
| Todo aceptado (una o lote) | 201 |
| Lote mixto (alguna aceptada y alguna rechazada) | **207** |
| Nada aceptado y todos los errores son duplicados | 409 |
| Nada aceptado por validación, hash o usuario inactivo | 422 |
| JSON malformado / cuerpo vacío | 400 |
| `Content-Type` distinto de JSON | 415 |
| Recurso inexistente | 404 |
| Error de BD o fallo de persistencia (con `ROLLBACK`) | 500 (503 si no hay conexión) |

- **Usuario inactivo** → 422 con código `USUARIO_INACTIVO`. No es 403: no es un tema de permisos de quien llama, sino de los datos.
- **Errores en un lote:** cada error lleva su `etapa`. La `etapa` general es la común si todas fallaron en la misma; si no, es `RESPUESTA`.
- **Fallo de persistencia:** todo el lote válido se deshace (`ROLLBACK`). La respuesta de error (500) informa la falla de BD, no los rechazos previos de validación; esos quedan en el log.

## 9. Dashboard

| Métrica | Definición usada |
|---|---|
| Hoy / semana / mes | Por `fecha_txn` (cuándo ocurrió) en hora de Bogotá. La semana empieza el lunes (`date_trunc('week')`) |
| % de transacciones con anomalía | `transacciones ANOMALA / total × 100` |
| Usuarios afectados | Usuarios distintos con al menos una transacción `ANOMALA` |
| Valor sospechoso | Suma de `valor` de las transacciones `ANOMALA` |
| Promedio por usuario | `total de transacciones / total de usuarios registrados` |
| Usuarios recurrentes | Top 10 por cantidad de anomalías |
| Casos más frecuentes | Top 10 de combinaciones (tipo, nivel, método de pago) |
| Mapa de calor | Día ISO (1 = lunes) × hora local; intensidad = cantidad de anomalías |
| Tendencia de hoy / semana / mes | Se compara con el **mismo tramo** del periodo anterior: hoy hasta ahora vs. ayer hasta esta misma hora; esta semana hasta ahora vs. la semana pasada hasta el mismo momento (igual con el mes). Comparar contra el periodo anterior completo haría que todo pareciera bajar. Si el anterior es 0 no hay % (no se divide por cero) |
| Estados de revisión | `NUEVA` (nadie la ha mirado) → `ABIERTA` (en revisión) → `REVISADA` (fraude confirmado / gestionado) o `DESCARTADA` (falso positivo). Una cerrada se puede reabrir. `NUEVA` no se asigna a mano. `fecha_revision` = cuándo se cerró; vuelve a NULL al reabrir. "Anomalías nuevas" = estado `NUEVA` |
| Evolución temporal | Anomalías por día de los últimos 90 días con datos; los días sin anomalías cuentan como 0. **Tendencia** = media móvil de 7 días |
| Pico repentino | Día con **≥ 3** anomalías y **≥ 2 ×** el promedio de los 7 días anteriores (se exigen 3 días previos, para no marcar el primer día de datos) |
| Horas con más anomalías / periodos de actividad | Por hora local (0–23): anomalías y transacciones en **gráficas separadas** con el mismo eje X (sin doble eje). El fondo marca las franjas horarias |
| Actividad por franja | Transacciones, anomalías, % de transacciones anómalas y usuarios en cada franja de `reglas.json` (hora truncada al segundo, como en la detección) |
| Múltiples transacciones | Anomalías agrupadas por cuántas transacciones había en la ventana al dispararse (3, 4, 5, 6 o más) y la ráfaga más grande registrada |
| Filtros de anomalías | El rango `desde/hasta` se aplica sobre `fecha_txn`. Una fecha sin hora toma el día completo |

## 10. Cambios al esquema

### Aprobados y aplicados

| Archivo | Qué agrega | Por qué |
|---|---|---|
| `database/migraciones/001_estado_revision_anomalias.sql` | `anomalias.estado_revision` (NUEVA/ABIERTA/REVISADA/DESCARTADA, por defecto NUEVA), `nota_revision` (≤ 500), `fecha_revision`, su CHECK y un índice | El dashboard pide anomalías nuevas, abiertas, revisadas y descartadas. **Ya está incluido en `schema.sql`**; la migración solo hace falta en una base creada con el esquema anterior (`npm run db:migrar`) |

### Propuestos (no ejecutados, esperan aprobación)

| Archivo | Qué agrega | Por qué |
|---|---|---|
| `database/propuestas/002_anomalia_transacciones.sql` | Tabla N:M `anomalia_transacciones` | Hoy las transacciones involucradas se **reconstruyen** con una consulta (mismo usuario, dentro de `ventana_segundos`). Si se borra una transacción o cambia la config de franjas, la reconstrucción puede diferir de lo que se vio al detectarla |
| `database/propuestas/003_rechazos.sql` (opcional) | Tabla `rechazos` | Hoy los rechazos solo quedan en `logs/app.log`; con la tabla, el dashboard podría mostrar estadísticas de rechazos |

Ninguna de las propuestas se ha ejecutado. El esquema en uso son las 3 tablas acordadas más las columnas de revisión de la migración 001.
