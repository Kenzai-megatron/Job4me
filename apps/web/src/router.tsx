import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { sessionQuery } from './api/queries';
import { AppShell } from './components/AppShell';
import { EnrollPage } from './routes/EnrollPage';
import { HomePage } from './routes/HomePage';
import { LoginPage } from './routes/LoginPage';
import { PlaceholderPage } from './routes/PlaceholderPage';
import { ProfilePage } from './routes/profile/ProfilePage';
import { SecurityPage } from './routes/settings/SecurityPage';
import { AiPage } from './routes/settings/AiPage';
import { ImportReviewPage } from './routes/profile/ImportReviewPage';
import { OfferPage } from './routes/offers/OfferPage';
import { OffersPage } from './routes/offers/OffersPage';
import { SourcesPage } from './routes/sources/SourcesPage';

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: Outlet });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery(sessionQuery);
    if (session.authenticated) throw redirect({ to: '/' });
  },
});

const enrollRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/enroll',
  component: EnrollPage,
  beforeLoad: async ({ context }) => {
    // Loads the pre-login cookie and the CSRF token before the first request.
    await context.queryClient.fetchQuery(sessionQuery);
  },
});

/** Every signed-in screen goes through this layout, which sends strangers to /login. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: AppShell,
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery(sessionQuery);
    if (!session.authenticated) throw redirect({ to: '/login' });
  },
});

const homeRoute = createRoute({ getParentRoute: () => appRoute, path: '/', component: HomePage });
const offersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/offers',
  component: OffersPage,
});
const offerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/offers/$offerId',
  component: OfferPage,
});
const sourcesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/sources',
  component: SourcesPage,
});
const applicationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/applications',
  component: () => <PlaceholderPage section="applications" phase={5} />,
});
const documentsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/documents',
  component: () => <PlaceholderPage section="documents" phase={4} />,
});
const profileRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/profile',
  component: ProfilePage,
});
const importReviewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/profile/imports/$importId',
  component: ImportReviewPage,
});
const securityRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/security',
  component: SecurityPage,
});
const aiRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/ai',
  component: AiPage,
});

const devRoutes = import.meta.env.DEV
  ? [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/dev/design',
        component: lazyRouteComponent(() => import('./dev/DesignPage'), 'DesignPage'),
      }),
    ]
  : [];

const routeTree = rootRoute.addChildren([
  loginRoute,
  enrollRoute,
  appRoute.addChildren([
    homeRoute,
    offersRoute,
    offerRoute,
    sourcesRoute,
    applicationsRoute,
    documentsRoute,
    profileRoute,
    importReviewRoute,
    securityRoute,
    aiRoute,
  ]),
  ...devRoutes,
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
