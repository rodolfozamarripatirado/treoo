/**
 * US-A-003 — DTO/validator implementation (propuesta).
 *
 * Forma cerrada de DEC-A-002:
 * - único campo obligatorio en creación de lección: title
 * - borrador puede tener cero actividades
 * - actividad parcial válida: campos opcionales pueden ausentarse, ser null o vacíos
 * - duración:
 *   - ausente: válido
 *   - null: válido
 *   - presente: finito y estrictamente positivo
 *
 * Normalización de texto opcional:
 * - null/undefined -> null
 * - cadena vacía -> null (consistente con almacenamiento nulo)
 * - cadena no vacía -> cadena recortada
 *
 * Estado: propuesto, pendiente revisión de Arquitectura/Datos/Cian.
 */

export type NormalizedField = string | null;

export type ValidationOutcome = {
  ok: boolean;
  errors: ValidationError[];
  normalized: NormalizedField;
};

export type Presentness = 'absent' | 'provided-null' | 'provided-empty' | 'provided-value';

export function classifyOptionalText(
  value: string | null | undefined,
): { normalized: NormalizedField; presentness: Presentness } {
  if (value === null) return { normalized: null, presentness: 'provided-null' };
  if (value === undefined) return { normalized: null, presentness: 'absent' };
  if (typeof value !== 'string') return { normalized: null, presentness: 'provided-null' };
  const trimmed = value.trim();
  if (trimmed === '') return { normalized: null, presentness: 'provided-empty' };
  return { normalized: trimmed, presentness: 'provided-value' };
}

export function validateOptionalText(
  value: string | null | undefined,
  fieldName = 'title',
): ValidationOutcome {
  const { normalized, presentness } = classifyOptionalText(value);
  const errors: ValidationError[] = [];
  if (presentness === 'provided-null' || presentness === 'provided-empty') {
    errors.push({ field: fieldName, reason: 'when provided must be a non-empty title' });
  }
  return { ok: errors.length === 0, errors, normalized };
}

export type ActivityInput = {
  kind?: string | null;
  title?: string | null;
  instruction?: string | null;
  order_index?: number | null;
  duration_minutes?: number | null;
};
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
export type IdempotencyKeyInput = {
  operationKind: 'create_lesson' | 'save_lesson';
  academyId: string;
  teacherId: string;
  lessonId?: string;
  expectedRevision: number;
  payload: unknown;
};
export type LessonDraftInput = {
  title: string;
  lesson_text?: string | null;
  theme?: string | null;
  level_context?: string | null;
  objective?: string | null;
  methodology?: string | null;
  activities?: readonly ActivityInput[];
};
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
export type NormalizedCreatePayload = {
  title: string;
  lesson_text: NormalizedField;
  theme: NormalizedField;
  level_context: NormalizedField;
  objective: NormalizedField;
  methodology: NormalizedField;
  activities: ActivityNormalized[];
};
export type NormalizedSavePayload = {
  title: NormalizedField;
  lesson_text: NormalizedField;
  theme: NormalizedField;
  level_context: NormalizedField;
  objective: NormalizedField;
  methodology: NormalizedField;
  activities: ActivityNormalized[];
};

/**
 * Normaliza texto opcional para lectura/escritura.
 * - null/undefined -> null
 * - cadena vacía -> null
 * - cadena no vacía -> recortada
 */
export function normalizeOptionalText(value: string | null | undefined): NormalizedField {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Valida una actividad solo por campos presentes.
 * Campos ausentes/nulos son válidos; solo order_index y duration_minutes tienen
 * reglas semánticas cuando están presentes.
 */
export function validateActivity(input: ActivityInput): ValidationError[] {
  const errors: ValidationError[] = [];

  if (input.order_index !== null && input.order_index !== undefined) {
    if (!Number.isInteger(input.order_index) || input.order_index < 0) {
      errors.push({
        field: 'order_index',
        reason: 'must be a non-negative integer when present',
      });
    }
  }

  if (input.duration_minutes !== null && input.duration_minutes !== undefined) {
    const value = input.duration_minutes;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      errors.push({
        field: 'duration_minutes',
        reason: 'when present must be finite and strictly positive',
      });
    }
  }

  return errors;
}

