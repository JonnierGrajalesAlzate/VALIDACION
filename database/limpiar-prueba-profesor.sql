-- Borra SOLO los datos creados por peticiones/prueba_profesor.py
-- (usuarios con correo @prueba-profesor.com, sus transacciones y anomalías).
-- Las anomalías se borran solas por ON DELETE CASCADE.
BEGIN;
DELETE FROM transacciones
 WHERE usuario_id IN (SELECT id FROM usuarios WHERE email LIKE '%@prueba-profesor.com');
DELETE FROM usuarios WHERE email LIKE '%@prueba-profesor.com';
COMMIT;
