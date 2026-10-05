const env = require('../config/env');

function descripcionConexion() {
  return `host=${env.PGHOST} puerto=${env.PGPORT} base_de_datos=${env.PGDATABASE} usuario=${env.PGUSER}`;
}

function extraerLlave(detail) {
  const m = /\(([^()]+)\)=\((.*?)\)/.exec(detail || '');
  return m ? { columnas: m[1], valor: m[2] } : null;
}

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
    case '23503':
      return {
        codigo: 'LLAVE_FORANEA',
        mensaje:
          `Violación de llave foránea en ${err.table || '?'} (restricción ${err.constraint || '?'}): ` +
          (llave
            ? `${llave.columnas}=${llave.valor} no existe en la tabla referenciada o todavía tiene registros que dependen de él`
            : 'el registro referenciado no existe o tiene registros dependientes'),
        original,
      };
    case '23514':
      return {
        codigo: 'VALOR_NO_PERMITIDO',
        mensaje: `Se violó la regla CHECK "${err.constraint || '?'}" de la tabla ${err.table || '?'}: el valor no está permitido por la base de datos`,
        original,
      };
    case '23502':
      return {
        codigo: 'CAMPO_FALTANTE',
        mensaje: `La columna ${err.column || '?'} de la tabla ${err.table || '?'} no admite NULL`,
        original,
      };
    case '22P02':
      return {
        codigo: 'TIPO_INVALIDO',
        mensaje: `PostgreSQL recibió un dato con tipo inválido: ${err.message}`,
        original,
      };
    case '22003':
      return {
        codigo: 'VALOR_FUERA_DE_RANGO',
        mensaje: `Un valor numérico excede el rango de su columna: ${err.message}`,
        original,
      };
    case '28P01':
    case '28000':
      return {
        codigo: 'BD_CREDENCIALES',
        mensaje: `PostgreSQL rechazó las credenciales (${descripcionConexion()}). Revise PGUSER y PGPASSWORD en backend/.env`,
        original,
      };
    case '3D000':
      return {
        codigo: 'BD_NO_EXISTE',
        mensaje: `La base de datos "${env.PGDATABASE}" no existe en ${env.PGHOST}:${env.PGPORT}. Créela en pgAdmin 4 (clic derecho en Databases → Create → Database) o corrija PGDATABASE en backend/.env`,
        original,
      };
    case '42P01':
      return {
        codigo: 'BD_TABLA_NO_EXISTE',
        mensaje: `Una tabla no existe (${err.message}). Ejecute database/schema.sql en la base "${env.PGDATABASE}" desde el Query Tool de pgAdmin 4`,
        original,
      };
    case '42703':
      return {
        codigo: 'BD_COLUMNA_NO_EXISTE',
        mensaje: `Una columna no existe (${err.message}). El esquema de la base no coincide con database/schema.sql`,
        original,
      };
    case '57P01':
    case '57P03':
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

function esErrorPg(err) {
  if (!err) return false;
  return (
    (typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code) && 'severity' in err) ||
    ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'].includes(err.code) ||
    /timeout exceeded when trying to connect|Connection terminated/i.test(err.message || '')
  );
}

module.exports = { traducirErrorPg, esErrorPg, descripcionConexion };
