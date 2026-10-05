const reglas = require('../config/reglas');
const env = require('../config/env');
const { enTransaccion } = require('../db/pool');
const { ErrorApp, crearDetalle } = require('../errores/ErrorApp');
const { ETAPAS } = require('../logging/etapas');
const { establecerEtapa } = require('../logging/contexto');
const { crearLogger } = require('../logging/logger');
const { validarTransaccion, tipoDe, describirValor } = require('../validacion/esquemaTransaccion');
const { verificarHash } = require('../hashing');
const { detectarAnomalias, rangoHistorico } = require('../ventana/ventanaDeslizante');
const { aIsoNegocio } = require('../validacion/fechas');
const usuariosRepo = require('../repositorios/usuarios.repo');
const transaccionesRepo = require('../repositorios/transacciones.repo');
const anomaliasRepo = require('../repositorios/anomalias.repo');

const log = crearLogger(__filename);

const LLAVE_CANDADO = 20260923;

const abreviar = (hash) => (hash && hash.length > 12 ? `${hash.slice(0, 12)}…` : hash);

async function procesarTransacciones(cuerpo, { requestId }) {
  const R = reglas.obtener();

  establecerEtapa(ETAPAS.RECEPCION);
  const esLote = Array.isArray(cuerpo);
  if (!esLote && tipoDe(cuerpo) !== 'object') {
    throw new ErrorApp({
      etapa: ETAPAS.RECEPCION,
      codigo: 'TIPO_INVALIDO',
      mensaje: `El cuerpo debe ser un objeto (una transacción) o un arreglo de objetos (lote); se recibió ${describirValor(cuerpo)}`,
    });
  }
  const elementos = esLote ? cuerpo : [cuerpo];
  if (elementos.length === 0) {
    throw new ErrorApp({ etapa: ETAPAS.RECEPCION, codigo: 'LOTE_VACIO', mensaje: 'El lote está vacío: envíe al menos una transacción.' });
  }
  if (elementos.length > R.lote.maxTransacciones) {
    throw new ErrorApp({
      etapa: ETAPAS.RECEPCION,
      codigo: 'LOTE_DEMASIADO_GRANDE',
      mensaje: `El lote tiene ${elementos.length} transacciones y el máximo es ${R.lote.maxTransacciones} (config/reglas.json → lote.maxTransacciones).`,
    });
  }
  log.info({ fn: 'procesarTransacciones', cantidad: elementos.length, modo: esLote ? 'lote' : 'individual' }, `Recibida(s) ${elementos.length} transacción(es)`);

  const rechazadas = [];
  function rechazar(posicion, idTxn, etapa, errores) {
    const conEtapa = errores.map((e) => ({ ...e, etapa }));
    rechazadas.push({ posicion, idTxn, etapa, errores: conEtapa });
    for (const e of conEtapa) {
      log.warn(
        { fn: 'rechazar', etapa, idTxn, posicion, campo: e.campo, codigo: e.codigo, recibido: e.recibido, esperado: e.esperado },
        `${etapa}: ${idTxn !== null ? `idTxn=${idTxn}` : `posición ${posicion}`} ${e.mensaje}`,
      );
    }
  }

  establecerEtapa(ETAPAS.VALIDACION_ESQUEMA);
  let validas = [];
  elementos.forEach((el, i) => {
    const r = validarTransaccion(el, i, R);
    if (r.ok) validas.push(r.datos);
    else rechazar(i, r.idTxn, ETAPAS.VALIDACION_ESQUEMA, r.errores);
  });

  establecerEtapa(ETAPAS.VALIDACION_HASH);
  validas = validas.filter((d) => {
    const v = verificarHash(d.original);
    if (v.valido) return true;
    log.warn(
      { fn: 'verificarHash', idTxn: d.idTxn, modo: v.modo, recibido: v.recibido, esperado: v.esperado },
      `VALIDACION_HASH: idTxn=${d.idTxn} hash no coincide. Recibido=${abreviar(v.recibido)}, Esperado=${abreviar(v.esperado)}`,
    );
    log.debug({ fn: 'verificarHash', idTxn: d.idTxn, cadenaFirmada: v.cadena }, `VALIDACION_HASH: cadena exacta que se firmó para idTxn=${d.idTxn}`);
    rechazar(d.posicion, d.idTxn, ETAPAS.VALIDACION_HASH, [crearDetalle({
      idTxn: d.idTxn,
      posicion: d.posicion,
      campo: 'hash',
      codigo: 'HASH_INVALIDO',
      mensaje: `hash no coincide con el ${v.modo === 'hmac' ? 'HMAC-SHA256' : 'SHA-256'} de la transacción: algún campo fue modificado o la llave (HMAC_SECRET) es distinta`,
      recibido: v.recibido,
      tipoRecibido: 'string',
      esperado: env.NODE_ENV === 'development' ? v.esperado : `${v.modo === 'hmac' ? 'HMAC-SHA256' : 'SHA-256'} de la transacción sin el campo hash (claves ordenadas, sin espacios)`,
    })]);
    return false;
  });

  establecerEtapa(ETAPAS.DUPLICADOS);
  const primeraPosicion = new Map();
  validas = validas.filter((d) => {
    if (!primeraPosicion.has(d.idTxn)) {
      primeraPosicion.set(d.idTxn, d.posicion);
      return true;
    }
    rechazar(d.posicion, d.idTxn, ETAPAS.DUPLICADOS, [crearDetalle({
      idTxn: d.idTxn, posicion: d.posicion, campo: 'idTxn', codigo: 'DUPLICADO_EN_LOTE',
      mensaje: `idTxn=${d.idTxn} está repetido dentro del mismo lote (ya aparece en la posición ${primeraPosicion.get(d.idTxn)}); solo se procesa la primera aparición`,
      recibido: d.idTxn, tipoRecibido: 'number', esperado: 'idTxn único',
    })]);
    return false;
  });

  let aceptadas = [];
  let usuariosCreados = [];

  if (validas.length) {
    ({ aceptadas, usuariosCreados } = await enTransaccion(async (cliente) => {
      await cliente.query('SELECT pg_advisory_xact_lock($1)', [LLAVE_CANDADO]);

      establecerEtapa(ETAPAS.DUPLICADOS);
      const existentes = await transaccionesRepo.idsExistentes(validas.map((d) => d.idTxn), cliente);
      validas = validas.filter((d) => {
        if (!existentes.has(d.idTxn)) return true;
        rechazar(d.posicion, d.idTxn, ETAPAS.DUPLICADOS, [crearDetalle({
          idTxn: d.idTxn, posicion: d.posicion, campo: 'idTxn', codigo: 'DUPLICADO',
          mensaje: `idTxn=${d.idTxn} ya existe en transacciones (violación de llave única)`,
          recibido: d.idTxn, tipoRecibido: 'number', esperado: 'idTxn que no exista en la base de datos',
        })]);
        return false;
      });
      if (!validas.length) return { aceptadas: [], usuariosCreados: [] };

      establecerEtapa(ETAPAS.USUARIO);
      const emails = [...new Set(validas.map((d) => d.email))];
      const existentesU = await usuariosRepo.buscarPorEmails(emails, cliente);
      const porEmail = new Map(existentesU.map((u) => [u.email, u]));
      const faltan = emails.filter((e) => !porEmail.has(e)).map((email) => ({ email, nombre: email.split('@')[0] }));
      const creados = await usuariosRepo.crearSiNoExisten(faltan, cliente);
      for (const u of creados) {
        porEmail.set(u.email, u);
        log.info({ fn: 'procesarTransacciones', usuarioId: u.id, usuario: u.email }, `USUARIO: ${u.email} no existía; se creó automáticamente con estado ACTIVO (nombre="${u.nombre}")`);
      }
      validas = validas.filter((d) => {
        const u = porEmail.get(d.email);
        d.usuarioId = u.id;
        if (u.estado === 'ACTIVO') return true;
        rechazar(d.posicion, d.idTxn, ETAPAS.USUARIO, [crearDetalle({
          idTxn: d.idTxn, posicion: d.posicion, campo: 'user', codigo: 'USUARIO_INACTIVO',
          mensaje: `el usuario ${d.email} (id=${u.id}) está INACTIVO y no puede registrar transacciones; actívelo con PATCH /api/usuarios/${u.id}`,
          recibido: d.email, tipoRecibido: 'string', esperado: 'usuario con estado ACTIVO',
        })]);
        return false;
      });
      if (!validas.length) return { aceptadas: [], usuariosCreados: creados };

      establecerEtapa(ETAPAS.ORDENAMIENTO);
      validas.sort((a, b) => a.fechaMs - b.fechaMs || a.idTxn - b.idTxn);
      log.debug({ fn: 'procesarTransacciones', orden: validas.map((d) => d.idTxn) }, 'ORDENAMIENTO: transacciones ordenadas cronológicamente');

      establecerEtapa(ETAPAS.VENTANA_DESLIZANTE);
      const fechasPorUsuario = new Map();
      for (const d of validas) {
        if (!fechasPorUsuario.has(d.usuarioId)) fechasPorUsuario.set(d.usuarioId, []);
        fechasPorUsuario.get(d.usuarioId).push(d.fechaMs);
      }
      const rangos = [...fechasPorUsuario].map(([usuarioId, fechas]) => ({ usuarioId, ...rangoHistorico(fechas, R) }));
      const historico = await transaccionesRepo.historicoPorRangos(rangos, cliente);
      log.info({ fn: 'procesarTransacciones', usuarios: rangos.length, historico: historico.length }, `VENTANA_DESLIZANTE: ${historico.length} transacción(es) previas cargadas de la BD para ${rangos.length} usuario(s)`);

      const deteccion = detectarAnomalias({
        historico,
        nuevas: validas.map((d) => ({ id: d.idTxn, email: d.email, fechaMs: d.fechaMs })),
        reglas: R,
      });

      establecerEtapa(ETAPAS.PERSISTENCIA);
      await transaccionesRepo.insertarVarias(validas.map((d) => ({
        id: d.idTxn, usuarioId: d.usuarioId, valor: d.valor, fechaMs: d.fechaMs,
        estado: deteccion.get(d.idTxn).estado, hash: d.hash, metodoPago: d.metodoPago,
      })), cliente);
      const filasAnomalias = validas.flatMap((d) => deteccion.get(d.idTxn).anomalias.map((a) => ({
        transaccionId: d.idTxn, tipo: a.tipo, nivel: a.nivel, cantidad: a.cantidad, ventanaSegundos: a.ventanaSegundos,
      })));
      const insertadas = await anomaliasRepo.insertarVarias(filasAnomalias, cliente);
      const idAnomalia = new Map(insertadas.map((a) => [`${a.transaccion_id}|${a.tipo}`, a.id]));
      log.info({ fn: 'procesarTransacciones', transacciones: validas.length, anomalias: insertadas.length }, `PERSISTENCIA: ${validas.length} transacción(es) y ${insertadas.length} anomalía(s) guardadas (COMMIT)`);

      return {
        usuariosCreados: creados,
        aceptadas: validas.map((d) => {
          const r = deteccion.get(d.idTxn);
          return {
            posicion: d.posicion,
            idTxn: d.idTxn,
            usuario: d.email,
            usuarioId: d.usuarioId,
            fecha: aIsoNegocio(d.fechaMs),
            valor: d.valor,
            metodoPago: d.metodoPago,
            estado: r.estado,
            anomalias: r.anomalias.map((a) => ({ id: idAnomalia.get(`${d.idTxn}|${a.tipo}`), ...a })),
            ventana: r.traza,
          };
        }),
      };
    }, { fn: 'procesarTransacciones' }));
  }

  establecerEtapa(ETAPAS.RESPUESTA);
  return construirRespuesta({ requestId, esLote, total: elementos.length, aceptadas, rechazadas, usuariosCreados });
}

