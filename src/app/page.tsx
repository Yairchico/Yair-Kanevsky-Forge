// This route is always intercepted by src/middleware.ts, which redirects to
// /login (signed out) or /trainer /trainee (signed in, by role). This
// component is a fallback in case middleware ever fails to match.
export default function RootPage() {
  return null;
}
