# Posición de pila técnica — US-A-003 (borrador)

## 1. Propósito

Documentar la posición técnica para revisión, sin decidir implementación ni
adoptar framework.

## 2. Entrada actual

- Árbol en `91799ad`: solo contrato, sin backend.
- PO recomienda 2 teachers en 1 academia + 2ª academia, nombres en inglés,
  seed idempotente y tabla de deduplicación ejecutable.
- DBA/AGT-DATA-001 propone DDL y semántica de revisión/conflicto/deduplicación.
- TD03 deja elección de pila a Freebuff con Arquitectura.
- No hay código existente que imponga otra pila en el árbol revisado.

## 3. Candidato propuesto meramente para revisión

- Node 24
- TypeScript
- Fastify
- PostgreSQL 16
- React/Vite en frontend

Destino de esta propuesta: revisión, no adopción automática.

## 4. Coincidencia con contrato corregido

El contrato deja explícitamente pendiente:
- sesión;
- API;
- retry/idempotencia;
- representación exacta de duración;
- campos VA aceptados.

Eso permite definir pila sin acoplar contrato a implementación prematura.

## 5. Puente con backend existente

Si el backend existente es Sequelize:
- migrar DDL propuesto como migraciones TS;
- compartir validadores puros;
- modelar guardado transaccional con update condicional + replace completo;
- modelo de deduplicación según tabla propuesta o equivalente revisado.

Esto es puente, no implementación.

## 6. Estado

- Posición propuesta, no adoptada.
- Backend pendiente.
- SQL no ejecutado.
- Árbol intacto excepto el nuevo paquete corregido.