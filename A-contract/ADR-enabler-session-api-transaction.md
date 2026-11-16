# ADR enabler — session, API, transaction boundary, error contract

Status: propuesta técnica, pendiente de Arquitectura/UX.
Not an approval of application stories, not executable SQL, not a running service.

This ADR is an enabler artifact: it records a concrete proposal for the same
stack already in play (Node 24 / TypeScript / Fastify / pg / React-Vite) and aligns
it with accepted parts of HU001, HU002v0.2, HU003, HU004.

## 1. Design goals

- Authoritative actor and scope come from the server-resolved session, not from
  free-form body fields.
- Unsafe mutations only proceed through an idempotent operation key with a CAS on
  `expectedRevision` inside one ACID transaction.
- Client-visible contract is small, stable, and inspectable from docs and tests.
- Cookie/session can be revoked; a revoked session must fail closed.

## 2. Accepted narrative alignment

From accepted acceptance context:

- HU001: an authenticated teacher works within an academy.
- HU002v0.2: the teacher can create and save a lesson draft; save increments
  revision and replaces the activity set atomically; concurrent save produces a
  conflict.
- HU003/004: the same boundary supports preview and scoped reads.

We treat those as narrative constraints, not as a commitment to ship every
flow today.

## 3. Session and authorization source of truth

Proposal:
- Session identity is a signed cookie issued by the server after login.
- The cookie carries at least:
  - `teacher_id`
  - `academy_id`
  - expiry and revocation binding
- Every mutating and read endpoint accepts the request only after the server
  validates the cookie and resolves the auth context from it.
- Authorization decisions use the resolved `(academy_id, teacher_id)` as the scope.
- A request that supplies `academy_id` or `teacher_id` in the body does not get to
  override the resolved scope; body fields are payload, not authority.

Concrete rule:
- The backend never trusts a free `teacher_id` or `academy_id` from the request
  body as the source of authorization.
- For a lesson operation, the server checks that the lesson belongs to the
  resolved `(academy_id, teacher_id)`.

## 4. Cookie/session revocation

Proposal:
- Session is revocable server-side; revocation makes the cookie invalid even if it
  is still unexpired cryptographically.
- On revocation, server marks the session revoked; next request using that cookie
  is rejected as `UNAUTHORIZED`.
- Revocation is not “clear cookie on client”; it is a server-side invalidation that
  future requests must observe.
- Invalid-expiry and revoked-session both map to `UNAUTHORIZED` at the boundary.

Concrete rule:
- `UNAUTHORIZED` means the server could not accept the request as coming from the
  resolved teacher in the resolved academy.

## 5. API surface proposal

All paths below are proposals, not implemented URLs.

### 5.1 Auth

- `POST /api/session` — login, returns session cookie, sets same-site/httponly
  cookie.
- `POST /api/session/revoke` — server-side revocation of the current session.

### 5.2 Lessons

- `POST /api/academies/:academyId/lessons` — create draft.
  - Scope from session, not from path alone; path is routing, session is
    authority.
  - Body: create draft DTO.
- `GET /api/academies/:academyId/lessons/:lessonId` — read current revision.
- `GET /api/academies/:academyId/lessons/:lessonId/preview` — read without effect.
- `POST /api/academies/:academyId/lessons/:lessonId/save` — save with
  `expectedRevision`.
  - Body: save DTO.
  - Transactional CAS + activity replacement + dedup write.
- `POST /api/academies/:academyId/lessons/:lessonId/reopen` — reopen for editing.

Path segments are used for routing and locality; the final authority is still the
resolved session. A request whose resolved session does not match the path scope is
rejected.

### 5.3 Idempotency

- Create and save accept an `Idempotency-Key` header.
- Same operation kind + same canonical request hash → replay saved response.
- Same key + different hash/kind → `IDEMPOTENCY_KEY_REUSED`.

## 6. Endpoint/DTO/error mapping

This is the proposed minimum mapping, aligned to `contract.md` DTOs.

### 6.1 Create draft

Request:
- path: `/api/academies/:academyId/lessons`
- header: `Idempotency-Key`
- body: create draft DTO
  - `title` non-empty
  - optional lesson fields
  - optional activities
- auth: session resolves `(academy_id, teacher_id)`

Validation:
- title required and non-empty after trim
- activity fields validated field-by-field
- duration present → finite and strictly positive

Success:
- 201
- body: lesson object with `revision = 1`, `status = 'draft'`

Errors:
- `UNAUTHORIZED`
- `NOT_FOUND` if academy/teacher scope from session is invalid for the path
- `VALIDATION_ERROR`
- `IDEMPOTENCY_KEY_REUSED`

### 6.2 Save

Request:
- path: `/api/academies/:academyId/lessons/:lessonId/save`
- header: `Idempotency-Key`
- body: save DTO
  - `expectedRevision`
  - optional fields
  - optional activities as complete replacement
- auth: session scope must equal lesson owner `(academy_id, teacher_id)`

Validation:
- `expectedRevision` positive integer
- optional title non-empty if provided
- activity fields validated field-by-field

Transaction boundary:
- read current lesson and current dedup row under concurrency control
- CAS on `revision = expectedRevision`
- if CAS fails → conflict
- if CAS succeeds:
  - update lesson revision and fields
  - replace activity set for that `(academy_id, lesson_id)`
  - insert/update dedup row with saved response
