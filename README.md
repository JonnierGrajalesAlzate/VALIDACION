# Appresso — Detección de anomalías con Ventana Deslizante

*"Appresso — Tu café, a un tap"*. La aplicación recibe transacciones, las valida de forma estricta (tipos de datos y hash HMAC-SHA256), detecta posibles fraudes con la técnica **Sliding Window** y muestra todo en un dashboard.

| Capa | Tecnología |
|---|---|
| Backend | Node.js 20+ · Express 5 · Zod 4 (estricto) · `pg` · `crypto` · Luxon · winston |
| Base de datos | PostgreSQL 13+ (probado en 18) |
| Frontend | React 19 + Vite · Recharts · React Router |
| Pruebas | Jest + Supertest contra una base de datos de pruebas separada |

```
TAREA/
├── database/            schema.sql · seed.sql · reset.sql · limpiar-datos.sql · propuestas/ (migraciones NO ejecutadas)
├── backend/
│   ├── config/reglas.json   ventana, umbral, franjas, niveles, métodos de pago, modo del hash
│   ├── src/                 app.js · server.js · hashing.js · validacion/ · ventana/ · repositorios/ · rutas/ · ...
│   ├── scripts/             generar-datos.js · generar-seed.js · hash_profesor.py · ejecutar-sql.js
│   ├── tests/               unit/ · integracion/ · fixtures/
│   └── logs/app.log
├── frontend/            React + Vite
├── peticiones/appresso.http   colección de ejemplos (REST Client de VS Code)
├── DECISIONES.md        suposiciones, reglas ambiguas y cambios de esquema propuestos
└── README.md
```

---

## 1. Requisitos

- **Node.js 20 o superior.** Se recomienda **22+**: el hash compatible con Python usa `JSON.parse` con `context.source`, disponible desde Node 21.
- PostgreSQL con pgAdmin 4.
- *(Opcional)* Python 3, para regenerar los fixtures de compatibilidad del hash.

## 2. Crear la base de datos en pgAdmin 4

1. En pgAdmin 4 conéctese al servidor (PostgreSQL 18).
2. Clic derecho en **Databases → Create → Database…**, nombre **`ACTIVIDAD_PA`**, y guardar. Omita este paso si la base ya existe.
3. Clic derecho sobre `ACTIVIDAD_PA` → **Query Tool**.
4. Abra `database/schema.sql` (ícono de carpeta) y ejecútelo con **F5**. Crea las 3 tablas, los CHECK, los índices y los triggers.
5. *(Opcional)* Abra y ejecute `database/seed.sql`: carga 15 usuarios, unas 415 transacciones y 38 anomalías, incluidos los 3 casos de uso del 01/09/2026.

Otros scripts:

| Script | Para qué |
|---|---|
| `database/limpiar-datos.sql` | Vacía las tablas sin borrarlas. Úselo antes de cargar los datos del profesor |
| `database/reset.sql` | **Borra** las tablas. Luego ejecute `schema.sql` de nuevo |

> También se pueden ejecutar desde la terminal: `cd backend` y luego `npm run db:schema`, `npm run db:seed` o `npm run db:reset`.

## 3. Configurar el backend

```bash
cd backend
npm install
copy .env.example .env      # en Linux/Mac: cp .env.example .env
```

Edite `backend/.env`:

| Variable | Ejemplo | Nota |
|---|---|---|
| `PGHOST`, `PGPORT` | `localhost`, `5432` | |
| `PGUSER`, `PGPASSWORD` | `postgres`, `…` | La contraseña nunca aparece en logs ni respuestas |
| `PGDATABASE` | `ACTIVIDAD_PA` | |
| `PGDATABASE_TEST` | `actividad_pa_test` | Base exclusiva de Jest; se crea sola y **se borra en cada corrida** |
| `HMAC_SECRET` | `…` | **Debe ser la misma llave del profesor** |
| `PORT` | `3000` | |
| `NODE_ENV` | `development` | Solo en `development` existe `/api/dev/calcular-hash` |
| `TZ_NEGOCIO` | `America/Bogota` | Zona asumida para fechas sin zona; también se usa en franjas y dashboard |
| `LOG_LEVEL` | `info` | Con `debug` el log muestra la cadena exacta que se firmó |

