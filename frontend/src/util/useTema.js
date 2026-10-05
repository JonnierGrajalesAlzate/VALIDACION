import { useEffect, useState } from 'react';

const TOKENS = ['--text', '--text-2', '--muted', '--border', '--surface', '--surface-2', '--series-1', '--series-2',
  '--seq-0', '--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5', '--seq-6', '--seq-7', '--nivel-bajo', '--nivel-medio', '--nivel-alto'];

function leer() {
  const estilos = getComputedStyle(document.documentElement);
  return Object.fromEntries(TOKENS.map((t) => [t.slice(2), estilos.getPropertyValue(t).trim()]));
}

export function useTema() {
  const [tema, setTema] = useState(leer);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const actualizar = () => setTema(leer());
    mq.addEventListener('change', actualizar);
    return () => mq.removeEventListener('change', actualizar);
  }, []);
  return tema;
}