/**
 * Normaliza una actividad enviada a la forma usada por el servicio.
 * Campos ausentes/nulos pasan a null; strings no vacíos se recortan.
 */
export function normalizeActivity(input: ActivityInput): ActivityNormalized {
  return {
    kind: normalizeOptionalText(input.kind),
    title: normalizeOptionalText(input.title),
    instruction: normalizeOptionalText(input.instruction),
    order_index: input.order_index != null ? input.order_index : null,
    duration_minutes: input.duration_minutes != null ? input.duration_minutes : null,
  };
}

/**
 * Valida y normaliza un conjunto de actividades como el reemplazo completo para un
 * ámbito. El resultado es el conjunto canónico usado para guardado y para el hash
 * canónico de la petición.
 */
export function normalizeActivities(
  input: readonly ActivityInput[] | null | undefined,
): ActivityNormalized[] {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeActivity);
}

/**
 * Produce un valor comparable y serializable para el hash de la petición.
 * Conserva el orden semántico original del payload cuando no exista otro
 * criterio diferenciador y conserva el contenido completo del conjunto.
 */
export interface CanonicalPayloadActivities {
  readonly leaf: ActivityNormalized;
  readonly originalIndex: number;
}

export function canonicalActivitiesForHash(
  activities: readonly ActivityNormalized[],
): readonly CanonicalPayloadActivities[] {
  return activities.map((leaf, originalIndex) => ({ leaf, originalIndex }));
}

export function serializeCanonicalPayloadActivities(
  activities: readonly CanonicalPayloadActivities[],
): readonly ActivityNormalized[] {
  return activities.map((item) => item.leaf);
}
/**
 * Valida un borrador de lección. Único obligatorio: title no vacío.
 * Las actividades se validan campo por campo; cero actividades es válido.
 */
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
        errors.push({
          field: `activities[${index}].${err.field}`,
          reason: err.reason,
        });
      });
    });
  }

  return errors;
}

/**
 * Validador numérico reutilizable de duración.
 * - ausente/nulo: válido
 * - presente: finito y estrictamente positivo
 */
export function validateDuration(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Valida una petición de guardado. expectedRevision obligatorio positivo.
 * title solo se valida si se envía. Las actividades se validan campo por campo.
 */
export function validateSaveRequest(input: SaveRequestInput): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision <= 0) {
    errors.push({
      field: 'expectedRevision',
      reason: 'must be a positive integer',
    });
  }

  const titleOutcome = validateOptionalText(input.title);
  errors.push(...titleOutcome.errors);

  if (input.activities !== null && input.activities !== undefined) {
    if (!Array.isArray(input.activities)) {
      errors.push({
        field: 'activities',
        reason: 'when present must be an array',
      });
    } else {
      input.activities.forEach((activity, index) => {
        const activityErrors = validateActivity(activity);
        activityErrors.forEach((err) => {
          errors.push({
            field: `activities[${index}].${err.field}`,
            reason: err.reason,
          });
        });
      });
    }
  }

  return errors;
}

/**
 * Normaliza un SaveRequestInput a la forma canónica usada por el servicio y por el
 * hash canónico de la petición.
 *
 * Contrato corregido:
 * - si se envía title, debe ser un título no vacío; null/vacio se rechazan.
 * - si se envía activities, debe ser un array; el resto de campos opcionales se
 *   normalizan sin exterminar información.
 * - la actividad y el orden semántico del payload completo se conservan antes del
 *   hash y antes del guardado.
 */
export function normalizeSaveRequest(input: SaveRequestInput): NormalizedSavePayload {
  const titleOutcome = validateOptionalText(input.title);
  const normalizedTitle = titleOutcome.normalized;
  if (!titleOutcome.ok) {
    throw new Error('normalizeSaveRequest received an invalid title');
  }

  let normalizedActivities: ActivityNormalized[];
  if (input.activities !== null && input.activities !== undefined) {
    if (!Array.isArray(input.activities)) {
      throw new Error('normalizeSaveRequest received a non-array activities value');
    }
    normalizedActivities = normalizeActivities(input.activities);
  } else {
    normalizedActivities = [];
  }

  return {
    title: normalizedTitle,
    lesson_text: normalizeOptionalText(input.lesson_text),
    theme: normalizeOptionalText(input.theme),
    level_context: normalizeOptionalText(input.level_context),
    objective: normalizeOptionalText(input.objective),
    methodology: normalizeOptionalText(input.methodology),
    activities: normalizedActivities,
  };
}

