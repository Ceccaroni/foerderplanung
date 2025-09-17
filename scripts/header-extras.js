// Tabs aktiv halten + Smooth-Scroll + Avatar-State
(function(){
  const tabs = Array.from(document.querySelectorAll('.fp-tab'));
  const avatars = Array.from(document.querySelectorAll('.fp-avatar'));
  const sections = [
    { id:'#stammdaten-h', tab: tabs[0], av: avatars[0] },
    { id:'#docs-h',       tab: tabs[1], av: avatars[1] },
    { id:'#zielbaum-h',   tab: tabs[3], av: avatars[2] },
  ];
  const foto = document.querySelector('#foto-h');
  if (foto) sections.splice(2,0,{ id:'#foto-h', tab: tabs[2], av: null });

  function setActive(id){
    tabs.forEach(t => t.removeAttribute('aria-current'));
    avatars.forEach(a => a?.classList.remove('is-active'));
    const s = sections.find(x => x.id === id);
    if (!s) return;
    s.tab.setAttribute('aria-current','page');
    if (s.av) s.av.classList.add('is-active');
  }

  // Click: Tabs
  tabs.forEach(t => {
    t.addEventListener('click', (e) => {
      const href = t.getAttribute('href');
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      setActive(href);
      target.scrollIntoView({ behavior:'smooth', block:'start' });
      history.replaceState(null,'',href);
    });
  });

  // Click: Avatare (data-goto="#…")
  avatars.forEach(a => {
    const to = a.getAttribute('data-goto');
    if (!to) return;
    a.addEventListener('click', () => {
      const target = document.querySelector(to);
      if (!target) return;
      setActive(to);
      target.scrollIntoView({ behavior:'smooth', block:'start' });
      history.replaceState(null,'',to);
    });
  });

  // Scroll: aktives Register automatisch setzen
  const io = new IntersectionObserver((entries) => {
    // am stärksten sichtbarer Abschnitt gewinnt
    let best = null, bestRatio = 0;
    for (const e of entries){
      if (e.isIntersecting && e.intersectionRatio > bestRatio){
        bestRatio = e.intersectionRatio;
        best = e.target;
      }
    }
    if (!best) return;
    const id = '#'+best.id;
    const hit = sections.find(s => s.id === id);
    if (hit) setActive(id);
  }, { rootMargin: '-40% 0px -50% 0px', threshold: [0, .25, .5, .75, 1] });

  sections.forEach(s => {
    const h = document.querySelector(s.id);
    if (h) io.observe(h);
  });

  // initial anhand der URL
  const fromHash = sections.find(s => s.id === location.hash);
  setActive(fromHash ? fromHash.id : sections[0].id);
})();
