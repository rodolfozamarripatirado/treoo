# Contrato corregido — US-A-003 (revisión R3, entrega propuesta)

## 1. Propósito y estado

Este documento corrige `A-contract/draft/CONTRACT-US-A-003-v2.md` en el SHA
`91799ad813c57df18ca893fe889b395383fa4be9` con los hallazgos concretos del
reporte R3 (`PO-A002-R3-01` … `PO-A002-R3-07`) y la propuesta AGT-DATA-001.

Estado: **propuesta corregida**, pendiente de revisión de Arquitectura/Datos/Cian.
No es implementación ejecutable y no autoriza migración.

Fuente canónica: Notion.
Fuente de entrada usada para esta corrección:
`/home/node/.cache/treoo-po/handoff-20261116.md` (copia local del PO desde Notion).

## 2. Ámbito corregido (R3-01, R3-02, R3-03)

### 2.1 Ámbito de academia y autoridad

- El backend resuelve `academy_id` y `teacher_id` desde el contexto de sesión
  autorizado, no desde un campo libre en el cuerpo de la petición.
- Ningún endpoint de lección acepta `teacher_id` o `academy_id` al pie de la
  letra desde el payload sin validación de sesión.
- Cada operación verifica que el actor en sesión pertenece a la academia
  resuelta y que la lección estudiada pertenece a esa misma `(academy_id, teacher_id)`.
- La integridad relacional se refuerza con restricciones y claves compuestas, pero
  eso refuerza, no sustituye, la autorización resuelta en sesión.

### 2.2 Borrador mínimo corregido (R3-02 / DEC-A-002)

Borrador válido:
- título no vacío;
- cero o más actividades;
- contenido parcial permitido;
- duración opcional;
- cuando la actividad incluye `duration_minutes`, debe ser finito y estrictamente positivo.

Campos de lección que el backend debe permitir en borrador:
- título obligatorio;
- texto opcional;
- tema opcional;
- nivel/contexto opcional;
- objetivo opcional;
- metodología/notas opcionales.

Campos de actividad que el backend debe permitir:
- `kind` opcional;
- `title` opcional;
- `instruction` opcional;
- `duration_minutes` opcional, finito y mayor que cero cuando está presente;
- `order_index` entero no negativo, estable dentro del borrador;
- edición sin silenciar campos pendientes.

Validación mínima de actividad cuando se envía:
- si `kind` está presente, no vacío;
- si `title` está presente, no vacío;
- si `instruction` está presente, no vacío;
- si `duration_minutes` está presente, finito y estrictamente positivo.

## 3. Contratos de entidad corregidos (R3-02, R3-03)

### 3.1 Lección

Campos mínimos siguientes en el modelo de persistencia:
- `academy_id`
- `lesson_id`
- `teacher_id`
- `title`, texto no vacío
- `theme`
- `level_context`
- `objective`
- `methodology`
- `lesson_text`
- `status`, con valor mínimo aceptado `draft` para este corte
- `revision`, entero positivo monotono incrementado por guardado exitoso
- `created_at`, `updated_at`

Reglas:
- Borrador inicial y guardado existente usan `draft` para este corte manual.
- Reopen/preview no cambian estado, versión ni contenido.
- El estado cambiado al guardar no se modela como `saved` en este corte; el
  contrato de persistencia usa la revisión y la autoría por academia como fuente
  de verdad.

### 3.2 Actividad

Campos mínimos:
- `academy_id`
- `activity_id`
- `lesson_id`
- `order_index`
- `kind`
- `title`
- `instruction`
- `duration_minutes`
- `created_at`, `updated_at`

Reglas:
- Orden único dentro del borrador por `(academy_id, lesson_id, order_index)`.
- Duración opcional; cuando existe, finita y estrictamente positiva.
- Guardado exitoso reemplaza el conjunto completo de actividades del mismo
  ámbito en la misma transacción.

## 4. Duración corregida (R3-03)

