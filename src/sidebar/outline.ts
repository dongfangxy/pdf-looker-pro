/**
 * Outline (bookmark) tree.
 *
 * Destinations are already resolved to page numbers by the viewer, so this module
 * only builds DOM and reports navigation intent.
 */
import type { OutlineEntry } from '../viewer/viewer.js';

export interface OutlineHandlers {
  onNavigate(page: number): void;
}

export function renderOutline(container: HTMLElement, entries: OutlineEntry[], handlers: OutlineHandlers): void {
  container.replaceChildren();
  if (entries.length === 0) return;

  const root = document.createElement('ul');
  root.className = 'outline-tree';
  appendNodes(root, entries, handlers);
  container.appendChild(root);
}

function appendNodes(parent: HTMLElement, entries: OutlineEntry[], handlers: OutlineHandlers): void {
  for (const entry of entries) {
    const li = document.createElement('li');
    li.className = 'outline-node';

    const row = document.createElement('div');
    row.className = 'outline-row';

    const hasChildren = entry.children.length > 0;
    const twisty = document.createElement('button');
    twisty.type = 'button';
    twisty.className = 'outline-twisty';
    twisty.tabIndex = -1;
    twisty.textContent = hasChildren ? '▸' : '';
    twisty.disabled = !hasChildren;
    row.appendChild(twisty);

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'outline-label';
    label.textContent = entry.title;
    if (entry.bold) label.style.fontWeight = '600';
    if (entry.italic) label.style.fontStyle = 'italic';
    if (entry.page === null) {
      label.disabled = true;
      label.title = '此条目没有可跳转的目标';
    } else {
      label.title = `第 ${entry.page} 页`;
      label.addEventListener('click', () => handlers.onNavigate(entry.page as number));
    }
    row.appendChild(label);
    li.appendChild(row);

    if (hasChildren) {
      const childList = document.createElement('ul');
      childList.className = 'outline-tree nested collapsed';
      appendNodes(childList, entry.children, handlers);
      li.appendChild(childList);

      const toggle = (): void => {
        const collapsed = childList.classList.toggle('collapsed');
        twisty.textContent = collapsed ? '▸' : '▾';
      };
      twisty.addEventListener('click', toggle);
      label.addEventListener('dblclick', toggle);
    }

    parent.appendChild(li);
  }
}
