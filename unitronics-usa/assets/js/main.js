/* Unitronics USA — UI interactions (no dependencies) */
(() => {
  const doc = document.documentElement;
  doc.classList.remove("no-js");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* Mobile menu -------------------------------------------------------- */
  const toggle = document.querySelector(".nav__toggle");
  const setMenu = (open) => {
    doc.classList.toggle("nav-open", open);
    toggle?.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
  };
  toggle?.addEventListener("click", () => setMenu(!doc.classList.contains("nav-open")));
  document.querySelectorAll(".mobile-menu a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
  addEventListener("keydown", (e) => e.key === "Escape" && setMenu(false));

  /* Header state + scroll progress ------------------------------------- */
  const header = document.querySelector(".site-header");
  const progress = document.querySelector(".progress");
  let lastY = scrollY;
  let ticking = false;
  const onScroll = () => {
    const y = scrollY;
    header?.classList.toggle("is-scrolled", y > 12);
    if (!doc.classList.contains("nav-open")) {
      header?.classList.toggle("is-hidden", y > 400 && y > lastY + 4);
      if (y < lastY - 4) header?.classList.remove("is-hidden");
    }
    const max = doc.scrollHeight - innerHeight;
    progress?.style.setProperty("--p", max > 0 ? (y / max).toFixed(4) : 0);
    doc.style.setProperty("--scroll", y.toFixed(1));
    lastY = y;
    ticking = false;
  };
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();

  /* Reveal on scroll --------------------------------------------------- */
  const reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("is-in"));
  }

  /* Card spotlight + gentle 3D tilt (desktop) -------------------------- */
  if (finePointer) {
    document.querySelectorAll(".card, .contact-card").forEach((card) => {
      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        card.style.setProperty("--mx", `${x}px`);
        card.style.setProperty("--my", `${y}px`);
        if (!reduceMotion && card.classList.contains("card") && !card.querySelector(".card__stage, .service__stage")) {
          const rx = ((y / r.height) - 0.5) * -5;
          const ry = ((x / r.width) - 0.5) * 5;
          card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;
        }
      });
      card.addEventListener("pointerleave", () => { card.style.transform = ""; });
    });

    /* Magnetic buttons */
    if (!reduceMotion) {
      document.querySelectorAll(".btn").forEach((btn) => {
        btn.addEventListener("pointermove", (e) => {
          const r = btn.getBoundingClientRect();
          const dx = e.clientX - (r.left + r.width / 2);
          const dy = e.clientY - (r.top + r.height / 2);
          btn.style.transform = `translate(${dx * 0.15}px, ${dy * 0.25}px)`;
        });
        btn.addEventListener("pointerleave", () => { btn.style.transform = ""; });
      });
    }
  }

  /* Whole-card links --------------------------------------------------- */
  document.querySelectorAll(".card--link").forEach((card) => {
    const link = card.querySelector("a[href]");
    if (!link) return;
    card.addEventListener("click", (e) => {
      if (e.target.closest("a, .card__stage")) return;
      if (getSelection().toString()) return;
      link.click();
    });
  });

  /* Instant navigation: prefetch internal pages on hover / touch -------- */
  const prefetched = new Set();
  const supportsSpeculation = HTMLScriptElement.supports?.("speculationrules");
  const prefetch = (url) => {
    if (supportsSpeculation || prefetched.has(url)) return;
    prefetched.add(url);
    const l = document.createElement("link");
    l.rel = "prefetch"; l.href = url;
    document.head.appendChild(l);
  };
  document.querySelectorAll('a[href$=".html"], a[href="./"], a[href="/"]').forEach((a) => {
    if (a.origin !== location.origin) return;
    const go = () => prefetch(a.href);
    a.addEventListener("pointerenter", go, { passive: true });
    a.addEventListener("touchstart", go, { passive: true });
    a.addEventListener("focus", go);
  });

  /* Contact form → opens the visitor's mail app, pre-filled ------------ */
  const form = document.querySelector("#contact-form");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const d = new FormData(form);
    const subject = `Website enquiry — ${d.get("topic") || "General"}`;
    const body = [
      `Name: ${d.get("name")}`,
      `Email: ${d.get("email")}`,
      `Phone: ${d.get("phone") || "-"}`,
      `Company: ${d.get("company") || "-"}`,
      "",
      d.get("message"),
    ].join("\n");
    location.href = `mailto:elcardo@unitronics-sa.co.za?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const note = form.querySelector(".form__note");
    if (note) note.textContent = "Opening your email app… If nothing happens, email elcardo@unitronics-sa.co.za directly.";
  });

  /* Footer year -------------------------------------------------------- */
  document.querySelectorAll("[data-year]").forEach((el) => { el.textContent = new Date().getFullYear(); });
})();
