# DTO y validadores — US-A-003 (revisión R3, cerrado DEC-A-002)

## 1. Principio de autoridad

- `academy_id` y `teacher_id` se resuelven desde la sesión autorizada en servidor.
- El payload puede incluir referencias de ruta/contexto, pero la fuente de verdad
  de ámbito es la sesión, no un campo del body.
- Validación de propiedad: la lección estudiada debe pertenecer al
  `(academy_id, teacher_id)` del contexto resuelto.

## 2. Forma cerrada de DEC-A-002

- Único campo obligatorio en creación de lección: `title`.
- Borrador puede tener cero actividades.
- Actividades parciales válidas: un objeto de actividad puede incluir algunos
  campos y omitir otros.
- Texto opcional de actividad puede ser cadena vacía o ser nulo; no se rechaza
  borrador por falta de contenido opcional.
- Duración:
  - ausente: válido
  - `null`: válido
  - presente: finito y estrictamente positivo
- La duración no se deriva ni se valida como suma global en este contrato;
  se valida campo por campo.

## 3. Normalización de texto opcional

Regla mínima compartida entre frontend y backend:
- Campos opcionales de texto se aceptan en estas formas:
  - ausentes
  - `null`
  - cadena no vacía
  - cadena vacía
- Cuando se persisten, la forma preferida es:
  - cadena vacía y `null` se guardan como `null` si el modelo lo permite, o
    se conserva la forma recibida de forma consistente,
  - pero lo importante es que el borrador no se rechace por contenido opcional
    ausente o vacío.

Decisión explícita de esta revisión:
- No rechazar borrador por `kind`, `title`, `instruction` vacíos o nulos si se
  permiten como opcionales; únicamente el modelo de lección exige `title` no
  vacío en creación.
- Si una actividad se envía, se valida solo lo que se envía, con las reglas de
  abajo, sin inventar ni requerir campos no enviados.

## 4. Crear borrador

Campos de sesión (resueltos en servidor):
- `academy_id`
- `teacher_id`

Campos de lección:
- `title`: texto no vacío (único obligatorio en este corte)
- `lesson_text`: opcional
- `theme`: opcional
- `level_context`: opcional
- `objective`: opcional
- `methodology`: opcional

Campos de actividades:
- lista opcional
- cada elemento puede incluir:
  - `kind`: opcional; si está presente, puede ser cadena no vacía o vacía; no
    obligatorio
  - `title`: opcional; puede ser cadena no vacía, vacía o ausente
  - `instruction`: opcional; puede ser cadena no vacía, vacía o ausente
  - `order_index`: entero no negativo opcional; si falta, backend asigna orden
    estable
  - `duration_minutes`:
    - ausente: válido
    - `null`: válido
    - presente: finito y estrictamente positivo

Validación mínima:
- `title` no vacío después de recorte
- si una actividad envía `duration_minutes`, es finito y > 0

## 5. SaveRequest

Campos de sesión/contexto:
- `academy_id`
- `lesson_id`
- `teacher_id`

Campos de guardado:
- `expectedRevision`: entero positivo
- `title`: opcional; si se envía, no vacío
- `lesson_text`: opcional
- `theme`: opcional
- `level_context`: opcional
- `objective`: opcional
- `methodology`: opcional
- `activities`: opcional; si se incluye, es el conjunto completo enviado para el
  mismo ámbito en esa transacción

Regla mínima:
- `expectedRevision` obligatorio para guardado mutante
- si `activities` se envía, se trata como reemplazo completo del conjunto de
  actividades del mismo `(academy_id, lesson_id)` en la transacción
- si se envían actividades, cada una usa las reglas de campo opcional anterior

## 6. ReopenRequest / EditRequest

ReopenRequest:
- `academy_id`
- `lesson_id`
- `teacher_id`

EditRequest después de reapertura:
- `academy_id`
- `lesson_id`
- `teacher_id`
- `expectedRevision`
- mismo conjunto de campos opcionales que SaveRequest, con el mismo tratamiento
  de reemplazo completo de actividades cuando se envía

## 7. PreviewRequest

- `academy_id`
- `lesson_id`
- `teacher_id`

Solo lectura de la revisión confirmada. No publica y no cambia estado/versión/contenido.

