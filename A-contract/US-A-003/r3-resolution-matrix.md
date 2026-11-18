# Matriz de resolución R3 — US-A-003

## 1. Propósito

Esta matriz cierra cada hallazgo del reporte R3 (`PO-A002-R3-01` …
`PO-A002-R3-07`) y los hallazgos AGT-DATA-001 contra los artefactos corregidos
en este paquete.

Estado de los artefactos:
- contrato corregido: `A-contract/US-A-003/contract.md`
- DTO/validadores: `A-contract/US-A-003/dto-validators.md`
- DDL/migración/seed: `A-contract/US-A-003/migration-seed.sql`
- capa ejecutable: **pendiente** (no implementada, no migrada)

## 2. Matriz

### PO-A002-R3-01 — Ámbito y autoridad

Hallazgo:
- Falta ámbito de academia y su relación con identidad/membresía/autorización.
- `teacherId` como entrada y “sesión docente” no definen fuente de autoridad.

Corrección:
- Contrato §2 y DTO §1 establecen que `academy_id` y `teacher_id` se resuelven
  desde la sesión autorizada.
- Contraintancia basada en `(academy_id, teacher_id)` en `treoo.lesson` y
  `treoo.academy_teacher`.
- Validador de ámbito en DTO §11.

Artefacto:
- `contract.md` §2, §3.1, §11, §14
- `dto-validators.md` §1, §11
- `migration-seed.sql` tabla `academy_teacher`, FK compuesta en `lesson`

Estado: corregido en propuesta. Pendiente decisión de Arquitectura sobre sesión/API.

### PO-A002-R3-02 — Borrador mínimo y campos opcionales

Hallazgo:
- `text` no vacío, `activities` no vacío, `kind/text` obligatorios contradicen
  DEC-A-002.
- Faltan campos de edición de HU (tema, nivel/contexto, objetivo, metodología/notas).

Corrección:
- Borrador mínimo corregido: título no vacío, cero o más actividades, contenido
  parcial permitido, duración opcional.
- Campos de lección y actividad recircunscritos como opcionales cuando el dominio lo
  permite.
- Validaciones opcionales con reglas explícitas.

Artefacto:
- `contract.md` §2.2, §3.1, §3.2
- `dto-validators.md` §2, §3, §8, §9, §10

Estado: corregido en propuesta. Pendiente Cian/UX sobre campos VA como mínimo
para el recorrido manual.

### PO-A002-R3-03 — Duración

Hallazgo:
- `duration integer NOT NULL / entero positivo` contradice duración opcional,
  fraccionaria y >0 cuando existe.

Corrección:
- Duración opcional; cuando existe, finita y estrictamente positiva.
- Compatibilidad FE/BE y rechazo de NaN/Infinity/<=0 en runtime.
- No se inventa duración total.

Artefacto:
- `contract.md` §2.2, §4
- `dto-validators.md` §2, §8, §9
- `migration-seed.sql` CHECK en `activity.duration_minutes`

Estado: corregido en propuesta. Pendiente decisión de representación decimal exacta
si se requiere.

### PO-A002-R3-04 — Estado y preview

Hallazgo:
- `saved/reopened/preview` listados como estados sin separar estado UI/persistencia.

Corrección:
- Qué persiste definido: `draft`, `revision`, actividades, metadatos opcionales,
  fechas.
- Reopen/preview no cambian contenido/revisión.
- Preview solo de revisión guardada, retorno al mismo editor.

Artefacto:
- `contract.md` §3.1, §5, §2.2, §9.4
- `dto-validators.md` §6

Estado: corregido en propuesta. Pendiente política de comportamiento de preview
cuando el borrador está cerrado.

### PO-A002-R3-05 — Revisión, transacción, retry/idempotencia

Hallazgo:
- Sin revisión en DTO/respuesta/campos; conflicto “versión/updated_at o equivalente”.
- Falta comparación atómica y política reproducible, especialmente creación sin ID
  previo.
- No reintentar escritura automática con versión actualizada.

Corrección:
- `expectedRevision` obligatorio para guardado mutante.
- Actualización condicional atómica sobre
  `(academy_id, lesson_id, teacher_id, revision = expectedRevision)`.
- Reemplazo completo de actividades solo si la fila devuelta existe.
- Conflicto sin mutación de lesson ni activities.
- Mecanismo de deduplicación propuesto para creación segura.

Artefacto:
- `contract.md` §6, §7, §9.2, §12
- `dto-validators.md` §2, §4, §12
- `migration-seed.sql` sección de deduplicación propuesta

Estado: corregido en propuesta. Pendiente cierre de esquema/retención de respuesta
de deduplicación e integración.

### PO-A002-R3-06 — DDL físico ausente

Hallazgo:
- Lista de campos no es DDL ejecutable.
- Faltan identidad/membresía del docente de seed, FKs/constraints completas,
  orden/duración, versión, límites runtime y migración revisable.

Corrección:
- DDL propuesto ejecutable como archivo separado.
- Tablas `academy`, `teacher`, `academy_teacher`, `lesson`, `activity`.
- FKs compuestas, índices, constraint de orden, constraint de duración, versión.
- Migración propuesta como archivo separado.

Artefacto:
- `migration-seed.sql`

Estado: propuesta lista para revisión, no ejecutada, no aprobada.

### PO-A002-R3-07 — Residuos y Manual sin IA

Hallazgo:
- `term?` sin significado definido; “Material original Narwhals” sin soporte.
- Manual sin IA tratado como precondición circular.

Corrección:
- `term?` eliminado del contrato mínimo o con definición explícita antes de uso.
- Material original fuera del contrato mínimo o marcado como fuente opcional futura.
- Manual persistente sin IA es el resultado a producir, no precondición.

Artefacto:
- `contract.md` §8, §13

Estado: corregido en propuesta.

## 3. Hallazgos AGT-DATA-001 contra el mismo commit

- Mínimos de borrador: corregidos en propuesta.
- Ámbito: corregido en propuesta.
- Duración: corregida en propuesta.
- Revisión atómica: corregida en propuesta.
- Estado: corregido en propuesta.
- Creación/reintentos: corregido en propuesta.
- Original: corregido en propuesta.
- DDL/DTO/runtime: propuesta entregada, pendiente revisión y evidencia de prueba.

## 4. Pendientes por decisión

- Mecanismo exacto de sesión docente y cómo se transmiten `academy_id` y
  `teacher_id`.
- API real: transportes, rutas, versiones de respuesta.
- Política de retry/idempotencia deseada y esquema de deduplicación desplegable.
- Representación exacta de duración si se prefiere decimal exacto.
- Comportamiento cuando el borrador está cerrado en preview.
- Campos VA aceptados por Cian/UX para el recorrido manual.
- Candidato de stack real; propuesta asumible Node 24 / TypeScript / Fastify /
  PostgreSQL 16 con React/Vite si no hay código existente que imponga otro.