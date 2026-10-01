/**
 * Algoritmo de VENTANA DESLIZANTE (Sliding Window) para detectar anomalías.
 *
 * Idea: cada usuario tiene su PROPIA cola de transacciones ordenadas en el
 * tiempo (Map usuario → cola). Para cada transacción nueva:
 *   1. se agrega al final de la cola de su usuario;
 *   2. se sacan por el INICIO las que quedaron fuera del rango, es decir,
 *      las que cumplen (fecha_actual − fecha_txn) > segundos_ventana;
 *   3. se cuentan las que quedan: si son ≥ umbral → POSIBLE_FRAUDE.
 *
 * Ejemplo con ventana = 3 s y umbral = 3:
 *   10:00:01 → cola [01]          (1)
 *   10:00:02 → cola [01, 02]      (2)
 *   10:00:03 → cola [01, 02, 03]  (3) ≥ 3 → ANOMALÍA (03 - 01 = 2 s ≤ 3 s)
 *   10:00:05 → sale 01 (5-1 = 4 s > 3 s) → cola [02, 03, 05] (3) → ANOMALÍA
 *
 * Complejidad: cada transacción entra y sale de la cola UNA vez → O(n)
 * por usuario (después de ordenar, que es O(n log n)). Una solución
 * ingenua que compare cada transacción con todas las demás sería O(n²).
 *
 * Este módulo es PURO (no usa la base de datos): recibe el histórico ya
 * cargado y las transacciones nuevas, y devuelve qué anomalías hay. Así
 * se puede probar con muchísimos casos sin PostgreSQL.
 */
const env = require('../config/env');
const { obtenerFranja } = require('./franjas');
const { calcularNivel } = require('./niveles');
const { crearLogger } = require('../logging/logger');

const log = crearLogger(__filename);

/**
 * Cola FIFO con índice de inicio: sacar del inicio es O(1) (Array.shift()
 * es O(n) porque reacomoda todo el arreglo).
 */
class ColaVentana {
  constructor(ventanaMs) {
    this.ventanaMs = ventanaMs;
    this.items = [];
    this.inicio = 0;
    this.historicas = 0; // cuántas de la cola vienen de la BD (no son nuevas)
  }

  /**
   * Agrega un evento y expulsa los que quedaron fuera de la ventana.
   * Regla EXACTA: un evento sigue dentro si (actual − evento) ≤ ventana.
   * @returns {Array} eventos que salieron
   */
  agregar(evento) {
    this.items.push(evento);
    if (!evento.esNueva) this.historicas += 1;
    const salieron = [];
    while (evento.fechaMs - this.items[this.inicio].fechaMs > this.ventanaMs) {
      const sale = this.items[this.inicio];
      this.inicio += 1;
      if (!sale.esNueva) this.historicas -= 1;
      salieron.push(sale);
    }
    // Compacta de vez en cuando para liberar memoria.
    if (this.inicio > 1024 && this.inicio * 2 > this.items.length) {
      this.items = this.items.slice(this.inicio);
      this.inicio = 0;
    }
    return salieron;
  }

  get tamano() {
    return this.items.length - this.inicio;
  }

  contenido() {
    return this.items.slice(this.inicio);
  }

  /** La transacción NUEVA más reciente dentro de la ventana (o null). */
  ultimaNueva() {
    for (let i = this.items.length - 1; i >= this.inicio; i -= 1) {
      if (this.items[i].esNueva) return this.items[i];
    }
    return null;
  }
}

/** Orden cronológico; si dos tienen la misma fecha, por id (orden estable). */
function compararEventos(a, b) {
  return a.fechaMs - b.fechaMs || a.id - b.id;
}

/**
 * Rango de fechas del histórico que hay que cargar de la BD para un
 * usuario, de modo que no se pierdan anomalías que cruzan entre dos envíos.
 * @param {number[]} fechasNuevasMs fechas de las transacciones nuevas del usuario
 */
