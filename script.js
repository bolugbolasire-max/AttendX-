// ==========================
// THEME TOGGLE (dark/light)
// ==========================
const themeToggle = document.getElementById('themeToggle');
const body = document.body;

// Load saved theme
if (localStorage.getItem('attendx-theme') === 'dark') {
  body.classList.add('dark');
  themeToggle.textContent = '☀️';
}

themeToggle.addEventListener('click', () => {
  body.classList.toggle('dark');
  const isDark = body.classList.contains('dark');
  themeToggle.textContent = isDark ? '☀️' : '🌙';
  localStorage.setItem('attendx-theme', isDark ? 'dark' : 'light');
});

// ==========================
// ANIMATED STAT COUNTERS
// ==========================
const counters = document.querySelectorAll('.counter');

function animateCounter(el) {
  const target = +el.getAttribute('data-target');
  const duration = 1500; // ms
  const startTime = performance.now();

  function update(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const value = Math.floor(progress * target);
    el.textContent = value.toLocaleString();
    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      el.textContent = target.toLocaleString();
    }
  }

  requestAnimationFrame(update);
}

// Only animate once, when the stats section scrolls into view
const statsSection = document.querySelector('.stats');
let statsAnimated = false;

if (statsSection) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && !statsAnimated) {
        counters.forEach(animateCounter);
        statsAnimated = true;
      }
    });
  }, { threshold: 0.3 });

  observer.observe(statsSection);
}

// ==========================
// BACK TO TOP BUTTON
// ==========================
const topBtn = document.getElementById('topBtn');

window.addEventListener('scroll', () => {
  if (window.scrollY > 400) {
    topBtn.style.display = 'block';
  } else {
    topBtn.style.display = 'none';
  }
});

topBtn.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ==========================
// SMOOTH SCROLL FOR NAV LINKS
// ==========================
document.querySelectorAll('nav ul a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (e) => {
    const targetId = link.getAttribute('href');
    if (targetId.length > 1) {
      const targetEl = document.querySelector(targetId);
      if (targetEl) {
        e.preventDefault();
        targetEl.scrollIntoView({ behavior: 'smooth' });
      }
    }
  });
});

// ==========================
// CONTACT FORM (EmailJS)
// ==========================
// Sends the form directly to your inbox via EmailJS — no backend needed.
// Public key is safe to expose in client-side code (that's how EmailJS
// is designed to work); it is NOT a secret like an API private key.
(function () {
  const EMAILJS_PUBLIC_KEY = "RXL1cXvWmv3NC0fuH";
  const EMAILJS_SERVICE_ID = "service_q648zvm";
  const EMAILJS_TEMPLATE_ID = "template_kdwk9xy";

  if (window.emailjs) {
    emailjs.init(EMAILJS_PUBLIC_KEY);
  }

  const contactForm = document.getElementById('contactForm');
  const contactSubmitBtn = document.getElementById('contactSubmitBtn');
  const contactFormMessage = document.getElementById('contactFormMessage');

  function showContactMessage(text, type) {
    if (!contactFormMessage) return;
    contactFormMessage.textContent = text;
    contactFormMessage.className = `form-message ${type}`;
  }

  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();

      if (!window.emailjs) {
        showContactMessage("Could not connect to the mail service. Please try again shortly.", "error");
        return;
      }

      showContactMessage("", "");
      contactSubmitBtn.disabled = true;
      contactSubmitBtn.textContent = "Sending...";

      const templateParams = {
        name: document.getElementById('contactName').value.trim(),
        email: document.getElementById('contactEmail').value.trim(),
        message: document.getElementById('contactMessage').value.trim()
      };

      emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams)
        .then(() => {
          showContactMessage("Thanks for reaching out! We'll get back to you shortly.", "success");
          contactForm.reset();
        })
        .catch((error) => {
          console.error("EmailJS error:", error);
          showContactMessage("Something went wrong sending your message. Please try again.", "error");
        })
        .finally(() => {
          contactSubmitBtn.disabled = false;
          contactSubmitBtn.textContent = "Send Message";
        });
    });
  }
})();