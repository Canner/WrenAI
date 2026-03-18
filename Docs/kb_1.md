Great request. I audited your current wren-ui and here’s the most practical i18n rollout plan for 2026 App Router standards using next-intl with strong type safety and RSC-first patterns.
Audit Findings
- You are currently on the Pages Router (wren-ui/src/pages/...), not App Router.
- Existing dynamic route needing localization support: wren-ui/src/pages/home/[id].tsx.
- Metadata/localization gaps:
  - Global title hardcoded in wren-ui/src/pages/_app.tsx:19 (Wren AI).
  - No locale-aware <html lang> in wren-ui/src/pages/_document.tsx:34.
- High-impact hardcoded UI strings in shared components:
  - wren-ui/src/components/HeaderBar.tsx:56 (Home, Modeling, Knowledge, API)
  - wren-ui/src/components/sidebar/Home.tsx:81 (Dashboard)
  - wren-ui/src/components/sidebar/Knowledge.tsx:35 (Question-SQL pairs, Instructions)
  - wren-ui/src/pages/home/index.tsx:31 (Know more about your data)
- High volume of localized notifications needed:
  - wren-ui/src/pages/modeling.tsx:99+
  - wren-ui/src/pages/knowledge/question-sql-pairs.tsx:52+
  - wren-ui/src/pages/home/[id].tsx:91+
- Routing currently depends on static enum paths in wren-ui/src/utils/enum/path.ts:1, which must become locale-aware.
---
Target Architecture (Recommended)
Use App Router + locale segment + route groups:
wren-ui/src/
  app/
    [locale]/
      (marketing)/
        page.tsx
      (dashboard)/
        home/
          page.tsx
          [id]/
            page.tsx
          dashboard/
            page.tsx
        modeling/
          page.tsx
        knowledge/
          question-sql-pairs/
            page.tsx
          instructions/
            page.tsx
        api-management/
          history/
            page.tsx
      layout.tsx
      not-found.tsx
  i18n/
    routing.ts
    navigation.ts
    request.ts
  messages/
    en.json
    fr.json
Why this works well:
- [locale] enables locale-prefixed URLs and per-locale metadata.
- Route groups let you keep shared app shell (HeaderBar, sidebar layout) without duplicating layout logic.
- Keeps pages/api as-is during migration (safe hybrid migration path).
---
Phase 1 — Core i18n Foundation
1. Install next-intl and configure plugin in next.config.js.
2. Add wren-ui/src/i18n/routing.ts with:
   - locales, defaultLocale, optional localePrefix.
   - pathnames mapping for localized slugs (SEO-safe).
3. Add wren-ui/src/i18n/request.ts for server-side message loading.
4. Add middleware (wren-ui/src/middleware.ts) for locale detection:
   - Detect from path → cookie → Accept-Language.
   - Exclude _next, api, static assets in matcher.
5. Add wren-ui/src/app/[locale]/layout.tsx:
   - <html lang={locale}>
   - NextIntlClientProvider with server-fetched messages.
6. Type-safe keys (strict):
   - Create global.d.ts module augmentation for next-intl with Messages from messages/en.json.
   - This gives compile-time key checking for t('...').
---
Phase 2 — Localized Navigation + SEO
1. Replace next/link and next/router usage with next-intl/navigation wrappers.
2. Create wren-ui/src/i18n/navigation.ts via createNavigation(routing) and export:
   - Link, useRouter, usePathname, redirect, getPathname.
3. Replace path enum usage gradually:
   - Keep internal route IDs/constants.
   - Resolve localized pathname via typed getPathname.
4. SEO requirements:
   - In each route’s generateMetadata, output:
     - localized title/description
     - alternates.languages for all supported locales
   - Keep canonical per locale.
5. Keep dynamic IDs untranslated (/en/home/123, /fr/accueil/123 if localized segment mapping enabled).
---
Phase 3 — Component Conversion Examples (RSC-first)
Server Component example (preferred for bundle size):
// src/app/[locale]/(dashboard)/home/page.tsx
import {getTranslations} from 'next-intl/server';
export default async function HomePage() {
  const t = await getTranslations('Home');
  return <h1>{t('title')}</h1>;
}
Client Component example:
'use client';
import {useTranslations} from 'next-intl';
export function HeaderNav() {
  const t = useTranslations('Nav');
  return (
    <>
      <button>{t('home')}</button>
      <button>{t('modeling')}</button>
      <button>{t('knowledge')}</button>
    </>
  );
}
Migration rule:
- Prefer getTranslations in RSC pages/layouts.
- Only use useTranslations in interactive client components.
- For notifications (message.success), pass translated strings from parent/server when possible, or use client hook if truly client-only.
---
Phase 4 — Automation for Existing Strings
Use a two-step codemod pipeline:
1. Extract strings (AST script with ts-morph or Babel):
   - Scan .tsx/.ts.
   - Capture JSX text nodes, string literals in UI props (title, label, placeholder) and toast messages.
   - Ignore technical strings (URLs, class names, GraphQL names, route constants).
   - Output to messages/en.json with namespaced keys (e.g., Header.nav.home).
2. Optional transform pass:
   - Replace extracted literals with t('...').
   - Insert useTranslations('Namespace') or getTranslations('Namespace') depending on component type.
   - Mark low-confidence replacements for manual review.
Recommended script outputs:
- messages/en.json
- i18n-extract-report.md (file, line, key, confidence)
- i18n-todo.csv for unresolved strings
---
Important Notes for Your Current Codebase
- Because you’re on Pages Router, do a staged migration:
  1) Introduce App Router + i18n scaffold,
  2) Move shared shell (HeaderBar, sidebar layout),
  3) Migrate high-traffic pages (home, modeling, knowledge),
  4) Remove old Pages routes when parity is done.
- Keep pages/api/* unchanged until you intentionally migrate API handlers.
---
If you want, I can next produce a concrete file-by-file migration checklist for your exact routes (/home, /home/[id], /modeling, /knowledge/*, /api-management/history) with estimated effort and risk per file