function rangoHistorico(fechasNuevasMs, reglas, zona = env.TZ_NEGOCIO) {
  const min = Math.min(...fechasNuevasMs);
  const max = Math.max(...fechasNuevasMs);
  const ventanaMs = reglas.ventanaDeslizante.segundos * 1000;
  let desdeMs = min - ventanaMs;
  let hastaMs = max + ventanaMs;
  const fh = reglas.franjasHorarias;
  if (fh.activo) {
    if (fh.modo === 'OCURRENCIA') {
      desdeMs = Math.min(desdeMs, obtenerFranja(min, fh.franjas, zona).inicioMs);
      hastaMs = Math.max(hastaMs, obtenerFranja(max, fh.franjas, zona).finMs);
    } else {
      desdeMs = Math.min(desdeMs, min - fh.segundosVentanaMovil * 1000);
      hastaMs = Math.max(hastaMs, max + fh.segundosVentanaMovil * 1000);
    }
  }
  return { desdeMs, hastaMs };
}

/**
 * Detecta anomalías.
 *
 * @param {object} p
 * @param {Array<{id:number, email:string, fechaMs:number}>} p.historico  transacciones YA guardadas
 * @param {Array<{id:number, email:string, fechaMs:number}>} p.nuevas     transacciones a procesar
 * @param {object} p.reglas  reglas vigentes
 * @param {string} [p.zona]
 * @returns {Map<number, {estado:string, anomalias:Array, traza:object}>} resultado por id de transacción nueva
 */
