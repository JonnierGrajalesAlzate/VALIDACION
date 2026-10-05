const env = require('../config/env');
const { ventanaPara, ventanaMaxima } = require('./franjas');
const { calcularNivel } = require('./niveles');
const { crearLogger } = require('../logging/logger');

const log = crearLogger(__filename);

class ColaVentana {
  constructor(ventanaMaxMs) {
    this.ventanaMaxMs = ventanaMaxMs;
    this.items = [];
    this.inicio = 0;
    this.historicas = 0;
  }

  agregar(evento, ventanaMs = this.ventanaMaxMs) {
    this.items.push(evento);
    if (!evento.esNueva) this.historicas += 1;
    while (this.inicio > 0 && evento.fechaMs - this.items[this.inicio - 1].fechaMs <= ventanaMs) {
      this.inicio -= 1;
      if (!this.items[this.inicio].esNueva) this.historicas += 1;
    }
    const salieron = [];
    while (evento.fechaMs - this.items[this.inicio].fechaMs > ventanaMs) {
      const sale = this.items[this.inicio];
      this.inicio += 1;
      if (!sale.esNueva) this.historicas -= 1;
      salieron.push(sale);
    }
    if (this.inicio > 1024 && this.inicio * 2 > this.items.length) {
      const corte = this.primerIndiceDesde(evento.fechaMs - this.ventanaMaxMs);
      if (corte > 1024) {
        this.items = this.items.slice(corte);
        this.inicio -= corte;
      }
    }
    return salieron;
  }

  primerIndiceDesde(desdeMs) {
    let lo = 0;
    let hi = this.inicio;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.items[mid].fechaMs < desdeMs) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  get tamano() {
    return this.items.length - this.inicio;
  }

  contenido() {
    return this.items.slice(this.inicio);
  }

  ultimaNueva() {
    for (let i = this.items.length - 1; i >= this.inicio; i -= 1) {
      if (this.items[i].esNueva) return this.items[i];
    }
    return null;
  }
}

function compararEventos(a, b) {
  return a.fechaMs - b.fechaMs || a.id - b.id;
}

function rangoHistorico(fechasNuevasMs, reglas) {
  const ventanaMs = ventanaMaxima(reglas) * 1000;
  return { desdeMs: Math.min(...fechasNuevasMs) - ventanaMs, hastaMs: Math.max(...fechasNuevasMs) + ventanaMs };
}

function detectarAnomalias({ historico, nuevas, reglas, zona = env.TZ_NEGOCIO }) {
  const { umbral } = reglas.ventanaDeslizante;
  const resultado = new Map();
  for (const n of nuevas) {
    resultado.set(n.id, { estado: 'VALIDA', anomalias: [], traza: null });
  }

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

  const porUsuario = new Map();
  const agregar = (t, esNueva) => {
    if (!porUsuario.has(t.email)) porUsuario.set(t.email, []);
    porUsuario.get(t.email).push({ id: t.id, email: t.email, fechaMs: t.fechaMs, esNueva });
  };
  historico.forEach((t) => agregar(t, false));
  nuevas.forEach((t) => agregar(t, true));

  for (const [email, eventos] of porUsuario) {
    eventos.sort(compararEventos);

    const cola = new ColaVentana(ventanaMaxima(reglas) * 1000);

    for (const evento of eventos) {
      const { segundos, franja } = ventanaPara(evento.fechaMs, reglas, zona);
      const salieron = cola.agregar(evento, segundos * 1000);
      const conteo = cola.tamano;
      const anomalia = () => ({
        tipo: 'POSIBLE_FRAUDE',
        nivel: calcularNivel(conteo - umbral, reglas.niveles),
        cantidad: conteo,
        ventanaSegundos: segundos,
        franja,
      });

      if (evento.esNueva) {
        resultado.get(evento.id).traza = {
          ventanaSegundos: segundos,
          franja,
          entro: evento.id,
          salieron: salieron.map((s) => s.id),
          enVentana: cola.contenido().map((e) => e.id),
          conteo,
        };
        log.debug(
          { fn: 'detectarAnomalias', etapa: 'VENTANA_DESLIZANTE', idTxn: evento.id, usuario: email, franja, salieron: salieron.map((s) => s.id), enVentana: cola.contenido().map((e) => e.id) },
          `idTxn=${evento.id} entra a la ventana de ${email}: ${conteo} transacción(es) en ${segundos} s${franja ? ` (franja ${franja})` : ''}`,
        );
        if (conteo >= umbral) registrar(evento.id, anomalia());
      } else if (conteo >= umbral && cola.historicas < umbral) {
        const culpable = cola.ultimaNueva();
        if (culpable) registrar(culpable.id, anomalia());
      }
    }
  }

  for (const [id, r] of resultado) {
    for (const a of r.anomalias) {
      log.info(
        { fn: 'detectarAnomalias', etapa: 'VENTANA_DESLIZANTE', idTxn: id, tipo: a.tipo, nivel: a.nivel, cantidad: a.cantidad, ventanaSegundos: a.ventanaSegundos, franja: a.franja },
        `ANOMALÍA ${a.tipo} (${a.nivel}) en idTxn=${id}: ${a.cantidad} transacciones en ${a.ventanaSegundos} s${a.franja ? ` (franja ${a.franja})` : ''}`,
      );
    }
  }
  return resultado;
}

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