- `duration_minutes` es opcional.
- Cuando está presente, debe ser finito y estrictamente positivo.
- La representación numérica debe ser compatible entre frontend y backend.
- El backend rechaza valores no finitos y valores `<= 0` cuando se indican.
- No se inventa duración total si no hay actividades con duración definida.
- La suma total de la lección, si existe, se deriva de los valores guardados,
  no de caché de cliente.

## 5. Estado corregido (R3-04)

Lo que persiste:
- lección con `status = draft` y `revision`;
- actividades con orden y duración opcional;
- metadatos opcionales de lección;
- fechas de creación y actualización.

Lo que no persiste como cambio de estado:
- reapertura;
- vista previa;
- navegación UI de cerrado/previsualización.

Vista previa:
- lee una revisión ya guardada sin modificarla;
- no publica a alumnos;
- no dispara IA/extracción/generación en este corte;
- reanuda el mismo editor del mismo borrador sin clonar ni reiniciar versión;
- si el borrador está cerrado según política, vista previa puede ser solo lectura
  con aviso y reapertura explícita según política definida.

## 6. Revisión atómica y conflicto corregidos (R3-05)

Requisito mínimo de guardado:
- toda mutación requiere `expectedRevision`;
- en transacción, autenticar/resolver actor y academia desde sesión;
- ejecutar actualización condicional con predicado atómico sobre
  `academy_id`, `lesson_id`, `teacher_id` y `revision = expectedRevision`;
- si la actualización devuelve fila, sincronizar el conjunto completo de
  actividades para ese `academy_id` y `lesson_id` en la misma transacción;
- si no devuelve fila, responder conflicto/recurso no visible sin tocar actividades;
- responder solo tras commit con la revisión retornada.

Política de conflicto:
- dos guardados simultáneos con el mismo `expectedRevision` dejan exactamente uno
  en la siguiente revisión y el otro en conflicto;
- no se fusiona contenido automáticamente;
- no se reintenta automáticamente la escritura con `revision` actualizada, porque
  eso puede sobrescribir cambios concurrentes;
- cliente decide resincronización/rebase manual.

## 7. Creación y reintentos corregidos (R3-05)

- Creación segura ante timeout necesita mecanismo explícito de deduplicación con
  clave estable por `(academy_id, teacher_id, idempotency_key)`.
- Mismo `idempotency_key` y mismo hash de petición devuelven el resultado
  original.
- Mismo `idempotency_key` con hash distinto se rechaza.
- Reintentos idénticos sin cambios de payload no avanzan ni corrompen estado.
- Falencia de persistencia no marca borrador como guardado.
- La retención y esquema exacto de respuesta de deduplicación se cierran antes de
  integrar como criterio verificable.

## 8. Material original y término corregidos (R3-07)

- “Material original Narwhals” no es requisito del flujo manual; dejarlo fuera del
  contrato mínimo o marcarlo como fuente opcional claramente futura.
- `term?` no tiene significado definido en este corte; eliminarlo del contrato mínimo
  o definirlo con evidencia explícita antes de usarlo.

## 9. DTO corregidos (R3-02, R3-03, R3-05, R3-07)

### 9.1 Crear borrador

Petición mínima:
- título no vacío
- texto de lección opcional
- tema opcional
- nivel/contexto opcional
- objetivo opcional
- metodología/notas opcionales
- actividades opcionales, cada una con:
  - `kind` opcional
  - `title` opcional
  - `instruction` opcional
  - `duration_minutes` opcional, finito y estrictamente positivo cuando presente
  - `order_index` entero no negativo opcional; si falta, el backend asigna orden
    estable

El backend deriva `academy_id` y `teacher_id` desde sesión.

### 9.2 Guardar

Petición mínima:
- `academy_id` y `lesson_id` expresados en ruta/contexto resueltos desde sesión
- `expectedRevision`
- título opcional si no cambia
- texto opcional
- tema opcional
- nivel/contexto opcional
- objetivo opcional
- metodología/notas opcionales
- actividades opcionales, enviadas como conjunto completo cuando se incluyen

Regla mínima: si se envían actividades, se reemplaza el conjunto completo del
mismo ámbito en la transacción.

### 9.3 Reabrir / editar

