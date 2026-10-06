document.querySelectorAll('[data-menu-toggle]').forEach((button) => {
  const nav = document.getElementById(button.getAttribute('aria-controls'));
  button.addEventListener('click', () => {
    const isOpen = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!isOpen));
    nav.classList.toggle('open', !isOpen);
  });

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      button.setAttribute('aria-expanded', 'false');
      nav.classList.remove('open');
    });
  });
});

const formTabs = document.querySelectorAll('[data-form-mode]');
const registerForm = document.getElementById('register-form');
const loginForm = document.getElementById('login-form');
const accountMessage = document.getElementById('account-message');

function showAccountMessage(message, isError = false) {
  if (!accountMessage) return;
  accountMessage.textContent = message;
  accountMessage.classList.add('visible');
  accountMessage.classList.toggle('error', isError);
}

formTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const mode = tab.dataset.formMode;
    formTabs.forEach((item) => item.classList.toggle('active', item === tab));
    registerForm?.classList.toggle('form-hidden', mode !== 'register');
    loginForm?.classList.toggle('form-hidden', mode !== 'login');
    accountMessage?.classList.remove('visible');
  });
});

async function submitAccountForm(form, endpoint) {
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Please wait...';
  accountMessage?.classList.remove('visible');

  try {
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || 'We could not complete your request.');
    if (result.sessionToken) localStorage.setItem('bimavoltSession', result.sessionToken);
    showAccountMessage(result.message || 'Your request was received.');
    form.reset();
  } catch (error) {
    const message = error instanceof TypeError
      ? 'The registration service is not reachable. Start the BimaVolt server and try again.'
      : error.message;
    showAccountMessage(message, true);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = form === registerForm ? 'Create rider account' : 'Log in';
  }
}

registerForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!registerForm.reportValidity()) return;
  submitAccountForm(registerForm, '/api/auth/register');
});

loginForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  submitAccountForm(loginForm, '/api/auth/login');
});
