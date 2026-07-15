/**
 * Shell header ↔ auth state binding.
 */
(function () {
    function displayName(user) {
        if (!user) return 'Guest';
        if (user.username) return user.username;
        if (user.fullName) return user.fullName;
        if (user.firstName) return user.firstName;
        var email = user.primaryEmailAddress && user.primaryEmailAddress.emailAddress;
        if (email) return email.split('@')[0];
        return 'Player';
    }

    function initialFor(name) {
        var clean = String(name || '?').trim();
        return (clean.charAt(0) || '?').toUpperCase();
    }

    function setText(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function updateHeader(state) {
        var isSignedIn = !!(state && state.isSignedIn && state.user);
        var name = isSignedIn ? displayName(state.user) : 'Guest';
        var tier = isSignedIn ? 'Signed in' : 'Not signed in';

        setText('shell-user-name', name);
        setText('shell-user-tier', tier);
        setText('shell-user-avatar', initialFor(name));

        var authAction = document.getElementById('shell-auth-action');
        var authIcon = document.getElementById('shell-auth-action-icon');
        var accountBtn = document.getElementById('header-account-btn');
        var accountIcon = document.getElementById('header-account-icon');
        var userStatsLink = document.getElementById('nav-userstats');

        if (isSignedIn) {
            if (authAction) {
                authAction.setAttribute('href', '#');
                authAction.removeAttribute('data-spa-link');
                authAction.title = 'Sign out';
                authAction.setAttribute('aria-label', 'Sign out');
                authAction.onclick = function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!window.usertypoAuth) return;
                    window.usertypoAuth.signOut().then(function () {
                        if (window.navigateTo) window.navigateTo('/signin');
                        else window.location.href = '/signin';
                    }).catch(function (err) {
                        console.error('[usertypo auth] sign out failed', err);
                    });
                };
            }
            if (authIcon) authIcon.textContent = 'logout';
            if (accountBtn) {
                accountBtn.setAttribute('href', '/userstats');
                accountBtn.title = name;
                accountBtn.setAttribute('aria-label', 'Your profile');
            }
            if (accountIcon) accountIcon.textContent = 'person';
            if (userStatsLink) userStatsLink.setAttribute('href', '/userstats');
        } else {
            if (authAction) {
                authAction.setAttribute('href', '/signin');
                authAction.setAttribute('data-spa-link', '');
                authAction.title = 'Sign in';
                authAction.setAttribute('aria-label', 'Sign in');
                authAction.onclick = null;
            }
            if (authIcon) authIcon.textContent = 'login';
            if (accountBtn) {
                accountBtn.setAttribute('href', '/signin');
                accountBtn.title = 'Sign in';
                accountBtn.setAttribute('aria-label', 'Sign in');
            }
            if (accountIcon) accountIcon.textContent = 'login';
            if (userStatsLink) userStatsLink.setAttribute('href', '/signin');
        }
    }

    function boot() {
        if (!window.usertypoAuth) {
            updateHeader({ isSignedIn: false, user: null });
            return;
        }
        window.usertypoAuth.onChange(updateHeader);
        window.usertypoAuth.ready().then(function () {
            updateHeader(window.usertypoAuth.getState());
        }).catch(function () {
            updateHeader({ isSignedIn: false, user: null });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
