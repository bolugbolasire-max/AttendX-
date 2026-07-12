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
// CONTACT FORM (placeholder handler)
// ==========================
const contactForm = document.getElementById('contactForm');

if (contactForm) {
  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();
    // TODO: Replace this with a real submission (e.g. Firebase Firestore
    // write, or an email service) once the backend is wired up.
    alert('Thanks for reaching out! We will get back to you shortly.');
    contactForm.reset();
  });
}