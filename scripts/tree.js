(function(){
  const tree = document.getElementById('ziel-tree');
  if (!tree) return;

  // Initial: Gruppen an aria-expanded koppeln
  function syncGroups(){
    tree.querySelectorAll('[role="group"]').forEach(group => {
      const controller = group.previousElementSibling; // das treeitem davor
      const open = controller?.getAttribute('aria-expanded') === 'true';
      group.hidden = !open;
      const twisty = controller?.querySelector('.twisty');
      if (twisty) twisty.textContent = open ? '▾' : '▸';
    });
  }

  // Fokusverwaltung: genau ein treeitem tabbable
  function setOnlyTabbable(el){
    tree.querySelectorAll('[role="treeitem"]').forEach(n => n.setAttribute('tabindex','-1'));
    if (el) el.setAttribute('tabindex','0');
    el?.focus();
  }

  // Toggle auf/zu
  function toggle(item){
    if (!item.hasAttribute('aria-expanded')) return; // Blatt
    const open = item.getAttribute('aria-expanded') === 'true';
    item.setAttribute('aria-expanded', open ? 'false' : 'true');
    syncGroups();
  }

  // Klick-Handling (Twisty oder Doppelklick auf Zeile)
  tree.addEventListener('click', e => {
    const item = e.target.closest('[role="treeitem"]');
    if (!item) return;

    if (e.target.classList.contains('twisty') || e.detail === 2) {
      toggle(item);
    } else {
      tree.querySelectorAll('[aria-selected="true"]').forEach(n => n.removeAttribute('aria-selected'));
      item.setAttribute('aria-selected', 'true');
      setOnlyTabbable(item);
    }
  });

  // Tastatur gemäss ARIA-Tree: Pfeile, Home/Ende, Enter/Space, Links/Rechts
  tree.addEventListener('keydown', e => {
    const items = [...tree.querySelectorAll('[role="treeitem"]')];
    let current = document.activeElement.closest('[role="treeitem"]');
    if (!current) { setOnlyTabbable(items[0]); return; }
    let i = items.indexOf(current);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault(); setOnlyTabbable(items[Math.min(i+1, items.length-1)]); break;
      case 'ArrowUp':
        e.preventDefault(); setOnlyTabbable(items[Math.max(i-1, 0)]); break;
      case 'Home':
        e.preventDefault(); setOnlyTabbable(items[0]); break;
      case 'End':
        e.preventDefault(); setOnlyTabbable(items[items.length-1]); break;
      case 'ArrowRight':
      case 'Enter':
      case ' ':
        e.preventDefault(); toggle(current); break;
      case 'ArrowLeft':
        e.preventDefault();
        if (current.getAttribute('aria-expanded') === 'true') {
          toggle(current);
        } else {
          const parentGroup = current.parentElement.closest('[role="group"]');
          const parentItem = parentGroup?.previousElementSibling;
          if (parentItem) setOnlyTabbable(parentItem);
        }
        break;
    }
  });

  // Auswahl initial auf erstes Item
  const first = tree.querySelector('[role="treeitem"]');
  if (first) { first.setAttribute('aria-selected','true'); }
  syncGroups();
})();
