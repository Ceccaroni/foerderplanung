// Tabs & Avatare: sanftes Scrollen, aktiver Tab
function selectTab(a) {
  document.querySelectorAll('.fp-tabs .fp-tab')
    .forEach(t => t.removeAttribute('aria-current'));
  a.setAttribute('aria-current', 'page');
}
function goto(id) {
  const el = document.querySelector(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.fp-tabs .fp-tab').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (id && id.startsWith('#')) {
        e.preventDefault();
        goto(id);
        selectTab(a);
      }
    });
  });
  document.querySelectorAll('.fp-avatar[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-goto');
      if (id) goto(id);
    });
  });
});
