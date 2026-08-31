/* ===========================================================
   PROTOTYPE NOTICE
   Everything in this file simulates a backend in the browser:
   there is no real mail server, SMS provider, database, or
   moderation model behind it. Every place that would need a
   real integration in production is marked with TODO(prod).
   =========================================================== */

/* ---------------- Newsletter signup ---------------- */
(function newsletterForm() {
  const form = document.getElementById("newsletter-form");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = form.querySelector("[name=email]").value.trim();
    const role = form.querySelector("input[name=role]:checked");
    const success = document.getElementById("newsletter-success");

    if (!email || !role) return;

    // TODO(prod): POST to a real subscription endpoint (e.g. your
    // ESP's API — Mailchimp, Postmark, Buttondown) which stores the
    // segment (role) so you can send audience-specific updates to
    // developers vs. carriers/platforms vs. regulators vs. general.
    console.log("[mock subscribe]", { email, role: role.value });

    success.textContent = `You're on the list as a ${role.nextElementSibling.textContent.trim()}. We'll send working-group updates to ${email}.`;
    success.classList.add("show");
    form.reset();
  });
})();

/* ---------------- Verification gate (email + phone) ---------------- */
const VerifyGate = (() => {
  let state = { email: null, phone: null, emailCode: null, phoneCode: null };

  function genCode() {
    // TODO(prod): never generate OTP codes client-side. This exists
    // only so the prototype can "verify" without a real backend.
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function goToStep(n) {
    document.querySelectorAll(".auth-panel").forEach((p) => p.classList.remove("active"));
    document.getElementById(`step-${n}`)?.classList.add("active");
    document.querySelectorAll(".step-track .seg").forEach((seg, i) => {
      seg.classList.toggle("done", i < n - 1);
      seg.classList.toggle("active", i === n - 1);
    });
  }

  function init() {
    const gate = document.getElementById("verify-gate");
    if (!gate) return;

    const alreadyVerified = sessionStorage.getItem("uidt_verified") === "true";
    if (alreadyVerified) {
      showBoard();
      return;
    }

    goToStep(1);

    // Step 1: email
    document.getElementById("email-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const email = document.getElementById("email-input").value.trim();
      if (!email) return;
      state.email = email;
      state.emailCode = genCode();
      // TODO(prod): trigger a real transactional email (e.g. via
      // Postmark/SES) containing a signed, single-use verification
      // link or code. Never expose the code in the DOM/console.
      console.log("[mock email code]", state.emailCode);
      document.getElementById("email-sent-to").textContent = email;
      document.getElementById("mock-email-code").textContent = state.emailCode;
      goToStep(2);
      focusFirstOtp("email-otp");
    });

    // Step 2: email OTP
    wireOtpRow("email-otp", () => {
      const entered = readOtp("email-otp");
      const status = document.getElementById("email-otp-status");
      if (entered === state.emailCode) {
        status.textContent = "";
        goToStep(3);
      } else {
        status.textContent = "That code doesn't match. Check the mock code above and try again.";
      }
    });

    // Step 3: phone
    document.getElementById("phone-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const phone = document.getElementById("phone-input").value.trim();
      if (!phone) return;
      state.phone = phone;
      state.phoneCode = genCode();
      // TODO(prod): trigger a real SMS via a provider (e.g. Twilio
      // Verify) rate-limited per number to prevent SMS-pumping abuse.
      console.log("[mock sms code]", state.phoneCode);
      document.getElementById("phone-sent-to").textContent = phone;
      document.getElementById("mock-phone-code").textContent = state.phoneCode;
      goToStep(4);
      focusFirstOtp("phone-otp");
    });

    // Step 4: phone OTP
    wireOtpRow("phone-otp", () => {
      const entered = readOtp("phone-otp");
      const status = document.getElementById("phone-otp-status");
      if (entered === state.phoneCode) {
        status.textContent = "";
        sessionStorage.setItem("uidt_verified", "true");
        sessionStorage.setItem("uidt_email", state.email);
        showBoard();
      } else {
        status.textContent = "That code doesn't match. Check the mock code above and try again.";
      }
    });
  }

  function wireOtpRow(rowId, onComplete) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const inputs = [...row.querySelectorAll("input")];
    inputs.forEach((input, idx) => {
      input.addEventListener("input", () => {
        input.value = input.value.replace(/[^0-9]/g, "").slice(0, 1);
        if (input.value && idx < inputs.length - 1) inputs[idx + 1].focus();
        if (inputs.every((i) => i.value)) onComplete();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && !input.value && idx > 0) inputs[idx - 1].focus();
      });
    });
  }

  function readOtp(rowId) {
    return [...document.getElementById(rowId).querySelectorAll("input")].map((i) => i.value).join("");
  }

  function focusFirstOtp(rowId) {
    setTimeout(() => document.querySelector(`#${rowId} input`)?.focus(), 30);
  }

  function showBoard() {
    document.getElementById("verify-gate").style.display = "none";
    const board = document.getElementById("board-app");
    board.style.display = "block";
    const badge = document.getElementById("session-identity");
    if (badge) badge.textContent = sessionStorage.getItem("uidt_email") || "verified sender";
  }

  function signOut() {
    sessionStorage.removeItem("uidt_verified");
    sessionStorage.removeItem("uidt_email");
    location.reload();
  }

  return { init, signOut };
})();