## 8. Respuestas mínimas

LessonResponse:
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
- `activities`

ActivityResponse:
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

ErrorResponse:
- `code`
- `message`
- opcional: datos de revisión actual para `CONFLICT`

## 9. Validador de actividad — implementación

Política: solo los campos presentes se validan; los campos ausentes o nulos son
permitidos para actividad; solo `duration_minutes` tiene regla semántica fuerte
cuando está presente.

Entrada parcial de actividad:
- `kind?: string`
- `title?: string`
- `instruction?: string`
- `order_index?: number`
- `duration_minutes?: number | null`

```ts
export type ActivityInput = {
  kind?: string | null;
  title?: string | null;
  instruction?: string | null;
  order_index?: number | null;
  duration_minutes?: number | null;
};

export type NormalizedField = string | null;

export type ActivityNormalized = {
  kind: NormalizedField;
  title: NormalizedField;
  instruction: NormalizedField;
  order_index: number | null;
  duration_minutes: number | null;
};

export type ValidationError = {
  field: string;
  reason: string;
};

export function normalizeOptionalText(value: string | null | undefined): NormalizedField {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function validateActivity(input: ActivityInput): ValidationError[] {
  const errors: ValidationError[] = [];

  if (input.order_index !== null && input.order_index !== undefined) {
    if (!Number.isInteger(input.order_index) || input.order_index < 0) {
      errors.push({ field: 'order_index', reason: 'must be a non-negative integer when present' });
    }
  }

  if (input.duration_minutes !== null && input.duration_minutes !== undefined) {
    const value = input.duration_minutes;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      errors.push({ field: 'duration_minutes', reason: 'when present must be finite and strictly positive' });
    }
  }

  return errors;
}

export function normalizeActivity(input: ActivityInput): ActivityNormalized {
  return {
    kind: normalizeOptionalText(input.kind),
    title: normalizeOptionalText(input.title),
    instruction: normalizeOptionalText(input.instruction),
    order_index: input.order_index != null ? input.order_index : null,
    duration_minutes: input.duration_minutes != null ? input.duration_minutes : null,
  };
}
```

Reglas expresadas en código:
- `order_index`, si está presente, entero no negativo.
- `duration_minutes`, si está presente, finito y > 0.
- `kind`, `title`, `instruction`:
  - si están presentes y no nulos, se aceptan tanto cadena no vacía como vacía;
  - no se tratan como error de validación en esta revisión.
- `normalizeActivity` convierte entrada en la forma canónica usada para guardado y
  para el hash canónico; campos ausentes/nulos pasan a null, strings no vacíos se
  recortan.

## 10. Normalización de conjunto de actividades

El conjunto de actividades se normaliza y luego se canoniza por orden para uso en
creación/guardado y para el hash de petición.

```ts
export function normalizeActivities(
  input: readonly ActivityInput[] | null | undefined,
): ActivityNormalized[] {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeActivity);
}

export function canonicalOrder(activities: readonly ActivityNormalized[]): readonly ActivityNormalized[] {
  return [...activities].sort((a, b) => {
    const ai = a.order_index ?? -1;
    const bi = b.order_index ?? -1;
    if (ai !== bi) return ai - bi;
    const at = a.title ?? '';
    const bt = b.title ?? '';
    if (at !== bt) return at < bt ? -1 : 1;
    const ak = a.kind ?? '';
    const bk = b.kind ?? '';
    if (ak !== bk) return ak < bk ? -1 : 1;
    const ai2 = a.instruction ?? '';
    const bi2 = b.instruction ?? '';
    if (ai2 !== bi2) return ai2 < bi2 ? -1 : 1;
    const ad = a.duration_minutes ?? -1;
    const bd = b.duration_minutes ?? -1;
    return ad - bd;
  });
}
```

Reglas:
- `normalizeActivities` retorna un arreglo vacío para entrada ausente/nula/no array.
- `canonicalOrder` ordena por `order_index` ascendente (null antes que cualquier
  valor presente), con desempates deterministas por título, kind, instrucción y
  duración.
- La misma lista de actividades presentada en diferente orden de envío produce el
  mismo conjunto canonizado.

## 11. Validador de lección

