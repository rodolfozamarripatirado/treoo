/**
 * US-A-003 — Validator implementation (propuesta).
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

export type LessonDraftInput = {
  title: string;
  lesson_text?: string | null;
  theme?: string | null;
  level_context?: string | null;
  objective?: string | null;
  methodology?: string | null;
  activities?: readonly ActivityInput[];
};

export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

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

export function validateDuration(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

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
        errors.push({
          field: `activities[${index}].${err.field}`,
          reason: err.reason,
        });
      });
    });
  }

  return errors;
}