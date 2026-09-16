/**
 * Fixed page-level custom scrollbar (matches leaderboards / home stats behavior).
 */
(function () {
    'use strict';

    var wired = false;
    var active = false;
    var isDragging = false;
    var startY = 0;
    var startScrollTop = 0;
    var track = null;
    var thumb = null;

    function updatePageScrollbar() {
        if (!active || !track || !thumb) return;
        var docH = document.documentElement.scrollHeight;
        var winH = window.innerHeight;
        var scrollable = docH - winH;
        if (scrollable <= 0) {
            track.style.display = 'none';
            return;
        }
        track.style.display = 'block';
        var pct = Math.min(1, Math.max(0, window.scrollY / scrollable));
        var trackH = track.clientHeight;
        var thumbH = Math.max(trackH * (winH / docH), 40);
        thumb.style.height = thumbH + 'px';
        if (!isDragging) {
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
        isDragging = true;
        startY = e.clientY;
        startScrollTop = window.scrollY;
        document.body.style.userSelect = 'none';
        thumb.classList.add('bg-primary');
    }

    function onDocumentMouseMove(e) {
        showTrackNearCursor(e);
        if (!isDragging || !track || !thumb) return;
        var docH = document.documentElement.scrollHeight;
        var winH = window.innerHeight;
        var maxScroll = docH - winH;
        var thumbH = thumb.clientHeight;
        var maxThumbTop = track.clientHeight - thumbH;
        var deltaY = e.clientY - startY;
        if (maxThumbTop > 0 && maxScroll > 0) {
            window.scrollTo(0, startScrollTop + (deltaY / maxThumbTop) * maxScroll);
        }
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
        window.addEventListener('scroll', updatePageScrollbar);
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
