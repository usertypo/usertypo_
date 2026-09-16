/**
 * Fixed page-level custom scrollbar (matches leaderboards / home stats behavior).
 */
(function () {
    'use strict';

    var wired = false;
    var active = false;
    var isDragging = false;
    var thumbClickOffset = 0;
    var track = null;
    var thumb = null;

    function updatePageScrollbar() {
        if (!active || !track || !thumb) return;
        var docH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        var winH = window.innerHeight;
        var scrollable = docH - winH;
        if (scrollable <= 0) {
            track.style.display = 'none';
            track.style.visibility = 'hidden';
            return;
        }
        track.style.display = 'block';
        track.style.visibility = 'visible';
        var trackH = track.clientHeight;
        var thumbH = Math.max(trackH * (winH / docH), 40);
        thumb.style.height = thumbH + 'px';
        // While dragging, mousemove owns thumb position for immediate feedback.
        if (!isDragging) {
            var pct = Math.min(1, Math.max(0, window.scrollY / scrollable));
            thumb.style.top = (pct * (trackH - thumbH)) + 'px';
        }
    }

    function showTrackNearCursor(e) {
        if (!active || !track) return;
        if (isDragging || window.innerWidth - e.clientX < 40) {
            track.classList.remove('opacity-0', 'translate-x-4', 'pointer-events-none');
            track.classList.add('opacity-100', 'translate-x-0', 'pointer-events-auto');
        } else {
            track.classList.add('opacity-0', 'translate-x-4', 'pointer-events-none');
            track.classList.remove('opacity-100', 'translate-x-0', 'pointer-events-auto');
        }
    }

    function onThumbMouseDown(e) {
        if (!active || !thumb) return;
        e.preventDefault();
        isDragging = true;
        var thumbRect = thumb.getBoundingClientRect();
        thumbClickOffset = e.clientY - thumbRect.top;
        document.body.style.userSelect = 'none';
        thumb.classList.add('bg-primary');
    }

    function onDocumentMouseMove(e) {
        showTrackNearCursor(e);
        if (!isDragging || !track || !thumb) return;

        var trackRect = track.getBoundingClientRect();
        var thumbH = thumb.clientHeight;
        var maxThumbTop = trackRect.height - thumbH;
        var newThumbTop = e.clientY - trackRect.top - thumbClickOffset;
        newThumbTop = Math.max(0, Math.min(newThumbTop, maxThumbTop));

        // Move thumb immediately so it doesn't feel stuck while the page scrolls.
        thumb.style.top = newThumbTop + 'px';

        var scrollRatio = maxThumbTop > 0 ? newThumbTop / maxThumbTop : 0;
        var docH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        var maxScroll = Math.max(0, docH - window.innerHeight);
        window.scrollTo(0, scrollRatio * maxScroll);
    }

    function onDocumentMouseUp() {
        if (!isDragging) return;
        isDragging = false;
        document.body.style.userSelect = '';
        if (thumb) thumb.classList.remove('bg-primary');
        updatePageScrollbar();
    }

    function wire() {
        if (wired) return;
        wired = true;
        track = document.getElementById('page-scroll-track');
        thumb = document.getElementById('page-scroll-thumb');
        document.addEventListener('mousemove', onDocumentMouseMove);
        window.addEventListener('scroll', updatePageScrollbar, { passive: true });
        window.addEventListener('resize', updatePageScrollbar);
        document.addEventListener('mouseup', onDocumentMouseUp);
        if (thumb) thumb.addEventListener('mousedown', onThumbMouseDown);
    }

    function unwire() {
        if (!wired) return;
        wired = false;
        active = false;
        isDragging = false;
        document.removeEventListener('mousemove', onDocumentMouseMove);
        window.removeEventListener('scroll', updatePageScrollbar);
        window.removeEventListener('resize', updatePageScrollbar);
        document.removeEventListener('mouseup', onDocumentMouseUp);
        if (thumb) thumb.removeEventListener('mousedown', onThumbMouseDown);
        if (track) {
            track.classList.add('opacity-0', 'translate-x-4', 'pointer-events-none');
            track.classList.remove('opacity-100', 'translate-x-0', 'pointer-events-auto');
            track.style.display = '';
            track.style.visibility = '';
        }
        track = null;
        thumb = null;
    }

    window.usertypoPageScrollbar = {
        enable: function () {
            wire();
            active = true;
            setTimeout(updatePageScrollbar, 50);
            setTimeout(updatePageScrollbar, 350);
        },
        disable: function () {
            unwire();
        },
        refresh: function () {
            if (active) updatePageScrollbar();
        },
    };
})();
