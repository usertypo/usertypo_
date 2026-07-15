/**
 * Clerk public config for usertypo_
 *
 * Publishable keys are safe to use in browser code (they are meant to be public).
 * Never put a Secret key (sk_...) in this file.
 */
window.USERTYPO_CLERK = {
    publishableKey: 'pk_test_dHJ1c3RlZC1wcmF3bi0zMS5jbGVyay5hY2NvdW50cy5kZXYk',
    // Decoded from the publishable key — your Clerk Frontend API host
    frontendApi: 'trusted-prawn-31.clerk.accounts.dev',
    signInUrl: '/signin',
    signUpUrl: '/signin',
    afterSignInUrl: '/',
    afterSignUpUrl: '/',
    ssoCallbackUrl: '/sso-callback',
};
