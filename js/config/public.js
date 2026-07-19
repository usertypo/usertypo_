/**
 * Public client config for usertypo_
 *
 * Only PUBLISHABLE / ANON values belong here (safe in the browser).
 * Never put Secret keys (sk_...) or service-role keys in this file.
 *
 * Local override: set CLERK_PUBLISHABLE_KEY in `.env` and run `npm run dev`
 * (server injects them). For static hosts, set these values at deploy/build time.
 */
window.USERTYPO_CONFIG = {
    clerk: {
        publishableKey: 'pk_test_dHJ1c3RlZC1wcmF3bi0zMS5jbGVyay5hY2NvdW50cy5kZXYk',
        frontendApi: 'trusted-prawn-31.clerk.accounts.dev',
        signInUrl: '/signin',
        signUpUrl: '/signin',
        afterSignInUrl: '/',
        afterSignUpUrl: '/',
        ssoCallbackUrl: '/sso-callback',
    },
    supabase: {
        url: 'https://skebosepedaxnvcaizka.supabase.co',
        // Prefer new publishable key; anon kept as fallback for older clients
        publishableKey: 'sb_publishable_NvfpUKNOtSQ8KuIP1H-JkA_ZriwgB72',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNrZWJvc2VwZWRheG52Y2FpemthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMjc5MDEsImV4cCI6MjA5OTYwMzkwMX0.OhFRFJQfzlL3DJJXtv-lKWZYDWnrkJ5cQhu3dwduDFI',
    },
    multiplayer: {
        // Leave blank when Socket.IO is served by the same origin.
        url: '',
    },
};
