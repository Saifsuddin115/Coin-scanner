

(function () {

    /* ---------- 1. CONFIG ---------------------------------------
       Change these without touching any logic below.
    ---------------------------------------------------------------*/

    // Hour (24h, local time) that a new trading day begins.
    // 20 = 8:00 PM. Before this hour, "today" is the trading day.
    // At/after this hour, the trading day is already tomorrow's date.
    const CONTRACT_CUTOFF_HOUR = 20;

    // How long the punishment screen sits before it auto-advances
    // to the next contract. In milliseconds.
    const PUNISHMENT_DURATION_MS = 3 * 60 * 1000; // 3 minutes

    // The line shown on every contract. Keep it short — it's meant
    // to be read every single night, not skimmed once.
    const RULE_TEXT = "Follow the TC today if you truly want to be profitable.";

    // Shown on the sign step (the "or else") AND on the punishment
    // step (the "this is what you owe"). Edit freely.
    const PUNISHMENT_LIST = [
        "100 push-ups",
        "100 sit-ups",
        "A cold shower",
        "A 5-minute plank"
    ];

    // localStorage keys — everything for this system lives here.
    const KEY_CURRENT = "tc_contract_current";
    const KEY_HISTORY = "tc_contract_history";


    /* ---------- 2. TRADING DAY MATH ------------------------------
       A "trading day" is identified by a YYYY-MM-DD key + a nice
       display label. The only thing that makes it different from a
       normal calendar day is WHEN the key changes: at 8 PM, not
       midnight.

       NOTE: this uses local getFullYear/getMonth/getDate (not
       toISOString) on purpose — toISOString converts to UTC first,
       which can silently shift the date near midnight depending on
       your timezone. This way the key always matches the date on
       your actual clock.
    ---------------------------------------------------------------*/

    function pad(n) {
        return n.toString().padStart(2, "0");
    }

    function dateKey(d) {
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    // Returns { key, label, dateObj } for the trading day that
    // `now` currently falls in.
    function getTradingDayInfo(now = new Date()) {
        const d = new Date(now.getTime());

        if (d.getHours() >= CONTRACT_CUTOFF_HOUR) {
            // We've crossed the 8 PM cutoff — this belongs to
            // tomorrow's trading day.
            d.setDate(d.getDate() + 1);
        }

        d.setHours(0, 0, 0, 0);

        const label = d.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric"
        });

        return { key: dateKey(d), label, dateObj: d };
    }


    /* ---------- 3. STORAGE ----------------------------------------
       "current" = the contract that's active right now (signed, not
       yet reviewed). "history" = an array of past contracts, each
       with `followed` set to true or false once reviewed.
    ---------------------------------------------------------------*/

    function loadCurrent() {
        try {
            const raw = localStorage.getItem(KEY_CURRENT);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function saveCurrent(contract) {
        if (contract === null) {
            localStorage.removeItem(KEY_CURRENT);
        } else {
            localStorage.setItem(KEY_CURRENT, JSON.stringify(contract));
        }
    }

    function loadHistory() {
        try {
            const raw = localStorage.getItem(KEY_HISTORY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function pushToHistory(contract) {
        const history = loadHistory();
        history.unshift(contract); // newest first
        localStorage.setItem(KEY_HISTORY, JSON.stringify(history));
    }


    /* ---------- 4. DIALOG + STEPS ----------------------------------
       One <dialog> element, reused for every step by swapping its
       innerHTML. It is opened with showModal() exactly once per
       cycle and only closed at the very end of the confirm step —
       the 'cancel' event (ESC key) is blocked so the whole thing
       cannot be dismissed early.

       Flow: review (optional) -> punishment (optional) -> sign
             -> confirm -> [No loops back to sign] -> [Yes closes]
    ---------------------------------------------------------------*/

    let dialogEl = null;

    function ensureDialog() {
        if (dialogEl) return dialogEl;

        dialogEl = document.createElement("dialog");
        dialogEl.id = "tcContractDialog";
        document.body.appendChild(dialogEl);

        // Block ESC-to-close — this contract isn't optional.
        dialogEl.addEventListener("cancel", (e) => e.preventDefault());

        return dialogEl;
    }

    // Step: "Did you follow yesterday's contract?"
    function showReviewStep(prevContract, today) {
        const dialog = ensureDialog();

        dialog.innerHTML = `
            <div class="tc-date">${prevContract.label}</div>
            <div class="tc-title">Did you follow the TC?</div>
            <div class="tc-review-buttons">
                <button type="button" id="tcReviewYes" aria-label="Yes">&#10003;</button>
                <button type="button" id="tcReviewNo" aria-label="No">&#10005;</button>
            </div>
        `;

        if (!dialog.open) dialog.showModal();

        document.getElementById("tcReviewYes").addEventListener("click", () => {
            prevContract.followed = true;
            pushToHistory(prevContract);
            saveCurrent(null);
            showSignStep(today);
        });

        document.getElementById("tcReviewNo").addEventListener("click", () => {
            prevContract.followed = false;
            pushToHistory(prevContract);
            saveCurrent(null);
            showPunishmentStep(today);
        });
    }

    // Step: punishment screen, auto-advances after PUNISHMENT_DURATION_MS
    function showPunishmentStep(today) {
        const dialog = ensureDialog();

        const listHtml = PUNISHMENT_LIST
            .map((item) => `<li>${item}</li>`)
            .join("");

        dialog.innerHTML = `
            <div class="tc-title">Pay it off.</div>
            <ul class="tc-punishment-list">${listHtml}</ul>
            <div class="tc-countdown">Next contract in <span id="tcCountdown"></span></div>
        `;

        if (!dialog.open) dialog.showModal();

        let remainingMs = PUNISHMENT_DURATION_MS;
        const countdownEl = document.getElementById("tcCountdown");

        function renderCountdown() {
            const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
            const m = Math.floor(totalSeconds / 60);
            const s = totalSeconds % 60;
            countdownEl.textContent = `${m}:${pad(s)}`;
        }

        renderCountdown();

        const intervalId = setInterval(() => {
            remainingMs -= 1000;
            renderCountdown();

            if (remainingMs <= 0) {
                clearInterval(intervalId);
                showSignStep(today);
            }
        }, 1000);
    }

    // Step: sign today's/tonight's contract.
    // `prefillName` is only set when we bounce back here after a
    // "No" on the confirm step, so you don't have to retype it.
    function showSignStep(today, prefillName = "") {
        const dialog = ensureDialog();

        const punishmentItems = PUNISHMENT_LIST.join(", ");

        dialog.innerHTML = `
            <div class="tc-date">${today.label}</div>
            <div class="tc-title">The Contract</div>
            <div class="tc-rule-text">${RULE_TEXT}</div>
            <div class="tc-punishment-note">
                If you don't: <strong>${punishmentItems}</strong>.
            </div>
            <label class="tc-signature-label" for="tcSignatureInput">Sign to confirm</label>
            <input
                type="text"
                id="tcSignatureInput"
                class="tc-signature-input"
                placeholder="Type your name"
                autocomplete="off"
                spellcheck="false"
                autocorrect="off"
                autocapitalize="off"
            />
            <button type="button" id="tcConfirmBtn" disabled>Confirm</button>
        `;

        if (!dialog.open) dialog.showModal();

        const input = document.getElementById("tcSignatureInput");
        const confirmBtn = document.getElementById("tcConfirmBtn");

        if (prefillName) {
            input.value = prefillName;
            confirmBtn.disabled = false;
        }

        input.addEventListener("input", () => {
            confirmBtn.disabled = input.value.trim().length === 0;
        });

        confirmBtn.addEventListener("click", () => {
            const name = input.value.trim();
            if (!name) return;
            showConfirmStep(today, name);
        });
    }

    // Step: "Sign as [name]?" Yes/No — Yes saves + closes,
    // No goes back to the signature step with the name kept.
    function showConfirmStep(today, name) {
        const dialog = ensureDialog();

        dialog.innerHTML = `
            <div class="tc-date">${today.label}</div>
            <div class="tc-title">Sign as ${name}?</div>
            <div class="tc-confirm-buttons">
                <button type="button" id="tcConfirmYes">Yes</button>
                <button type="button" id="tcConfirmNo">No</button>
            </div>
        `;

        document.getElementById("tcConfirmYes").addEventListener("click", () => {
            saveCurrent({
                key: today.key,
                label: today.label,
                signedBy: name,
                signedAt: new Date().toISOString(),
                followed: null
            });
            dialog.close();
        });

        document.getElementById("tcConfirmNo").addEventListener("click", () => {
            showSignStep(today, name);
        });
    }


    /* ---------- 5. PUBLIC API (used by Contract.html) --------------
       Returns every contract — history plus today's in-progress one
       if it exists — newest first, ready to render as a list.
    ---------------------------------------------------------------*/

    function getAllContracts() {
        const history = loadHistory();
        const current = loadCurrent();

        const all = current ? [{ ...current, isActive: true }, ...history] : history;
        return all;
    }

    function renderHistory(container) {
        const contracts = getAllContracts();

        if (contracts.length === 0) {
            container.innerHTML = `<div class="tc-history-empty">No contracts signed yet.</div>`;
            return;
        }

        container.innerHTML = contracts
            .map((c) => {
                let statusHtml;
                if (c.isActive) {
                    statusHtml = `<div class="tc-history-status pending">In progress</div>`;
                } else if (c.followed === true) {
                    statusHtml = `<div class="tc-history-status">&#10003;</div>`;
                } else {
                    statusHtml = `<div class="tc-history-status">&#10005;</div>`;
                }

                const signedTime = c.signedAt
                    ? new Date(c.signedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : "";

                return `
                    <div class="tc-history-row">
                        <div>
                            <div class="tc-history-date">${c.label}</div>
                            <div class="tc-history-signed">Signed by ${c.signedBy} at ${signedTime}</div>
                        </div>
                        ${statusHtml}
                    </div>
                `;
            })
            .join("");
    }

    // Expose the bits Contract.html needs.
    window.TCContract = { getAllContracts, renderHistory };


    /* ---------- 6. BOOT ---------------------------------------------
       Decide what (if anything) needs to show, the moment the page
       loads. This is the entire state machine:

         no contract saved at all       -> sign today's contract
         current.key === today's key    -> already handled, do nothing
         current.key !== today's key    -> a new trading day started:
             current.followed === null  -> ask review question first
             (anything else)            -> just sign the new one
    ---------------------------------------------------------------*/

    function runContractCheck() {
        const today = getTradingDayInfo();
        const current = loadCurrent();

        if (!current) {
            showSignStep(today);
            return;
        }

        if (current.key === today.key) {
            // Still inside the trading day this contract was signed
            // for — nothing to do, let the user use the app.
            return;
        }

        // A new trading day has begun since `current` was created.
        if (current.followed === null) {
            showReviewStep(current, today);
        } else {
            // Leftover state (shouldn't normally happen since the
            // dialog can't be dismissed mid-flow) — just recover by
            // signing the new day's contract.
            showSignStep(today);
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        runContractCheck();

        // If this page has a history list container, fill it in.
        const historyContainer = document.getElementById("tcHistoryList");
        if (historyContainer) {
            renderHistory(historyContainer);
        }
    });

})();