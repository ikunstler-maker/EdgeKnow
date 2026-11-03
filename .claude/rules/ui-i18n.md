---
paths:
  - "src/i18n/**"
  - "src/app/**"
  - "src/components/**"
---
# UI & i18n rules
- Every UI string lives in `src/i18n/uk.ts` and the same key in `src/i18n/en.ts` (TypeScript checks both match).
- Don't read `uk.ts`/`en.ts` whole: Grep the key or section, Read with offset/limit, Edit in place.
- Mobile: controls ≥44×44 px; no horizontal page scroll; light and dark theme.
- Visual checks: temporary `src/app/login/harness` page + `next dev -p 3123` with dummy Supabase env + Playwright; remove the harness and `.next/dev` afterwards.
