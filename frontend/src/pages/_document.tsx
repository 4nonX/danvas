import { Html, Head, Main, NextScript } from "next/document";
import { brand } from "@/lib/theme.generated";
import { themeBootScript } from "@/lib/theme";
import { localeBootScript } from "@/lib/locale";
import { tr } from "@/lib/i18n";

/** Bump when the favicon / app icons change. */
const ICON_REV = "d1";

export default function Document() {
  // The app is statically exported, so this markup is identical for every user
  // and cannot carry their locale. The boot script below replaces both
  // attributes before first paint. They are still declared here because a page
  // with NO language at all fails WCAG 3.1.1 for anyone reaching it without
  // scripts, and for crawlers.
  return (
    <Html lang="en" dir="ltr">
      <Head>
        {/* Apply the stored dark-mode preference before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        {/* Set lang and dir before first paint: a mirrored layout arriving a
            frame late moves every element on the page. */}
        <script dangerouslySetInnerHTML={{ __html: localeBootScript }} />
        <meta name="theme-color" content={brand["600"]} />
        {/* Social share card (Open Graph + Twitter): title and description
            shown when a link is unfurled in chat, social, and previews. */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={tr("page.hycanvas_2")} />
        <meta property="og:title" content={tr("page.hycanvas_2")} />
        <meta property="og:description" content={tr("page.a_free_ai_native_visual_design_platform")} />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={tr("page.hycanvas_2")} />
        <meta name="twitter:description" content={tr("page.a_free_ai_native_visual_design_platform")} />
        {/* The danvas mark: SVG first, PNG + ICO fallbacks, plus the
            touch/PWA tiles. */}
        {/* ?v= changes whenever the icons do: browsers keep favicons in a
            cache of their own that a reload does not refresh. */}
        <link rel="icon" type="image/svg+xml" href={`/favicon.svg?v=${ICON_REV}`} />
        <link rel="icon" type="image/png" sizes="32x32" href={`/favicon-32.png?v=${ICON_REV}`} />
        <link rel="icon" type="image/png" sizes="16x16" href={`/favicon-16.png?v=${ICON_REV}`} />
        <link rel="apple-touch-icon" sizes="180x180" href={`/apple-touch-icon.png?v=${ICON_REV}`} />
        <link rel="manifest" href={`/manifest.webmanifest?v=${ICON_REV}`} />
      </Head>
      <body className="antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