> Si cambia `HMAC_SECRET`, los hashes de `seed.sql` dejan de coincidir con esa llave. Eso no afecta lo que ya está en la BD; para tener un seed coherente, ejecute `npm run generar:seed`.

## 4. Ejecutar

**Backend** (puerto 3000):

```bash
cd backend
npm start          # o: npm run dev  (se reinicia al guardar cambios)
```

Al arrancar verifica la conexión y que existan las 3 tablas con todas sus columnas. Si algo falla, **se detiene** y dice exactamente qué falta, por ejemplo:

```
[ARRANQUE] Arranque detenido: Falta la tabla "anomalias". Ejecute database/schema.sql en la base de datos.
```

**Frontend** (puerto 5173), en otra terminal:

```bash
cd frontend
npm install
npm run dev
```

Abra **http://localhost:5173**. Vite reenvía `/api` al backend.

| Página | Qué hace |
|---|---|
| **Registrar** | Formulario con validación en vivo y los botones *Calcular hash*, *Enviar*, *Corromper hash*, *Enviar con tipo incorrecto*. Incluye un área para lotes en JSON y los 3 casos de uso precargados |
| **Dashboard** | Tarjetas (hoy / semana / mes, % anómalas, valor sospechoso…), evolución, mapa de calor por hora, distribución por nivel, tipo y método de pago, usuarios recurrentes y casos frecuentes |
| **Anomalías → detalle** | Línea de tiempo y recorrido de la ventana paso a paso: qué transacción entró y cuál salió |
| **Transacciones / Usuarios / Configuración** | Filtros, eliminar, activar/inactivar usuarios, cambiar ventana y umbral |

Los errores se muestran campo por campo y también se imprimen en la **consola del navegador (F12)** con su `requestId`.

## 5. Pruebas

```bash
cd backend
npm test                 # todas (unitarias + integración)
npm run test:unit        # solo lógica pura (sin BD)
npm run test:integracion
```

Las pruebas crean y limpian **`actividad_pa_test`**; nunca tocan `ACTIVIDAD_PA`.

| Se cubre | |
|---|---|
| Casos de uso | Los 3 casos obligatorios, también enviados de a una transacción |
| Validación | Tipo incorrecto, campo faltante, campo extra, correo inválido, fecha imposible, valor negativo, hash inválido, `idTxn` duplicado, usuario inactivo, JSON malformado |
| Lotes | Lote mixto (207) y **ROLLBACK** cuando falla la persistencia |
| Ventana | Límites exactos (3,000 s vs 3,001 s), transacciones desordenadas, anomalías entre dos lotes, llegada tardía |
| Franjas | Franja que cruza la medianoche y modo móvil |
| Hash | **Compatibilidad con Python**: fixtures de `scripts/hash_profesor.py` (7 casos + 410 floats). Si Python está instalado, también se ejecuta en vivo |
| Errores de PostgreSQL | Traducción de 23505, 23503, 23514, 22P02, 42P01, ECONNREFUSED y 28P01 |

### Generar datos de prueba con hash válido

```bash
cd backend
# Guardar en un archivo (incluye los 3 casos de uso y 5 transacciones malformadas):
npm run generar:datos -- --casos --invalidas 5 --salida datos.json
# Enviar directo a la API:
npm run generar:datos -- --cantidad-dias 3 --rafagas 4 --enviar http://localhost:3000/api/transacciones
```

Todas las opciones están en la cabecera de `scripts/generar-datos.js`.

### Colección de peticiones

`peticiones/appresso.http` usa la extensión **REST Client** de VS Code. Calcula el hash con el endpoint de desarrollo y lo reutiliza en la petición siguiente.

