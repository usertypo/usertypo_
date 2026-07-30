/**
 * Cloudflare Pages Function — approximate country from the CDN edge.
 * Used only to store an ISO country code on the signed-in profile for
 * aggregate community charts (About page). Never returns IP.
 */
export async function onRequestGet(context) {
    const countryRaw = context.request && context.request.cf
        ? context.request.cf.country
        : null;
    const country = String(countryRaw || '')
        .trim()
        .toUpperCase();
    const safe = /^[A-Z]{2}$/.test(country) && country !== 'XX' && country !== 'T1'
        ? country
        : null;

    return Response.json(
        { country: safe },
        {
            headers: {
                'Cache-Control': 'private, max-age=3600',
                'Content-Type': 'application/json; charset=utf-8',
            },
        }
    );
}