function detectarAnomalias({ historico, nuevas, reglas, zona = env.TZ_NEGOCIO }) {
  const { segundos, umbral } = reglas.ventanaDeslizante;
  const fh = reglas.franjasHorarias;
  const resultado = new Map();
  for (const n of nuevas) {
    resultado.set(n.id, { estado: 'VALIDA', anomalias: [], traza: null });
  }

  /** Registra una anomalía; si ya había una del mismo tipo, conserva la de mayor conteo. */
  function registrar(idTxn, anomalia) {
    const r = resultado.get(idTxn);
    const previa = r.anomalias.find((a) => a.tipo === anomalia.tipo);
    if (previa) {
      if (anomalia.cantidad > previa.cantidad) Object.assign(previa, anomalia);
    } else {
      r.anomalias.push(anomalia);
    }
    r.estado = 'ANOMALA';
  }

  // 1. Agrupar por usuario: cada usuario tiene su propia línea de tiempo.
  const porUsuario = new Map();
  const agregar = (t, esNueva) => {
    if (!porUsuario.has(t.email)) porUsuario.set(t.email, []);
    porUsuario.get(t.email).push({ id: t.id, email: t.email, fechaMs: t.fechaMs, esNueva });
  };
  historico.forEach((t) => agregar(t, false));
  nuevas.forEach((t) => agregar(t, true));

  for (const [email, eventos] of porUsuario) {
    // 2. Orden cronológico (histórico + nuevas mezcladas).
    eventos.sort(compararEventos);

    // 3. Ventana deslizante principal: POSIBLE_FRAUDE.
    const cola = new ColaVentana(segundos * 1000);
    // Franjas: conteo por ocurrencia, o una segunda cola si el modo es MOVIL.
    const ocurrencias = new Map();
    const colaMovil = fh.activo && fh.modo === 'MOVIL' ? new ColaVentana(fh.segundosVentanaMovil * 1000) : null;

    for (const evento of eventos) {
      const salieron = cola.agregar(evento);
      const conteo = cola.tamano;

      if (evento.esNueva) {
        resultado.get(evento.id).traza = {
          ventanaSegundos: segundos,
          entro: evento.id,
          salieron: salieron.map((s) => s.id),
          enVentana: cola.contenido().map((e) => e.id),
          conteo,
        };
        log.debug(
          { fn: 'detectarAnomalias', etapa: 'VENTANA_DESLIZANTE', idTxn: evento.id, usuario: email, salieron: salieron.map((s) => s.id), enVentana: cola.contenido().map((e) => e.id) },
          `idTxn=${evento.id} entra a la ventana de ${email}: ${conteo} transacción(es) en ${segundos} s`,
        );
        if (conteo >= umbral) {
          registrar(evento.id, {
            tipo: 'POSIBLE_FRAUDE',
            nivel: calcularNivel(conteo - umbral, reglas.niveles),
            cantidad: conteo,
            ventanaSegundos: segundos,
          });
        }
      } else if (conteo >= umbral && cola.historicas < umbral) {
        // Caso "llegada tardía": esta transacción YA estaba guardada y antes
        // no superaba el umbral; lo supera ahora porque llegó una nueva con
        // fecha anterior. La anomalía se asocia a la NUEVA (la que hizo
        // superar el umbral), porque el historial no se reclasifica.
        const culpable = cola.ultimaNueva();
        if (culpable) {
          registrar(culpable.id, {
            tipo: 'POSIBLE_FRAUDE',
            nivel: calcularNivel(conteo - umbral, reglas.niveles),
            cantidad: conteo,
            ventanaSegundos: segundos,
          });
        }
      }

      // 4. Límite por franja horaria.
      if (!fh.activo) continue;
      const franja = obtenerFranja(evento.fechaMs, fh.franjas, zona);
      let conteoFranja;
      let historicasFranja;
      let culpable;
      let ventanaFranja;
      if (colaMovil) {
        colaMovil.agregar(evento);
        conteoFranja = colaMovil.tamano;
        historicasFranja = colaMovil.historicas;
        culpable = colaMovil.ultimaNueva();
        ventanaFranja = fh.segundosVentanaMovil;
      } else {
        let oc = ocurrencias.get(franja.clave);
        if (!oc) {
          oc = { conteo: 0, historicas: 0, ultimaNueva: null };
          ocurrencias.set(franja.clave, oc);
        }
        oc.conteo += 1;
        if (evento.esNueva) oc.ultimaNueva = evento;
        else oc.historicas += 1;
        conteoFranja = oc.conteo;
        historicasFranja = oc.historicas;
        culpable = oc.ultimaNueva;
        ventanaFranja = franja.duracionSegundos;
      }

      // "hasta N transacciones" → la N+1 ya excede el límite.
      if (conteoFranja > franja.limite) {
        const idAsociado = evento.esNueva ? evento.id : historicasFranja <= franja.limite && culpable ? culpable.id : null;
        if (idAsociado !== null) {
          registrar(idAsociado, {
            tipo: 'EXCESO_FRANJA_HORARIA',
            nivel: calcularNivel(conteoFranja - (franja.limite + 1), reglas.niveles),
            cantidad: conteoFranja,
            ventanaSegundos: ventanaFranja,
            franja: franja.nombre,
            limite: franja.limite,
          });
        }
      }
    }
  }

  for (const [id, r] of resultado) {
    for (const a of r.anomalias) {
      log.info(
        { fn: 'detectarAnomalias', etapa: 'VENTANA_DESLIZANTE', idTxn: id, tipo: a.tipo, nivel: a.nivel, cantidad: a.cantidad, ventanaSegundos: a.ventanaSegundos },
        `ANOMALÍA ${a.tipo} (${a.nivel}) en idTxn=${id}: ${a.cantidad} transacciones ${a.tipo === 'POSIBLE_FRAUDE' ? `en ${a.ventanaSegundos} s` : `en la franja ${a.franja} (límite ${a.limite})`}`,
      );
    }
  }
  return resultado;
}

/**
 * Recorre la ventana paso a paso (para la línea de tiempo del detalle de
 * una anomalía): qué transacción entró, cuáles salieron y qué quedó.
 * @param {Array<{id:number, fechaMs:number}>} transacciones de UN usuario
 */
function simularVentana(transacciones, segundos) {
  const cola = new ColaVentana(segundos * 1000);
  return [...transacciones]
    .map((t) => ({ ...t, esNueva: true }))
    .sort(compararEventos)
    .map((t) => {
      const salieron = cola.agregar(t);
      return { entro: t.id, fechaMs: t.fechaMs, salieron: salieron.map((s) => s.id), enVentana: cola.contenido().map((e) => e.id), conteo: cola.tamano };
    });
}

module.exports = { detectarAnomalias, simularVentana, rangoHistorico, ColaVentana, compararEventos };
