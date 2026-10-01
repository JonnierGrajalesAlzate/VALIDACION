/** Usuarios con sus conteos; permite activar/inactivar (PATCH /api/usuarios/:id). */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/cliente';
import PanelResultado, { ListaErrores } from '../componentes/PanelResultado';
import { fmtFecha, fmtPesos } from '../util/formato';

export default function Usuarios() {
  const [r, setR] = useState(null);
  const [accion, setAccion] = useState(null);
  const cargar = useCallback(() => api('GET', '/api/usuarios').then(setR), []);
  useEffect(() => { cargar(); }, [cargar]);

  async function cambiar(u) {
    const estado = u.estado === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO';
    const res = await api('PATCH', `/api/usuarios/${u.id}`, { estado });
    setAccion(res);
    cargar();
  }

  return (
    <>
      <div className="encabezado"><div><h1>Usuarios</h1><p>Un usuario INACTIVO no puede registrar transacciones (error USUARIO_INACTIVO).</p></div></div>
      {accion && !accion.ok && <PanelResultado resultado={accion} />}
      {accion && accion.ok && <p className="aviso">✓ {accion.cuerpo.mensaje}</p>}
      {r && !r.ok && <div className="resultado mal"><h3>✕ Error</h3><ListaErrores errores={r.cuerpo.errores} /></div>}
      {r && r.ok && (
        <section className="tarjeta">
          <h2>{r.cuerpo.total} usuario(s)</h2>
          <div className="tabla-scroll">
            <table>
              <thead><tr><th>id</th><th>Correo</th><th>Nombre</th><th>Estado</th><th className="num">Transacciones</th><th className="num">Anómalas</th><th className="num">Anomalías</th><th className="num">Valor total</th><th>Última</th><th /></tr></thead>
              <tbody>
                {r.cuerpo.datos.map((u) => (
                  <tr key={u.id}>
                    <td className="mono">{u.id}</td>
                    <td><Link to={`/transacciones?usuario=${encodeURIComponent(u.email)}`}>{u.email}</Link></td>
                    <td>{u.nombre}</td>
                    <td><span className={`insignia ${u.estado === 'ACTIVO' ? 'ok' : 'mal'}`}>{u.estado}</span></td>
                    <td className="num">{u.totalTransacciones}</td>
                    <td className="num">{u.transaccionesAnomalas}</td>
                    <td className="num">{u.totalAnomalias}</td>
                    <td className="num">{fmtPesos(u.valorTotal)}</td>
                    <td className="mono">{fmtFecha(u.ultimaTransaccion, { ms: false })}</td>
                    <td><button className="chico" onClick={() => cambiar(u)}>{u.estado === 'ACTIVO' ? 'Inactivar' : 'Activar'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
