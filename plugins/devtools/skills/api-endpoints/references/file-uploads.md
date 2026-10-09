# File uploads (signed-URL flow)

Every upload (proposal attachments, resource documents, hero/banner images, avatars) goes through Supabase storage using a signed URL. File bytes never pass through tRPC, because base64 bodies hit the ~4.5 MB Vercel cap and return 413.

## Three steps

1. **Sign**: a `sign*UploadUrl` mutation (e.g. `routers/profile/signProfileImageUploadUrl.ts`, `routers/decision/signProposalAttachmentUploadUrl.ts`) auth-gates the caller and calls `signStorageUploadUrl({ pathPrefix, fileName })`. That returns `{ storagePath, signedUrl, token }`.
2. **PUT**: the client sends the raw file to `signedUrl` directly (`fetch(signedUrl, { method: 'PUT', body: file })`).
3. **Record**: a small mutation receives `storagePath` plus metadata. Its service calls `getStorageObjectByPath({ path })`, then `assertUploadedStorageObject({ storageObject, storagePath, requiredPathPrefix, declaredMimeType, maxFileSize })`, and inserts the row only after that passes.

If any step fails, refetch the owning query so no phantom optimistic row is left behind.

## Server trust boundary (record step)

Client checks are UX only. `assertUploadedStorageObject` (`packages/common/src/utils/storage.ts`) runs these checks against the object metadata Supabase recorded:

- the object exists (`NotFoundError`)
- `storagePath` starts with the caller's own prefix, which blocks claiming another user's upload
- the stored Content-Type, not the declared one, is on `ALLOWED_UPLOAD_MIME_TYPES`, and it matches what the client declared
- the stored size is within `maxFileSize`. The signed PUT has no size cap of its own.

Use the helper; don't re-implement these checks. Endpoints stricter than the shared allowlist narrow further after it. For example, `saveProfileImage` rejects anything that isn't `image/*`. Re-assert access on the record step. For personal-profile owners, use the non-throwing access path (see access-control).

## Paths

- Scope the prefix to the owning entity's profile, not the uploader, using per-feature helpers such as `proposalAttachmentPathPrefix(profileId)` → `profile/{profileId}/proposals/`.
- `signStorageUploadUrl` builds `<prefix><uuid>_<sanitized>`, using `randomUUID()` (never `Date.now()`) and `sanitizeStorageFileName`. Don't build keys by hand.

## Shared constants

All of these come from `utils/storage.ts`. Never hardcode a MIME list or a byte count:

- `ALLOWED_UPLOAD_MIME_TYPES`, `AllowedUploadMimeType`, `isAllowedUploadMimeType`
- `DEFAULT_UPLOAD_SIZE_LIMIT` (25 MB), `IMAGE_UPLOAD_SIZE_LIMIT` (5 MB). Derive per-feature caps from these (e.g. `MAX_PROPOSAL_ATTACHMENT_FILE_SIZE`).
- `ASSETS_BUCKET`, `sanitizeStorageFileName`

Interpolate the limits and allowed types into user-facing copy so the copy can't drift from what's enforced.

## Import boundaries

- Client components import upload constants from `@op/common/client`, never `@op/common`. The full barrel pulls in `next/headers` and breaks the build.
- `signStorageUploadUrl.ts` and `storageObject.ts` are server-only, so they stay out of the utils barrel. Import them by direct path.

## Client state

Never persist a base64 `data:` preview to browser storage, because it blows the `sessionStorage` quota. Strip it in the persist `partialize` with an anchored `/^data:[^,]*;base64,/` (see `Onboarding/useOnboardingFormStore.ts`).

## Tests

Each server re-check needs a test: missing object → `NotFoundError`; stored type not allowed, declared ≠ stored, or path outside the prefix → `ValidationError`. If you skip an oversize test because it's too heavy, say so in the PR.

History: PR #1420 (attachments, stored-MIME check, UUID keys, client import boundary), #1480 (hero image, thin routers, copy drift), #1608 (base64 preview quota), #1612 (avatar/banner, image-only narrowing, personal-profile access).