Regla solo para `title` en creación:
- obligatorio en creación
- no vacío después de recorte

Campos opcionales:
- `lesson_text`, `theme`, `level_context`, `objective`, `methodology`
- presentes, nulos o vacíos: aceptados como opcionales
- no se rechaza el borrador por falta de ellos

```ts
export type LessonDraftInput = {
  title: string;
  lesson_text?: string | null;
  theme?: string | null;
  level_context?: string | null;
  objective?: string | null;
  methodology?: string | null;
  activities?: readonly ActivityInput[];
};

export function validateLessonDraft(input: LessonDraftInput): ValidationError[] {
  const errors: ValidationError[] = [];

  const title = normalizeOptionalText(input.title);
  if (title === null || title === '') {
    errors.push({ field: 'title', reason: 'must be a non-empty title' });
    return errors;
  }

  if (Array.isArray(input.activities)) {
    input.activities.forEach((activity, index) => {
      const activityErrors = validateActivity(activity);
      activityErrors.forEach((err) => {
        errors.push({ field: `activities[${index}].${err.field}`, reason: err.reason });
      });
    });
  }

  return errors;
}

export function normalizeCreateDraft(input: LessonDraftInput): {
  title: string;
  lesson_text: NormalizedField;
  theme: NormalizedField;
  level_context: NormalizedField;
  objective: NormalizedField;
  methodology: NormalizedField;
  activities: ActivityNormalized[];
} {
  return {
    title: normalizeOptionalText(input.title),
    lesson_text: normalizeOptionalText(input.lesson_text),
    theme: normalizeOptionalText(input.theme),
    level_context: normalizeOptionalText(input.level_context),
    objective: normalizeOptionalText(input.objective),
    methodology: normalizeOptionalText(input.methodology),
    activities: normalizeActivities(input.activities),
  };
}
```

## 12. Validador de guardado

- `expectedRevision` obligatorio positivo.
- Campos opcionales se validan solo si se envían.
- Las actividades se validan campo por campo.
- La salida normalizada se usa tanto para la mutación como para el hash canónico.

```ts
export type SaveRequestInput = {
  expectedRevision: number;
  title?: string | null;
  lesson_text?: string | null;
  theme?: string | null;
  level_context?: string | null;
  objective?: string | null;
  methodology?: string | null;
  activities?: readonly ActivityInput[];
};

export function validateSaveRequest(input: SaveRequestInput): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision <= 0) {
    errors.push({
      field: 'expectedRevision',
      reason: 'must be a positive integer',
    });
  }

  if (input.title !== null && input.title !== undefined) {
    const title = normalizeOptionalText(input.title);
    if (title === null || title === '') {
      errors.push({ field: 'title', reason: 'when provided must be a non-empty title' });
    }
  }

  if (Array.isArray(input.activities)) {
    input.activities.forEach((activity, index) => {
      const activityErrors = validateActivity(activity);
      activityErrors.forEach((err) => {
        errors.push({ field: `activities[${index}].${err.field}`, reason: err.reason });
      });
    });
  }

  return errors;
}

export function normalizeSaveRequest(input: SaveRequestInput): {
  title: NormalizedField;
  lesson_text: NormalizedField;
  theme: NormalizedField;
  level_context: NormalizedField;
  objective: NormalizedField;
  methodology: NormalizedField;
  activities: ActivityNormalized[];
} {
  return {
    title: normalizeOptionalText(input.title),
    lesson_text: normalizeOptionalText(input.lesson_text),
    theme: normalizeOptionalText(input.theme),
    level_context: normalizeOptionalText(input.level_context),
    objective: normalizeOptionalText(input.objective),
    methodology: normalizeOptionalText(input.methodology),
    activities: normalizeActivities(input.activities),
  };
}
```

## 13. Validador de duración

Rechaza solo:
- ausente/nulo: válido
- presente: `typeof value !== 'number' || !Number.isFinite(value) || value <= 0`

```ts
export function validateDuration(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
```

## 14. Hash canónico de petición para idempotencia

El hash canónico se usa como clave del significado de idempotentes. El mismo
`operationKind` y la misma petición canonizada producen el mismo hash; los cambios
en cualquier componente relevante producen un hash distinto.

