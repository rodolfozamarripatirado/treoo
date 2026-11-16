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

export type ValidationError = {
  field: string;
  reason: string;
};

export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = typeof value === 'string' ? value.trim() : '';
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
```

Reglas expresadas en código:
- `order_index`, si está presente, entero no negativo.
- `duration_minutes`, si está presente, finito y > 0.
- `kind`, `title`, `instruction`:
  - si están presentes y no nulos, se aceptan tanto cadena no vacía como vacía;
  - no se tratan como error de validación en esta revisión.

## 10. Validador de lección

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
  activities?: ActivityInput[];
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
```

## 11. Validador de duración

Rechaza solo:
- ausente/nulo: válido
- presente: `typeof value !== 'number' || !Number.isFinite(value) || value <= 0`

```ts
export function validateDuration(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
```

## 12. Normalización consistente para borrador

Regla mínima para FE/BE:
- opcionales se aceptan como nulo, vacío o cadena no vacía;
- si el modelo almacena nulos, cadena vacía se normaliza a nulo;
- si el modelo almacena texto, cadena vacía se conserva como texto vacío;
- la decisión se aplica de forma consistente en lectura y escritura;
- lo rechazado es contenido obligatorio faltante o inválido, no ausencia de
  opcionales.

## 13. Validación de ámbito

- `academy_id` y `teacher_id` deben coincidir con la sesión resuelta.
- la operación solo procede si la lección bajo estudio pertenece a ese mismo
  `(academy_id, teacher_id)`.
- Ningún payload puede cambiar `academy_id` en la operación sin remodelación
  explícita autorizada; eso está fuera del corte manual.

## 14. Conflictos/replicación en DTO

- toda mutación que avanza revisión usa `expectedRevision`;
- si la comparación atómica falla, respuesta `CONFLICT` sin modificar lesson ni
  activities;
- no se acepta reintento automático de escritura con `expectedRevision` actualizado
  por servidor.

## 15. Reglas mínimas de colección de actividades

- orden único dentro del borrador por `(academy_id, lesson_id, order_index)`;
- guardado exitoso sincroniza el conjunto completo enviado para el ámbito;
- borrador sin actividades es lista vacía válida;
- si se elimina o reordena, el conjunto restante mantiene orden coherente.