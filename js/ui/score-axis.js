/**
 * Shared helpers for the Score Distribution charts (About page + User stats).
 * Public: window.usertypoScoreAxis
 *
 * - mergeBins(bins, factor): combine adjacent WPM buckets (factor 2 turns 5-WPM bins into 10-WPM bins).
 * - makeLabel(text): x-axis label cell that sits under one bar.
 * - layoutLabels(xAxis): if a label is wider than its bar, rotate it anticlockwise by just
 *   enough to fit the bar's width. Labels that already fit stay horizontal.
 *   Returns { allFit } so callers can switch to wider buckets when labels still don't fit.
 */
(function () {
    function mergeBins(bins, factor) {
        if (!Array.isArray(bins)) return [];
        if (!(factor > 1)) return bins.slice();
        var out = [];
        for (var i = 0; i < bins.length; i += factor) {
            var group = bins.slice(i, i + factor);
            out.push({
                start: group[0].start,
                end: group[group.length - 1].end,
                count: group.reduce(function (sum, b) { return sum + (Number(b.count) || 0); }, 0),
            });
        }
        return out;
    }

    function makeLabel(text) {
        var cell = document.createElement('span');
        cell.className = 'score-axis-cell';
        var label = document.createElement('span');
        label.className = 'score-axis-label';
        label.textContent = text;
        cell.appendChild(label);
        return cell;
    }

    function layoutLabels(xAxis) {
        var cells = Array.prototype.slice.call(xAxis.children);
        var items = [];

        // Pass 1: measure each label flat and find the angle it needs to fit its bar
        var sharedAngle = 0;
        cells.forEach(function (cell) {
            var label = cell.firstElementChild;
            if (!label) return;
            label.style.left = '50%';
            label.style.right = 'auto';
            label.style.transformOrigin = '';
            label.style.transform = 'translateX(-50%)';
            var textWidth = label.offsetWidth;
            var textHeight = label.offsetHeight;
            var barWidth = cell.clientWidth;
            items.push({ label: label, cell: cell, textWidth: textWidth, textHeight: textHeight });

            if (textWidth <= barWidth + 0.5) return;
            // Smallest anticlockwise angle whose footprint fits under this bar
            var needed = 90;
            for (var a = 1; a <= 90; a++) {
                var rad = a * Math.PI / 180;
                if (textWidth * Math.cos(rad) + textHeight * Math.sin(rad) <= barWidth + 0.5) {
                    needed = a;
                    break;
                }
            }
            if (needed > sharedAngle) sharedAngle = needed;
        });

        // Pass 2: every label uses the same angle, set by the longest/narrowest one
        var maxFootprint = 0;
        var rad2 = sharedAngle * Math.PI / 180;
        items.forEach(function (item) {
            var label = item.label;
            if (sharedAngle === 0) {
                label.style.left = '50%';
                label.style.right = 'auto';
                label.style.transform = 'translateX(-50%)';
            } else {
                // Rotate around the label's top-right corner so it hangs under the bar's centre
                label.style.left = 'auto';
                label.style.right = '50%';
                label.style.transformOrigin = '100% 0';
                label.style.transform = 'rotate(' + (-sharedAngle) + 'deg)';
            }
            var footprint = item.textWidth * Math.sin(rad2) + item.textHeight * Math.cos(rad2);
            if (footprint > maxFootprint) maxFootprint = footprint;
        });

        var height = Math.ceil(maxFootprint) + 6;
        cells.forEach(function (cell) {
            cell.style.height = height + 'px';
        });
        return { allFit: sharedAngle === 0 };
    }

    window.usertypoScoreAxis = {
        mergeBins: mergeBins,
        makeLabel: makeLabel,
        layoutLabels: layoutLabels,
    };
})();
