(() => {
  const form = document.querySelector('#bespoke-form');
  const imageInput = document.querySelector('#bespoke-image');
  const imagePreview = document.querySelector('#bespoke-preview');
  const status = document.querySelector('#bespoke-message');
  const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  let attachment = '';

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('This image could not be read. Please choose another.'));
      reader.readAsDataURL(file);
    });
  }

  imageInput.addEventListener('change', async () => {
    attachment = '';
    imagePreview.hidden = true;
    const file = imageInput.files?.[0];
    if (!file) return;
    if (!imageTypes.has(file.type)) {
      imageInput.value = '';
      status.textContent = 'Choose a PNG, JPEG or WebP image.';
      status.dataset.error = 'true';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      imageInput.value = '';
      status.textContent = 'The reference image must be 2 MB or smaller.';
      status.dataset.error = 'true';
      return;
    }
    try {
      attachment = await readImage(file);
      imagePreview.src = attachment;
      imagePreview.hidden = false;
      status.textContent = '';
      delete status.dataset.error;
    } catch (error) {
      status.textContent = error.message;
      status.dataset.error = 'true';
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const submit = form.querySelector('button[type="submit"]');
    const body = Object.fromEntries(new FormData(form));
    delete body.imageFile;
    if (attachment) body.attachment = attachment;
    status.textContent = 'Sending your request…';
    delete status.dataset.error;
    submit.disabled = true;
    try {
      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Your enquiry could not be sent. Please try again.');
      status.textContent = `Thank you. Your request reference is ${result.reference}. Our team can follow up using the contact details you provided.`;
      form.reset();
      attachment = '';
      imagePreview.removeAttribute('src');
      imagePreview.hidden = true;
    } catch (error) {
      status.textContent = error.message;
      status.dataset.error = 'true';
    } finally {
      submit.disabled = false;
    }
  });

  // Prefill contact fields for signed-in clients while leaving them editable.
  fetch('/api/account').then(response => response.json()).then(result => {
    if (!result.authenticated || !result.customer) return;
    if (!form.elements.name.value) form.elements.name.value = result.customer.name || '';
    if (!form.elements.email.value) form.elements.email.value = result.customer.email || '';
    form.querySelector('.bespoke-contact').hidden = true;
    const note = document.createElement('p');
    note.className = 'field-hint';
    note.textContent = `We’ll reply using your account contact: ${result.customer.email}.`;
    form.querySelector('.bespoke-contact').before(note);
  }).catch(() => {});
})();
