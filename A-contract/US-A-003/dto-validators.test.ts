// US-A-003 validator tests — self-contained ESM module for Node 24.
// Implementation inline here so the published files are standalone and runnable
// without a build/compilation step.

type ActivityInput = {
  kind?: string | null;
  title?: string | null;
  instruction?: string | null;
  order_index?: number | null;
  duration_minutes?: number | null;
};

type ValidationError = {
  field: string;
  reason: string;
};

type LessonDraftInput = {
  title: string;
  lesson_text?: string | null;
  theme?: string | null;
  level_context?: string | null;
  objective?: string | null;
  methodology?: string | null;
  activities?: readonly ActivityInput[];
};

type SaveRequestInput = {
  expectedRevision: number;
  title?: string | null;
  lesson_text?: string | null;
  theme?: string | null;
  level_context?: string | null;
  objective?: string | null;
  methodology?: string | null;
  activities?: readonly ActivityInput[];
};

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function validateActivity(input: ActivityInput): ValidationError[] {
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

function validateLessonDraft(input: LessonDraftInput): ValidationError[] {
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

function validateDuration(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validateSaveRequest(input: SaveRequestInput): ValidationError[] {
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

type TestResult = Array<{ description: string; pass: boolean; errors?: ValidationError[] }>;

function testLessonDraft(name: string, input: LessonDraftInput, expectedErrors: number): TestResult {
  const errors = validateLessonDraft(input);
  const pass = errors.length === expectedErrors;
  return [{ description: name, pass, errors }];
}

function testActivity(name: string, input: ActivityInput, expectedErrors: number): TestResult {
  const errors = validateActivity(input);
  const pass = errors.length === expectedErrors;
  return [{ description: name, pass, errors }];
}

function testDuration(name: string, value: unknown, expectedValid: boolean): TestResult {
  const valid = validateDuration(value);
  const pass = valid === expectedValid;
  return [{ description: name, pass }];
}

function testSave(name: string, input: SaveRequestInput, expectedErrors: number): TestResult {
  const errors = validateSaveRequest(input);
  const pass = errors.length === expectedErrors;
  return [{ description: name, pass, errors }];
}

export const lessonDraftTests: TestResult[] = [
  ...testLessonDraft('title required', { title: '' }, 1),
  ...testLessonDraft('title required whitespace', { title: '   ' }, 1),
  ...testLessonDraft('valid title only', { title: 'present perfect' }, 0),
  ...testLessonDraft('valid title with null theme', { title: 'present perfect', theme: null }, 0),
  ...testLessonDraft('valid title with empty theme', { title: 'present perfect', theme: '' }, 0),
  ...testLessonDraft('valid title with undefined theme', { title: 'present perfect', theme: undefined }, 0),
  ...testLessonDraft('valid title with activities empty', { title: 'present perfect', activities: [] }, 0),
  ...testLessonDraft('valid partial activity', { title: 'present perfect', activities: [{ duration_minutes: null }] }, 0),
  ...testLessonDraft('valid activity with fraction duration', { title: 'present perfect', activities: [{ duration_minutes: 0.5 }] }, 0),
  ...testLessonDraft('valid activity with empty kind', { title: 'present perfect', activities: [{ kind: '', title: '' }] }, 0),
  ...testLessonDraft('invalid zero duration', { title: 'present perfect', activities: [{ duration_minutes: 0 }] }, 1),
  ...testLessonDraft('invalid negative duration', { title: 'present perfect', activities: [{ duration_minutes: -1 }] }, 1),
  ...testLessonDraft('invalid NaN duration', { title: 'present perfect', activities: [{ duration_minutes: Number.NaN }] }, 1),
  ...testLessonDraft('invalid Infinity duration', { title: 'present perfect', activities: [{ duration_minutes: Number.POSITIVE_INFINITY }] }, 1),
  ...testLessonDraft('invalid order_index negative', { title: 'present perfect', activities: [{ order_index: -1 }] }, 1),
  ...testLessonDraft('invalid order_index float', { title: 'present perfect', activities: [{ order_index: 1.5 }] }, 1),
  ...testLessonDraft('mixed valid and invalid activities', {
    title: 'present perfect',
    activities: [
      { duration_minutes: 0.5 },
      { duration_minutes: 0 },
    ],
  }, 1),
  ...testLessonDraft('activity order_index null allowed', { title: 'present perfect', activities: [{ order_index: null }] }, 0),
  ...testLessonDraft('activity duration undefined allowed', { title: 'present perfect', activities: [{ duration_minutes: undefined }] }, 0),
];

export const activityTests: TestResult[] = [
  ...testActivity('null duration allowed', { duration_minutes: null }, 0),
  ...testActivity('undefined duration allowed', { duration_minutes: undefined }, 0),
  ...testActivity('empty kind allowed', { kind: '' }, 0),
  ...testActivity('null kind allowed', { kind: null }, 0),
  ...testActivity('empty title allowed', { title: '' }, 0),
  ...testActivity('empty instruction allowed', { instruction: '' }, 0),
  ...testActivity('all fields null', { kind: null, title: null, instruction: null, duration_minutes: null, order_index: null }, 0),
  ...testActivity('valid order_index zero', { order_index: 0 }, 0),
  ...testActivity('invalid order_index negative', { order_index: -1 }, 1),
  ...testActivity('invalid order_index float', { order_index: 2.5 }, 1),
  ...testActivity('invalid zero duration', { duration_minutes: 0 }, 1),
  ...testActivity('invalid negative duration', { duration_minutes: -0.5 }, 1),
  ...testActivity('invalid Infinity duration', { duration_minutes: Number.POSITIVE_INFINITY }, 1),
  ...testActivity('invalid NaN duration', { duration_minutes: Number.NaN }, 1),
];

export const durationTests: TestResult[] = [
  ...testDuration('null valid', null, true),
  ...testDuration('undefined valid', undefined, true),
  ...testDuration('positive integer valid', 30, true),
  ...testDuration('positive float valid', 0.5, true),
  ...testDuration('zero invalid', 0, false),
  ...testDuration('negative invalid', -1, false),
  ...testDuration('NaN invalid', Number.NaN, false),
  ...testDuration('Infinity invalid', Number.POSITIVE_INFINITY, false),
  ...testDuration('string invalid', '30', false),
  ...testDuration('object invalid', {}, false),
];

export const saveTests: TestResult[] = [
  ...testSave('expectedRevision required', { expectedRevision: 0 }, 1),
  ...testSave('expectedRevision must be positive', { expectedRevision: -1 }, 1),
  ...testSave('expectedRevision float invalid', { expectedRevision: 2.5 }, 1),
  ...testSave('valid save with only expectedRevision', { expectedRevision: 1 }, 0),
  ...testSave('valid save with empty title cleared', { expectedRevision: 1, title: '' }, 1),
  ...testSave('valid save with null title kept', { expectedRevision: 1, title: null }, 0),
  ...testSave('valid save with title and null activities', { expectedRevision: 1, title: 'present perfect', activities: null }, 0),
  ...testSave('invalid activity in save', { expectedRevision: 1, title: 'present perfect', activities: [{ duration_minutes: 0 }] }, 1),
  ...testSave('valid save partial activity empty strings', { expectedRevision: 1, title: 'present perfect', activities: [{ kind: '', title: '' }] }, 0),
];

export const normalizeTests: TestResult[] = [
  { description: 'null stays null', pass: normalizeOptionalText(null) === null },
  { description: 'undefined stays null', pass: normalizeOptionalText(undefined) === null },
  { description: 'empty string becomes null', pass: normalizeOptionalText('') === null },
  { description: 'whitespace becomes null', pass: normalizeOptionalText('   ') === null },
  { description: 'trimmed non-empty preserved', pass: normalizeOptionalText('  present perfect  ') === 'present perfect' },
  { description: 'non-string becomes null', pass: normalizeOptionalText(42) === null },
];

export function runAll(): TestResult[] {
  return [
    ...lessonDraftTests,
    ...activityTests,
    ...durationTests,
    ...saveTests,
    ...normalizeTests,
  ];
}

export function summary(results: TestResult[]): { total: number; passed: number; failed: number } {
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const failed = total - passed;
  return { total, passed, failed };
}

if (typeof process !== 'undefined' && process.argv) {
  const results = runAll();
  const { total, passed, failed } = summary(results);
  const failures = results.filter((r) => !r.pass);

  console.log(`US-A-003 validator tests: ${passed}/${total} passed`);

  if (failures.length > 0) {
    console.log('FAILURES:');
    failures.forEach((f) => {
      const detail = f.errors && f.errors.length > 0 ? ` errors=${JSON.stringify(f.errors)}` : '';
      console.log(`  - ${f.description}${detail}`);
    });
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}