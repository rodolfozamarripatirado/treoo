# Commit suggestion — US-A-003 corregido

## Contenido del commit

Este commit agrega el paquete corregido sobre `91799ad` en la rama
`Treoo/freebuff/T-A-002-contract`, sin modificar ese SHA existente.

Archivos nuevos:
- `A-contract/US-A-003/contract.md`
- `A-contract/US-A-003/dto-validators.md`
- `A-contract/US-A-003/migration-seed.sql`
- `A-contract/US-A-003/r3-resolution-matrix.md`
- `A-contract/US-A-003/test-scenarios-report.md`
- `A-contract/US-A-003/draft-sequelize-integration.md`
- `A-contract/US-A-003/draft-stack-position.md`
- `A-contract/US-A-003/commit-prep-note.md`
- `A-contract/US-A-003/commit-suggestion.md`

## Mensaje propuesto

```
Corregir paquete US-A-003 según R3 y propuesta AGT-DATA-001

Contrato corregido por R3:
- Ámbito academia y autoridad derivada de sesión.
- Borrador mínimo DEC-A-002: título, cero o más actividades,
  contenido parcial, duración opcional.
- Duración opcional, finita y >0 cuando existe.
- Estado y preview separados del ciclo de guardado.
- Revisión atómica con expectedRevision y reemplazo completo
  de actividades en transacción.
- Deduplicación propuesta para creación segura.
- Eliminación de term? y "Material original Narwhals" del
  contrato mínimo.

DTO/validadores corregidos:
- Campos opcionales explícitos y reglas por campo presente.
- Validador de actividad y de duración reusable.
- Validación de ámbito desde sesión.

DDL/migración/seed propuesto:
- Tablas treoo.academy, teacher, academy_teacher, lesson,
  activity con FKs compuestas, orden y constraint de duración.
- Migración y seed propuestos, NO EJECUTADOS, NO APROBADOS.
- Preflight y tabla de deduplicación propuestos.

Indispensable pendiente:
- Revisión Arquitectura/Datos/Cian.
- decisión sobre sesión, API, retry, deduplicación y representación
  exacta de duración.
- Backend y migración posteriores al acuerdo.
```

## Advertencias de commit

- No ejecutar SQL por este commit.
- No incluir valores secretos.
- Si el remote avanzó desde el último fetch, resolver conflicto antes de
  publicar.
- No hacer merge a main sin revisión.