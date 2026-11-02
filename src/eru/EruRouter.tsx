import { lazy, Suspense, ComponentType, type ReactNode } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ERU_ROUTES } from './routes.generated';
import EruPageShell from './EruPageShell';
import { AuthProvider } from './lib/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { ThemeProvider as EruThemeProvider } from './context/ThemeContext';
import { MediaPlayerProvider } from './context/MediaPlayerContext';
import { DashboardEventsProvider } from './context/DashboardEventsContext';
import EruErrorBoundary from './EruErrorBoundary';

const SLUG_TO_TITLE = (slug: string) =>
  slug.replace(/^\//, '').replace(/[-/:]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Home';

function wrap(loader: () => Promise<any>, title: string) {
  const Lazy = lazy(async () => {
    const mod = await loader();
    const C: ComponentType<any> = mod.default ?? mod;
    return { default: (props: any) => (
      <EruPageShell title={title} badge="EXPERIMENTAL" banner="Imported from Eru — verify before operational use.">
        <EruErrorBoundary name={title}>
          <C {...props} />
        </EruErrorBoundary>
      </EruPageShell>
    ) };
  });
  return <Lazy />;
}

const Fallback = () => (
  <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
    Loading Eru module…
  </div>
);

/**
 * The context stack every ported Eru page was written against.
 *
 * In Eru these live at the root of its own App.jsx. Only AuthProvider came
 * across with the pages, so `useLanguage`, `useMediaPlayer` and `useTheme`
 * found nothing and threw on mount — fourteen pages (dashboard, markets, trade,
 * portfolio, messages, settings, music, listening, the playlist and collab
 * routes…) rendered an error card instead of the page. Mounting the same five
 * providers here is what makes those pages reachable, and mounting them once
 * around the whole subtree keeps playback and language alive across Eru
 * navigation rather than resetting on each route change.
 *
 * Exported separately so a test can mount a page's hooks in the same stack the
 * router gives them.
 */
export function EruProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <LanguageProvider>
        <EruThemeProvider>
          <MediaPlayerProvider>
            <DashboardEventsProvider>{children}</DashboardEventsProvider>
          </MediaPlayerProvider>
        </EruThemeProvider>
      </LanguageProvider>
    </AuthProvider>
  );
}

export default function EruRouter() {
  return (
    <EruProviders>
      <Suspense fallback={<Fallback />}>
        <Routes>
          {ERU_ROUTES.map(({ path, name, loader }) => (
            <Route key={path + name} path={path} element={wrap(loader, SLUG_TO_TITLE(path) || name)} />
          ))}
        </Routes>
      </Suspense>
    </EruProviders>
  );
}
