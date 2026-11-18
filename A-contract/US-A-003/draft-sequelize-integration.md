# Nota técnica de integración — US-A-003 y postura backend existente

## 1. Propósito

Esta nota une el paquete corregido (`A-contract/US-A-003/*`) con la postura
backend existente del repositorio, para que Arquitectura/Datos/Cian revisen el
mismo artefacto sin que Freebuff decida stack ni implementación prematura.

Estado: propuesta, no ejecutada, no migrada.

## 2. Entrada usada

- Reporte R3 y proforma DBA/AGT-DATA-001:
  `/home/node/.cache/treoo-po/handoff-20261116.md`
- Artefactos corregidos en este paquete:
  - `A-contract/US-A-003/contract.md`
  - `A-contract/US-A-003/dto-validators.md`
  - `A-contract/US-A-003/migration-seed.sql`
  - `A-contract/US-A-003/r3-resolution-matrix.md`
  - `A-contract/US-A-003/test-scenarios-report.md`

## 3. Postura del repositorio

El árbol actual en `91799ad` contiene:
- `README.md`
- `A-contract/draft/CONTRACT-US-A-003-v2.md`
- `treoo/local/A-contract/CONTRACT-US-A-003.md`
- `treoo/local/A-contract/demo-worksheet-ref.txt`

No hay código de aplicación, migraciones ejecutadas ni paquete de backend en el
árbol revisado. Esto significa que no hay restricción técnica existente que imponga
un ORM, framework o lenguaje concreto desde el commit actual.

## 4. Decisión técnica pendiente

Si no hay código existente que imponga otra pila, el candidato propuesto para
revisión es:

- Node 24
- TypeScript
- Fastify
- PostgreSQL 16
- Frontend React/Vite

Esto es una propuesta, no una decisión adoptada. La decisión corresponde a
Arquitectura con Freebuff preparando artefactos.

## 5. Coherencia con el contrato corregido

El contrato corregido deja explícitamente pendiente:
- mecanismo exacto de sesión docente;
- API real: transportes, rutas, versiones de respuesta;
- política de retry/idempotencia y esquema de deduplicación desplegable;
- representación exacta de duración si se prefiere decimal exacto;
- campos VA aceptados por Cian/UX.

Eso significa que el paquete es útil como contrato/validador/DDL/pruebas
propuestas sin decidir implementación todavía.

## 6. Puntos de encuentro con un backend Sequelize existente

Si la decisión final es Sequelize:
- el DDL propuesto puede traducirse a migraciones Sequelize/TypeScript con los
  mismos constraints de clave compuesta, orden y duración;
- la función pura de validación de actividad/duración puede vivir en una capa
  compartida entre frontend y backend si el stack lo permite;
- la creación deduplicada puede modelarse con la tabla propuesta o con un
  mecanismo equivalente revisado por Arquitectura;
- la transacción de guardado puede expresarse como una única transacción que
  haga update condicional + replace completo de actividades.

No se está adoptando Sequelize aquí; solo se deja abierto el puente.

## 7. Próximo paso mínimo

Exponer este paquete a revisión sin ejecutar SQL y sin decidir stack. Si
Arquitectura/Datos/Cian confirman el modelo y los validadores, entonces proceder
con:
- archivo de migración real derivado de `migration-seed.sql`;
- seed repetible con preflight;
- capa de acceso autorizada por sesión mínima para el ciclo manual.

## 8. Estado

- Paquete corregido listo para revisión.
- Backend pendiente.
- DB no usado todavía para verificación de DDL.