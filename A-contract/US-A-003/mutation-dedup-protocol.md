# mutation_dedup — protocolo ejecutable propuesto (US-A-003)

Este documento es el protocolo complementario al SQL ejecutable en `migration-seed.sql`
para `treoo.mutation_dedup`. No ejecuta SQL, no expone servicios y no aprueba la
implementación real; fija el contrato mínimo que el servicio debe respetar si usa ese
ledger.

## 1. Propósito

`mutation_dedup` existe para hacer que una operación semántica determinada sea
idempotente por significado, no solo por llave externa opcional del cliente.

El servidor:

- calcula un hash canónico de la petición normalizada;
- lo usa como parte de la llave semántica del mutation;
- guarda la respuesta mínima de la operación confirmada en el mismo registro;
- reutiliza esa respuesta textualmente cuando llega una petición semánticamente idéntica.

## 2. Alcance de la clave

Llave compuesta:

- `academy_id`
- `teacher_id`
- `operation_key`
- `operation_kind`
- `request_hash`

El alcance es por `(academy_id, teacher_id)`. El mismo `operation_key` textual en otro
ámbito o para otro teacher es otra fila independiente.

`operation_kind` es `create_lesson` o `save_lesson`.

`request_hash` es el hash canónico de la petición normalizada, SHA-256, 32 octetos.

## 3. Hash canónico mínimo

El hash canónico debe cubrir los componentes que hacen que la operación sea la misma
operación semántica:

- `operation_kind`
- `academy_id`
- `teacher_id`
- `lesson_id` para save
- `expected_revision`
- payload normalizado y ordenado de la misma forma usada para la mutación

La canonización exacta de payload queda en el servicio, pero esta propuesta exige que
la misma lógica de normalización que aplica a la mutación se use también para el hash,
para que cliente y servidor no calculen significados distintos sobre la misma petición.

Mismo significado → mismo hash. Distinto significado → distinto hash.

## 4. Crear con idempotencia

Flow propuesto para create:

1. Servidor valida el payload completo con los validadores del paquete.
2. Servidor calcula `requestHash` sobre la petición normalizada.
3. Dentro de una transacción, servidor lee existencia de la clave en
   `(academy_id, teacher_id, operation_key)` con el mismo mecanismo de cierre de
   concurrencia que usará para la mutación.
4. Si la clave ya existe con el mismo `operation_kind` y el mismo `request_hash`, el
   servidor retorna la respuesta guardada textualmente como `IDEMPOTENT_REPLAY`.
5. Si la clave existe con distinto `operation_kind` o distinto `request_hash`, el
   servidor rechaza con `IDEMPOTENCY_KEY_REUSED` y no muta.
6. Si no existe la clave:
   - servidor crea la lección con `revision = 1`, `status = 'draft'` y los campos del
     payload normalizado;
   - si el payload incluye actividades, servidor inserta o reemplaza el conjunto completo
     de actividades para ese `(academy_id, lesson_id)` en la misma transacción;
   - servidor inserta `mutation_dedup` con `operation_kind = 'create_lesson'`, el
     `request_hash`, `committed_revision = 1` y la respuesta mínima guardada.
7. Commit y respuesta.

En create, la fila del ledger tiene la misma `lesson_id` que la lección creada.

## 5. Save con espera atómica de revisión

Flow propuesto para save:

1. Servidor valida el `SaveRequest` completo.
2. Servidor calcula `requestHash` sobre la petición normalizada.
3. Transacción:
   - lee la lección actual para `(academy_id, lesson_id)`;
   - compara `expectedRevision` con la revisión actual;
   - si no coinciden, rollback y respuesta `CONFLICT`, sin tocar lección, activities ni
     el registro.
4. Si coinciden:
   - servidor actualiza la lección con la nueva revisión y los campos del payload
     normalizado;
   - servidor reemplaza el conjunto completo de actividades para ese
     `(academy_id, lesson_id)` en la misma transacción;
   - servidor inserta o actualiza `mutation_dedup` con `operation_kind = 'save_lesson'`,
     el `request_hash`, la `committed_revision` resultante y la respuesta mínima guardada.