function construirRespuesta({ requestId, esLote, total, aceptadas, rechazadas, usuariosCreados }) {
  rechazadas.sort((a, b) => a.posicion - b.posicion);
  aceptadas.sort((a, b) => a.posicion - b.posicion);
  const errores = rechazadas.flatMap((r) => r.errores);
  const codigos = errores.map((e) => e.codigo);
  const anomalias = aceptadas.reduce((n, a) => n + a.anomalias.length, 0);

  let http;
  if (!rechazadas.length) http = 201;
  else if (aceptadas.length) http = 207;
  else if (codigos.every((c) => c === 'DUPLICADO' || c === 'DUPLICADO_EN_LOTE')) http = 409;
  else http = 422;

  const etapas = [...new Set(rechazadas.map((r) => r.etapa))];
  const cuerpo = {
    ok: aceptadas.length > 0,
    requestId,
    etapa: !aceptadas.length && etapas.length === 1 ? etapas[0] : ETAPAS.RESPUESTA,
    modo: esLote ? 'lote' : 'individual',
    mensaje: resumenTexto({ total, aceptadas, rechazadas, anomalias }),
    resumen: {
      recibidas: total,
      aceptadas: aceptadas.length,
      rechazadas: rechazadas.length,
      conAnomalia: aceptadas.filter((a) => a.estado === 'ANOMALA').length,
      anomalias,
      usuariosCreados: usuariosCreados.map((u) => u.email),
    },
    aceptadas,
    rechazadas,
    errores,
  };
  log.info({ fn: 'construirRespuesta', status: http, aceptadas: aceptadas.length, rechazadas: rechazadas.length, anomalias }, `RESPUESTA: ${cuerpo.mensaje}`);
  return { http, cuerpo };
}

function resumenTexto({ total, aceptadas, rechazadas, anomalias }) {
  const partes = [`${aceptadas.length} de ${total} transacción(es) aceptada(s)`];
  if (rechazadas.length) partes.push(`${rechazadas.length} rechazada(s)`);
  partes.push(anomalias ? `${anomalias} anomalía(s) detectada(s)` : 'sin anomalías');
  return partes.join(', ');
}

module.exports = { procesarTransacciones };
