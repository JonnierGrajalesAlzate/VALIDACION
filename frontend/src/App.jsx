import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api } from './api/cliente';
import Anomalias from './paginas/Anomalias';
import Configuracion from './paginas/Configuracion';
import Dashboard from './paginas/Dashboard';
import DetalleAnomalia from './paginas/DetalleAnomalia';
import Registro from './paginas/Registro';
import Transacciones from './paginas/Transacciones';
import Usuarios from './paginas/Usuarios';

function EstadoApi() {
  const [salud, setSalud] = useState(null);
  useEffect(() => {
    const revisar = () => api('GET', '/api/health').then(setSalud);
    revisar();
    const t = setInterval(revisar, 30000);
    return () => clearInterval(t);
  }, []);
  if (!salud) return <span className="estado-api">Verificando…</span>;
  const ok = salud.ok;
  const texto = ok
    ? `API y PostgreSQL OK (${salud.cuerpo.baseDeDatos.nombre}, ${salud.cuerpo.baseDeDatos.latenciaMs} ms)`
    : salud.status === 0 || salud.status >= 500 && !salud.cuerpo.baseDeDatos
      ? 'Backend sin conexión'
      : `PostgreSQL con problemas: ${(salud.cuerpo.baseDeDatos?.problemas || []).join(' ')}`;
  return (
    <span className="estado-api" title={texto}>
      <span className="punto" style={{ background: ok ? 'var(--good)' : 'var(--critical)' }} aria-hidden="true" />
      {ok ? '✓' : '✕'} {texto}
    </span>
  );
}

export default function App() {
  return (
    <>
      <header className="barra">
        <NavLink to="/" className="marca"><img src="/favicon.svg" alt="" width="26" height="26" />Appresso <small>· tu café, a un tap</small></NavLink>
        <nav className="nav" aria-label="Principal">
          <NavLink to="/" end>Registrar</NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/anomalias">Anomalías</NavLink>
          <NavLink to="/transacciones">Transacciones</NavLink>
          <NavLink to="/usuarios">Usuarios</NavLink>
          <NavLink to="/configuracion">Configuración</NavLink>
        </nav>
        <EstadoApi />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Registro />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/anomalias" element={<Anomalias />} />
          <Route path="/anomalias/:id" element={<DetalleAnomalia />} />
          <Route path="/transacciones" element={<Transacciones />} />
          <Route path="/usuarios" element={<Usuarios />} />
          <Route path="/configuracion" element={<Configuracion />} />
          <Route path="*" element={<p className="vacio">Página no encontrada.</p>} />
        </Routes>
      </main>
    </>
  );
}