## 6. Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/transacciones` | Una transacción (objeto) o un lote (arreglo) |
| GET | `/api/transacciones` | Filtros `usuario`, `desde`, `hasta`, `estado`, `metodoPago`, `limite`, `pagina` |
| DELETE | `/api/transacciones/:id` | Elimina la transacción y sus anomalías |
| GET | `/api/usuarios` | Usuarios con su cantidad de transacciones y anomalías |
| PATCH | `/api/usuarios/:id` | `{ "estado": "ACTIVO" \| "INACTIVO" }` |
| GET | `/api/anomalias` | Filtros `tipo`, `nivel`, `desde`, `hasta`, `usuario` |
| GET | `/api/anomalias/:id` | Detalle con línea de tiempo y pasos de la ventana |
| GET | `/api/estadisticas` | Datos del dashboard (todo calculado con SQL) |
| GET / PUT | `/api/config` | Reglas: ventana, umbral, franjas, niveles, métodos de pago, modo del hash |
| GET | `/api/health` | Estado del servidor y de PostgreSQL |
| POST | `/api/dev/calcular-hash` | **Solo `NODE_ENV=development`**: hash correcto y cadena firmada |

**Estructura de error** (siempre la misma):

```json
{ "ok": false, "requestId": "…", "etapa": "VALIDACION_ESQUEMA",
  "errores": [ { "idTxn": 10001, "campo": "value", "codigo": "TIPO_INVALIDO",
                 "mensaje": "campo 'value' debe ser número > 0, se recibió string '50000'",
                 "recibido": "50000", "tipoRecibido": "string", "esperado": "number > 0, sin comillas, máximo 2 decimales",
                 "etapa": "VALIDACION_ESQUEMA" } ] }
```

**Códigos HTTP:**

| Código | Cuándo |
|---|---|
| 201 | Todo creado |
| 207 | Lote mixto |
| 400 | JSON malformado |
| 409 | Duplicado |
| 415 | `Content-Type` incorrecto |
| 422 | Validación, hash o usuario inactivo |
| 404 | No encontrado |
| 500 / 503 | Errores reales del servidor o de la BD |

## 7. Logs

Formato, una línea por evento, en consola y en `backend/logs/app.log`:

```
[fecha-hora] [NIVEL] [requestId] [ETAPA] [archivo:función] mensaje | idTxn=... campo=... recibido=... esperado=...
```

Ejemplo:

```
[2026-09-30 19:06:16.283 -05:00] [WARN] [698bfbb4-…] [VALIDACION_HASH] [procesarTransacciones.js:verificarHash] VALIDACION_HASH: idTxn=50019 hash no coincide. Recibido=88c83c306774…, Esperado=ff258af24c59… | idTxn=50019 modo="hmac" recibido="88c8…" esperado="ff25…"
```

**Etapas:** `RECEPCION → PARSEO_JSON → VALIDACION_ESQUEMA → VALIDACION_HASH → DUPLICADOS → USUARIO → ORDENAMIENTO → VENTANA_DESLIZANTE → PERSISTENCIA → RESPUESTA`.

Para encontrar todos los logs de una petición, busque su `requestId` en `app.log`. Es el mismo que muestran el frontend y la consola del navegador.

## 8. Cómo funciona la ventana deslizante

Cada usuario tiene su propia cola (`Map usuario → cola`). Las transacciones se ordenan por fecha y, para cada una:

1. Se **agrega** al final de la cola de su usuario.
2. Se **sacan por el inicio** las que cumplen `fecha_actual − fecha_txn > 3 s`.
3. Se **cuenta** lo que queda: si hay **≥ 3**, la transacción se marca `ANOMALA` y se registra `POSIBLE_FRAUDE`.

Cada transacción entra y sale una sola vez de la cola, así que el recorrido es **O(n)** por usuario; una comparación de todas contra todas sería O(n²). Antes de procesar un lote se cargan de PostgreSQL las transacciones recientes de cada usuario, para no perder anomalías que cruzan entre dos envíos.

El código, comentado paso a paso, está en `backend/src/ventana/ventanaDeslizante.js`. Las reglas que el enunciado deja abiertas (franjas, niveles, llegadas tardías…) están en **DECISIONES.md**.