/* ---------------- Tiered auto-moderator ---------------- */
const AutoMod = (() => {
  // TODO(prod): replace this keyword/pattern stand-in with a real
  // pipeline: a spam/URL-reputation classifier for auto-removal,
  // and a lighter-touch model or heuristic set for the review queue.
  const AUTO_REMOVE_PATTERNS = [
    /\bfree\s+(crypto|money|gift\s*card)\b/i,
    /\bhttps?:\/\/[^\s]+\.(ru|top|xyz|zip)\b/i,
    /\bwire\s+transfer\b/i,
    /\bclick\s+here\s+now\b/i,
  ];
  const REVIEW_QUEUE_PATTERNS = [
    /\b(idiot|scam(mer)?|stupid)\b/i,
    /\bguarantee(d)?\b/i,
    /\bhttps?:\/\/[^\s]+/i, // any link, generally: hold for a human look
  ];

  function classify(text) {
    if (AUTO_REMOVE_PATTERNS.some((re) => re.test(text))) return "removed";
    if (REVIEW_QUEUE_PATTERNS.some((re) => re.test(text))) return "queued";
    return "posted";
  }

  return { classify };
})();

/* ---------------- Composer wiring ---------------- */
(function composer() {
  const form = document.getElementById("composer-form");
  if (!form) return;
  const list = document.getElementById("thread-list");
  const textarea = document.getElementById("composer-text");
  const boardSelect = document.getElementById("composer-board");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;

    const verdict = AutoMod.classify(text);
    const identity = sessionStorage.getItem("uidt_email") || "verified sender";
    const time = "just now";

    const banner = document.createElement("div");
    if (verdict === "removed") {
      banner.className = "mod-banner removed";
      banner.innerHTML = `<span class="glyph">&#10005;</span><span>Removed automatically. This post matched a known spam/malicious-link pattern. <br><small>TODO(prod): swap in a real classifier + link-reputation check.</small></span>`;
      list.prepend(banner);
    } else if (verdict === "queued") {
      banner.className = "mod-banner queued";
      banner.innerHTML = `<span class="glyph">&#8987;</span><span>Held for review. A moderator will approve or remove it before it's visible to others.</span>`;
      list.prepend(banner);
      list.prepend(buildThreadCard(identity, text, "queued", time));
    } else {
      banner.className = "mod-banner posted";
      banner.innerHTML = `<span class="glyph">&#10003;</span><span>Posted to the board.</span>`;
      list.prepend(banner);
      list.prepend(buildThreadCard(identity, text, "posted", time));
    }

    textarea.value = "";
    setTimeout(() => banner.remove(), 6000);
  });

  function buildThreadCard(identity, text, verdict, time) {
    const el = document.createElement("div");
    el.className = "thread" + (verdict === "queued" ? " flagged" : "");
    const pill = verdict === "queued"
      ? `<span class="pill queued">Pending review</span>`
      : `<span class="pill verified">Verified sender</span>`;
    el.innerHTML = `
      <div class="meta">
        <span class="id-chip"><span class="dot"></span>${identity}</span>
        <span>&middot;</span><span>${time}</span>
        <span>&middot;</span>${pill}
      </div>
      <p>${escapeHtml(text)}</p>
      <div class="stats"><span>0 replies</span><span>0 views</span></div>`;
    return el;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();

document.addEventListener("DOMContentLoaded", () => {
  VerifyGate.init();
  const signOutBtn = document.getElementById("sign-out");
  if (signOutBtn) signOutBtn.addEventListener("click", VerifyGate.signOut);
});
