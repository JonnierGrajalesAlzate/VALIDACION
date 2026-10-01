/**
 * Traduce los errores de PostgreSQL / node-postgres a mensajes claros en
 * español, según su código (SQLSTATE) o el código de red de Node.
 *
 * Siempre se conserva el código y el mensaje ORIGINAL de PostgreSQL en
 * `original`, para loguearlo: el mensaje traducido orienta, pero el
 * original es la evidencia exacta.
 *
 * Referencia de códigos: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const env = require('../config/env');

/** Descripción de la conexión SIN la contraseña (nunca se muestra). */
function descripcionConexion() {
  return `host=${env.PGHOST} puerto=${env.PGPORT} base_de_datos=${env.PGDATABASE} usuario=${env.PGUSER}`;
}

/**
 * Extrae el valor duplicado del "detail" de PG.
 * Ej.: 'Key (id)=(10003) already exists.'  → { columnas: 'id', valor: '10003' }
 *      'La llave (id)=(10003) ya existe.'   (PG instalado en español)
 * Por eso el patrón NO depende del idioma: solo busca "(columnas)=(valor)".
 */
function extraerLlave(detail) {
  const m = /\(([^()]+)\)=\((.*?)\)/.exec(detail || '');
  return m ? { columnas: m[1], valor: m[2] } : null;
}

/**
 * @param {Error & {code?: string}} err Error lanzado por `pg` o por la red
 * @returns {{codigo: string, mensaje: string, original: object}}
 */
function traducirErrorPg(err) {
  const original = {
    codigoPg: err.code || null,
    mensajePg: err.message,
    detallePg: err.detail || null,
    tabla: err.table || null,
    columna: err.column || null,
    restriccion: err.constraint || null,
  };
  const llave = extraerLlave(err.detail);

  switch (err.code) {
    case '23505': {
      // unique_violation
      if (err.constraint === 'transacciones_pkey' && llave) {
        return {
          codigo: 'DUPLICADO',
          mensaje: `idTxn=${llave.valor} ya existe en transacciones (violación de llave única)`,
          original,
        };
      }
      return {
        codigo: 'DUPLICADO',
        mensaje: `Registro duplicado en la tabla ${err.table || '?'}: ${
          llave ? `ya existe ${llave.columnas}=${llave.valor}` : 'ya existe un registro con esos datos'
        } (restricción ${err.constraint || '?'})`,
        original,
      };
    }
    case '23503': // foreign_key_violation
      return {
        codigo: 'LLAVE_FORANEA',
        mensaje:
          `Violación de llave foránea en ${err.table || '?'} (restricción ${err.constraint || '?'}): ` +
          (llave
            ? `${llave.columnas}=${llave.valor} no existe en la tabla referenciada o todavía tiene registros que dependen de él`
            : 'el registro referenciado no existe o tiene registros dependientes'),
        original,
      };
    case '23514': // check_violation
      return {
        codigo: 'VALOR_NO_PERMITIDO',
        mensaje: `Se violó la regla CHECK "${err.constraint || '?'}" de la tabla ${err.table || '?'}: el valor no está permitido por la base de datos`,
        original,
      };
    case '23502': // not_null_violation
      return {
        codigo: 'CAMPO_FALTANTE',
        mensaje: `La columna ${err.column || '?'} de la tabla ${err.table || '?'} no admite NULL`,
        original,
      };
    case '22P02': // invalid_text_representation
      return {
        codigo: 'TIPO_INVALIDO',
        mensaje: `PostgreSQL recibió un dato con tipo inválido: ${err.message}`,
        original,
      };
    case '22003': // numeric_value_out_of_range
      return {
        codigo: 'VALOR_FUERA_DE_RANGO',
        mensaje: `Un valor numérico excede el rango de su columna: ${err.message}`,
        original,
      };
    case '28P01': // invalid_password
    case '28000': // invalid_authorization_specification
      return {
        codigo: 'BD_CREDENCIALES',
        mensaje: `PostgreSQL rechazó las credenciales (${descripcionConexion()}). Revise PGUSER y PGPASSWORD en backend/.env`,
        original,
      };
    case '3D000': // invalid_catalog_name
      return {
        codigo: 'BD_NO_EXISTE',
        mensaje: `La base de datos "${env.PGDATABASE}" no existe en ${env.PGHOST}:${env.PGPORT}. Créela en pgAdmin 4 (clic derecho en Databases → Create → Database) o corrija PGDATABASE en backend/.env`,
        original,
      };
    case '42P01': // undefined_table
      return {
        codigo: 'BD_TABLA_NO_EXISTE',
        mensaje: `Una tabla no existe (${err.message}). Ejecute database/schema.sql en la base "${env.PGDATABASE}" desde el Query Tool de pgAdmin 4`,
        original,
      };
    case '42703': // undefined_column
      return {
        codigo: 'BD_COLUMNA_NO_EXISTE',
        mensaje: `Una columna no existe (${err.message}). El esquema de la base no coincide con database/schema.sql`,
        original,
      };
    case '57P01': // admin_shutdown
    case '57P03': // cannot_connect_now
      return {
        codigo: 'BD_SIN_CONEXION',
        mensaje: `PostgreSQL se está apagando o reiniciando (${descripcionConexion()})`,
        original,
      };
    case 'ECONNREFUSED':
      return {
        codigo: 'BD_SIN_CONEXION',
        mensaje: `No hay conexión con PostgreSQL (${descripcionConexion()}): la conexión fue rechazada. ¿Está iniciado el servicio "postgresql-x64-18" y es correcto el puerto?`,
        original,
      };
    case 'ENOTFOUND':
      return {
        codigo: 'BD_SIN_CONEXION',
        mensaje: `No se encontró el servidor PostgreSQL "${env.PGHOST}" (${descripcionConexion()}). Revise PGHOST en backend/.env`,
        original,
      };
    case 'ETIMEDOUT':
      return {
        codigo: 'BD_SIN_CONEXION',
        mensaje: `Se agotó el tiempo de espera conectando a PostgreSQL (${descripcionConexion()})`,
        original,
      };
    default:
      break;
  }

  // Sin código: errores de conexión que `pg` lanza como texto.
  if (/timeout exceeded when trying to connect|Connection terminated/i.test(err.message || '')) {
    return {
      codigo: 'BD_SIN_CONEXION',
      mensaje: `Se perdió o no se pudo abrir la conexión con PostgreSQL (${descripcionConexion()})`,
      original,
    };
  }

  return {
    codigo: 'BD_ERROR',
    mensaje: `Error de PostgreSQL${err.code ? ` ${err.code}` : ''}: ${err.message}`,
    original,
  };
}

/** Indica si el error proviene de PostgreSQL o de la conexión a él. */
function esErrorPg(err) {
  if (!err) return false;
  // Los errores de PG traen un SQLSTATE de 5 caracteres; los de red, códigos E*.
  return (
    (typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code) && 'severity' in err) ||
    ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'].includes(err.code) ||
    /timeout exceeded when trying to connect|Connection terminated/i.test(err.message || '')
  );
}

module.exports = { traducirErrorPg, esErrorPg, descripcionConexion };
