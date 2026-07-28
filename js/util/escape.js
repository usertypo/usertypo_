/**
 * Shared HTML escaping helpers — window.usertypoEscape
 */
(function () {
    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/`/g, '&#96;');
    }

    /**
     * Allow only http(s) and data:image URLs for img/src / CSS url().
     * Rejects javascript:, data:text/html, etc.
     */
    function safeUrl(value, fallback) {
        var trimmed = String(value == null ? '' : value).trim();
        if (!trimmed) return fallback == null ? '' : String(fallback);
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        if (/^data:image\//i.test(trimmed)) return trimmed;
        if (/^\/(?!\/)/.test(trimmed)) return trimmed;
        return fallback == null ? '' : String(fallback);
    }

    window.usertypoEscape = {
        html: escapeHtml,
        attr: escapeAttr,
        url: safeUrl,
    };
})();
