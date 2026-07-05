---
name: file-uploads
description: How to upload files/images to Supabase storage via the signed-URL flow — the sign->PUT->record three-step, server-side trust boundaries for MIME/size/path, the shared upload constants in @op/common `utils/storage.ts`, and the `@op/common/client` import boundary for client components. Use when adding or reviewing any file or image upload — proposal attachments, resource documents, hero/banner images, avatars — or touching upload constants, signed URLs, or storage paths.
---

Uploads go through Supabase storage with a **signed-URL** flow. This replaced base64-through-tRPC, which hit `413 Payload Too Large` against the 3MB Vercel body cap once files got real. The pattern recurred across PR #1420 (proposal attachments) and PR #1480 (decision overview hero image); ONE-325 tracks migrating the remaining upload endpoints onto it. Every upload — attachments, documents, hero/banner images, avatars — uses the same three steps and the same shared constants.

## The three-step signed-URL flow

Never send file bytes through the tRPC body. Three round-trips:

1. **Sign.** Client calls a `sign*` mutation. The server auth-gates the caller, computes the storage path, and returns `{ storagePath, signedUrl, token }`. Tiny JSON in, tiny JSON out.
2. **PUT direct to Supabase.** Client `PUT`s the raw file bytes **directly to `signedUrl`** — never through tRPC. This is what avoids the 413: the bytes never touch the Vercel function body.
3. **Record.** Client calls a small `record*` mutation with just the `storagePath` (plus any metadata like a display name). Tiny JSON RPC, no base64.

On failure of **any** step, refetch the owning query to clear the optimistic row — don't leave a phantom attachment in the UI.

```ts
// client — inside a use client component
const { storagePath, signedUrl } = await signAttachment.mutateAsync({ profileId, fileName: file.name });
await fetch(signedUrl, { method: 'PUT', body: file }); // raw bytes, direct to Supabase
await recordAttachment.mutateAsync({ proposalId, storagePath });
```

## The server re-check is the trust boundary

Client-side checks (extension filter, size preview, MIME sniff) are **UX only**. On the `record*` step the service must **independently re-verify**, because the client hands back an arbitrary `storagePath` and can `PUT` any `Content-Type` to the signed URL.

- **MIME — read the STORED type, not the declared one.** Read the `Content-Type` Supabase recorded on the actual PUT (`storedMimeType` from the object metadata), **not** `input.mimeType`. A caller can `PUT` `text/html` while declaring `image/png`, and Supabase serves back what it received. Re-check `storedMimeType` against the shared allowlist. PR #1420 review flagged this as **the most important line in the file** — deliberately do NOT trust the client-declared MIME.
- **Size — enforce against the stored object.** The signed PUT URL has **no inherent size cap**. On record, read the actual stored object size and reject against the cap **before** inserting the attachment row, so you never leave a row pointing at an oversized blob.
- **Anti-hijack path-prefix check.** The signed URL is path-scoped, but the client hands the path back on record. Re-check that `storagePath.startsWith(<caller's own prefix>)` — otherwise a caller could submit someone else's just-uploaded object. PR #1420.

```ts
// record*.ts — service side
const object = await getStorageObject({ storagePath }); // its own module, see server-only note
if (!object) throw new NotFoundError('Upload', storagePath);
if (!storagePath.startsWith(expectedPrefix)) throw new ValidationError('Storage path outside caller scope');
if (!isAllowedUploadMimeType(object.storedMimeType)) throw new ValidationError('Disallowed file type');
if (object.size > sizeLimit) throw new ValidationError('File exceeds size limit'); // reject BEFORE insert
```

## Storage path shape and uniqueness

Scope the path to the **owning entity's profile**, not the uploading user:

```
profile/{profileId}/proposals/{uuid}_{sanitizedFileName}
```

- **Use `crypto.randomUUID()` in the key, NOT `Date.now()`.** Two concurrent uploads of the same filename within one millisecond collide on the key, and Supabase (`upsert: false`) rejects the second. PR #1420 review: "Could it be possible to upload at the same time? Should this be a uuid instead?" -> switched to `crypto.randomUUID()`.
- **Scope by the owning resource's `profileId`, not the uploader's user id.** A proposal's attachments then group under one prefix and stay deletable together. (nourmalaeb, PR #1420.)

## Shared constants — single source of truth

All allowlists and caps live in **`packages/common/src/utils/storage.ts`** so client and server can't drift. This was the #1 review theme on both PRs — "Don't we already have this defined elsewhere to reuse?" **Never hardcode a MIME list or a size number at a call site or in upload copy — import the shared constant.**

- `ALLOWED_UPLOAD_MIME_TYPES` — one allowlist for every flow — plus the `AllowedUploadMimeType` type and the `isAllowedUploadMimeType` guard.
- `DEFAULT_UPLOAD_SIZE_LIMIT` (25MB, documents) and `IMAGE_UPLOAD_SIZE_LIMIT` (5MB, images). Derive per-feature caps from these; don't invent new magic numbers.
- **Interpolate the limit into user-facing copy** instead of hardcoding a number, so the message can't diverge from the enforced cap.
- `sanitizeStorageFileName` — the shared sanitizer. Rule: `[A-Za-z0-9._-]+` -> `_`, cap at 255 chars. Reviewers asked "couldn't we use a standard S3 sanitizer / library?" — resolution was **extract, don't add a dep**: `sanitize-filename` / `filenamify` only strip Windows-illegal chars, so the stricter in-house rule needs no dependency.

PR #1480 is exactly the drift this prevents: the overview-image copy said "png/jpeg only" while the code allowed `webp`/`gif`. One source of truth, interpolated into copy, and they can't disagree.

## Client import boundary (load-bearing)

A `use client` component must import upload constants from **`@op/common/client`, NOT `@op/common`**. Importing the full `@op/common` barrel drags `services/index.ts` -> `@op/supabase/server` -> `next/headers` into the client bundle and breaks the e2e Next build with "You're importing a module that depends on `next/headers`." PR #1420.

```ts
// ✅ client component
import { ALLOWED_UPLOAD_MIME_TYPES, IMAGE_UPLOAD_SIZE_LIMIT } from '@op/common/client';
// ❌ pulls next/headers into the client bundle
import { ALLOWED_UPLOAD_MIME_TYPES } from '@op/common';
```

## Don't leak `server-only` through the barrel

A helper that imports `@op/db/client` (which is `server-only`) must live in **its own module** and **not** be re-exported from the `utils` barrel — otherwise every client-safe consumer of the barrel drags `server-only` along and Vitest suites fail at module load. New DB-touching callers import the helper by its direct path (PR #1420, `storageObject.ts`).

## Keep the routers thin

Never do upload work at the router level. `sign*` / `record*` routers **validate input and delegate to `@op/common` services** — no DB access, no MIME/size logic in the router. PR #1480: "We never pull in the DB to the router level" / "Everything below this should be in a service instead." See the `api-endpoints` and `service-layer-structure` skills.

## Test coverage

The security re-checks — the ones the client can't be trusted for — each get a test (PR #1420):

- Storage object missing at the signed path -> `NotFoundError`.
- Stored `Content-Type` not on the allowlist -> `ValidationError`.
- Declared `mimeType` != stored `Content-Type` -> `ValidationError`.
- `storagePath` outside the caller's prefix -> `ValidationError`.

An explicit `>25MB` test was skipped as too heavy (it would PUT 25MB per run) and called out in the commit message — note the gap rather than silently dropping it. See the `test-conventions` skill.

## Verify

Run `pnpm w:api typecheck` after touching upload procedures, and `pnpm w:app typecheck` after touching client-side upload constants.