Canonización mínima incluida en el hash:
- `operation_kind`
- `academy_id`
- `teacher_id`
- `lesson_id` (solo para save)
- `expected_revision`
- `payload` canonizado: mismo orden de claves, números como cadenas decimales sin
  notación científica, textos recortados y normalizados con la misma regla que el
  servicio, y conjunto de activities ordenado con `canonicalOrder` antes de
  calcular el hash.

Requisito de la clave:
- El `request_hash` de `mutation_dedup` se construye a partir de los mismos
  componentes que este hash canónico.
- Una petición idéntica produce el mismo hash; una petición distinta produce un hash
  distinto; por lo tanto el servidor no confunde operaciones diferentes con el mismo
  `operation_kind` solo porque compartan ámbito.

```ts
export type IdempotencyKeyInput = {
  operationKind: 'create_lesson' | 'save_lesson';
  academyId: string;
  teacherId: string;
  lessonId?: string;
  expectedRevision: number;
  payload: unknown;
};

export async function canonicalRequestHash(input: IdempotencyKeyInput): Promise<Uint8Array> {
  const normalizedPayload =
    input.operationKind === 'save_lesson'
      ? canonicalOrder(normalizeActivities(input.payload as SaveRequestInput['activities']).map((a) => ({
          kind: normalizeOptionalText(a.kind ?? null),
          title: normalizeOptionalText(a.title ?? null),
          instruction: normalizeOptionalText(a.instruction ?? null),
          order_index: a.order_index != null ? a.order_index : null,
          duration_minutes: a.duration_minutes != null ? a.duration_minutes : null,
        })))
      : canonicalOrder(normalizeActivities(input.payload as LessonDraftInput['activities'] ?? []).map((a) => ({
          kind: normalizeOptionalText(a.kind ?? null),
          title: normalizeOptionalText(a.title ?? null),
          instruction: normalizeOptionalText(a.instruction ?? null),
          order_index: a.order_index != null ? a.order_index : null,
          duration_minutes: a.duration_minutes != null ? a.duration_minutes : null,
        })));

  const object: Record<string, unknown> = {
    operation_kind: input.operationKind,
    academy_id: input.academyId,
    teacher_id: input.teacherId,
  };

  if (input.lessonId != null) object.lesson_id = input.lessonId;
  object.expected_revision = input.expectedRevision;
  object.payload = normalizedPayload;

  const json = JSON.stringify(object);
  const encoder = new TextEncoder();
  const data = encoder.encode(json);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
}
```

Reglas expresadas en código:
- El hash se calcula sobre la representación JSON canonizada de la petición.
- El mismo input produce el mismo `Uint8Array` de 32 octetos.
- Cambios en `operationKind`, `academyId`, `teacherId`, `lessonId`, `expectedRevision`
  o cualquier actividad normalizada producen hash distinto.
- La canonización de actividades garantiza que listas equivalentes con distinto orden
  de envío producen el mismo hash.
- `canonicalRequestHash` no es blocking en principio de ejecución; si el servicio
  elige SHA-256 síncrono, debe usar un wrapper equivalente.

## 15. Protocolo de save y replay

Este servicio propone el protocolo mínimo para save con idempotencia semántica.

### Requisitos generales

- Save se ejecuta en una transacción ACID que incluye: lectura de la lección actual,
  comparación CAS de `expectedRevision`, actualización de lección, actualización del
  conjunto de actividades para el mismo `(academy_id, lesson_id)` y escritura del
  registro de deduplication.
- La respuesta mínima de save se construye y se guarda UNA VEZ dentro de esa
  transacción, antes o durante el commit; no se recomputa ni se re-leen datos para
  el replay.
- Si el save es confirmado, la respuesta guardada se retorna textualmente para
  `IDEMPOTENT_REPLAY` si el servidor recibe el mismo `operationKind` + requestHash
  válido.
- Para save que falla por payload no válido, el servidor retorna error normal y NO
  escribe registro de `mutation_dedup` con respuesta de éxito.
- Para save que falla por `expectedRevision` incorrecto, el servidor retorna
  `CONFLICT` sin modificar lección ni activities ni escribir registro de
  `mutation_dedup`.

