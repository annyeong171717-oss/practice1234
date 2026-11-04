/* ==========================================================================
   Kim Jeongwon - Self Introduction & Portfolio (Vanilla JavaScript)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    initMobileNav();
    initNavbarScroll();
    initModal();
    initContactForm();
    initScrollAnimations();
});

/* 1. Mobile Navigation Toggle */
function initMobileNav() {
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const navMenu = document.getElementById('nav-menu');

    if (mobileBtn && navMenu) {
        mobileBtn.addEventListener('click', () => {
            navMenu.classList.toggle('open');
            const icon = mobileBtn.querySelector('i');
            if (navMenu.classList.contains('open')) {
                icon.className = 'fa-solid fa-xmark';
            } else {
                icon.className = 'fa-solid fa-bars';
            }
        });

        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                navMenu.classList.remove('open');
                if (mobileBtn.querySelector('i')) {
                    mobileBtn.querySelector('i').className = 'fa-solid fa-bars';
                }
            });
        });
    }
}

/* 2. Navbar Sticky Effect & Active Link Highlight */
function initNavbarScroll() {
    const navbar = document.querySelector('.navbar');
    const sections = document.querySelectorAll('section');
    const navLinks = document.querySelectorAll('.nav-link');

    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }

        let currentSection = '';
        sections.forEach(section => {
            const sectionTop = section.offsetTop - 120;
            const sectionHeight = section.clientHeight;
            if (window.scrollY >= sectionTop && window.scrollY < sectionTop + sectionHeight) {
                currentSection = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${currentSection}`) {
                link.classList.add('active');
            }
        });
    });
}

/* 3. Modal Window Handling for Multiple Modals */
function initModal() {
    const triggers = document.querySelectorAll('.modal-trigger');
    const overlays = document.querySelectorAll('.modal-overlay');

    triggers.forEach(trigger => {
        trigger.addEventListener('click', () => {
            const modalId = trigger.getAttribute('data-modal');
            const targetModal = document.getElementById(modalId);
            if (targetModal) {
                targetModal.classList.add('active');
            }
        });
    });

    overlays.forEach(modal => {
        const closeBtn = modal.querySelector('.modal-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.classList.remove('active');
            });
        }
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });
}

/* 4. Contact Form & Toast Notification */
function initContactForm() {
    const form = document.getElementById('contact-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('sender-name').value;
        const email = document.getElementById('sender-email').value;
        const message = document.getElementById('sender-message').value;

        if (name && email && message) {
            const messages = JSON.parse(localStorage.getItem('user_messages') || '[]');
            messages.push({ name, email, message, date: new Date().toISOString() });
            localStorage.setItem('user_messages', JSON.stringify(messages));

            showToast(`${name}님의 메시지가 성공적으로 전달되었습니다! 💌`);
            form.reset();
        }
    });
}

function showToast(message) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-message');

    if (!toast || !toastMsg) return;

    toastMsg.innerText = message;
    toast.classList.remove('hidden');

    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3500);
}

/* 5. Scroll Animations for Progress Bars */
function initScrollAnimations() {
    const skillSection = document.getElementById('global-skills');
    const progressFills = document.querySelectorAll('.progress-bar-fill');

    let animated = false;

    window.addEventListener('scroll', () => {
        if (!skillSection) return;
        const sectionPos = skillSection.getBoundingClientRect().top;
        const screenPos = window.innerHeight / 1.3;

        if (sectionPos < screenPos && !animated) {
            progressFills.forEach(fill => {
                const targetWidth = fill.style.width;
                fill.style.width = '0%';
                setTimeout(() => {
                    fill.style.width = targetWidth;
                }, 100);
            });
            animated = true;
        }
    });
}
