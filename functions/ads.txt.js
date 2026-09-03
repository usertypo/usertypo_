/**
 * Serve /ads.txt for ad networks.
 * Prefer Ezoic's managed file when available; otherwise keep the AdSense line
 * so Google verification does not break while Incubator finishes provisioning.
 */
var EZOIC_ADS_TXT = 'https://srv.adstxtmanager.com/19390/usertypo.com';
var FALLBACK_ADS_TXT =
    'google.com, pub-4215657077722335, DIRECT, f08c47fec0942fa0\n';

export async function onRequestGet() {
    try {
        var upstream = await fetch(EZOIC_ADS_TXT, {
            headers: { Accept: 'text/plain' },
            cf: { cacheTtl: 900, cacheEverything: true },
        });
        if (upstream.ok) {
            var body = await upstream.text();
            if (body && body.trim()) {
                // Ensure our AdSense publisher stays authorized even if Ezoic's
                // list is temporarily missing it.
                if (body.indexOf('pub-4215657077722335') === -1) {
                    body = body.replace(/\s*$/, '\n') + FALLBACK_ADS_TXT;
                }
                return new Response(body, {
                    status: 200,
                    headers: {
                        'Content-Type': 'text/plain; charset=utf-8',
                        'Cache-Control': 'public, max-age=900',
                    },
                });
            }
        }
    } catch (e) {
        /* fall through to local AdSense line */
    }

    return new Response(FALLBACK_ADS_TXT, {
        status: 200,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
        },
    });
}
