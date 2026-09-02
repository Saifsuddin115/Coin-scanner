/* ================================================================
   TC SIDEBAR — DRAG TO REORDER (pointer-events version)
   ----------------------------------------------------------------
   Drop this in /static/nav.js and include it on every page, right
   after contract.js.

   Uses Pointer Events (not HTML5 drag-and-drop) on purpose — HTML5
   drag-and-drop only works with a mouse and does nothing on touch
   screens, which is most of this app's real usage. Pointer Events
   fire the same way for mouse, touch, and stylus.

   REQUIRED MARKUP — each sidebar button needs BOTH of these:
       data-nav-key="chart"     <- stable id, used to remember order
       data-href="/chart"       <- where it navigates on a plain tap

   No onclick="" attribute — this script does the navigating itself,
   so it can tell a tap apart from the start of a drag. If a button
   still has onclick="location.href=...", remove it; the two navigation
   paths will race each other.
   ================================================================ */

(function () {

    const STORAGE_KEY = "tc_nav_order";
    const DRAG_THRESHOLD_PX = 8; // how far you must move before it counts as a drag, not a tap

    // ---- inject just enough CSS for the drag state -------------
    const style = document.createElement("style");
    style.textContent = `
        #sidebar button[data-nav-key] {
            touch-action: none;      /* stop the page from scrolling while you drag */
            user-select: none;       /* stop text selection while dragging */
        }
        #sidebar button.tc-dragging {
            opacity: 0.35;
        }
    `;
    document.head.appendChild(style);

    function applySavedOrder(sidebar) {
        let order;
        try {
            order = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        } catch (e) {
            order = null;
        }
        if (!order) return;

        // Appending each button in saved order moves it to the end
        // of #sidebar one at a time, which leaves them in exactly
        // that order once the loop finishes.
        order.forEach((key) => {
            const btn = sidebar.querySelector(`button[data-nav-key="${key}"]`);
            if (btn) sidebar.appendChild(btn);
        });
    }

    function saveCurrentOrder(sidebar) {
        const order = Array.from(sidebar.querySelectorAll("button[data-nav-key]"))
            .map((btn) => btn.dataset.navKey);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
    }

    function wireUpButtons(sidebar) {
        let draggedBtn = null;
        let startY = 0;
        let hasMoved = false;

        sidebar.querySelectorAll("button[data-nav-key]").forEach((btn) => {

            btn.addEventListener("pointerdown", (e) => {
                draggedBtn = btn;
                startY = e.clientY;
                hasMoved = false;
                // lets this element keep receiving pointermove even if
                // the finger/cursor drifts outside its own bounding box
                btn.setPointerCapture(e.pointerId);
            });

            btn.addEventListener("pointermove", (e) => {
                if (!draggedBtn) return;

                if (!hasMoved && Math.abs(e.clientY - startY) > DRAG_THRESHOLD_PX) {
                    hasMoved = true;
                    draggedBtn.classList.add("tc-dragging");
                }
                if (!hasMoved) return;

                // Which button (if any) is currently under the pointer?
                const under = document.elementFromPoint(e.clientX, e.clientY);
                const overBtn = under && under.closest("button[data-nav-key]");
                if (!overBtn || overBtn === draggedBtn || !sidebar.contains(overBtn)) return;

                const rect = overBtn.getBoundingClientRect();
                const isBelowMidpoint = e.clientY - rect.top > rect.height / 2;

                if (isBelowMidpoint) {
                    overBtn.after(draggedBtn);
                } else {
                    overBtn.before(draggedBtn);
                }
            });

            function finishDrag() {
                if (draggedBtn) draggedBtn.classList.remove("tc-dragging");

                if (hasMoved) {
                    saveCurrentOrder(sidebar);
                }

                draggedBtn = null;
                hasMoved = false;
            }

            btn.addEventListener("pointerup", () => finishDrag());
            btn.addEventListener("pointercancel", () => finishDrag());

            // The actual navigation. Only fires on a real tap — if the
            // pointerup above just finished a drag, hasMoved was true
            // and we already reset it, so check happens via a closure
            // flag captured at click time instead.
            btn.addEventListener("click", (e) => {
                // If this click immediately follows a drag, the browser
                // still fires it (that's normal DOM behavior) — but by
                // the time click fires, pointerup already ran and reset
                // hasMoved, so we need our own short-lived flag instead.
                if (btn.dataset.tcJustDragged === "1") {
                    e.preventDefault();
                    delete btn.dataset.tcJustDragged;
                    return;
                }
                const href = btn.dataset.href;
                if (href) location.href = href;
            });

            btn.addEventListener("pointerup", () => {
                if (hasMoved) btn.dataset.tcJustDragged = "1";
            });
        });
    }

    document.addEventListener("DOMContentLoaded", () => {
        const sidebar = document.getElementById("sidebar");
        if (!sidebar) return;

        applySavedOrder(sidebar);
        wireUpButtons(sidebar);
    });

})();