- commit
- respond only after commit

Success:
- 200
- body: lesson object with new `revision`

Errors:
- `UNAUTHORIZED`
- `NOT_FOUND`
- `VALIDATION_ERROR`
- `CONFLICT`
- `IDEMPOTENCY_KEY_REUSED`

### 6.3 Preview / read

Request:
- path as above
- no `Idempotency-Key` required for read/preview
- auth: session scope checks ownership

Success:
- 200
- body: lesson object for a committed revision

Errors:
- `UNAUTHORIZATED`
- `NOT_FOUND`

### 6.4 Error envelope

Proposed minimal envelope:
- `code`
- `message`
- for conflict: current revision when available

Concrete error codes:
- `UNAUTHORIZED`
- `NOT_FOUND`
- `VALIDATION_ERROR`
- `CONFLICT`
- `IDEMPOTENCY_KEY_REUSED`
- `INTERNAL_ERROR`

## 7. Transaction boundary

Canonical transaction for save:
- resolve session scope
- validate DTO
- open transaction
- read lesson for `(academy_id, lesson_id, teacher_id)`
- if not found or wrong owner → abort with appropriate error before mutation
- CAS: `UPDATE ... WHERE revision = expectedRevision AND teacher_id = ...`
- if no row updated → abort, no activity change, conflict response
- replace activity set for that scope
- insert/update mutation_dedup with saved response
- commit
- return after commit with committed revision

Canonical transaction for create:
- resolve session scope
- validate DTO
- open transaction
- check dedup key:
  - same kind + same hash → replay saved response
  - same key + different kind/hash → reject with `IDEMPOTENCY_KEY_REUSED`
- create lesson with `revision = 1`
- if activities provided, insert/replace activity set
- insert dedup row with saved response
- commit
- return after commit

Rules:
- No success response before commit.
- Failure after mutation still reverts the mutation because everything is in the
  same transaction.
- Dedup key is the mechanism for retry safety and concurrent visibility, not a
  client-only convention.

## 8. Stack positioning

Proposal:
- Runtime: Node 24
- Language: TypeScript
- Server: Fastify
- DB driver: pg direct (no ORM in scope)
- Frontend: React + Vite
- Migration/seed: SQL files + run-once seed script review
- Validator layer: existing `dto-validators.ts`

Excluded from this proposal:
- No second ORM draft competing with the above.
- No alternate API style invented here.
- No AI/generation hooks in this cut.

## 9. Container and ARM64 packaging proposal

Goal: reproducible local packaging and test commands, not a deployed service.

### 9.1 Images

- Build target: `linux/arm64` where possible; cross-build only if host is
  amd64 and no native runner is available.
- Runtime image: distroless or minimal node runtime image for the built server
  artifact; keep the build image separate.
- Dev image: full toolchain image for typecheck, lint, and validator tests.

### 9.2 Build steps

Proposal:
- Install dependencies
- Type-check
- Build server artifact
- Package artifact into runtime image
- Run validator tests inside the same env used for CI

### 9.3 Reproducible commands

Local npm flow:
- `npm ci`
- `npm run test:validators`
- typecheck command pending exact tsconfig/code setup

Container flow proposal:
- build dev image with toolchain
- run `npm ci` and `npm run test:validators` in dev image
- build runtime image from artifact stage
- verify artifact stage does not include dev dependencies

### 9.4 What we do not do here

- We do not start a real server.
- We do not expose ports.
- We do not bind real DB credentials into images.
- We do not publish images.

## 10. Remaining implementation gates

Concrete gates before this becomes implementation:
- Architecture approves session model, cookie handling, revocation mechanism, and
  auth-context resolution.
- UX/tools approval for the editor/preview flow still pending.
- DBA/Architecture approval of mutation_dedup schema, response shape, retention, and
  transaction boundaries.
- Exact API route design and HTTP status mapping finalized.
- Exact error envelope and replay semantics finalized.
- Auth cookie signing/rotation/revocation implementation details finalized.
- Migration/run strategy finalized for demo DB.
- Functional test harness contract finalized: integration vs unit boundaries for
  auth, conflict, and replay.

## 11. First functional-test estimate

Order-of-magnitude estimate for first functional verification pass, assuming the
server and DB are available and auth is wired:

- auth path: login, valid cookie use, expired cookie, revoked session.
- create draft: minimal title, zero activities, optional fields, invalid title.
- save: CAS success, CAS conflict, activity replace, replay same key/hash,
  reject same key different hash.
- read/preview: ownership isolation between Ana/Alex and Bruno.
- session revocation: request after revocation returns `UNAUTHORIZED`.

Estimate: small but non-trivial; roughly a few hours of focused functional work for a
first pass, not a full suite. Exact effort depends on how much auth and DB wiring is
already in place, which is not assumed here.

## 12. What is decided vs still pending

Decided in this ADR:
- authoritative scope from server-resolved session
- cookie revocation as server-side invalidation
- endpoint/DTO/error mapping proposal aligned with contract.md
- transaction CAS boundary for save and create
- one concrete stack proposal, no ORM competition
- container/ARM64 packaging and reproducible commands proposal

Still pending:
- Architecture/UX approval gates listed in section 10
- exact response shapes for replay and error diagnosis
- exact route conventions and header semantics
- exact migration/run approach for demo DB