### Guardado por primera vez

1. Servidor valida `SaveRequest` completo con el validador de petición.
2. Transacción abre y lee lección + revision actual para `(academy_id, lesson_id)`.
3. Transacción compara `expectedRevision` con la revision actual; si no coinciden -
   rollback y respuesta `CONFLICT`.
4. Si la revisión actual coincide, transacción aplica el nuevo título/fields
   opcionales y el nuevo conjunto de actividades normalizado para ese lesson y ámbito.
5. Transacción calcula `requestHash` sobre la misma petición canonizada usada en
   `canonicalRequestHash`.
6. Transacción escribe o actualiza `mutation_dedup` para esa `operation_key` con el
   `requestHash` aplicado, la `committed_revision` y la respuesta mínima.
7. Transacción commita, y el servidor retorna la respuesta mínima guardada.

### Respuesta de replay semántica

- Si una nueva petición llega con el mismo `operationKind` + `requestHash` que ya
  existe en `mutation_dedup` como resultado confirmado, el servidor retorna la misma
  respuesta mínima guardada.
- El servidor no vuelve a ejecutar la mutación ni vuelve a calcular la respuesta.
- Si el servidor puede retornar `IDEMPOTENT_REPLAY` textualmente desde el registro,
  lo hace y no cambia la lección ni las activities.

### Rechazo por clave reutilizada

- Si la transacción encuentra la misma `operation_key` con un `requestHash` distinto
  al entrante, el servidor rechaza con `IDEMPOTENT_KEY_REUSED` y no aplica la
  mutación.
- Esa regla preserva que una clave semántica no se sobreescriba con otra operación.

### Nota de implementación sobre concurrentes

- La consulta de existencia del registro en `mutation_dedup` y la operación de guardar
  deben ocurrir bajo la misma transacción y el mismo cierre de concurrencia que la
  actualización de lección/activities.
- La implementación concreta (SELECT FOR UPDATE, bloqueo de fila, llave única con
  upsert atómico, etc.) se elige en el corte de migración; esta propuesta solo fija
  que la validación, la mutación y el idempotente no puedan separarse en pasos
  eventualmente consistency.

```ts
export type MutationDedupResponse = {
  lesson_id: string;
  committed_revision: number;
  status: string;
};

export function buildSavedResponse(input: {
  lessonId: string;
  committedRevision: number;
  status: string;
}): MutationDedupResponse {
  return {
    lesson_id: input.lessonId,
    committed_revision: input.committedRevision,
    status: input.status,
  };
}
```

Reglas expresadas en código:
- La respuesta guardada se construye UNA VEZ al confirmar la operación.
- El mismo estado confirmado produce la misma respuesta guardada.
- El servidor retorna esa respuesta textualmente para `IDEMPOTENT_REPLAY` sin
  recomputar, revalidar ni re-leer estado.
- El servicio define si se incluye más o menos; esta propuesta es solo la forma
  mínima sugerida.

## 16. Conflictos/replicación en DTO

- toda mutación que avanza revisión usa `expectedRevision`;
- si la comparación atómica falla, respuesta `CONFLICT` sin modificar lesson ni
  activities;
- no se acepta reintento automático de escritura con `expectedRevision` actualizado
  por servidor.

## 17. Reglas mínimas de colección de actividades

- orden único dentro del borrador por `(academy_id, lesson_id, order_index)`;
- guardado exitoso sincroniza el conjunto completo enviado para el ámbito;
- borrador sin actividades es lista vacía válida;
- si se elimina o reordena, el conjunto restante mantiene orden coherente.

## 19. Pendientes de aprobación externa

Pendiente de Arquitectura / UX / Cian:
- forma exacta del registro de deduplicación y el formato de respuesta guardada;
- mecanismo concreto de coordinación de concurrencia de save;
- formato de respuesta mínima que el servicio expondrá oficialmente;
- alcance real de validación/derivación de llave en servidor;
- decisión de si la plataforma prefiere SHA canónico asíncrono o síncrono.

Esta propuesta no ejecuta ni aprueba esos puntos; fija solo el contrato mínimo
necesario para que el servidor sea coherente entre validación, mutación,
idempotencia y reproducibilidad de respuesta.