- Reopen reanuda edición del mismo borrador sin cambiar revisión ni contenido.
- Edición posterior usa el mismo patrón de `expectedRevision` y reemplazo completo
  de actividades cuando se incluyen.

### 9.4 Vista previa

Petición mínima:
- `academy_id` y `lesson_id` desde sesión/contexto
- solo lectura de la revisión confirmada
- sin efecto sobre estado, versión o contenido

## 10. Respuestas mínimas

Lección:
- `academy_id`
- `lesson_id`
- `teacher_id`
- `title`
- `theme`
- `level_context`
- `objective`
- `methodology`
- `lesson_text`
- `status`
- `revision`
- `created_at`
- `updated_at`

Actividad:
- `academy_id`
- `activity_id`
- `lesson_id`
- `order_index`
- `kind`
- `title`
- `instruction`
- `duration_minutes`
- `created_at`
- `updated_at`

Error mínimo:
- `code`
- `message`
- para conflicto, datos de revisión actual cuando corresponda

## 11. Errores mínimos

- `UNAUTHORIZED`: sesión inválida o docente no reconocido.
- `NOT_FOUND`: lección no existe o no pertenece al docente/ágora resuelta.
- `VALIDATION_ERROR`: campos inválidos.
- `CONFLICT`: cambio concurrente detectado.
- `INTERNAL_ERROR`: fallo interno sin revelar detalles.

## 12. Transacción de guardado corregida

1. Resolver y validar sesión de docente y academia.
2. Validar payload.
3. En transacción:
   - actualización condicional de la lección con `expectedRevision`;
   - si la fila devuelta existe, reemplazar el conjunto completo de actividades
     para el mismo ámbito;
   - si no hay fila, abortar sin mutar actividades;
4. Commit.
5. Responder solo con la revisión confirmada recuperada tras commit.

Reapertura y edición usan reglas equivalentes de propiedad y versión.

## 13. Pre condiciones

- Demo manual persistente sin IA es el resultado a producir, no una precondición
  que deba funcionar antes de implementarlo.
- Material original para S-02 no bloquea el manual.
- DB con esquema definido y migrado antes de las historias de acceso.
- Contrato corregido revisado por Arquitectura/Datos/Cian antes de codificar.

## 14. Estado actual

- Contrato corregido por R3 y propuesta DDL/migración/seed separada entregada junto
  a este documento.
- No ejecutado.
- No migrado.
- Pendiente revisión y decisión sobre mecanismo de sesión, API, retry y
  deduplicación.

## 15. Referencia al paquete corrector

- Paquete corrector: `A-contract/US-A-003/`.
- Ficheros líderes:
  - `contract.md` (→ este fichero)
  - `dto-validators.md` (→ reglas de validación)
  - `dto-validators.ts` → implementación ejecutable de validadores
  - `dto-validators.test.ts` → pruebas focalizadas sobre DTOs/validadores/typos
  - `migration-seed.sql` → DDL propuesto + seed REPETIBLE + ledger de deduplicación ejecutable
  - `r3-resolution-matrix.md` → matiz de hallazgos R3 a artefacto
  - `test-scenarios-report.md` → escenarios de prueba (positivos, negativos, RLS)
  - `draft-sequelize-integration.md` / `draft-stack-position.md` / `commit-prep-note.md` / `commit-suggestion.md` → notas auxiliares de puente/posicionamiento/commit.

> Nota operativa: `commit-prep-note.md` y `commit-suggestion.md` quedan como artefactos auxiliares del proceso, no del paquete de entrega funcional. Si el equipo prefiere un paquete más limpio, se pueden retirar en un commit posterior; en cualquier caso, no afectan a lo que el equipo validó (contracto, DTOs, DDL/seed, pruebas).

#### Revisión de DBA y próximo commit

- Este paquete incorpora `migration-seed.sql` revisado tras la propuesta de DBA del `data-review-20261116.md`.
- Las correcciones se publicarán en un segundo commit sobre la rama actual, después de publicar primer commit de paquete base.
- SQL sigue sin ejecutarse ni aprobarse en este turno.

#### III. Qué HAY y qué NO HAY en este paquete

| Sí está | No está (fuera de este paquete) |
| --- | --- |