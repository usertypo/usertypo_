/**
 * Debug-mode dual logger: localhost ingest + same-origin /api/__agent_debug
 */
(function () {
    function agentDebugLog(payload) {
        var body = payload || {};
        body.sessionId = '8b0b5b';
        body.timestamp = Date.now();
        var json = JSON.stringify(body);
        try {
            fetch('http://127.0.0.1:7504/ingest/493b0702-3b97-4a37-8def-7b94a2958f6d', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '8b0b5b' },
                body: json,
            }).catch(function () {});
        } catch (e) { /* ignore */ }
        try {
            fetch('/api/__agent_debug', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: json,
            }).catch(function () {});
        } catch (e) { /* ignore */ }
    }
    window.__agentDebugLog = agentDebugLog;
})();
