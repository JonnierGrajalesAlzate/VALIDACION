function nuevoRequestId() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `web-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function registrarErrores(metodo, ruta, status, cuerpo, requestId) {
  const errores = (cuerpo && cuerpo.errores) || [];
  if (!errores.length && status < 400) return;
  // eslint-disable-next-line no-console
  console.groupCollapsed(`%c[Appresso] ${metodo} ${ruta} → HTTP ${status} · requestId=${requestId} · etapa=${cuerpo?.etapa ?? '?'}`, 'color:#d03b3b;font-weight:bold');
  if (cuerpo?.mensaje) console.log(cuerpo.mensaje); // eslint-disable-line no-console
  if (errores.length) {
    // eslint-disable-next-line no-console
    console.table(errores.map((e) => ({
      etapa: e.etapa ?? cuerpo?.etapa, idTxn: e.idTxn, campo: e.campo, codigo: e.codigo,
      mensaje: e.mensaje, recibido: typeof e.recibido === 'object' ? JSON.stringify(e.recibido) : e.recibido, esperado: e.esperado,
    })));
  }
  console.log('Respuesta completa:', cuerpo); // eslint-disable-line no-console
  console.groupEnd(); // eslint-disable-line no-console
}

export async function api(metodo, ruta, cuerpo) {
  const requestId = nuevoRequestId();
  const opciones = { method: metodo, headers: { 'X-Request-Id': requestId } };
  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
  }

  let respuesta;
  try {
    respuesta = await fetch(ruta, opciones);
  } catch (err) {
    const sinConexion = {
      ok: false, requestId, etapa: 'RED',
      mensaje: 'No se pudo conectar con el backend. ¿Está corriendo "npm start" en la carpeta backend (puerto 3000)?',
      errores: [{ idTxn: null, campo: null, codigo: 'SIN_CONEXION', mensaje: `Fallo de red: ${err.message}`, recibido: null, esperado: 'backend en http://localhost:3000' }],
    };
    registrarErrores(metodo, ruta, 0, sinConexion, requestId);
    return { ok: false, status: 0, cuerpo: sinConexion, requestId };
  }

  const idServidor = respuesta.headers.get('X-Request-Id') || requestId;
  let datos;
  const texto = await respuesta.text();
  try {
    datos = texto ? JSON.parse(texto) : {};
  } catch {
    datos = {
      ok: false, requestId: idServidor, etapa: 'RESPUESTA',
      mensaje: `El servidor respondió algo que no es JSON (HTTP ${respuesta.status}). Si es 500/502/504, revise que el backend esté corriendo.`,
      errores: [{ idTxn: null, campo: null, codigo: 'RESPUESTA_NO_JSON', mensaje: texto.slice(0, 200), recibido: null, esperado: 'JSON' }],
    };
  }
  registrarErrores(metodo, ruta, respuesta.status, datos, idServidor);
  return { ok: respuesta.ok, status: respuesta.status, cuerpo: datos, requestId: idServidor };
}

export function consulta(filtros) {
  const p = new URLSearchParams();
  Object.entries(filtros).forEach(([k, v]) => {
    if (v !== '' && v !== null && v !== undefined) p.set(k, v);
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}