5. Commit y respuesta de save.

La respuesta de save retorna `lesson_id`, `committed_revision` resultante y status.

## 6. Respuesta guardada para replay

El servicio construye la respuesta mínima UNA SOLA VEZ cuando la operación se confirma.

La respuesta guardada debe ser suficiente para reproducir la respuesta de éxito original
sin recomputar ni re-leer el estado de la lección en cada replay.

Esto no exige que el response_json sea grande ni que incluya todo el lesson; exige que
sea consistente, reproducible y el mismo para el mismo significado confirmado.

El servidor retorna esa respuesta textualmente para `IDEMPOTENT_REPLAY`.

## 7. Transacción y validación matemática

Todos los pasos relevantes deben ocurrir en una transacción ACID:

- lectura del estado actual;
- CAS de `expectedRevision`;
- mutación de lección;
- mutación de activities;
- escritura de `mutation_dedup` con la respuesta guardada.

No se admite que la lección quede actualizada sin su registro de deduplication, ni que
exista un registro de deduplication sin la operación confirmada asociada.

Validación de payload:

- si el payload no es válido, el servidor retorna error normal y no escribe
  `mutation_dedup` con respuesta de éxito;
- si `expectedRevision` no coincide, el servidor retorna `CONFLICT` y no escribe
  `mutation_dedup` con respuesta de éxito.

## 8. Manejo de concurrentes

Si dos peticiones compiten por la misma clave semántica:

- una gana porque logra la inserción/actualización atómica;
- la otra falla en el mismo mecanismo de cierre de concurrencia, se revierte y luego
  reintenta dentro de la misma transacción o vuelve a leer la fila ganadora para decidir
  si puede responder con `IDEMPOTENT_REPLAY`.

El servicio no debe dejar estado parcial: si falla después de mutar lección pero antes de
confirmar el registro, la transacción revierte junto con la mutación.

La clave única en `(academy_id, teacher_id, operation_key)` debe ser el mecanismo que
hace que la carrera sea visible y reversible en el servidor, no una esperanza externa.

## 9. Rechazo por clave reutilizada

Regla no negociable del protocolo:

- misma clave semántica + mismo hash → replay de la respuesta confirmada;
- misma clave semántica + distinto hash o distinto operation_kind → rechazo explícito,
  sin mutación.

Esto preserva que una clave semántica no se convierta en la operación equivocada porque
llegó después con otro contenido.

## 10. Retención para demo

Para la demo, el ledger se retiene durante la vida útil de la demo. No hay TTL automático,
no hay purga automática y no hay reutilización silenciosa de claves existentes.

Cualquier retiro posterior requiere procedimiento explícito; no se ejecuta aquí. La política
de producción queda fuera de este corte.

## 11. Respuesta mínima sugerida

Comentario de propuesta, no ejecutado ni aprobado:

- `lesson_id`
- `committed_revision`
- `status`

El servicio puede incluir más o menos; esta propuesta solo señala que la respuesta guardada
debe ser suficiente para el replay textual y lo suficientemente pequeña para poder ser
retida sin depender de un payload arbitrario del cliente.

## 12. Validación de ámbito en save y create

El servidor resuelve `academy_id` y `teacher_id` desde la sesión. La operación solo procede
si la lección estudiada pertenece a ese mismo `(academy_id, teacher_id)`.

Ninguna mutación de este contrato cambia `academy_id` de una lección existente sin
remodelación explícita autorizada fuera del corte manual.

## 13. Relación con los validadores

Los validadores de `dto-validators.ts` definen lo que el servidor acepta como payload
válido. El hash canónico y el protocolo de dedup usan la misma normalización que esos
validadores para evitar que el significado de la petición cambie entre validación,
mutación y replay.

Esto no supone que los validadores sean suficientes para la seguridad de producción; solo
supone que la misma capa de normalización debe ser la fuente para la mutación y para el
hash canónico.