/**
 * Normaliza un borrador de lección a la forma canónica usada por el servicio y por
 * el hash canónico de la petición.
 */
export function normalizeCreateDraft(input: LessonDraftInput): NormalizedCreatePayload {
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

/**
 * Candidato de fila de deduplicación usada por el servidor para crear o actualizar la
 * tabla treoo.mutation_dedup en la misma transacción que la mutación.
 *
 * Campos no negociables del contrato:
 * - operationKind y requestHash juntos determinan si una clave existente se reutiliza
 *   como replay o se rechaza como IDEMPOTENCY_KEY_REUSED.
 * - committedRevision es la revisión confirmada tras el commit, no la esperada.
 * - responseJson es el cuerpo mínimo necesario para reproducir la respuesta original;
 *   el servicio define su forma exacta; esta unidad no lo ejecuta ni lo aprueba.
 */
export type MutationDedupRowInput = {
  academyId: string;
  teacherId: string;
  operationKey: string;
  operationKind: 'create_lesson' | 'save_lesson';
  requestHash: ArrayLike<number>;
  lessonId: string;
  committedRevision: number;
  responseJson: unknown;
};

/**
 * SHA-256 canónico de la petición normalizada.
 *
 * La canonización de payload se elige por consistencia entre cliente y servicio;
 * esta función solo ejerce esa canonización y el hash. No cambia el significado de
 * idempotentes: mismos operationKind + mismos datos canonizados producen el mismo
 * requestHash.
 */
export async function canonicalRequestHash(input: IdempotencyKeyInput): Promise<Uint8Array> {
  function normalizeSaveActivity(a: any): any {
    return {
      kind: normalizeOptionalText(a.kind ?? null),
      title: normalizeOptionalText(a.title ?? null),
      instruction: normalizeOptionalText(a.instruction ?? null),
      order_index: a.order_index != null ? a.order_index : null,
      duration_minutes: a.duration_minutes != null ? a.duration_minutes : null,
    };
  }

  const rawPayload =
    input.operationKind === 'save_lesson'
      ? (input.payload as SaveRequestInput)
      : (input.payload as LessonDraftInput);

  const normalizedPayload =
    input.operationKind === 'save_lesson'
      ? serializeCanonicalPayloadActivities(
          canonicalActivitiesForHash(
            normalizeActivities(rawPayload.activities).map(normalizeSaveActivity),
          ),
        )
      : serializeCanonicalPayloadActivities(
          canonicalActivitiesForHash(
            normalizeActivities(rawPayload.activities ?? []).map((a) => ({
              kind: normalizeOptionalText(a.kind ?? null),
              title: normalizeOptionalText(a.title ?? null),
              instruction: normalizeOptionalText(a.instruction ?? null),
              order_index: a.order_index != null ? a.order_index : null,
              duration_minutes: a.duration_minutes != null ? a.duration_minutes : null,
            })),
          ),
        );

  const object: Record<string, unknown> = {
    operation_kind: input.operationKind,
    academy_id: input.academyId,
    teacher_id: input.teacherId,
    lesson_id: input.lessonId ?? null,
    expected_revision: input.expectedRevision,
    payload: normalizedPayload,
  };

  const json = JSON.stringify(object);
  const encoder = new TextEncoder();
  const data = encoder.encode(json);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
}

/**
 * Representación de la respuesta mínima guardada en mutation_dedup para replay.
 *
 * Forma sugerida para revisión de Arquitectura/PO (no ejecutada aquí):
 *   - lesson_id
 *   - committed_revision
 *   - status
 *   - opcional: payload mínimo de respuesta sin datos sensibles innecesarios
 */
export type MutationDedupResponse = {
  lesson_id: string;
  committed_revision: number;
  status: string;
};

/**
 * Candidato de respuesta de replay construido desde el validation aprobado. El
 * servicio debe guardar esta forma (o otra acordada) en mutation_dedup.response_json
 * y reutilizarla textualmente en IDEMPOTENT_REPLAY.
 */
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

export type SerializedCanonicalPayload = readonly ActivityNormalized[];
