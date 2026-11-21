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
import { SecurityPage } from './routes/settings/SecurityPage';

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
  component: () => <PlaceholderPage section="offers" phase={2} />,
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
  component: () => <PlaceholderPage section="profile" phase={1} />,
});
const securityRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings/security',
  component: SecurityPage,
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
    applicationsRoute,
    documentsRoute,
    profileRoute,
    securityRoute,
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
