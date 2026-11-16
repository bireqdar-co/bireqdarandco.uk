// Contact form submission and enquiry status feedback.
(() => {
  const reference = new URLSearchParams(location.search).get('reference');
  if (reference) document.querySelector('#reference').value = reference;
  const form = document.querySelector('#enquiry-form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const message = document.querySelector('#form-message');
    message.textContent = 'Sending enquiry…';
    try {
      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form)))
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The enquiry could not be sent.');
      message.textContent = `Thank you. Your enquiry is recorded as ${data.reference}. Our team can follow up by email.`;
      form.reset();
    } catch (error) {
      message.textContent = error.message;
    }
  });
})();
