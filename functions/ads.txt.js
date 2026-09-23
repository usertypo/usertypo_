/**
 * Serve /ads.txt for ad networks.
 * Placeholder until a third-party ad provider is configured.
 */
var ADS_TXT =
    'google.com, pub-4215657077722335, DIRECT, f08c47fec0942fa0\n';

export async function onRequestGet() {
    return new Response(ADS_TXT, {
        status: 200,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=900',
        },
    });
}
